import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Safety-net cron tick: pick up prompt_responses whose per-response theme
// trigger from analyze-response was lost (fire-and-forget invoke failed,
// OpenAI/Gemini rate-limited, function cold-start timed out, etc.) and hand
// them to ai-thematic-analysis-bulk.
//
// Scheduled every 5 min by cron job `theme-backfill-tick` (see migration
// 20260526_theme_backfill_safety_net.sql). In steady state most ticks find
// nothing and return immediately.

// Per-tick budget. ai-thematic-analysis-bulk processes 8 responses in
// parallel internally with a 250ms gap between batches, so 100 responses
// finish in ~30-60s — well under the 150s edge timeout even when split
// across multiple companies sequentially.
const MAX_RESPONSES_PER_TICK = 100;
const CHUNK_SIZE = 40;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // RPC instead of PostgREST so the planner can use NOT EXISTS + the
    // ai_themes(response_id) index for the anti-join.
    const { data: missing, error: missingErr } = await supabase.rpc(
      "find_responses_missing_themes",
      { p_limit: MAX_RESPONSES_PER_TICK, p_days: 90 },
    );

    if (missingErr) {
      console.error("[theme-backfill-tick] missing lookup failed:", missingErr);
      return json({ error: missingErr.message }, 500);
    }

    if (!missing || missing.length === 0) {
      return json({ processed: 0, message: "nothing to do" }, 200);
    }

    // Bucket by company so each bulk call gets a single company_name (the
    // bulk function uses it in its prompt for theme extraction).
    const byCompany = new Map<string, { id: string; response_text: string }[]>();
    for (const row of missing as Array<{ id: string; company_id: string; response_text: string }>) {
      if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
      byCompany.get(row.company_id)!.push({ id: row.id, response_text: row.response_text });
    }

    // Resolve company names in one batched query rather than N round-trips.
    const companyIds = Array.from(byCompany.keys());
    const { data: companies, error: companiesErr } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    if (companiesErr) {
      console.error("[theme-backfill-tick] company name lookup failed:", companiesErr);
      return json({ error: companiesErr.message }, 500);
    }
    const nameById = new Map((companies ?? []).map((c: any) => [c.id, c.name]));

    const results: any[] = [];
    let totalThemes = 0;
    let totalProcessed = 0;

    for (const [companyId, rows] of byCompany) {
      const companyName = nameById.get(companyId);
      if (!companyName) {
        console.warn(`[theme-backfill-tick] no name for company ${companyId}, skipping`);
        continue;
      }

      // Cap one company's slice so a heavy backlog on a single company
      // doesn't hog the whole tick — the rest get picked up next run.
      const slice = rows.slice(0, CHUNK_SIZE);

      const resp = await fetch(`${supabaseUrl}/functions/v1/ai-thematic-analysis-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({
          responses: slice.map((r) => ({ response_id: r.id, response_text: r.response_text })),
          company_name: companyName,
          clear_existing: false,
        }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.error(`[theme-backfill-tick] bulk failed for ${companyName}: ${resp.status} ${t.slice(0, 200)}`);
        results.push({ company: companyName, ok: false, sent: slice.length, status: resp.status });
        continue;
      }

      // Capture bulk's summary so a future investigation can tell "we sent
      // 40 but only 3 generated themes" without bisecting through logs.
      const body = await resp.json().catch(() => null);
      const summary = body?.summary ?? {};
      const themes = summary.total_themes_created ?? summary.total_themes ?? 0;
      totalThemes += themes;
      totalProcessed += slice.length;
      results.push({
        company: companyName,
        ok: true,
        sent: slice.length,
        themes_created: themes,
        successful: summary.successful_responses,
        failed: summary.failed_responses,
      });
    }

    return json({ processed: totalProcessed, found: missing.length, total_themes: totalThemes, results }, 200);
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
