import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Claude collection via the Anthropic Message Batches API.
 *
 * Why: batch usage is billed at 50% of standard prices — input, output, AND
 * web-search tokens — and the batch worker throttles web_search per org for
 * us (no manual staggering needed). Collection is monthly-snapshot work with
 * no latency requirement, so it's a perfect fit.
 *
 * Actions (POST {action: ...}):
 *  - submit: {action:'submit', companyId, promptIds?, skipIfCollectedInMonth?}
 *      Creates Anthropic Message Batches (custom_id = confirmed_prompt id,
 *      same params as the synchronous test-prompt-claude path: Sonnet 5,
 *      web search max_uses 3, research-assistant system prompt) for every
 *      prompt missing a claude response, and records them in
 *      claude_batch_jobs.
 *  - poll: {action:'poll'}
 *      Invoked by the claude_batch_tick pg_cron (every 2 min while jobs are
 *      in_progress). Retrieves ended batches, extracts text + citations from
 *      each result, and feeds them through analyze-response exactly like the
 *      synchronous path (which stores the row and triggers theme analysis).
 */

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1500;
const SYSTEM_PROMPT =
  "You are a research assistant. Use the web_search tool to find current, factual information before answering, and ground your answer in the sources you find. Always cite the sources you used.";
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  // Mirrors test-prompt-claude: each search round re-bills retrieved page
  // content as input tokens, so cap the rounds.
  max_uses: 3,
};

// Prompts per Anthropic batch. Small on purpose: each ended batch is fully
// processed (results -> analyze-response) inside one poll invocation, which
// must stay under the 150s edge-function limit. 20 results with analyze calls
// running 5-way parallel ≈ 30-60s.
const PROMPTS_PER_BATCH = 20;
// analyze-response concurrency per ended batch.
const ANALYZE_CONCURRENCY = 5;
// Stop picking up more ended batches after this much wall-clock in one poll.
const POLL_TIME_BUDGET_MS = 100_000;

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

/** Concatenate all text blocks — answers interleave with search blocks. */
function extractText(contentArray: any[]): string {
  return (contentArray || [])
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("")
    .trim();
}

/**
 * Extract native web-search citations (nested in text blocks as
 * web_search_result_location), falling back to raw search results.
 * Same logic and output shape as test-prompt-claude.
 */
function extractCitations(contentArray: any[]): any[] {
  const citations: any[] = [];
  const seen = new Set<string>();

  const toDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url || "";
    }
  };
  const push = (entry: { url?: string; title?: string; cited_text?: string }) => {
    const url = entry.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    citations.push({
      url,
      domain: toDomain(url),
      title: entry.title || toDomain(url),
      cited_text: entry.cited_text,
      type: "website",
      confidence: "high",
    });
  };

  for (const block of contentArray || []) {
    if (block?.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c?.type === "web_search_result_location" && c.url) {
          push({ url: c.url, title: c.title, cited_text: c.cited_text });
        }
      }
    }
  }
  if (citations.length === 0) {
    for (const block of contentArray || []) {
      if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r?.type === "web_search_result" && r.url) {
            push({ url: r.url, title: r.title });
          }
        }
      }
    }
  }
  return citations;
}

function messageParams(promptText: string) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: promptText }],
    tools: [WEB_SEARCH_TOOL],
  };
}

/**
 * The batch agentic loop can return stop_reason 'pause_turn' (turn not
 * finished). Continue it with ONE synchronous Messages call by resubmitting
 * the paused assistant content; if it pauses again we use what we have —
 * text + citations gathered so far are still valid.
 */
async function continuePausedTurn(
  apiKey: string,
  promptText: string,
  pausedContent: any[],
): Promise<any[]> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: "POST",
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        ...messageParams(promptText),
        messages: [
          { role: "user", content: promptText },
          { role: "assistant", content: pausedContent },
        ],
      }),
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.content)) {
      return [...pausedContent, ...data.content];
    }
    console.warn("pause_turn continuation failed:", data?.error?.message);
  } catch (e) {
    console.warn("pause_turn continuation error:", e);
  }
  return pausedContent;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    const apiKey = Deno.env.get("CLAUDE_API_KEY");
    if (!apiKey) throw new Error("CLAUDE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // =========================================================================
    // SUBMIT
    // =========================================================================
    if (action === "submit") {
      const { companyId, promptIds, skipIfCollectedInMonth } = body;
      if (!companyId) throw new Error("companyId is required");

      // Month window for the skip check (same semantics as
      // collect-company-responses): with a month set, only responses INSIDE
      // that month count as "already collected"; otherwise any response does.
      let monthStart: string | null = null;
      let monthEnd: string | null = null;
      if (skipIfCollectedInMonth && /^\d{4}-\d{2}$/.test(skipIfCollectedInMonth)) {
        const [y, m] = skipIfCollectedInMonth.split("-").map(Number);
        monthStart = new Date(Date.UTC(y, m - 1, 1)).toISOString();
        monthEnd = new Date(Date.UTC(y, m, 1)).toISOString();
      }

      let promptsQuery = supabase
        .from("confirmed_prompts")
        .select("id, prompt_text")
        .eq("company_id", companyId)
        .eq("is_active", true);
      if (Array.isArray(promptIds) && promptIds.length > 0) {
        promptsQuery = promptsQuery.in("id", promptIds);
      }
      const { data: prompts, error: promptsErr } = await promptsQuery;
      if (promptsErr) throw new Error(`Prompt fetch failed: ${promptsErr.message}`);

      if (!prompts || prompts.length === 0) {
        return new Response(
          JSON.stringify({ success: true, submitted: 0, message: "No prompts" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Skip prompts that already have a claude response (month-bounded).
      let existingQuery = supabase
        .from("prompt_responses")
        .select("confirmed_prompt_id")
        .eq("company_id", companyId)
        .eq("ai_model", "claude")
        .in("confirmed_prompt_id", prompts.map((p: any) => p.id));
      if (monthStart && monthEnd) {
        existingQuery = existingQuery.gte("created_at", monthStart).lt("created_at", monthEnd);
      }
      const { data: existing } = await existingQuery;
      const existingIds = new Set((existing || []).map((r: any) => r.confirmed_prompt_id));

      // Skip prompts already queued in an in-flight batch (dedupe guard —
      // the queue's chunked self-chaining calls submit repeatedly).
      const { data: inflightJobs } = await supabase
        .from("claude_batch_jobs")
        .select("prompt_ids")
        .eq("company_id", companyId)
        .eq("status", "in_progress");
      const inflightIds = new Set<string>(
        (inflightJobs || []).flatMap((j: any) => (Array.isArray(j.prompt_ids) ? j.prompt_ids : [])),
      );

      const toSubmit = prompts.filter(
        (p: any) => !existingIds.has(p.id) && !inflightIds.has(p.id),
      );

      if (toSubmit.length === 0) {
        return new Response(
          JSON.stringify({ success: true, submitted: 0, message: "All prompts already collected or in-flight" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      let batchesCreated = 0;
      for (let i = 0; i < toSubmit.length; i += PROMPTS_PER_BATCH) {
        const chunk = toSubmit.slice(i, i + PROMPTS_PER_BATCH);
        const requests = chunk.map((p: any) => ({
          custom_id: p.id, // uuid — matches ^[a-zA-Z0-9_-]{1,64}$
          params: messageParams(p.prompt_text),
        }));

        const res = await fetch(`${ANTHROPIC_BASE}/messages/batches`, {
          method: "POST",
          headers: anthropicHeaders(apiKey),
          body: JSON.stringify({ requests }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(`Anthropic batch create failed: ${data?.error?.message || res.status}`);
        }

        const { error: insertErr } = await supabase.from("claude_batch_jobs").insert({
          anthropic_batch_id: data.id,
          company_id: companyId,
          prompt_ids: chunk.map((p: any) => p.id),
        });
        if (insertErr) {
          // The Anthropic batch exists but we failed to record it — cancel it
          // so it doesn't burn tokens as an orphan.
          await fetch(`${ANTHROPIC_BASE}/messages/batches/${data.id}/cancel`, {
            method: "POST",
            headers: anthropicHeaders(apiKey),
          }).catch(() => {});
          throw new Error(`claude_batch_jobs insert failed: ${insertErr.message}`);
        }
        batchesCreated++;
        console.log(`Created Anthropic batch ${data.id} with ${chunk.length} prompts`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          submitted: toSubmit.length,
          batchesCreated,
          skippedExisting: existingIds.size,
          skippedInflight: inflightIds.size,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =========================================================================
    // POLL
    // =========================================================================
    if (action === "poll") {
      const started = Date.now();

      const { data: jobs, error: jobsErr } = await supabase
        .from("claude_batch_jobs")
        .select("*")
        .eq("status", "in_progress")
        .order("submitted_at", { ascending: true })
        .limit(10);
      if (jobsErr) throw new Error(`Job fetch failed: ${jobsErr.message}`);

      let processed = 0;
      const summaries: any[] = [];

      for (const job of jobs || []) {
        if (Date.now() - started > POLL_TIME_BUDGET_MS) break;

        const statusRes = await fetch(
          `${ANTHROPIC_BASE}/messages/batches/${job.anthropic_batch_id}`,
          { headers: anthropicHeaders(apiKey) },
        );
        const batch = await statusRes.json();
        if (!statusRes.ok) {
          console.error(`Batch ${job.anthropic_batch_id} status fetch failed:`, batch?.error?.message);
          continue;
        }
        if (batch.processing_status !== "ended") {
          summaries.push({ batch: job.anthropic_batch_id, status: batch.processing_status });
          continue;
        }
        if (!batch.results_url) {
          await supabase
            .from("claude_batch_jobs")
            .update({ status: "failed", ended_at: new Date().toISOString(), error_log: "ended without results_url" })
            .eq("id", job.id);
          continue;
        }

        // Context for analyze-response: company name + per-prompt metadata.
        const { data: companyRow } = await supabase
          .from("companies")
          .select("name")
          .eq("id", job.company_id)
          .single();
        const companyName = companyRow?.name;
        const { data: promptRows } = await supabase
          .from("confirmed_prompts")
          .select("id, prompt_text, prompt_type, attribute_id")
          .in("id", job.prompt_ids);
        const promptById = new Map((promptRows || []).map((p: any) => [p.id, p]));

        const resultsRes = await fetch(batch.results_url, { headers: anthropicHeaders(apiKey) });
        const resultsText = await resultsRes.text();
        const lines = resultsText.split("\n").filter((l) => l.trim().length > 0);

        let succeeded = 0;
        const errors: string[] = [];

        // Bounded-concurrency processing of results.
        for (let i = 0; i < lines.length; i += ANALYZE_CONCURRENCY) {
          const slice = lines.slice(i, i + ANALYZE_CONCURRENCY);
          await Promise.all(
            slice.map(async (line) => {
              let entry: any;
              try {
                entry = JSON.parse(line);
              } catch {
                errors.push("unparseable result line");
                return;
              }
              const promptId = entry.custom_id;
              const prompt = promptById.get(promptId);
              const resultType = entry?.result?.type;

              if (resultType !== "succeeded") {
                errors.push(`${promptId}: ${resultType} ${entry?.result?.error?.error?.message || ""}`.trim());
                return;
              }
              if (!prompt || !companyName) {
                errors.push(`${promptId}: missing prompt/company context`);
                return;
              }

              let contentArray: any[] = entry.result.message?.content || [];
              if (entry.result.message?.stop_reason === "pause_turn") {
                contentArray = await continuePausedTurn(apiKey, prompt.prompt_text, contentArray);
              }

              const responseText = extractText(contentArray);
              if (!responseText) {
                errors.push(`${promptId}: empty response`);
                return;
              }
              const citations = extractCitations(contentArray);

              const analyzeRes = await fetch(`${supabaseUrl}/functions/v1/analyze-response`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  response: responseText,
                  companyName,
                  promptType: prompt.prompt_type,
                  citations,
                  confirmed_prompt_id: promptId,
                  ai_model: "claude",
                  company_id: job.company_id,
                  isAttributePrompt: prompt.attribute_id != null,
                }),
              });
              if (!analyzeRes.ok) {
                const errData = await analyzeRes.json().catch(() => ({}));
                errors.push(`${promptId}: analyze failed ${errData?.error || analyzeRes.status}`);
                return;
              }
              succeeded++;
            }),
          );
        }

        await supabase
          .from("claude_batch_jobs")
          .update({
            status: errors.length > 0 && succeeded === 0 ? "failed" : "completed",
            ended_at: new Date().toISOString(),
            results_processed: lines.length,
            results_succeeded: succeeded,
            error_log: errors.length > 0 ? errors.slice(0, 20).join(" | ") : null,
          })
          .eq("id", job.id);

        processed++;
        summaries.push({
          batch: job.anthropic_batch_id,
          status: "processed",
          results: lines.length,
          succeeded,
          errors: errors.length,
        });
      }

      return new Response(
        JSON.stringify({ success: true, jobsChecked: (jobs || []).length, jobsProcessed: processed, summaries }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: any) {
    console.error("claude-batch-collector error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
