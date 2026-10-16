-- Last three suggestions left undecided after the 2026-10-15 queue drain
-- (applied 2026-10-16; Karim wants no manual review).
--
-- Canal+ was stored with normalized_name 'canal+' (older normalization kept
-- the '+'), but normalize_entity_name('Canal+') is now 'canal', so
-- apply_auto_canonicalization could not find it and bounced every Canal+
-- variant back to manual. Re-normalize it (no other canonical uses 'canal')
-- and alias the two bounced variants. "Executive Headhunters" is a phrase,
-- not a company: let the apply step record it as a non-entity.

UPDATE public.canonical_entities
SET normalized_name = public.normalize_entity_name(canonical_name), updated_at = now()
WHERE canonical_name = 'Canal+'
  AND NOT EXISTS (SELECT 1 FROM public.canonical_entities x WHERE x.normalized_name = public.normalize_entity_name('Canal+'));

INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
SELECT ce.id, s.raw_alias, s.normalized_alias, 'manual', now()
FROM public.entity_alias_suggestions s
JOIN public.canonical_entities ce ON ce.canonical_name = 'Canal+'
WHERE s.status = 'pending' AND s.raw_alias IN ('Canal+ Group', 'Canal+ Poland')
ON CONFLICT (normalized_alias) DO NOTHING;

UPDATE public.entity_alias_suggestions
SET auto_method = 'auto_llm',
    llm_rationale = coalesce(llm_rationale, '') || ' [Auto-applied 2026-10-16: generic phrase, not a company]'
WHERE status = 'pending' AND auto_method IS NULL AND raw_alias LIKE 'Executive Headhunters%';

SELECT public.resolve_orphan_canonicalization_suggestions();
