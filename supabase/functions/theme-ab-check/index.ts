import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { analyzeThemes } from "../_shared/theme-analysis.ts";

// READ-ONLY A/B quality check for the Haiku -> Gemini 2.5 Flash-Lite swap.
//
// Pulls a sample of responses that ALREADY have themes in ai_themes (the
// current/baseline extraction — Haiku or older), re-runs the new Gemini
// extraction on the same text IN MEMORY, and reports how closely Gemini
// agrees with the baseline. Writes NOTHING to the database — this exists
// purely to quantify quality before flipping the live pipeline over.
//
// Also doubles as the first real smoke test of the Gemini request shape
// (responseSchema + thinkingConfig): if the API rejects the payload, this
// surfaces it here instead of in production.
//
// Invoke:  POST { "limit": 40, "company_id": "<optional uuid>" }
// The baseline is whatever generated the existing ai_themes rows; it is not
// guaranteed to be Haiku for every row (older responses may predate it), so
// read the agreement numbers as "Gemini vs current production", not a pure
// Haiku A/B.

const BATCH_SIZE = 6;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

const supabase = createClient(
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_URL") ?? "",
  // @ts-ignore Deno.env is available in edge runtime
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

interface BaselineTheme {
  attribute_id: string;
  sentiment: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
    const companyIdFilter: string | undefined = body.company_id;

    // 1. Candidate responses: mentioned=true (matches the live gate), have
    //    real text, most recent first. Oversample so we can drop any without
    //    baseline themes and still reach `limit`.
    let q = supabase
      .from("prompt_responses")
      .select("id, response_text, company_id")
      .eq("company_mentioned", true)
      .not("response_text", "is", null)
      .order("tested_at", { ascending: false })
      .limit(limit * 4);
    if (companyIdFilter) q = q.eq("company_id", companyIdFilter);

    const { data: candidates, error: candErr } = await q;
    if (candErr) return json({ error: candErr.message }, 500);
    if (!candidates || candidates.length === 0) {
      return json({ error: "no candidate responses found" }, 404);
    }

    const usable = candidates.filter(
      (r: any) => typeof r.response_text === "string" && r.response_text.length > 100,
    );
    const candidateIds = usable.map((r: any) => r.id);

    // 2. Batch-load baseline themes for all candidates in one query, group by
    //    response_id. Only responses that actually have baseline themes are
    //    comparable.
    const { data: baselineRows, error: baseErr } = await supabase
      .from("ai_themes")
      .select("response_id, attribute_id, sentiment")
      .in("response_id", candidateIds);
    if (baseErr) return json({ error: baseErr.message }, 500);

    const baselineByResponse = new Map<string, BaselineTheme[]>();
    for (const row of (baselineRows ?? []) as any[]) {
      if (!baselineByResponse.has(row.response_id)) baselineByResponse.set(row.response_id, []);
      baselineByResponse.get(row.response_id)!.push({
        attribute_id: row.attribute_id,
        sentiment: row.sentiment,
      });
    }

    const withBaseline = usable.filter((r: any) => baselineByResponse.has(r.id)).slice(0, limit);
    if (withBaseline.length === 0) {
      return json({ error: "no sampled responses have baseline themes to compare against" }, 404);
    }

    // 3. Resolve company names in one batched query.
    const companyIds = Array.from(new Set(withBaseline.map((r: any) => r.company_id).filter(Boolean)));
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    const nameById = new Map((companies ?? []).map((c: any) => [c.id, c.name]));

    // 4. Re-theme with Gemini in parallel batches. No writes.
    const perResponse: any[] = [];
    for (let i = 0; i < withBaseline.length; i += BATCH_SIZE) {
      const batch = withBaseline.slice(i, i + BATCH_SIZE);
      const batchOut = await Promise.all(
        batch.map(async (r: any) => {
          const companyName = nameById.get(r.company_id);
          if (!companyName) return null; // unresolved name — skip from the sample

          const baseline = baselineByResponse.get(r.id)!;
          try {
            const gemini = await analyzeThemes(r.response_text, companyName);
            return diffOne(r.id, companyName, baseline, gemini);
          } catch (e: any) {
            return {
              response_id: r.id,
              error: e?.message ?? String(e),
            };
          }
        }),
      );
      for (const o of batchOut) if (o) perResponse.push(o);
    }

    const compared = perResponse.filter((p) => !p.error);
    const errored = perResponse.filter((p) => p.error);

    // 5. Aggregate.
    const n = compared.length;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

    const summary = {
      sampled: withBaseline.length,
      compared: n,
      errored: errored.length,
      baseline_note:
        "baseline = existing ai_themes rows (current production; may predate Haiku for older responses)",
      // How often the two agree on the SET of attributes for a response.
      avg_attribute_jaccard: round(avg(compared.map((c) => c.attribute_jaccard))),
      // Of attributes present in BOTH, how often the sentiment matches.
      avg_sentiment_agreement: round(avg(compared.map((c) => c.sentiment_agreement).filter((x) => x >= 0))),
      // Volume: are we getting materially fewer/more themes?
      avg_baseline_theme_count: round(avg(compared.map((c) => c.baseline_count))),
      avg_gemini_theme_count: round(avg(compared.map((c) => c.gemini_count))),
      // Regressions: baseline had themes but Gemini returned none.
      gemini_empty_when_baseline_nonempty: compared.filter((c) => c.gemini_count === 0).length,
      // Attributes Gemini emitted that folded to "unknown" (enum leakage).
      responses_with_unknown_attr: compared.filter((c) => c.gemini_unknown_count > 0).length,
    };

    // A few worst-agreement examples for eyeballing.
    const examples = [...compared]
      .sort((a, b) => a.attribute_jaccard - b.attribute_jaccard)
      .slice(0, 8);

    return json({ summary, examples, errors: errored.slice(0, 10) }, 200);
  } catch (err: any) {
    console.error("[theme-ab-check] unhandled error:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});

function diffOne(
  responseId: string,
  companyName: string,
  baseline: BaselineTheme[],
  gemini: { attribute_id: string; sentiment: string }[],
) {
  const baseAttrs = new Set(baseline.map((t) => t.attribute_id));
  const gemAttrs = new Set(gemini.map((t) => t.attribute_id));

  const intersection = [...baseAttrs].filter((a) => gemAttrs.has(a));
  const union = new Set([...baseAttrs, ...gemAttrs]);
  const jaccard = union.size === 0 ? 1 : intersection.length / union.size;

  // Sentiment agreement over attributes present in both. Compare the first
  // sentiment seen per attribute on each side (themes are attribute-scoped).
  const baseSent = firstSentimentByAttr(baseline);
  const gemSent = firstSentimentByAttr(gemini);
  let agree = 0;
  for (const a of intersection) if (baseSent.get(a) === gemSent.get(a)) agree++;
  const sentimentAgreement = intersection.length === 0 ? -1 : agree / intersection.length;

  return {
    response_id: responseId,
    company: companyName,
    baseline_count: baseline.length,
    gemini_count: gemini.length,
    attribute_jaccard: round(jaccard),
    sentiment_agreement: round(sentimentAgreement),
    gemini_unknown_count: gemini.filter((t) => t.attribute_id === "unknown").length,
    baseline_attrs: [...baseAttrs],
    gemini_attrs: [...gemAttrs],
    only_in_baseline: [...baseAttrs].filter((a) => !gemAttrs.has(a)),
    only_in_gemini: [...gemAttrs].filter((a) => !baseAttrs.has(a)),
  };
}

function firstSentimentByAttr(themes: { attribute_id: string; sentiment: string }[]) {
  const m = new Map<string, string>();
  for (const t of themes) if (!m.has(t.attribute_id)) m.set(t.attribute_id, t.sentiment);
  return m;
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
