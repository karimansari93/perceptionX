import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { analyzeThemes, parseCompetitorList } from "../_shared/theme-analysis.ts";

// Real-time, single-response theme extraction. Invoked fire-and-forget from
// analyze-response immediately after a prompt_response row is inserted.
// Failures here are caught and forgotten by the caller, so a separate
// safety-net cron (theme-backfill-tick) re-runs anything that slipped
// through. Both paths share _shared/theme-analysis.ts so the prompt and
// model are identical end-to-end.

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { response_id, company_name, response_text, force = false } = body;

    if (!response_id) {
      return json({ error: "response_id is required" }, 400);
    }
    if (!response_text) {
      return json({ error: "response_text is required" }, 400);
    }
    if (!company_name) {
      return json({ error: "company_name is required" }, 400);
    }

    // Idempotency: re-invocations for the same response_id should be no-ops
    // unless the caller explicitly asks to re-theme (force=true). This is
    // what makes it safe for the cron to race with the real-time trigger.
    const { data: existingThemes, error: checkError } = await supabase
      .from("ai_themes")
      .select("id")
      .eq("response_id", response_id);

    if (checkError) {
      console.error("Error checking existing themes:", checkError);
      return json({ error: "Failed to check existing themes", details: checkError }, 500);
    }

    if (existingThemes && existingThemes.length > 0 && !force) {
      return json({
        success: true,
        message: "Themes already exist for this response",
        existing_count: existingThemes.length,
      });
    }

    if (existingThemes && existingThemes.length > 0 && force) {
      const { error: deleteError } = await supabase
        .from("ai_themes")
        .delete()
        .eq("response_id", response_id);
      if (deleteError) {
        console.error("Error deleting existing themes:", deleteError);
        return json({ error: "Failed to delete existing themes", details: deleteError }, 500);
      }
      // Competitor triples are generated in the same extraction pass, so a
      // forced re-theme regenerates them too.
      const { error: deleteCompError } = await supabase
        .from("competitor_themes")
        .delete()
        .eq("response_id", response_id);
      if (deleteCompError) {
        console.warn("Error deleting existing competitor themes:", deleteCompError);
      }
    }

    // Competitors detected in this response (canonical form — the write-time
    // trigger keeps canonical_competitors fresh). Passed into the SAME
    // extraction call so competitor ↔ attribute ↔ sentiment triples come out
    // alongside the company themes.
    const { data: responseRow } = await supabase
      .from("prompt_responses")
      .select("canonical_competitors, detected_competitors")
      .eq("id", response_id)
      .maybeSingle();
    const competitors = parseCompetitorList(
      responseRow?.canonical_competitors ?? responseRow?.detected_competitors,
      company_name,
    );

    const { themes, competitorThemes } = await analyzeThemes(response_text, company_name, competitors);

    // Competitor rows are inserted regardless of whether company themes were
    // found (a discovery answer can describe competitors without saying
    // anything about the company). The BEFORE INSERT trigger canonicalizes
    // names, stamps company_id, and drops noise/self rows.
    let competitorThemesInserted = 0;
    if (competitorThemes.length > 0) {
      const { data: insertedComp, error: compInsertError } = await supabase
        .from("competitor_themes")
        .insert(competitorThemes.map((t) => ({
          response_id,
          competitor_name: t.competitor_name,
          attribute_id: t.attribute_id,
          attribute_name: t.attribute_name,
          sentiment: t.sentiment,
          sentiment_score: t.sentiment_score,
          context_snippet: t.context_snippet,
        })))
        .select();
      if (compInsertError) {
        console.warn("Error inserting competitor themes:", compInsertError);
      } else {
        competitorThemesInserted = insertedComp?.length ?? 0;
      }
    }

    if (themes.length === 0) {
      return json({
        success: true,
        message: "No themes identified",
        themes: [],
        competitor_themes: competitorThemesInserted,
      });
    }

    const themeInserts = themes.map((theme) => ({
      response_id,
      theme_name: theme.theme_name,
      theme_description: theme.theme_description,
      sentiment: theme.sentiment,
      sentiment_score: theme.sentiment_score,
      attribute_id: theme.attribute_id,
      attribute_name: theme.attribute_name,
      confidence_score: theme.confidence_score,
      keywords: theme.keywords,
      context_snippets: theme.context_snippets,
    }));

    const { data: insertedThemes, error: insertError } = await supabase
      .from("ai_themes")
      .insert(themeInserts)
      .select();

    if (insertError) {
      console.error("Error inserting themes:", insertError);
      return json({ error: "Failed to store themes", details: insertError }, 500);
    }

    return json({
      success: true,
      themes: insertedThemes,
      total_themes: insertedThemes.length,
      positive_themes: themes.filter((t) => t.sentiment === "positive").length,
      negative_themes: themes.filter((t) => t.sentiment === "negative").length,
      neutral_themes: themes.filter((t) => t.sentiment === "neutral").length,
      competitor_themes: competitorThemesInserted,
    });
  } catch (error: any) {
    console.error("Error in AI thematic analysis:", error);
    return json({ error: "Failed to analyze themes", details: error?.message ?? String(error) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
