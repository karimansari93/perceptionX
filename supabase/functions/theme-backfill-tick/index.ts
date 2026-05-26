import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Safety-net cron tick: pick up prompt_responses whose per-response theme
// trigger from analyze-response was lost (fire-and-forget invoke failed,
// OpenAI rate-limited, function cold-start timed out, etc.) and hand them
// to ai-thematic-analysis-bulk.
//
// Scheduled every 5 min by cron job `theme-backfill-tick` (see migration
// 20260526_theme_backfill_safety_net.sql), so a real-time gap can't last
// more than that window. In steady state most ticks find nothing and
// return immediately.

// Per-tick budget. ai-thematic-analysis-bulk batches at 3 responses/sec
// internally, so 100 = ~35s of OpenAI work — comfortably under the 150s
// edge timeout. The chunk size matches AnalyzeThemesPanel so behaviour
// is identical between the manual admin tool and the automated cron.
const MAX_RESPONSES_PER_TICK = 100;
const CHUNK_SIZE = 40;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
      return jsonResponse({ error: missingErr.message }, 500);
    }

    if (!missing || missing.length === 0) {
      return jsonResponse({ processed: 0, message: "nothing to do" }, 200);
    }

    // Bucket by company so we can call ai-thematic-analysis-bulk with one
    // company_name per call (the bulk function takes a single name).
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
      return jsonResponse({ error: companiesErr.message }, 500);
    }
    const nameById = new Map((companies ?? []).map((c: any) => [c.id, c.name]));

    const results: Array<{ company: string; ok: boolean; responses: number; error?: string }> = [];
    let totalProcessed = 0;

    for (const [companyId, rows] of byCompany) {
      const companyName = nameById.get(companyId);
      if (!companyName) {
        console.warn(`[theme-backfill-tick] no name for company ${companyId}, skipping`);
        continue;
      }

      // Cap one company's slice so a heavy backlog on a single company can't
      // hog the whole tick — the rest get picked up on the next run.
      const slice = rows.slice(0, CHUNK_SIZE);

      const resp = await fetch(`${supabaseUrl}/functions/v1/ai-thematic-analysis-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          responses: slice.map((r) => ({
            response_id: r.id,
            response_text: r.response_text,
          })),
          company_name: companyName,
          clear_existing: false,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error(`[theme-backfill-tick] bulk failed for ${companyName}: ${resp.status} ${text}`);
        results.push({ company: companyName, ok: false, responses: slice.length, error: `${resp.status}` });
        continue;
      }

      totalProcessed += slice.length;
      results.push({ company: companyName, ok: true, responses: slice.length });
    }

    return jsonResponse(
      { processed: totalProcessed, found: missing.length, results },
      200,
    );
  } catch (err: any) {
    console.error("[theme-backfill-tick] unhandled error:", err);
    return jsonResponse({ error: err?.message ?? "unknown error" }, 500);
  }
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
