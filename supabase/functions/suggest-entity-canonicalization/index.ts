// =============================================================================
// suggest-entity-canonicalization
//
// Finds raw competitor variants in prompt_responses.detected_competitors that
// are not yet mapped via entity_aliases and have no suggestion in
// entity_alias_suggestions, then:
//   1. Rule pass (rules.ts): "Toyota Manufacturing UK" -> existing "Toyota"
//      when the rest of the name is geography / legal suffix / plant words.
//   2. LLM pass for everything else: map to an existing canonical, propose a
//      new canonical, or flag as non-entity.
//
// Every result lands in entity_alias_suggestions. With autoQueue (default),
// every result gets auto_method set and entity_canonicalization_tick()
// applies it. Nothing waits for a person (Karim, 2026-10-15):
//   - rule roll-ups, including country arms of tracked companies;
//   - first-pass LLM decisions at confidence >= 0.95, minus non-entities, new
//     canonicals that look like an unproven roll-up and names of tracked
//     companies;
//   - everything else goes to a stricter review pass, which merges only when
//     certain and otherwise keeps the name as its own company. A wrong merge
//     is worse than a split, so "keep separate" is the default when unsure.
// Each LLM call carries a per-batch shortlist of canonicals (rules.ts
// buildShortlister), never the whole table.
// Each run also reviews up to MAX_PENDING_REVIEW older suggestions that were
// left for manual review before this change.
//
// Candidates come from the request body (`variants`, sent by the SQL tick,
// which computes them without a statement timeout) or from
// find_unmapped_competitor_variants for scoped admin runs.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { claudeFetch } from "../_shared/claude-keys.ts";
import {
  AUTO_CONFIDENCE,
  buildProtectedStems,
  buildShortlister,
  type CanonicalRef,
  cleanForMatch,
  hasParentCanonical,
  isProtected,
  normalize,
  ruleRollUp,
} from "./rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// No OpenAI (Karim, 2026-10-18): both passes run on Claude Haiku 5.5, the
// cheapest model we have that knows companies well ($0.10 / $0.50 per M
// tokens, thinking off), replacing gpt-4.1-mini and gpt-4.1. The review pass
// uses the same model with stricter instructions.
const MODEL = "claude-haiku-5-5";
const REVIEW_MODEL = "claude-haiku-5-5";
// llm_model label on review decisions, distinct from first-pass rows so a
// first-pass row whose review failed is still picked up again.
const REVIEW_LABEL = `${REVIEW_MODEL}/review`;
// Labels whose decisions are final (gpt-4.1 reviewed until 2026-10-18).
const REVIEW_MODELS = ["gpt-4.1", REVIEW_LABEL];
const MAX_PENDING_REVIEW = 200;
const LLM_CHUNK = 50;
const LLM_CONCURRENCY = 6; // ~300 variants = one round, well inside the edge wall-clock limit
const MAX_VARIANTS = 500;

// Untyped client: this project has no generated DB types for edge functions.
// deno-lint-ignore no-explicit-any
type Supabase = any;

interface Candidate {
  raw_alias: string;
  normalized_alias: string;
  mention_count: number;
}

interface LlmSuggestion {
  raw_alias: string;
  decision: "map_existing" | "new_canonical" | "non_entity";
  canonical_name: string | null;
  entity_type: string | null;
  confidence: number;
  rationale: string;
}

interface SuggestionRow {
  raw_alias: string;
  normalized_alias: string;
  mention_count: number;
  suggested_canonical_name: string | null;
  suggested_entity_type: string | null;
  suggested_is_non_entity: boolean;
  confidence: number | null;
  status: "pending";
  llm_rationale: string | null;
  llm_model: string;
  auto_method: "auto_rule" | "auto_llm" | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      batchSize = 50,
      dryRun = false,
      organizationId = null,
      companyId = null,
      variants = null,
      autoQueue = true,
      reviewPending = true,
    } = await req.json().catch(() => ({}));

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Self-heal: pending suggestions whose alias already exists -> approved.
    const heal = await supabase.rpc("resolve_orphan_canonicalization_suggestions");
    if (heal.error) {
      console.warn("resolve_orphan_canonicalization_suggestions failed:", heal.error);
    }

    const candidates = Array.isArray(variants)
      ? (variants as Candidate[]).slice(0, MAX_VARIANTS)
      : await findCandidates(supabase, Math.min(batchSize, MAX_VARIANTS), organizationId, companyId);

    // Older suggestions still waiting for a person get the review model too.
    const pending = autoQueue && reviewPending && !dryRun ? await fetchPendingManual(supabase) : [];

    if (candidates.length === 0 && pending.length === 0) {
      return json({ processed: 0, auto_rule: 0, auto_llm: 0, manual: 0, suggestions: [] });
    }

    const [canonicals, aliases, companyNames, corrections] = await Promise.all([
      fetchAll<{ id: string; canonical_name: string; normalized_name: string; entity_type: string | null; is_active: boolean }>(
        supabase, "canonical_entities", "id, canonical_name, normalized_name, entity_type, is_active",
      ),
      fetchAll<{ normalized_alias: string; canonical_id: string }>(
        supabase, "entity_aliases", "normalized_alias, canonical_id",
      ),
      fetchAll<{ name: string }>(supabase, "companies", "name"),
      fetchCorrections(supabase),
    ]);

    // Index of active, real canonicals by normalized name and by alias.
    const byId = new Map<string, CanonicalRef>();
    const index = new Map<string, CanonicalRef>();
    for (const c of canonicals) {
      if (!c.is_active || c.entity_type === "non_entity" || c.canonical_name.startsWith("__non_entity_")) continue;
      const ref = { id: c.id, canonical_name: c.canonical_name, entity_type: c.entity_type };
      byId.set(c.id, ref);
      index.set(c.normalized_name, ref);
    }
    for (const a of aliases) {
      const ref = byId.get(a.canonical_id);
      if (ref && !index.has(a.normalized_alias)) index.set(a.normalized_alias, ref);
    }
    // Normalized names of every canonical, active or not (non-entity guard).
    const anyCanonical = new Set(canonicals.map((c) => c.normalized_name));
    // Per-batch list of canonicals to show the LLMs (never the whole table).
    const aliasCounts = new Map<string, number>();
    for (const a of aliases) aliasCounts.set(a.canonical_id, (aliasCounts.get(a.canonical_id) ?? 0) + 1);
    const shortlist = buildShortlister(index, aliasCounts);

    const tracked = companyNames.map((c) => c.name).filter((n) => n && n.trim().length > 0);
    const stems = buildProtectedStems(tracked);
    const trackedExact = new Set(tracked.map((n) => cleanForMatch(n)));

    // 1. Rule pass.
    const rows: SuggestionRow[] = [];
    const forLlm: Array<Candidate & { protected: boolean }> = [];
    for (const c of candidates) {
      const prot = isProtected(c.raw_alias, stems);
      const parent = ruleRollUp(c.raw_alias, index, trackedExact);
      if (parent) {
        rows.push({
          raw_alias: c.raw_alias,
          normalized_alias: c.normalized_alias,
          mention_count: c.mention_count,
          suggested_canonical_name: parent.canonical_name,
          suggested_entity_type: parent.entity_type ?? "other",
          suggested_is_non_entity: false,
          confidence: 1,
          status: "pending",
          llm_rationale: `Rule: regional / legal / plant variant of ${parent.canonical_name}`,
          llm_model: "rule",
          auto_method: autoQueue ? "auto_rule" : null,
        });
      } else {
        forLlm.push({ ...c, protected: prot });
      }
    }

    // 2. LLM pass, chunked with bounded concurrency. A failed chunk is logged
    //    and skipped; its variants stay unqueued and are retried next run.
    const chunks: Array<typeof forLlm> = [];
    for (let i = 0; i < forLlm.length; i += LLM_CHUNK) chunks.push(forLlm.slice(i, i + LLM_CHUNK));

    let llmFailures = 0;
    for (let i = 0; i < chunks.length; i += LLM_CONCURRENCY) {
      const results = await Promise.allSettled(
        chunks.slice(i, i + LLM_CONCURRENCY).map((chunk) => classify(chunk, shortlist(chunk.map((c) => c.raw_alias)), corrections)),
      );
      results.forEach((res, j) => {
        const chunk = chunks[i + j];
        if (res.status === "rejected") {
          llmFailures++;
          console.error("LLM chunk failed:", res.reason);
          return;
        }
        const byRaw = new Map(res.value.map((s) => [s.raw_alias, s]));
        for (const c of chunk) {
          const s = byRaw.get(c.raw_alias);
          if (!s) continue; // dropped by the LLM: retried next run
          rows.push(toRow(c, s, { autoQueue, index, anyCanonical, stems }));
        }
      });
    }

    // 3. Review pass: everything the cheap pass left for a person, new rows
    //    first, then older pending suggestions.
    const reviewCtx = { index, anyCanonical, tracked, corrections, shortlist };
    let reviewFailures = 0;
    let reviewedPending = 0;
    if (autoQueue) {
      const unsettled = rows.filter((r) => r.auto_method === null);
      const reviewed = await reviewAll(unsettled, reviewCtx);
      reviewFailures += reviewed.failures;
      for (const r of unsettled) {
        const decided = reviewed.byAlias.get(r.normalized_alias);
        if (decided) Object.assign(r, decided);
      }

      if (pending.length > 0) {
        const reviewedOld = await reviewAll(pending, reviewCtx);
        reviewFailures += reviewedOld.failures;
        const updates = pending
          .map((p) => ({ id: p.id, patch: reviewedOld.byAlias.get(p.normalized_alias) }))
          .filter((u) => u.patch);
        for (let i = 0; i < updates.length; i += 20) {
          await Promise.all(updates.slice(i, i + 20).map(async (u) => {
            const { error } = await supabase
              .from("entity_alias_suggestions")
              .update(u.patch)
              .eq("id", u.id)
              .eq("status", "pending")
              .is("auto_method", null);
            if (error) console.error("pending review update failed:", u.id, error);
            else reviewedPending++;
          }));
        }
      }
    }

    const summary = {
      processed: rows.length,
      auto_rule: rows.filter((r) => r.auto_method === "auto_rule").length,
      auto_llm: rows.filter((r) => r.auto_method === "auto_llm").length,
      manual: rows.filter((r) => r.auto_method === null).length,
      reviewed_pending: reviewedPending,
      llm_chunk_failures: llmFailures,
      review_chunk_failures: reviewFailures,
    };

    if (dryRun) return json({ ...summary, dryRun: true, suggestions: rows });

    // Insert-only: never overwrite a suggestion an admin (or a previous run)
    // already resolved.
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase
        .from("entity_alias_suggestions")
        .upsert(rows.slice(i, i + 200), { onConflict: "normalized_alias", ignoreDuplicates: true });
      if (error) throw error;
    }

    return json({ ...summary, suggestions: rows });
  } catch (error) {
    console.error("suggest-entity-canonicalization error:", error);
    return json({ error: String((error as Error)?.message ?? error) }, 500);
  }
});

function toRow(
  c: Candidate & { protected: boolean },
  s: LlmSuggestion,
  ctx: {
    autoQueue: boolean;
    index: Map<string, CanonicalRef>;
    anyCanonical: Set<string>;
    stems: Set<string>;
  },
): SuggestionRow {
  const isNonEntity = s.decision === "non_entity";
  const confidence = typeof s.confidence === "number" ? s.confidence : null;
  const target = s.canonical_name ? ctx.index.get(normalize(s.canonical_name)) : undefined;

  let auto = false;
  if (ctx.autoQueue && !c.protected && confidence !== null && confidence >= AUTO_CONFIDENCE) {
    if (isNonEntity) {
      // Dropping a name hides a real company if it's wrong ("Vipps MobilePay"
      // was called two companies joined), so the review model always decides.
      auto = false;
    } else if (
      s.canonical_name &&
      !isProtected(s.canonical_name, ctx.stems) &&
      // The alias index can resolve an unprotected LLM name ("YouTube") onto a
      // protected canonical ("Google"): check where it actually lands.
      !isProtected(target?.canonical_name, ctx.stems)
    ) {
      if (target) {
        auto = true; // maps onto an existing active canonical
      } else if (s.decision === "new_canonical") {
        const norm = normalize(s.canonical_name);
        auto = !ctx.anyCanonical.has(norm) &&
          !hasParentCanonical(c.raw_alias, ctx.index) &&
          !hasParentCanonical(s.canonical_name, ctx.index);
      }
      // map_existing to a name that doesn't exist = hallucination -> manual.
    }
  }

  return {
    raw_alias: c.raw_alias,
    normalized_alias: c.normalized_alias,
    mention_count: c.mention_count,
    // Use the canonical's exact stored spelling when mapping to one.
    suggested_canonical_name: isNonEntity ? null : (target?.canonical_name ?? s.canonical_name ?? null),
    suggested_entity_type: s.entity_type ?? null,
    suggested_is_non_entity: isNonEntity,
    confidence,
    status: "pending",
    llm_rationale: c.protected
      ? `[Client name: manual review] ${s.rationale ?? ""}`.trim()
      : (s.rationale ?? null),
    llm_model: MODEL,
    auto_method: auto ? "auto_llm" : null,
  };
}

interface ReviewItem {
  raw_alias: string;
  normalized_alias: string;
  suggested_canonical_name: string | null;
  suggested_is_non_entity: boolean;
  confidence: number | null;
}

interface PendingItem extends ReviewItem {
  id: string;
}

interface ReviewDecision {
  raw_alias: string;
  decision: "merge" | "separate" | "non_entity";
  canonical_name: string | null;
  entity_type: string | null;
  confidence: number;
  rationale: string;
}

type ReviewPatch = Pick<
  SuggestionRow,
  | "suggested_canonical_name"
  | "suggested_entity_type"
  | "suggested_is_non_entity"
  | "confidence"
  | "status"
  | "llm_rationale"
  | "llm_model"
  | "auto_method"
>;

interface ReviewCtx {
  index: Map<string, CanonicalRef>;
  anyCanonical: Set<string>;
  tracked: string[];
  corrections: Array<{ raw: string; suggested: string; final: string }>;
  shortlist: (names: string[]) => string[];
}

const REVIEW_CHUNK = 40;

async function fetchPendingManual(supabase: Supabase): Promise<PendingItem[]> {
  const { data, error } = await supabase
    .from("entity_alias_suggestions")
    .select("id, raw_alias, normalized_alias, suggested_canonical_name, suggested_is_non_entity, confidence")
    .eq("status", "pending")
    .is("auto_method", null)
    // Reviewed once is final: a decision the apply step bounced back must not
    // be re-sent to the review model every tick.
    .or(`llm_model.is.null,llm_model.not.in.(${REVIEW_MODELS.map((m) => `"${m}"`).join(",")})`)
    .order("mention_count", { ascending: false })
    .limit(MAX_PENDING_REVIEW);
  if (error) {
    console.warn("fetchPendingManual failed:", error);
    return [];
  }
  return (data ?? []) as PendingItem[];
}

/** Final decision for every item, keyed by normalized alias. */
async function reviewAll(
  items: ReviewItem[],
  ctx: ReviewCtx,
): Promise<{ byAlias: Map<string, ReviewPatch>; failures: number }> {
  const byAlias = new Map<string, ReviewPatch>();
  let failures = 0;
  const chunks: ReviewItem[][] = [];
  for (let i = 0; i < items.length; i += REVIEW_CHUNK) chunks.push(items.slice(i, i + REVIEW_CHUNK));
  for (let i = 0; i < chunks.length; i += LLM_CONCURRENCY) {
    const results = await Promise.allSettled(
      chunks.slice(i, i + LLM_CONCURRENCY).map((chunk) => review(chunk, ctx)),
    );
    results.forEach((res, j) => {
      if (res.status === "rejected") {
        failures++;
        console.error("Review chunk failed:", res.reason);
        return; // stays pending; retried next run
      }
      const byRaw = new Map(res.value.map((d) => [d.raw_alias, d]));
      for (const item of chunks[i + j]) {
        const d = byRaw.get(item.raw_alias);
        if (d) byAlias.set(item.normalized_alias, reviewToPatch(item, d, ctx));
      }
    });
  }
  return { byAlias, failures };
}

function reviewToPatch(item: ReviewItem, d: ReviewDecision, ctx: ReviewCtx): ReviewPatch {
  const base = {
    status: "pending" as const,
    llm_model: REVIEW_LABEL,
    auto_method: "auto_llm" as const,
    confidence: typeof d.confidence === "number" ? d.confidence : null,
    llm_rationale: `[Reviewed by ${REVIEW_MODEL}] ${d.rationale ?? ""}`.trim(),
  };

  if (d.decision === "merge" && d.canonical_name) {
    const target = ctx.index.get(normalize(d.canonical_name));
    if (target) {
      return {
        ...base,
        suggested_canonical_name: target.canonical_name,
        suggested_entity_type: target.entity_type ?? "other",
        suggested_is_non_entity: false,
      };
    }
    // Merge into a name that doesn't exist: keep the variant separate.
  }

  // Never hide something that is already a real, active canonical.
  if (d.decision === "non_entity" && (d.confidence ?? 0) >= 0.9 && !ctx.index.has(item.normalized_alias)) {
    return {
      ...base,
      suggested_canonical_name: null,
      suggested_entity_type: "non_entity",
      suggested_is_non_entity: true,
    };
  }

  // Keep it as its own company. Use the reviewer's clean name unless it
  // collides with an inactive or non-entity canonical, which the apply step
  // would bounce back to manual.
  let name = (d.decision === "separate" && d.canonical_name?.trim()) || item.raw_alias;
  const norm = normalize(name);
  if (ctx.anyCanonical.has(norm) && !ctx.index.has(norm)) name = item.raw_alias;
  return {
    ...base,
    suggested_canonical_name: name,
    suggested_entity_type: d.entity_type && d.entity_type !== "non_entity" ? d.entity_type : "other",
    suggested_is_non_entity: false,
  };
}

async function review(chunk: ReviewItem[], ctx: ReviewCtx): Promise<ReviewDecision[]> {
  const systemPrompt =
    `You make the FINAL call on company names that AI assistants mention when describing employers.
No human reviews your decisions. Wrongly merging two different companies is worse than leaving a
name separate, so merge only when you are certain.

For each name decide:
(a) "merge"      - it is the SAME employer as a company in the existing list: a country or regional
                   arm, a legal-entity form, a former name, an abbreviation or misspelling, or a
                   business unit without its own separate employer brand. canonical_name = the exact
                   spelling from the list.
(b) "separate"   - a different company, a subsidiary with its own employer brand, or you are not
                   certain. canonical_name = the clean, commonly used brand name (drop legal suffixes
                   like Inc, Ltd, GmbH, "Group", "Corporation").
(c) "non_entity" - clearly not an organization: a phrase, an industry or category, a geography, a
                   placeholder, or two companies joined ("Google/Meta"). Never just because you do
                   not recognize the name.

Tracked companies (our clients and the employers we measure) are listed separately. Never merge
one tracked company into another tracked company ("Ford Credit" is not "Ford"). A name that belongs
to a listed tracked division maps to that division, not to its parent.

A cheaper model already suggested an answer for each name. It may be wrong; decide for yourself.

Return STRICT JSON: {"decisions": [...]} with one entry per input name, in the same order.
Each entry: { raw_alias, decision, canonical_name, entity_type, confidence, rationale }.
- entity_type: "oem" | "supplier" | "it_services" | "consulting" | "financial" | "other" | "non_entity".
- confidence: 0..1, calibrated.
- rationale: <= 140 chars.`;

  const examples = ctx.corrections.length
    ? `\n\nPast reviewer corrections (follow this style):\n${
      ctx.corrections.map((c) => `- "${c.raw}": not "${c.suggested}" but "${c.final}"`).join("\n")
    }`
    : "";

  const userPrompt = `Existing canonical companies (merge into these exactly when applicable):
${
    ctx.shortlist(chunk.flatMap((u) => [u.raw_alias, u.suggested_canonical_name ?? ""]).filter(Boolean))
      .join(", ")
  }

Tracked companies:
${ctx.tracked.join(", ")}${examples}

Names to decide:
${
    chunk.map((u, i) => {
      const first = u.suggested_is_non_entity
        ? "not a company"
        : u.suggested_canonical_name ?? "no suggestion";
      const conf = u.confidence === null ? "?" : u.confidence;
      return `${i + 1}. ${u.raw_alias} (first suggestion: ${first}, confidence ${conf})`;
    }).join("\n")
  }`;

  const parsed = await askClaude(REVIEW_MODEL, systemPrompt, userPrompt) as { decisions?: ReviewDecision[] };
  return parsed.decisions ?? [];
}

/** One Claude call that must answer with a JSON object. Throws on failure. */
async function askClaude(model: string, system: string, user: string): Promise<Record<string, unknown>> {
  // claudeFetch sets x-api-key and hands over to CLAUDE_API_KEY_NEXT when the
  // current key's organization is out of credit (see claude-keys.ts).
  const resp = await claudeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      // Thinking off keeps the cost to the answer itself.
      thinking: { type: "disabled" },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Claude ${resp.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }
  if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    throw new Error(`Claude stopped: ${data.stop_reason}`);
  }
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  return parseJsonObject(text);
}

/** The JSON object in a model reply, tolerating code fences or a preamble. */
function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

async function findCandidates(
  supabase: Supabase,
  limit: number,
  organizationId: string | null,
  companyId: string | null,
): Promise<Candidate[]> {
  const { data, error } = await supabase.rpc("find_unmapped_competitor_variants", {
    p_limit: limit,
    p_organization_id: organizationId,
    p_company_id: companyId,
  });
  if (error) throw error;
  return (data ?? []) as Candidate[];
}

// PostgREST caps responses at 1000 rows; page through the whole table.
async function fetchAll<T>(supabase: Supabase, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

// Admin corrections (suggestion changed on approval) become few-shot examples
// so the LLM follows house style, chiefly "roll up to the parent brand".
async function fetchCorrections(supabase: Supabase): Promise<Array<{ raw: string; suggested: string; final: string }>> {
  const { data, error } = await supabase
    .from("entity_alias_suggestions")
    .select("raw_alias, suggested_canonical_name, auto_method, canonical_entities!entity_alias_suggestions_resolved_canonical_id_fkey(canonical_name, entity_type)")
    .eq("status", "approved")
    .eq("suggested_is_non_entity", false)
    .not("suggested_canonical_name", "is", null)
    .is("auto_method", null)
    .order("resolved_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.warn("fetchCorrections failed:", error);
    return [];
  }
  const out: Array<{ raw: string; suggested: string; final: string }> = [];
  for (const r of (data ?? []) as unknown as Array<{
    raw_alias: string;
    suggested_canonical_name: string;
    canonical_entities: { canonical_name: string; entity_type: string | null } | null;
  }>) {
    const final = r.canonical_entities;
    if (!final || final.entity_type === "non_entity") continue;
    if (final.canonical_name.toLowerCase() === r.suggested_canonical_name.toLowerCase()) continue;
    out.push({ raw: r.raw_alias, suggested: r.suggested_canonical_name, final: final.canonical_name });
    if (out.length >= 40) break;
  }
  return out;
}

async function classify(
  chunk: Candidate[],
  canonicalList: string[],
  corrections: Array<{ raw: string; suggested: string; final: string }>,
): Promise<LlmSuggestion[]> {
  const systemPrompt =
    `You are an industry-agnostic entity-resolution assistant for competitor names that AI assistants
mention when describing employers. The only question is: "Is this string the name of a real company /
brand / organization, and which parent brand should it be counted under?" Default to "real company"
unless you have strong reason to believe otherwise.

For each raw variant, decide:
(a) "map_existing"  - it matches, or belongs under, an existing canonical in the provided list
                      (case-insensitive, alias-aware). ROLL UP to the parent brand: regional / country arms,
                      legal-entity names, plants, R&D centres, corporate "Group"/"Holdings" forms and
                      product lines of a listed parent all map to that parent ("Hyundai India" -> "Hyundai",
                      "Toyota Manufacturing UK" -> "Toyota", "Sony Pictures Entertainment" -> "Sony",
                      "Google Workspace" -> "Google", "Renault Group" -> "Renault"). Prefer the shortest,
                      commonly used brand name. When in doubt between parent and new canonical, prefer
                      the parent. Use the exact spelling from the list.
(b) "new_canonical" - it IS a real company / brand / org but neither it nor its parent is in the list.
                      Propose the clean, commonly used brand name (drop legal suffixes like Inc, Ltd,
                      GmbH, "Group", "Corporation"; "Eli Lilly and Company" -> "Lilly").
(c) "non_entity"    - ONLY when clearly not a real entity name: phrases or sentences ("No Competitors",
                      "EV Startups"), geographies ("North America"), industry segments ("Streaming
                      Services", "Fintech"), corporate suffixes alone ("Ltd"), placeholders ("None", "N/A"),
                      acronym groupings ("FAANG"), or two companies joined ("Google/Meta").
                      Do NOT use non_entity just because you don't recognize the company.

Confidence: 0..1, calibrated. Use >= 0.95 only when you are certain (well-known company, unambiguous
parent). Ambiguous acronyms, dealerships, unknown small firms and names that could be several different
companies must be below 0.9.

Return STRICT JSON: {"suggestions": [...]} with one entry per input variant, in the same order.
Each entry: { raw_alias, decision, canonical_name, entity_type, confidence, rationale }.
- canonical_name: exact existing name (map_existing), proposed clean name (new_canonical), null (non_entity).
- entity_type: "oem" | "supplier" | "it_services" | "consulting" | "financial" | "other" | "non_entity"
  ("non_entity" iff decision is non_entity; "other" when nothing specific fits).
- rationale: <= 140 chars.`;

  const examples = corrections.length
    ? `\n\nPast reviewer corrections (the reviewer changed the first suggestion to the final one; follow this style):\n${
      corrections.map((c) => `- "${c.raw}": not "${c.suggested}" but "${c.final}"`).join("\n")
    }`
    : "";

  const userPrompt = `Existing canonical companies (map to these exactly when applicable):
${canonicalList.join(", ")}${examples}

Variants to classify:
${chunk.map((u, i) => `${i + 1}. ${u.raw_alias}`).join("\n")}`;

  const parsed = await askClaude(MODEL, systemPrompt, userPrompt) as { suggestions?: LlmSuggestion[] };
  return parsed.suggestions ?? [];
}
