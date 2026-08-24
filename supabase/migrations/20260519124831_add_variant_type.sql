-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260519124831; this file was
-- back-filled afterwards and therefore post-dates the deployment.

ALTER TABLE public.company_canonical_names
  ADD COLUMN IF NOT EXISTS variant_type text NOT NULL DEFAULT 'alias';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_canonical_names_variant_type_chk'
  ) THEN
    ALTER TABLE public.company_canonical_names
      ADD CONSTRAINT company_canonical_names_variant_type_chk
      CHECK (variant_type IN ('alias','geo','subsidiary','parent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ccn_canonical_variant_type
  ON public.company_canonical_names (canonical_name, variant_type);

CREATE TEMP TABLE _subsidiary_seed (parent text, brand text) ON COMMIT DROP;
INSERT INTO _subsidiary_seed (parent, brand) VALUES
  ('TJX','marshalls'),('TJX','homegoods'),('TJX','tj maxx'),('TJX','tk maxx'),
  ('TJX','homesense'),
  ('PepsiCo','pepsi'),('PepsiCo','gatorade'),('PepsiCo','frito-lay'),
  ('PepsiCo','frito lay'),('PepsiCo','quaker'),('PepsiCo','quaker oats'),
  ('PepsiCo','tropicana'),('PepsiCo','doritos'),('PepsiCo','lay''s'),
  ('PepsiCo','lays'),('PepsiCo','cheetos'),('PepsiCo','mountain dew'),
  ('PepsiCo','aquafina'),('PepsiCo','sodastream'),
  ('PepsiCo','rockstar energy'),('PepsiCo','propel'),('PepsiCo','sabra'),
  ('PepsiCo','naked juice'),
  ('Nestlé','purina'),('Nestlé','nestle purina'),('Nestlé','nestlé purina'),
  ('Nestlé','nestle purina petcare'),('Nestlé','nestlé purina petcare'),
  ('Nestlé','nestlé health science'),
  ('Roche','genentech'),('Roche','genentech/roche'),('Roche','roche/genentech'),
  ('Roche','genentech (roche group)'),('Roche','roche diagnostics'),
  ('Roche','roche pharma'),
  ('Amazon','aws'),('Amazon','amazon web services'),
  ('Amazon','amazon web services (aws)'),('Amazon','amazon prime video'),
  ('Amazon','prime video'),('Amazon','amazon mgm studios'),
  ('Amazon','amazon studios'),('Amazon','amazon lab126'),
  ('Amazon','amazon music'),('Amazon','amazon games'),
  ('Amazon','amazon kuiper'),('Amazon','twitch'),
  ('Google','deepmind'),('Google','google deepmind'),('Google','waymo'),
  ('Google','waymo (alphabet)'),('Google','google cloud'),
  ('Google','google cloud platform'),('Google','youtube'),
  ('Google','fitbit'),('Google','google nest'),
  ('PwC','strategy&'),('PwC','strategy& (pwc)'),
  ('Deloitte','monitor deloitte'),('Deloitte','deloitte digital'),
  ('Mars','mars petcare'),('Mars','mars wrigley'),
  ('Mars','mars veterinary health'),('Mars','wrigley'),
  ('Unilever','hindustan unilever'),('Unilever','hindustan unilever limited'),
  ('Sony','sony interactive entertainment'),('Sony','sony music'),
  ('Sony','sony music entertainment'),('Sony','sony pictures'),
  ('Sony','sony pictures entertainment'),('Sony','playstation'),
  ('Tata','tata steel'),('Tata','tata motors'),('Tata','tata power'),
  ('Tata','tata consultancy services'),('Tata','tcs'),
  ('Tata','tata chemicals'),('Tata','tata communications'),
  ('Tata','tata elxsi'),('Tata','tata technologies'),
  ('Tata','tata consumer'),('Tata','tata consumer products'),
  ('Tata','tata starbucks'),('Tata','jaguar land rover'),
  ('Mahindra','tech mahindra'),
  ('Reliance','reliance jio'),('Reliance','reliance retail'),('Reliance','jio'),
  ('Aditya Birla','aditya birla fashion'),('Aditya Birla','hindalco'),
  ('Aditya Birla','grasim'),
  ('Coca-Cola','costa coffee'),
  ('Coca-Cola','minute maid'),('Coca-Cola','sprite'),('Coca-Cola','fanta');

UPDATE public.company_canonical_names
SET variant_type = 'geo'
WHERE variant_type = 'alias'
  AND lower(variant_name) <> lower(canonical_name)
  AND lower(variant_name) ~ (
        '(^|[^a-z])('
        || 'india|china|u\.?k\.?|u\.?s\.?a?|usa|brasil|brazil|do brasil|'
        || 'france|germany|deutschland|spain|espana|europe|european|'
        || 'north america|latin america|of america|canada|japan|mexico|'
        || 'italy|italia|netherlands|asia|africa|australia|nordic|iberia|'
        || 'middle east|apac|emea|latam'
        || ')([^a-z]|$)'
      );

UPDATE public.company_canonical_names ccn
SET canonical_name = s.parent
FROM _subsidiary_seed s
WHERE lower(ccn.canonical_name) = lower(s.brand)
  AND lower(ccn.canonical_name) <> lower(s.parent);

INSERT INTO public.company_canonical_names (variant_name, canonical_name, variant_type, source)
SELECT s.brand, s.parent, 'subsidiary', 'manual'
FROM _subsidiary_seed s
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_canonical_names c
  WHERE lower(c.variant_name) = lower(s.brand)
    AND lower(c.canonical_name) = lower(s.parent)
);

UPDATE public.company_canonical_names ccn
SET variant_type = 'subsidiary'
FROM _subsidiary_seed s
WHERE lower(ccn.variant_name) = lower(s.brand)
  AND lower(ccn.canonical_name) = lower(s.parent)
  AND lower(ccn.variant_name) <> lower(ccn.canonical_name);

UPDATE public.company_canonical_names
SET variant_type = 'parent'
WHERE lower(variant_name) IN (
  'alphabet','alphabet inc','alphabet inc.',
  'the walt disney company','walt disney company',
  'meta platforms','meta platforms inc'
)
AND lower(variant_name) <> lower(canonical_name);

DROP FUNCTION IF EXISTS public.search_companies(text, integer);

CREATE OR REPLACE FUNCTION public.search_companies(query text, max_results integer DEFAULT 30)
 RETURNS TABLE(
   canonical_name text,
   website_domain text,
   industries text[],
   total_mentions integer,
   best_industry text,
   matched_variant text,
   matched_type text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH q AS (SELECT lower(trim(query)) AS ql),
  direct AS (
    SELECT cs.canonical_name, cs.website_domain, cs.industries,
           cs.total_mentions, cs.best_industry,
           NULL::text AS matched_variant, NULL::text AS matched_type,
           CASE
             WHEN lower(cs.canonical_name) = (SELECT ql FROM q) THEN 0
             WHEN lower(cs.canonical_name) LIKE (SELECT ql FROM q) || '%' THEN 1
             ELSE 2
           END AS rank_bucket
    FROM company_search_index cs, q
    WHERE lower(cs.canonical_name) LIKE '%' || q.ql || '%'
  ),
  via_variant AS (
    SELECT cs.canonical_name, cs.website_domain, cs.industries,
           cs.total_mentions, cs.best_industry,
           ccn.variant_name AS matched_variant, ccn.variant_type AS matched_type,
           CASE
             WHEN lower(ccn.variant_name) = (SELECT ql FROM q) THEN 3
             WHEN lower(ccn.variant_name) LIKE (SELECT ql FROM q) || '%' THEN 4
             ELSE 5
           END AS rank_bucket
    FROM company_canonical_names ccn
    JOIN company_search_index cs
      ON lower(cs.canonical_name) = lower(ccn.canonical_name)
    , q
    WHERE ccn.variant_type IN ('subsidiary','parent')
      AND lower(ccn.variant_name) <> lower(ccn.canonical_name)
      AND lower(ccn.variant_name) LIKE '%' || q.ql || '%'
  ),
  ranked AS (
    SELECT DISTINCT ON (canonical_name) *
    FROM (SELECT * FROM direct UNION ALL SELECT * FROM via_variant) u
    ORDER BY canonical_name, rank_bucket
  )
  SELECT canonical_name, website_domain, industries, total_mentions,
         best_industry, matched_variant, matched_type
  FROM ranked
  ORDER BY rank_bucket,
           CASE WHEN lower(canonical_name) = (SELECT ql FROM q) THEN 0 ELSE 1 END,
           total_mentions DESC
  LIMIT max_results;
$function$;

GRANT EXECUTE ON FUNCTION public.search_companies(text, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_company_subsidiaries(p_canonical text)
 RETURNS TABLE(subsidiary text, variant_type text, mention_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT s.variant_name AS subsidiary,
         s.variant_type,
         COALESCE(m.cnt, 0)::int AS mention_count
  FROM company_canonical_names s
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM prompt_responses pr
    WHERE pr.for_index = true
      AND pr.detected_competitors ILIKE '%' || s.variant_name || '%'
  ) m ON true
  WHERE lower(s.canonical_name) = lower(p_canonical)
    AND s.variant_type = 'subsidiary'
    AND lower(s.variant_name) <> lower(s.canonical_name)
  ORDER BY mention_count DESC, s.variant_name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_company_subsidiaries(text)
  TO anon, authenticated, service_role;
