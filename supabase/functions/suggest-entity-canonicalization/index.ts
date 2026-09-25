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
// safe results also get auto_method set, and entity_canonicalization_tick()
// (event-driven: runs after new responses land) applies them without review:
//   - rule roll-ups;
//   - LLM decisions at confidence >= 0.95 (historical admin agreement ~95%+),
//     minus new canonicals that look like an unproven roll-up.
// Names belonging to tracked companies (clients, their divisions, everything
// we measure) are never auto-queued: they stay pending for manual review.
//
// Candidates come from the request body (`variants`, sent by the SQL tick,
// which computes them without a statement timeout) or from
// find_unmapped_competitor_variants for scoped admin runs.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  AUTO_CONFIDENCE,
  buildProtectedStems,
  type CanonicalRef,
  hasParentCanonical,
  isProtected,
  normalize,
  rollUpToParent,
} from "./rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4.1-mini";
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

    if (candidates.length === 0) {
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

    const stems = buildProtectedStems(
      companyNames.map((c) => c.name).filter((n) => n && n.trim().length > 0),
    );

    // 1. Rule pass.
    const rows: SuggestionRow[] = [];
    const forLlm: Array<Candidate & { protected: boolean }> = [];
    for (const c of candidates) {
      const prot = isProtected(c.raw_alias, stems);
      const parent = prot ? null : rollUpToParent(c.raw_alias, index);
      if (parent && !isProtected(parent.canonical_name, stems)) {
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
    const canonicalList = [...new Set([...byId.values()].map((c) => c.canonical_name))].sort();
    const chunks: Array<typeof forLlm> = [];
    for (let i = 0; i < forLlm.length; i += LLM_CHUNK) chunks.push(forLlm.slice(i, i + LLM_CHUNK));

    let llmFailures = 0;
    for (let i = 0; i < chunks.length; i += LLM_CONCURRENCY) {
      const results = await Promise.allSettled(
        chunks.slice(i, i + LLM_CONCURRENCY).map((chunk) => classify(chunk, canonicalList, corrections)),
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

    const summary = {
      processed: rows.length,
      auto_rule: rows.filter((r) => r.auto_method === "auto_rule").length,
      auto_llm: rows.filter((r) => r.auto_method === "auto_llm").length,
      manual: rows.filter((r) => r.auto_method === null).length,
      llm_chunk_failures: llmFailures,
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
      // Never hide something that is already a real, active canonical.
      auto = !ctx.index.has(c.normalized_alias);
    } else if (s.canonical_name && !isProtected(s.canonical_name, ctx.stems)) {
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

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { suggestions?: LlmSuggestion[] };
  return parsed.suggestions ?? [];
}
