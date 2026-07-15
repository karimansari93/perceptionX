import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.65.0";
import { corsHeaders } from "../_shared/cors.ts";
import { buildMessageParams, parseThemesFromMessage } from "../_shared/theme-analysis.ts";

// Safety-net cron: theme any prompt_responses whose real-time trigger from
// analyze-response was lost. Runs on the Anthropic Message Batches API
// instead of synchronous calls:
//   - flat 50% discount on all tokens (this path is latency-insensitive
//     by definition — these responses already sat theme-less for hours)
//   - batch requests don't count against live rate limits, so the old
//     30-responses-per-20-minutes throttle (which protected the realtime
//     path's RPM headroom) is gone and the backlog drains ~30x faster
//   - synchronous Haiku at 100 responses/tick overruns the 150s edge
//     timeout; batches sidestep that entirely (submit-and-poll)
//
// Each tick (cron `theme-backfill-tick`, every 5 min):
//   1. Poll pending batches (theme_backfill_batches table). For each ended
//      batch: parse results, insert themes (skipping responses the realtime
//      path themed in the meantime), stamp zero-theme responses so they are
//      never resubmitted, and mark the batch row done.
//   2. If nothing is in flight, find missing responses and submit the next
//      batch (up to BATCH_SUBMIT_LIMIT requests, custom_id = response_id).
// Responses whose batch entry errored/expired still have no themes, so the
// next submission picks them up automatically — no retry bookkeeping.

const BATCH_SUBMIT_LIMIT = 500;
const INSERT_CHUNK = 200;
const IN_CHUNK = 100; // uuids per .in() filter — keeps PostgREST URLs short

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: Deno.env.get("CLAUDE_API_KEY") });

  try {
    // ---- Phase 1: harvest ended batches -------------------------------
    const { data: pending, error: pendingErr } = await supabase
      .from("theme_backfill_batches")
      .select("id, anthropic_batch_id, request_count")
      .eq("status", "pending");
    if (pendingErr) return json({ error: pendingErr.message }, 500);

    const harvested: any[] = [];
    let stillInFlight = 0;

    for (const row of pending ?? []) {
      const batch = await anthropic.messages.batches.retrieve(row.anthropic_batch_id);
      if (batch.processing_status !== "ended") {
        stillInFlight++;
        harvested.push({ batch_id: row.anthropic_batch_id, status: batch.processing_status });
        continue;
      }

      // Decode every succeeded result: custom_id is the response_id.
      const themed: { response_id: string; themes: any[] }[] = [];
      const emptyIds: string[] = [];
      let succeeded = 0;
      let failed = 0;
      const results = await anthropic.messages.batches.results(row.anthropic_batch_id);
      for await (const entry of results) {
        if (entry.result.type !== "succeeded") {
          failed++;
          continue;
        }
        succeeded++;
        const themes = parseThemesFromMessage(entry.result.message, entry.custom_id);
        if (themes.length > 0) themed.push({ response_id: entry.custom_id, themes });
        else emptyIds.push(entry.custom_id);
      }

      // A successful extraction with zero themes is a final answer, not a
      // failure — stamp it so find_responses_missing_themes() stops
      // resubmitting (and re-billing) the same response every cycle.
      const emptyAt = new Date().toISOString();
      for (let i = 0; i < emptyIds.length; i += IN_CHUNK) {
        const { error: markErr } = await supabase
          .from("prompt_responses")
          .update({ themes_none_found_at: emptyAt })
          .in("id", emptyIds.slice(i, i + IN_CHUNK));
        if (markErr) console.error("[theme-backfill-tick] failed to mark empty responses:", markErr);
      }

      // Skip responses the realtime trigger themed while the batch ran —
      // same clear_existing:false semantics as the old synchronous path.
      const already = new Set<string>();
      const ids = themed.map((t) => t.response_id);
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data: existing } = await supabase
          .from("ai_themes")
          .select("response_id")
          .in("response_id", ids.slice(i, i + IN_CHUNK));
        for (const e of existing ?? []) already.add(e.response_id);
      }

      const inserts = themed
        .filter((t) => !already.has(t.response_id))
        .flatMap((t) =>
          t.themes.map((theme) => ({
            response_id: t.response_id,
            theme_name: theme.theme_name,
            theme_description: theme.theme_description,
            sentiment: theme.sentiment,
            sentiment_score: theme.sentiment_score,
            attribute_id: theme.attribute_id,
            attribute_name: theme.attribute_name,
            confidence_score: theme.confidence_score,
            keywords: theme.keywords,
            context_snippets: theme.context_snippets,
          }))
        );

      let inserted = 0;
      for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
        const chunk = inserts.slice(i, i + INSERT_CHUNK);
        const { error: insertErr } = await supabase.from("ai_themes").insert(chunk);
        if (insertErr) {
          console.error(`[theme-backfill-tick] insert failed for batch ${row.anthropic_batch_id}:`, insertErr);
          continue; // uninserted responses stay theme-less → retried next batch
        }
        inserted += chunk.length;
      }

      const summary = {
        succeeded,
        failed,
        responses_themed: themed.length - already.size,
        marked_no_themes: emptyIds.length,
        skipped_already_themed: already.size,
        themes_inserted: inserted,
      };
      await supabase
        .from("theme_backfill_batches")
        .update({ status: "done", completed_at: new Date().toISOString(), result_summary: summary })
        .eq("id", row.id);
      harvested.push({ batch_id: row.anthropic_batch_id, status: "ended", ...summary });
    }

    // ---- Phase 2: submit the next batch if nothing is in flight --------
    if (stillInFlight > 0) {
      return json({ harvested, submitted: 0, message: "batch still in flight" }, 200);
    }

    const { data: missing, error: missingErr } = await supabase.rpc(
      "find_responses_missing_themes",
      { p_limit: BATCH_SUBMIT_LIMIT, p_days: 90 },
    );
    if (missingErr) {
      console.error("[theme-backfill-tick] missing lookup failed:", missingErr);
      return json({ harvested, error: missingErr.message }, 500);
    }
    if (!missing || missing.length === 0) {
      return json({ harvested, submitted: 0, message: "nothing to do" }, 200);
    }

    // Resolve company names in one batched query (the prompt names the company).
    const companyIds = Array.from(new Set(missing.map((r: any) => r.company_id)));
    const nameById = new Map<string, string>();
    for (let i = 0; i < companyIds.length; i += IN_CHUNK) {
      const { data: companies } = await supabase
        .from("companies")
        .select("id, name")
        .in("id", companyIds.slice(i, i + IN_CHUNK));
      for (const c of companies ?? []) nameById.set(c.id, c.name);
    }

    const requests = (missing as Array<{ id: string; company_id: string; response_text: string }>)
      .filter((r) => nameById.has(r.company_id))
      .map((r) => ({
        custom_id: r.id, // uuid — valid batch custom_id charset
        params: buildMessageParams(r.response_text, nameById.get(r.company_id)!),
      }));

    if (requests.length === 0) {
      return json({ harvested, submitted: 0, message: "no responses with resolvable company names" }, 200);
    }

    const created = await anthropic.messages.batches.create({ requests } as any);
    const { error: trackErr } = await supabase.from("theme_backfill_batches").insert({
      anthropic_batch_id: created.id,
      request_count: requests.length,
    });
    if (trackErr) {
      // The batch exists but we lost track of it — cancel so its responses
      // get resubmitted by a tracked batch instead of double-billing.
      console.error("[theme-backfill-tick] failed to record batch, canceling:", trackErr);
      await anthropic.messages.batches.cancel(created.id).catch(() => {});
      return json({ harvested, error: trackErr.message }, 500);
    }

    return json({ harvested, submitted: requests.length, batch_id: created.id }, 200);
  } catch (err: any) {
    console.error("[theme-backfill-tick] unhandled error:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
