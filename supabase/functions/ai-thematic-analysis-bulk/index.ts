import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { analyzeThemes } from "../_shared/theme-analysis.ts";

// Bulk theme extraction. Caller provides an array of { response_id,
// response_text } plus the company_name; we run Gemini 2.5 Flash on each
// in parallel (capped by BATCH_SIZE) and write the themes back. Used by
// the AnalyzeThemesPanel admin tool and the theme-backfill-tick cron.
//
// Gemini 2.5 Flash is faster (~1-3s) and cheaper than gpt-4o-mini, so we
// can afford higher parallelism. BATCH_SIZE 8 + 250ms gap = ~30 req/sec
// peak, well under the Tier-2 Gemini limit (~2k RPM = 33 RPS) and far
// faster than the old 3-parallel+1s gap pattern (~3 RPS) — a 40-response
// chunk drops from ~70s to ~15s, keeping us comfortably under the 150s
// edge timeout even on slow days.

const BATCH_SIZE = 8;
const INTER_BATCH_DELAY_MS = 250;

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

interface ResponseData {
  response_id: string;
  response_text: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { responses, company_name, clear_existing = true } = body;

    if (!Array.isArray(responses) || responses.length === 0) {
      return json({ error: "responses array is required and must not be empty" }, 400);
    }
    if (!company_name) {
      return json({ error: "company_name is required" }, 400);
    }

    const responseIds = responses.map((r: ResponseData) => r.response_id);

    if (clear_existing && responseIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("ai_themes")
        .delete()
        .in("response_id", responseIds);
      if (deleteError) {
        console.warn("Error clearing existing themes:", deleteError);
      }
    }

    const results: Array<Record<string, unknown>> = [];
    let totalThemesCreated = 0;

    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const batch = responses.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (response: ResponseData) => {
          try {
            // Skip-if-themed lets the cron race the real-time trigger
            // without double-paying for Gemini calls.
            const { data: existing } = await supabase
              .from("ai_themes")
              .select("id")
              .eq("response_id", response.response_id)
              .limit(1);

            if (existing && existing.length > 0) {
              return {
                response_id: response.response_id,
                success: true,
                message: "Themes already exist",
                themes_count: existing.length,
              };
            }

            const themes = await analyzeThemes(response.response_text, company_name);

            if (themes.length === 0) {
              return {
                response_id: response.response_id,
                success: true,
                message: "No themes identified",
                themes_count: 0,
              };
            }

            const themeInserts = themes.map((theme) => ({
              response_id: response.response_id,
              theme_name: theme.theme_name,
              theme_description: theme.theme_description,
              sentiment: theme.sentiment,
              sentiment_score: theme.sentiment_score,
              talentx_attribute_id: theme.talentx_attribute_id,
              talentx_attribute_name: theme.talentx_attribute_name,
              confidence_score: theme.confidence_score,
              keywords: theme.keywords,
              context_snippets: theme.context_snippets,
            }));

            const { data: insertedThemes, error: insertError } = await supabase
              .from("ai_themes")
              .insert(themeInserts)
              .select();

            if (insertError) {
              console.error(`Insert error for ${response.response_id}:`, insertError);
              return {
                response_id: response.response_id,
                success: false,
                error: insertError.message,
                themes_count: 0,
              };
            }

            return {
              response_id: response.response_id,
              success: true,
              themes_count: insertedThemes?.length ?? 0,
              positive_themes: themes.filter((t) => t.sentiment === "positive").length,
              negative_themes: themes.filter((t) => t.sentiment === "negative").length,
              neutral_themes: themes.filter((t) => t.sentiment === "neutral").length,
            };
          } catch (error: any) {
            console.error(`Error processing response ${response.response_id}:`, error?.message ?? error);
            return {
              response_id: response.response_id,
              success: false,
              error: error?.message ?? String(error),
              themes_count: 0,
            };
          }
        }),
      );

      for (const r of batchResults) {
        results.push(r);
        const n = (r as any).themes_count;
        if (typeof n === "number") totalThemesCreated += n;
      }

      // Small gap between batches keeps us under Gemini per-second limits
      // when the cron + admin panel happen to fire concurrently.
      if (i + BATCH_SIZE < responses.length) {
        await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
      }
    }

    const successful = results.filter((r) => (r as any).success);
    const failed = results.filter((r) => !(r as any).success);

    return json({
      success: true,
      summary: {
        total_responses: responses.length,
        successful_responses: successful.length,
        failed_responses: failed.length,
        total_themes: totalThemesCreated,
        total_themes_created: totalThemesCreated,
      },
      results,
    });
  } catch (error: any) {
    console.error("Error in bulk AI thematic analysis:", error);
    return json({ error: "Failed to analyze themes", details: error?.message ?? String(error) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
