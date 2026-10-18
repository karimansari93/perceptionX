-- Names shown as initcap(raw) capitalise the letter after an apostrophe
-- ("St. Luke'S International Hospital", "Women'S"). Map those raw names to
-- the right casing, and fix entries that already carry it. Only a capital S
-- after a lower-case letter changes, so "TOD'S" stays as it is.

UPDATE public.company_canonical_names
SET canonical_name = regexp_replace(canonical_name, '([[:lower:]])([''’])S\M', '\1\2s', 'g'),
    brand_key = lower(regexp_replace(canonical_name, '([[:lower:]])([''’])S\M', '\1\2s', 'g')),
    updated_at = now()
WHERE canonical_name ~ '([[:lower:]])([''’])S\M';

INSERT INTO public.company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
SELECT DISTINCT ON (x.n) x.n, regexp_replace(initcap(x.n), '([[:lower:]])([''’])S\M', '\1\2s', 'g'), false, 'imported', 'alias',
       lower(regexp_replace(initcap(x.n), '([[:lower:]])([''’])S\M', '\1\2s', 'g'))
FROM (
  SELECT clean_company_name(t) AS n
  FROM (SELECT detected_competitors FROM public.index_responses WHERE index_period IS NULL
        UNION ALL
        SELECT detected_competitors FROM public.prompt_responses WHERE for_index AND index_period IS NULL) r
  CROSS JOIN LATERAL regexp_split_to_table(r.detected_competitors, '[,;\n]+') AS t
  WHERE r.detected_competitors ~ '[''’][sS]' AND length(btrim(t)) > 1
) x
WHERE initcap(x.n) ~ '([[:lower:]])([''’])S\M'
  AND NOT EXISTS (SELECT 1 FROM public.company_canonical_names c WHERE lower(c.variant_name) = x.n)
ON CONFLICT (variant_name) DO NOTHING;
