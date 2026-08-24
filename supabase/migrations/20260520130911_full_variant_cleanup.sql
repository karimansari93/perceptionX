-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260520130911; this file was
-- back-filled afterwards and therefore post-dates the deployment.

BEGIN
CREATE EXTENSION IF NOT EXISTS unaccent
ALTER TABLE public.company_canonical_names ADD COLUMN IF NOT EXISTS brand_key text
UPDATE public.company_canonical_names SET brand_key = lower(public.unaccent(canonical_name)) WHERE brand_key IS NULL OR brand_key = ''
CREATE TEMP TABLE _classifications (canonical_name text NOT NULL, variant_name text NOT NULL, new_variant_type text NOT NULL, brand_key text NOT NULL, reason text) ON COMMIT DROP
INSERT INTO _classifications (canonical_name, variant_name, new_variant_type, brand_key, reason) VALUES
  ('Nestlé','purina','subsidiary','purina','Purina collision'),
  ('Nestlé','nestle purina','subsidiary','purina','Purina collision'),
  ('Nestlé','nestlé purina','subsidiary','purina','Purina collision'),
  ('Nestlé','nestle purina petcare','subsidiary','purina','Purina collision'),
  ('Nestlé','nestlé purina petcare','subsidiary','purina','Purina collision'),
  ('Nestlé','nestlé health science','subsidiary','nestle health science','health-science arm'),
  ('Nestlé','nestle','alias','nestle',''),
  ('Nestlé','nestlé','alias','nestle',''),
  ('Nestlé','nestlé brazil','geo','nestle',''),
  ('Amazon','aws','subsidiary','aws','AWS collision'),
  ('Amazon','amazon web services','subsidiary','aws','AWS collision'),
  ('Amazon','amazon web services (aws)','subsidiary','aws','AWS collision'),
  ('Amazon','amazon prime video','subsidiary','prime video','Prime Video collision'),
  ('Amazon','prime video','subsidiary','prime video','Prime Video collision'),
  ('Amazon','twitch','subsidiary','twitch',''),
  ('Amazon','amazon','alias','amazon',''),
  ('Amazon','amazon brazil','geo','amazon',''),
  ('Roche','genentech','subsidiary','genentech','Genentech collision'),
  ('Roche','genentech/roche','subsidiary','genentech','Genentech collision'),
  ('Roche','genentech (roche group)','subsidiary','genentech','Genentech collision'),
  ('Roche','roche/genentech','subsidiary','genentech','Genentech collision'),
  ('Roche','roche diagnostics','subsidiary','roche diagnostics',''),
  ('Roche','roche','alias','roche',''),
  ('Roche','roche brazil','geo','roche',''),
  ('PepsiCo','frito-lay','subsidiary','frito-lay','Frito-Lay collision'),
  ('PepsiCo','frito lay','subsidiary','frito-lay','Frito-Lay collision'),
  ('PepsiCo','lays','subsidiary','lays','Lay collision'),
  ('PepsiCo','lay''s','subsidiary','lays','Lay collision'),
  ('PepsiCo','quaker','subsidiary','quaker','Quaker collision'),
  ('PepsiCo','quaker oats','subsidiary','quaker','Quaker collision'),
  ('PepsiCo','gatorade','subsidiary','gatorade',''),
  ('PepsiCo','tropicana','subsidiary','tropicana',''),
  ('PepsiCo','pepsi','subsidiary','pepsi',''),
  ('PepsiCo','pepsico','alias','pepsico','')
UPDATE public.company_canonical_names c SET variant_type = cls.new_variant_type, brand_key = cls.brand_key FROM _classifications cls WHERE c.canonical_name = cls.canonical_name AND c.variant_name = cls.variant_name
CREATE TEMP TABLE _detachments (canonical_name text NOT NULL, variant_name text NOT NULL, reason text) ON COMMIT DROP
INSERT INTO _detachments VALUES ('Ford','ford foundation','Ford Foundation is independent')
UPDATE public.company_canonical_names c SET canonical_name = c.variant_name, variant_type = 'alias', brand_key = lower(public.unaccent(c.variant_name)) FROM _detachments d WHERE c.canonical_name = d.canonical_name AND c.variant_name = d.variant_name
CREATE TEMP TABLE _reparents (old_canonical text NOT NULL, new_canonical text NOT NULL, variant_name text NOT NULL, new_variant_type text NOT NULL, brand_key text NOT NULL, reason text) ON COMMIT DROP
INSERT INTO _reparents VALUES
  ('KFC','Yum! Brands','kfc','subsidiary','kfc',''),
  ('KFC','Yum! Brands','kfc brazil','geo','kfc',''),
  ('KFC','Yum! Brands','kfc india','geo','kfc',''),
  ('Pizza Hut','Yum! Brands','pizza hut','subsidiary','pizza hut',''),
  ('Pizza Hut','Yum! Brands','pizza hut india','geo','pizza hut',''),
  ('Taco Bell','Yum! Brands','taco bell','subsidiary','taco bell',''),
  ('Taco Bell','Yum! Brands','taco bell uk','geo','taco bell',''),
  ('Whatsapp','Meta','whatsapp','subsidiary','whatsapp','')
UPDATE public.company_canonical_names c SET canonical_name = r.new_canonical, variant_type = r.new_variant_type, brand_key = r.brand_key FROM _reparents r WHERE c.canonical_name = r.old_canonical AND c.variant_name = r.variant_name
UPDATE public.company_canonical_names SET variant_type = 'geo' WHERE variant_type = 'alias' AND lower(variant_name) <> lower(canonical_name) AND variant_name ~* '\m(uk|gb|usa|india|china|brazil|brasil|germany|deutschland|france|spain|italy|japan|korea|mexico|canada|australia)\M'
UPDATE public.company_canonical_names SET brand_key = lower(public.unaccent(canonical_name)) WHERE brand_key IS NULL OR brand_key = ''
ALTER TABLE public.company_canonical_names ALTER COLUMN brand_key SET NOT NULL
CREATE INDEX IF NOT EXISTS idx_ccn_brand_key ON public.company_canonical_names (brand_key)
CREATE OR REPLACE FUNCTION public.get_company_subsidiaries(p_canonical text)
RETURNS TABLE(subsidiary text, variant_type text, mention_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH subs AS (
    SELECT s.brand_key, s.variant_name, s.variant_type, length(s.variant_name) AS vlen
    FROM public.company_canonical_names s
    WHERE lower(s.canonical_name) = lower(p_canonical)
      AND s.variant_type = 'subsidiary'
      AND lower(s.variant_name) <> lower(s.canonical_name)
  ),
  pick AS (
    SELECT DISTINCT ON (brand_key) brand_key, variant_name, variant_type
    FROM subs
    ORDER BY brand_key, vlen, variant_name
  )
  SELECT p.variant_name AS subsidiary, p.variant_type, COALESCE(m.cnt, 0)::int AS mention_count
  FROM pick p
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.prompt_responses pr
    WHERE pr.for_index = true AND EXISTS (
      SELECT 1 FROM public.company_canonical_names sib
      WHERE sib.brand_key = p.brand_key AND lower(sib.canonical_name) = lower(p_canonical)
        AND pr.detected_competitors ILIKE '%' || sib.variant_name || '%'
    )
  ) m ON true
  ORDER BY mention_count DESC, p.variant_name;
$function$
COMMIT
