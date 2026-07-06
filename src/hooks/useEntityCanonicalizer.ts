import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeEntityName } from "@/utils/competitorUtils";

/**
 * Returns a canonicalizer that maps raw competitor variants (as they appear in
 * prompt_responses.detected_competitors) onto canonical entity names stored in
 * public.canonical_entities via public.entity_aliases.
 *
 * - If the variant has an alias mapping AND the canonical is active, returns
 *   the canonical name (e.g. "Disney+" -> "Disney").
 * - If the variant maps to an INACTIVE canonical (a non-entity flagged in the
 *   admin canonicalization tab), returns null so the caller can drop the row.
 * - If the variant has no mapping, returns the original trimmed string so it
 *   still appears in the UI — coverage gaps remain visible until you map them.
 *
 * The map is fetched once on mount. Up to 5000 aliases — bump if you ever
 * exceed that. The Map lookup itself is O(1).
 */
export function useEntityCanonicalizer() {
  const [aliasMap, setAliasMap] = useState<Map<string, { canonical_name: string; is_active: boolean }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('entity_aliases')
        .select('normalized_alias, canonical_entities!inner(canonical_name, is_active)')
        .limit(5000);
      if (cancelled || error || !data) return;
      const next = new Map<string, { canonical_name: string; is_active: boolean }>();
      for (const row of data as Array<{
        normalized_alias: string;
        canonical_entities:
          | { canonical_name: string; is_active: boolean }
          | { canonical_name: string; is_active: boolean }[];
      }>) {
        const ce = Array.isArray(row.canonical_entities) ? row.canonical_entities[0] : row.canonical_entities;
        if (!ce) continue;
        next.set(row.normalized_alias, { canonical_name: ce.canonical_name, is_active: ce.is_active });
      }
      setAliasMap(next);
    })();
    return () => { cancelled = true; };
  }, []);

  const canonicalize = useCallback((raw: string): string | null => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    const norm = normalizeEntityName(trimmed);
    if (!norm) return null;
    const hit = aliasMap.get(norm);
    if (hit) return hit.is_active ? hit.canonical_name : null;
    return trimmed;
  }, [aliasMap]);

  return { canonicalize, aliasMap };
}
