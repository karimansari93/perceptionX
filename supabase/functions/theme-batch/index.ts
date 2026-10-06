import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.65.0";
import { corsHeaders } from "../_shared/cors.ts";
import { isCreditExhausted } from "../_shared/claude-keys.ts";
import {
  buildThemeRequest,
  CLASSIFIER_VERSION,
  clientFor,
  parseCompetitorList as parseCompetitors,
  parseThemeMessage,
} from "../_shared/theme-analysis.ts";

// Re-themes queued responses through the Message Batches API: same request
// body as live theming (buildThemeRequest), half the price, results within
// 24h (usually under an hour). Driven by cron every minute; each tick
// 1) collects finished batches into theme_batch_items.result,
// 2) applies stored results (replace the response's theme rows),
// 3) submits new batches from queued rows.
// See migration 20261006150000_theme_batch_tables.sql.

const BATCH_SIZE = 1000; // requests per Anthropic batch (~15 KB each)
const MAX_OPEN_JOBS = 4;
const APPLY_PER_TICK = 300;
const APPLY_CONCURRENCY = 6;
const MAX_ATTEMPTS = 3;
const TICK_BUDGET_MS = 110_000;

const KEY_SLOTS = ["CLAUDE_API_KEY", "CLAUDE_API_KEY_NEXT"];

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// @ts-ignore Deno.env is available in edge runtime
const keyFor = (slot: string) => Deno.env.get(slot) ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  const timeLeft = () => TICK_BUDGET_MS - (Date.now() - started);

  // Single runner at a time: take the lease or exit.
  const leaseUntil = new Date(Date.now() + 140_000).toISOString();
  const { data: lease } = await supabase
    .from("theme_batch_lease")
    .update({ leased_until: leaseUntil })
    .eq("id", true)
    .lt("leased_until", new Date().toISOString())
    .select();
  if (!lease || lease.length === 0) return json({ skipped: "lease held" });

  const summary: Record<string, unknown> = {};
  try {
    summary.collected = await collect(timeLeft);
    summary.applied = await apply(timeLeft);
    summary.submitted = await submit(timeLeft);
    return json(summary);
  } catch (e: any) {
    console.error("[theme-batch] tick failed:", e?.message ?? e);
    return json({ error: e?.message ?? String(e), ...summary }, 500);
  } finally {
    await supabase.from("theme_batch_lease").update({ leased_until: "epoch" }).eq("id", true);
  }
});

// 1. Pull results of ended batches into the queue rows.
async function collect(timeLeft: () => number) {
  const { data: jobs } = await supabase
    .from("theme_batch_jobs")
    .select("id, anthropic_batch_id, key_slot, company_name")
    .eq("status", "submitted");
  let collected = 0;
  for (const job of jobs ?? []) {
    if (timeLeft() < 40_000) break;
    const client = clientFor(keyFor(job.key_slot));
    const batch = await client.messages.batches.retrieve(job.anthropic_batch_id);
    if (batch.processing_status !== "ended") continue;

    const { data: items } = await supabase
      .from("theme_batch_items")
      .select("run_label, response_id, competitors, attempts")
      .eq("job_id", job.id)
      .eq("status", "submitted");
    const byId = new Map((items ?? []).map((i) => [i.response_id, i]));

    const updates: Record<string, unknown>[] = [];
    for await (const r of await client.messages.batches.results(job.anthropic_batch_id)) {
      const item = byId.get(r.custom_id);
      if (!item) continue;
      // A cut-off or declined reply parses as "no themes" and would wipe the
      // response's existing rows, so only a complete reply is stored.
      if (r.result.type === "succeeded" && r.result.message.stop_reason === "end_turn") {
        const parsed = parseThemeMessage(r.result.message, job.company_name, "", item.competitors ?? []);
        updates.push({ ...key(item), status: "stored", result: parsed, error: null });
      } else {
        const retry = item.attempts < MAX_ATTEMPTS;
        updates.push({
          ...key(item),
          status: retry ? "queued" : "failed",
          job_id: null,
          error: r.result.type === "succeeded"
            ? `stop_reason ${r.result.message.stop_reason}`
            : `batch result ${r.result.type}`,
        });
      }
      byId.delete(r.custom_id);
    }
    // Anything the batch didn't return goes back in the queue.
    for (const item of byId.values()) {
      updates.push({ ...key(item), status: "queued", job_id: null, error: "missing from batch results" });
    }
    await updateItems(updates);
    await supabase
      .from("theme_batch_jobs")
      .update({ status: "collected", collected_at: new Date().toISOString() })
      .eq("id", job.id);
    collected += updates.length;
  }
  return collected;
}

// 2. Replace each response's theme rows with the stored result. Rows queued
// with apply_result = false (reference checks) stay 'stored' and never touch
// live themes; compare them against theme_reference_labels instead.
async function apply(timeLeft: () => number) {
  const { data: items } = await supabase
    .from("theme_batch_items")
    .select("run_label, response_id, result")
    .eq("status", "stored")
    .eq("apply_result", true)
    .limit(APPLY_PER_TICK);
  let applied = 0;
  const queue = [...(items ?? [])];
  const worker = async () => {
    while (queue.length > 0 && timeLeft() > 15_000) {
      const item = queue.shift()!;
      const err = await replaceThemes(item.response_id, item.result);
      if (err) {
        await updateItems([{ ...key(item), status: "stored", error: err }]);
      } else {
        await updateItems([{ ...key(item), status: "applied", error: null }]);
        applied++;
      }
    }
  };
  await Promise.all(Array.from({ length: APPLY_CONCURRENCY }, worker));
  return applied;
}

async function replaceThemes(responseId: string, result: any): Promise<string | null> {
  const del1 = await supabase.from("competitor_themes").delete().eq("response_id", responseId);
  if (del1.error) return `delete competitor_themes: ${del1.error.message}`;
  const del2 = await supabase.from("ai_themes").delete().eq("response_id", responseId);
  if (del2.error) return `delete ai_themes: ${del2.error.message}`;

  const themes = result?.themes ?? [];
  if (themes.length > 0) {
    const { error } = await supabase.from("ai_themes").insert(themes.map((t: any) => ({
      response_id: responseId,
      theme_name: t.theme_name,
      theme_description: t.theme_description,
      sentiment: t.sentiment,
      sentiment_score: t.sentiment_score,
      attribute_id: t.attribute_id,
      attribute_name: t.attribute_name,
      confidence_score: t.confidence_score,
      keywords: t.keywords,
      context_snippets: t.context_snippets,
      classifier_version: CLASSIFIER_VERSION,
    })));
    if (error) return `insert ai_themes: ${error.message}`;
  }
  const comp = result?.competitorThemes ?? [];
  if (comp.length > 0) {
    const { error } = await supabase.from("competitor_themes").insert(comp.map((t: any) => ({
      response_id: responseId,
      competitor_name: t.competitor_name,
      attribute_id: t.attribute_id,
      attribute_name: t.attribute_name,
      sentiment: t.sentiment,
      sentiment_score: t.sentiment_score,
      context_snippet: t.context_snippet,
    })));
    if (error) console.warn(`[theme-batch] competitor insert for ${responseId}:`, error.message);
  }
  return null;
}

// 3. Submit queued rows, one company per batch.
async function submit(timeLeft: () => number) {
  const { count: open } = await supabase
    .from("theme_batch_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "submitted");
  let slots = MAX_OPEN_JOBS - (open ?? 0);
  let submitted = 0;
  while (slots > 0 && timeLeft() > 40_000) {
    const { data: next } = await supabase
      .from("theme_batch_items")
      .select("run_label, company_name")
      .eq("status", "queued")
      .limit(1);
    if (!next || next.length === 0) break;
    const { run_label, company_name } = next[0];

    const { data: items } = await supabase
      .from("theme_batch_items")
      .select("run_label, response_id, attempts")
      .eq("status", "queued")
      .eq("run_label", run_label)
      .eq("company_name", company_name)
      .limit(BATCH_SIZE);
    const ids = (items ?? []).map((i) => i.response_id);

    const texts = new Map<string, { text: string; competitors: string[] }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: rows, error } = await supabase
        .from("prompt_responses")
        .select("id, response_text, canonical_competitors, detected_competitors")
        .in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`load responses: ${error.message}`);
      for (const r of rows ?? []) {
        texts.set(r.id, {
          text: r.response_text ?? "",
          competitors: parseCompetitors(r.canonical_competitors ?? r.detected_competitors, company_name),
        });
      }
    }

    const usable = (items ?? []).filter((i) => (texts.get(i.response_id)?.text ?? "").length > 0);
    const requests = usable.map((i) => ({
      custom_id: i.response_id,
      params: buildThemeRequest(texts.get(i.response_id)!.text, company_name, texts.get(i.response_id)!.competitors),
    }));
    if (requests.length === 0) {
      await updateItems((items ?? []).map((i) => ({ ...key(i), status: "failed", error: "no response text" })));
      continue;
    }

    const { batch, slot } = await createBatch(requests);
    const { data: job, error: jobErr } = await supabase
      .from("theme_batch_jobs")
      .insert({
        run_label,
        company_name,
        anthropic_batch_id: batch.id,
        key_slot: slot,
        request_count: requests.length,
      })
      .select("id")
      .single();
    if (jobErr) throw new Error(`record job ${batch.id}: ${jobErr.message}`);

    await updateItems(usable.map((i) => ({
      ...key(i),
      status: "submitted",
      job_id: job.id,
      attempts: i.attempts + 1,
      competitors: texts.get(i.response_id)!.competitors,
      error: null,
    })));
    submitted += requests.length;
    slots--;
  }
  return submitted;
}

// Same key handover as live theming, but the batch must remember its key:
// results can only be read back with the key that created it.
async function createBatch(requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[]) {
  const slots = KEY_SLOTS.filter((s) => keyFor(s));
  if (slots.length === 0) throw new Error("Claude API key not configured");
  for (let i = 0; ; i++) {
    try {
      const batch = await clientFor(keyFor(slots[i])).messages.batches.create({ requests });
      return { batch, slot: slots[i] };
    } catch (err: any) {
      const exhausted = isCreditExhausted(err?.error) || isCreditExhausted({ message: err?.message });
      if (!exhausted || i === slots.length - 1) throw err;
    }
  }
}

const key = (i: { run_label: string; response_id: string }) => ({
  run_label: i.run_label,
  response_id: i.response_id,
});

// Bulk update through one RPC call (theme_batch_update_items); a key present
// in a row overwrites that field, an absent key leaves it unchanged.
async function updateItems(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.rpc("theme_batch_update_items", { p_rows: rows.slice(i, i + 500) });
    if (error) throw new Error(`update items: ${error.message}`);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
