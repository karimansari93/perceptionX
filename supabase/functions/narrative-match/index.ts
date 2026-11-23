import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.65.0";

// Employer Narrative matcher (docs/employer-narrative/metric-definitions.md).
// Compares each in-scope AI answer with the employer's active claims whose
// theme the answer touches, via the Message Batches API (half price).
// Run by hand, never on a schedule:
//   {"action":"submit", "company_ids":[...], "location_contexts":[...],
//    "start":"2026-10-01", "end":"2026-11-01", "dry_run":true|false}
//   {"action":"status",  "batch_id":"..."}
//   {"action":"collect", "batch_id":"..."}
// Service-role callers only: every call can spend money.

const MODEL = "claude-haiku-5-5";
const MATCHER_VERSION = "narrative-v1-2026-11";
const CLASSIFIER_VERSION = "v2-2026-10-06";

// @ts-ignore Deno.env is available in edge runtime
const env = (k: string) => Deno.env.get(k) ?? "";
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const anthropic = () => new Anthropic({ apiKey: env("CLAUDE_API_KEY") });

const SYSTEM = `You compare what an employer says about itself with what an AI assistant told a job candidate.

You get a list of the employer's claims, each with a label, and one AI answer. For EVERY claim, decide one verdict:
- "echoes": the answer states the claim or a clear equivalent about this employer.
- "contradicts": the answer says the opposite, as an opinion or framing (e.g. claim "collaborative culture", answer "siloed and political").
- "inaccurate": the answer states a specific fact about this employer (a policy, number, benefit, event or date) that conflicts with the claim, such as an old policy or a benefit described wrongly.
- "silent": the answer does not address this claim.

Rules:
- Judge only what the answer says about the named employer, not other companies.
- Mentioning the general topic is not enough to echo: the answer must convey the claim's substance.
- For any verdict except "silent", "quote" must be copied exactly, word for word, from the answer (one sentence or less). For "silent", quote is "".
- "reason" is one short line.
Return only JSON: {"results":[{"claim":"<label>","verdict":"...","quote":"...","reason":"..."}]}`;

type Claim = { id: string; company_id: string; organization_id: string; claim_text: string; attribute_id: string };

serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`) return json({ error: "service role only" }, 403);
  try {
    const body = await req.json();
    if (body.action === "submit") return json(await submit(body));
    if (body.action === "status") {
      const b = await anthropic().messages.batches.retrieve(body.batch_id);
      return json({ status: b.processing_status, counts: b.request_counts });
    }
    if (body.action === "collect") return json(await collect(body.batch_id));
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    console.error("[narrative-match]", e?.message ?? e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

async function loadClaims(companyIds: string[]): Promise<Claim[]> {
  const { data, error } = await supabase.from("narrative_claims")
    .select("id, company_id, organization_id, claim_text, attribute_id")
    .in("company_id", companyIds).eq("is_active", true).limit(1000);
  if (error) throw error;
  return data as Claim[];
}

const label = (c: Claim) => "c_" + c.id.slice(0, 8);

async function submit(p: any) {
  const { company_ids, location_contexts, start, end } = p;
  const claims = await loadClaims(company_ids);

  // PostgREST caps every read at 1,000 rows: page everything.
  const promptIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("confirmed_prompts")
      .select("id").in("company_id", company_ids).in("location_context", location_contexts)
      .order("id").range(from, from + 999);
    if (error) throw error;
    promptIds.push(...data!.map((x: any) => x.id));
    if (data!.length < 1000) break;
  }

  const answers: any[] = [];
  for (let i = 0; i < promptIds.length; i += 100) {
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase.from("prompt_responses")
        .select("id, company_id, response_text")
        .in("confirmed_prompt_id", promptIds.slice(i, i + 100))
        .gte("created_at", start).lt("created_at", end)
        .order("id").range(from, from + 499);
      if (error) throw error;
      answers.push(...data!);
      if (data!.length < 500) break;
    }
  }

  const themes = new Map<string, Set<string>>();
  for (let i = 0; i < answers.length; i += 100) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("ai_themes")
        .select("response_id, attribute_id")
        .in("response_id", answers.slice(i, i + 100).map((a) => a.id))
        .eq("classifier_version", CLASSIFIER_VERSION)
        .order("id").range(from, from + 999);
      if (error) throw error;
      for (const t of data!) {
        if (!themes.has(t.response_id)) themes.set(t.response_id, new Set());
        themes.get(t.response_id)!.add(t.attribute_id);
      }
      if (data!.length < 1000) break;
    }
  }

  const requests: any[] = [];
  let pairs = 0, chars = 0;
  for (const a of answers) {
    const ts = themes.get(a.id);
    if (!ts || !a.response_text) continue;
    const cs = claims.filter((c) => c.company_id === a.company_id && ts.has(c.attribute_id));
    if (!cs.length) continue;
    pairs += cs.length; chars += a.response_text.length;
    const claimList = cs.map((c) => `${label(c)}: ${c.claim_text}`).join("\n");
    requests.push({
      custom_id: a.id,
      params: {
        model: MODEL, max_tokens: 1500,
        thinking: { type: "disabled" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `CLAIMS:\n${claimList}\n\nAI ANSWER:\n${a.response_text}` }],
      },
    });
  }
  const summary = { answers_in_scope: answers.length, requests: requests.length, claim_answer_pairs: pairs, answer_chars: chars };
  if (p.dry_run !== false) return { dry_run: true, ...summary };
  const batch = await anthropic().messages.batches.create({ requests } as any);
  return { batch_id: batch.id, matcher_version: MATCHER_VERSION, ...summary };
}

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();

async function collect(batchId: string) {
  const client = anthropic();
  const b = await client.messages.batches.retrieve(batchId);
  if (b.processing_status !== "ended") return { status: b.processing_status, counts: b.request_counts };

  const results: { id: string; text: string }[] = [];
  let errored = 0;
  for await (const r of await client.messages.batches.results(batchId)) {
    if (r.result.type !== "succeeded") { errored++; continue; }
    const text = r.result.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    results.push({ id: r.custom_id, text });
  }

  // Map labels back to claims; fetch answer text to check quotes are verbatim.
  const allClaims = new Map<string, Claim>();
  const answerText = new Map<string, { company_id: string; text: string }>();
  for (let i = 0; i < results.length; i += 150) {
    const { data, error } = await supabase.from("prompt_responses").select("id, company_id, response_text")
      .in("id", results.slice(i, i + 150).map((r) => r.id));
    if (error) throw error;
    for (const a of data!) answerText.set(a.id, { company_id: a.company_id, text: a.response_text ?? "" });
  }
  const companyIds = [...new Set([...answerText.values()].map((a) => a.company_id))];
  for (const c of await loadClaims(companyIds)) allClaims.set(c.company_id + "|" + label(c), c);

  const rows: any[] = [];
  let parseFail = 0, notVerbatim = 0, unknownLabel = 0;
  for (const r of results) {
    const a = answerText.get(r.id);
    if (!a) continue;
    let parsed: any;
    try {
      const m = r.text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : r.text);
    } catch { parseFail++; continue; }
    const seen = new Set<string>();
    for (const x of parsed.results ?? []) {
      const c = allClaims.get(a.company_id + "|" + x.claim);
      if (!c || seen.has(c.id)) { unknownLabel++; continue; }
      seen.add(c.id);
      const verdict = ["echoes", "contradicts", "inaccurate", "silent"].includes(x.verdict) ? x.verdict : "silent";
      let quote: string | null = verdict === "silent" ? null : String(x.quote ?? "").trim() || null;
      let reason = String(x.reason ?? "").slice(0, 500);
      if (verdict !== "silent") {
        if (!quote) { quote = "(no quote returned)"; reason = "[no quote] " + reason; notVerbatim++; }
        else if (!norm(a.text).includes(norm(quote))) { reason = "[quote not verbatim] " + reason; notVerbatim++; }
      }
      rows.push({
        claim_id: c.id, response_id: r.id, organization_id: c.organization_id,
        verdict, evidence_quote: quote, reason, matcher_version: MATCHER_VERSION,
        review_status: verdict === "inaccurate" ? "pending" : "not_needed",
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("narrative_claim_matches")
      .upsert(rows.slice(i, i + 500), { onConflict: "claim_id,response_id,matcher_version", ignoreDuplicates: true });
    if (error) throw error;
  }
  const tally: Record<string, number> = {};
  for (const r of rows) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  return { status: "ended", answers: results.length, errored, parse_fail: parseFail, unknown_label: unknownLabel, quote_not_verbatim: notVerbatim, rows: rows.length, verdicts: tally };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
