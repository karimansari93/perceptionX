// =============================================================================
// suggest-entity-canonicalization
//
// Finds raw competitor variants in prompt_responses.detected_competitors that
// are not yet mapped via entity_aliases and have no pending suggestion in
// entity_alias_suggestions, then asks an LLM to either:
//   - map each variant to an existing canonical_entities.canonical_name,
//   - propose a new canonical name + entity_type, or
//   - flag it as a non-entity (geographies, generic phrases, error text).
//
// Results are inserted into entity_alias_suggestions with status='pending'
// for admin review. Idempotent — safe to run on a nightly cron.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4.1-mini";

interface Suggestion {
  raw_alias: string;
  decision: "map_existing" | "new_canonical" | "non_entity";
  canonical_name: string | null;
  entity_type: string | null;
  confidence: number;
  rationale: string;
}

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
    } = await req.json().catch(() => ({}));

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 0. Self-heal: any pending suggestion whose normalized_alias already
    //    has an entity_aliases row is effectively resolved (someone created
    //    the alias via SQL or via the seed migration). Flip it to 'approved'
    //    so it stops appearing in the Pending tab. Idempotent — relies on the
    //    RPC from migration 20260513000000_resolve_orphan_suggestions_rpc.sql.
    //    If the RPC isn't present we log and continue; the queue just won't
    //    self-heal until the migration is applied.
    const heal = await supabase.rpc('resolve_orphan_canonicalization_suggestions');
    if (heal.error) {
      console.warn('resolve_orphan_canonicalization_suggestions failed:', heal.error);
    }

    // 1. Pull existing canonical names so the LLM can map to them.
    const { data: canonicals, error: canonicalsErr } = await supabase
      .from("canonical_entities")
      .select("canonical_name, entity_type, is_active")
      .eq("is_active", true)
      .order("canonical_name");
    if (canonicalsErr) throw canonicalsErr;

    const canonicalList = (canonicals ?? [])
      .filter((c) => !c.canonical_name.startsWith("__non_entity_"))
      .map((c) => c.canonical_name);

    // 2. Find unmapped variants with their mention frequency.
    const { data: candidates, error: candidatesErr } = await supabase.rpc(
      "find_unmapped_competitor_variants",
      { p_limit: batchSize }
    );
    if (candidatesErr) {
      // RPC may not exist yet; fall back to a SQL query.
      // Optional scoping: if organizationId is provided, restrict to companies
      // in that org. If companyId is provided, restrict to that single company.
      // companyId wins if both are passed.
      let scopedCompanyIds: string[] | null = null;
      if (companyId) {
        scopedCompanyIds = [companyId];
      } else if (organizationId) {
        const orgCompanies = await supabase
          .from("organization_companies")
          .select("company_id")
          .eq("organization_id", organizationId);
        if (orgCompanies.error) throw orgCompanies.error;
        scopedCompanyIds = (orgCompanies.data ?? []).map(
          (r: { company_id: string }) => r.company_id
        );
        if (scopedCompanyIds.length === 0) {
          return new Response(
            JSON.stringify({
              processed: 0,
              suggestions: [],
              note: "organization has no companies",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      let fallbackQuery = supabase
        .from("prompt_responses")
        .select("detected_competitors")
        .not("detected_competitors", "is", null)
        .neq("detected_competitors", "");
      if (scopedCompanyIds) {
        fallbackQuery = fallbackQuery.in("company_id", scopedCompanyIds);
      }
      const fallback = await fallbackQuery.limit(5000);
      if (fallback.error) throw fallback.error;

      const counts = new Map<string, { raw: string; count: number }>();
      for (const row of fallback.data ?? []) {
        const dc = (row as { detected_competitors: string }).detected_competitors;
        if (!dc) continue;
        for (const part of dc.split(",")) {
          const raw = part.trim();
          if (!raw) continue;
          const norm = normalize(raw);
          if (!norm) continue;
          const existing = counts.get(norm);
          if (existing) existing.count += 1;
          else counts.set(norm, { raw, count: 1 });
        }
      }
      const normalizedKeys = [...counts.keys()];

      const { data: mapped } = await supabase
        .from("entity_aliases")
        .select("normalized_alias")
        .in("normalized_alias", normalizedKeys);
      const mappedSet = new Set((mapped ?? []).map((m) => m.normalized_alias));

      const { data: existingSuggestions } = await supabase
        .from("entity_alias_suggestions")
        .select("normalized_alias")
        .in("normalized_alias", normalizedKeys);
      const suggestedSet = new Set(
        (existingSuggestions ?? []).map((m) => m.normalized_alias)
      );

      const unmapped = [...counts.entries()]
        .filter(([k]) => !mappedSet.has(k) && !suggestedSet.has(k))
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, batchSize)
        .map(([normalized_alias, v]) => ({
          normalized_alias,
          raw_alias: v.raw,
          mention_count: v.count,
        }));

      return await runLlm(supabase, unmapped, canonicalList, dryRun);
    }

    return await runLlm(supabase, candidates ?? [], canonicalList, dryRun);
  } catch (error) {
    console.error("suggest-entity-canonicalization error:", error);
    return new Response(
      JSON.stringify({ error: String(error?.message ?? error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function runLlm(
  supabase: ReturnType<typeof createClient>,
  unmapped: Array<{ raw_alias: string; normalized_alias: string; mention_count: number }>,
  canonicalList: string[],
  dryRun: boolean,
) {
  if (unmapped.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0, suggestions: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const systemPrompt =
    `You are an industry-agnostic entity-resolution assistant. The only question is:
"Is this string the name of a real company / brand / organization?" — NOT "does it fit a particular industry."
The platform tracks competitors across many industries (automotive, tech, streaming, retail, finance,
healthcare, hospitality, food, gaming, etc.). Default to "this is a real company" unless you have strong
reason to believe otherwise.

For each raw variant, decide:
(a) "map_existing"  — it matches an existing canonical in the provided list (case-insensitive, alias-aware).
                      Includes subsidiaries / regional arms of a listed parent (e.g. "Hyundai India" -> "Hyundai",
                      "Apple TV+" -> "Apple", "Amazon Prime Video" -> "Amazon"). When in doubt between
                      mapping to a parent vs. proposing a new canonical, prefer mapping to the parent.
(b) "new_canonical" — it IS a real company / brand / org but isn't in the list yet. Use this for
                      anything you recognize as a real entity regardless of industry. Examples that should
                      all be new_canonical: CrowdStrike, Cloudflare, Stripe, Notion, Figma, Pfizer, Marriott,
                      Mercado Libre, Spotify, Patagonia, Costco, Bridgestone. Industry doesn't matter.
(c) "non_entity"    — only when the string is clearly NOT a real entity name. ONLY use this for:
                      • Pure phrases / sentences: "No Competitors", "Ford Does Not Operate", "Indian Firms",
                        "EV Startups", "Direct Competitors".
                      • Geographies: "North America", "Asia Pacific".
                      • Industry segments / categories: "Streaming Services", "Automotive Manufacturers",
                        "Management Consulting", "General Tech".
                      • Corporate suffixes alone: "Ltd", "Inc", "Pvt Ltd".
                      • Stop-words / placeholders: "None", "N/A", "unknown".
                      DO NOT use non_entity just because you don't recognize the company or it's outside a
                      specific industry. If it's a real-sounding company name in any sector, choose new_canonical.

Return STRICT JSON: an object with key "suggestions" whose value is an array, one entry per input variant,
in the same order.
Each entry: { raw_alias, decision, canonical_name, entity_type, confidence, rationale }.
- decision: "map_existing" | "new_canonical" | "non_entity"
- canonical_name: the exact existing canonical name (when map_existing), the proposed clean display name
  (when new_canonical), or null (when non_entity).
- entity_type: one of "oem" | "supplier" | "it_services" | "consulting" | "financial" | "other" | "non_entity".
  Use "non_entity" iff decision is non_entity. Use "other" liberally when no specific category fits — the
  type is a soft tag, not a filter.
- confidence: 0..1.
- rationale: <= 140 chars. Justify the decision. If "non_entity", say WHY it's not a real entity name
  (e.g. "geography", "phrase", "industry segment") — never say "not in auto industry" or similar.`;

  const userPrompt = `Existing canonical companies (do not invent new spellings; map to these exactly when applicable):
${canonicalList.join(", ")}

Variants to classify:
${unmapped.map((u, i) => `${i + 1}. ${u.raw_alias}`).join("\n")}`;

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
    const body = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { suggestions: Suggestion[] };
  const suggestions = parsed.suggestions ?? [];

  // Build inserts; align by raw_alias to be safe (LLMs sometimes drop entries).
  const byRaw = new Map(suggestions.map((s) => [s.raw_alias, s]));
  const rows = unmapped.map((u) => {
    const s = byRaw.get(u.raw_alias);
    const isNonEntity = s?.decision === "non_entity";
    return {
      raw_alias: u.raw_alias,
      normalized_alias: u.normalized_alias,
      mention_count: u.mention_count,
      suggested_canonical_name: s?.canonical_name ?? null,
      suggested_entity_type: s?.entity_type ?? null,
      suggested_is_non_entity: !!isNonEntity,
      confidence: typeof s?.confidence === "number" ? s.confidence : null,
      status: "pending" as const,
      llm_rationale: s?.rationale ?? null,
      llm_model: MODEL,
    };
  });

  if (dryRun) {
    return new Response(
      JSON.stringify({ processed: rows.length, suggestions: rows, dryRun: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: insertErr } = await supabase
    .from("entity_alias_suggestions")
    .upsert(rows, { onConflict: "normalized_alias", ignoreDuplicates: false });
  if (insertErr) throw insertErr;

  return new Response(
    JSON.stringify({ processed: rows.length, suggestions: rows }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^[\s\p{P}"]+|[\s\p{P}"]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
