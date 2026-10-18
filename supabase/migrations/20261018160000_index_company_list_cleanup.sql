-- Public Index company list clean-up (Karim, 2026-10-18: "We should have a
-- super clean company list after all this").
--
-- Every list below was reviewed by hand against the live Index (all 2,425
-- entries with 3+ mentions, plus the alias system's 316 suggested pairs, with
-- industry checks for ambiguous names). Nothing here calls an AI model.
--
--  1. Broken display names: "Boston" -> Boston Consulting Group, "Banco Do" ->
--     Banco do Brasil, "Agricultural Bank of" -> ... of China, initcap'd
--     acronyms ("Qvc" -> QVC) take the alias system's spelling.
--  2. Duplicates join one entry: BCG / Boston Consulting Group, Citi /
--     Citigroup / Citibank, P&G / Procter & Gamble, GlaxoSmithKline / GSK,
--     EA / Electronic Arts, product names join their maker (Azure ->
--     Microsoft, Pedigree -> Mars, WeChat -> Tencent).
--     Kept apart on purpose: HP / HPE, Rolls-Royce / Rolls-Royce Motor Cars,
--     GE Aerospace / GE HealthCare / GE Appliances, Coca-Cola / its bottlers,
--     Lloyds / Lloyd's of London, GLS / GLS Bank, Merck / Merck & Co.
--  3. Separate employers folded into a parent since May are split out ("TCS,
--     not Tata"): TCS, Tata Motors, JLR, Tata Steel, Tata Power and the other
--     Tata companies; Tech Mahindra and other listed Mahindra companies;
--     Siemens Energy and Siemens Healthineers; Hindalco and Grasim; Jio and
--     Reliance Retail; Vodafone Idea; Hindustan Unilever; Waymo; Google
--     DeepMind; Hilton Grand Vacations; AWS; Lloyd's of London.
--     company_keep_apart stops the nightly grouping from folding them back.
--  4. Entries that are not employers (categories, places, products, terms)
--     are excluded through company_overrides.
--  5. A size filter in April excluded companies whose size was then unknown.
--     The ones since labelled 5000+ (Amazon, Siemens, Novartis, Morgan
--     Stanley, Medtronic, Hyatt, KFC ...) were never shown again; they are
--     lifted now and nightly from here on. Ambiguous names stay hidden.
--
-- Backups of all three tables are taken first.

CREATE TABLE IF NOT EXISTS public.company_canonical_names_backup_20261018c AS
SELECT * FROM public.company_canonical_names;
CREATE TABLE IF NOT EXISTS public.company_overrides_backup_20261018 AS
SELECT * FROM public.company_overrides;
CREATE TABLE IF NOT EXISTS public.company_employee_tiers_backup_20261018 AS
SELECT * FROM public.company_employee_tiers;

CREATE TABLE IF NOT EXISTS public.company_keep_apart (
  name text PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_keep_apart ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.company_keep_apart IS
  'Separate employers the nightly Index grouping must never fold into a parent (TCS is not Tata).';
INSERT INTO public.company_keep_apart (name, note) VALUES
  ('AWS', 'Separate employer (2026-10-18 clean-up)'),
  ('Aditya Birla Fashion and Retail', 'Separate employer (2026-10-18 clean-up)'),
  ('Club Mahindra', 'Separate employer (2026-10-18 clean-up)'),
  ('Google DeepMind', 'Separate employer (2026-10-18 clean-up)'),
  ('Grasim Industries', 'Separate employer (2026-10-18 clean-up)'),
  ('Hilton Grand Vacations', 'Separate employer (2026-10-18 clean-up)'),
  ('Hindalco', 'Separate employer (2026-10-18 clean-up)'),
  ('Hindustan Unilever', 'Separate employer (2026-10-18 clean-up)'),
  ('JLR', 'Separate employer (2026-10-18 clean-up)'),
  ('Jio', 'Separate employer (2026-10-18 clean-up)'),
  ('Jio Financial Services', 'Separate employer (2026-10-18 clean-up)'),
  ('Lloyd''s of London', 'Separate employer (2026-10-18 clean-up)'),
  ('Mahindra Finance', 'Separate employer (2026-10-18 clean-up)'),
  ('Mahindra Lifespaces', 'Separate employer (2026-10-18 clean-up)'),
  ('Mahindra Logistics', 'Separate employer (2026-10-18 clean-up)'),
  ('Reliance Retail', 'Separate employer (2026-10-18 clean-up)'),
  ('Samsung Biologics', 'Separate employer (2026-10-18 clean-up)'),
  ('Samsung SDI', 'Separate employer (2026-10-18 clean-up)'),
  ('Siemens Energy', 'Separate employer (2026-10-18 clean-up)'),
  ('Siemens Gamesa', 'Separate employer (2026-10-18 clean-up)'),
  ('Siemens Healthineers', 'Separate employer (2026-10-18 clean-up)'),
  ('TCS', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata 1mg', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata AIA Life Insurance', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata AIG', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Advanced Systems', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata AutoComp Systems', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata CLiQ', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Capital', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Chemicals', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Communications', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Consumer Products', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Digital', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Electronics', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Elxsi', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Housing', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata International', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Medical Center', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Memorial Centre', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Motors', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Power', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Projects', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Realty and Infrastructure Limited', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Starbucks', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Steel', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Strategic Management Group', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Technologies', 'Separate employer (2026-10-18 clean-up)'),
  ('Tata Teleservices', 'Separate employer (2026-10-18 clean-up)'),
  ('Tech Mahindra', 'Separate employer (2026-10-18 clean-up)'),
  ('Vodafone Idea', 'Separate employer (2026-10-18 clean-up)'),
  ('Waymo', 'Separate employer (2026-10-18 clean-up)')
ON CONFLICT (name) DO NOTHING;

-- Moves one Index entry (all its name-list rows) to another display name.
-- The joined entry keeps a size label when only the old name had one.
CREATE OR REPLACE FUNCTION public.index_fold_entry(p_from text, p_to text, p_map_raw boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  INSERT INTO company_employee_tiers (company_name, estimated_tier, confidence, classified_by, classified_at)
  SELECT p_to, t.estimated_tier, t.confidence, t.classified_by, t.classified_at
  FROM company_employee_tiers t
  WHERE lower(t.company_name) = lower(p_from)
    AND NOT EXISTS (SELECT 1 FROM company_employee_tiers x WHERE lower(x.company_name) = lower(p_to))
  LIMIT 1
  ON CONFLICT (company_name) DO NOTHING;

  UPDATE company_canonical_names
  SET canonical_name = p_to, brand_key = lower(p_to), updated_at = now()
  WHERE lower(canonical_name) = lower(p_from);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Names that only appear raw on the Index have no row yet.
  IF p_map_raw AND lower(p_from) <> lower(p_to) THEN
    INSERT INTO company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
    VALUES (lower(p_from), p_to, true, 'manual', 'alias', lower(p_to))
    ON CONFLICT (variant_name) DO NOTHING;
  END IF;
  RETURN v_n;
END;
$function$;

-- Moves the name-list rows of one parent that match a pattern to their own entry.
CREATE OR REPLACE FUNCTION public.index_split_variants(p_from text, p_pattern text, p_to text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  UPDATE company_canonical_names
  SET canonical_name = p_to,
      brand_key = lower(p_to),
      variant_type = CASE WHEN variant_type IN ('subsidiary', 'parent') THEN 'alias' ELSE variant_type END,
      updated_at = now()
  WHERE canonical_name = p_from AND variant_name ~ p_pattern;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- Alias-system pass: variants that start with a separate employer's name go to
-- that employer, and rows already on a separate employer are never moved.
CREATE OR REPLACE FUNCTION public.index_obvious_variant_plan()
RETURNS TABLE(variant text, target text, existing_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH a AS (
    SELECT DISTINCT ON (lower(btrim(ea.alias))) lower(btrim(ea.alias)) AS variant, ce.canonical_name
    FROM entity_aliases ea
    JOIN canonical_entities ce ON ce.id = ea.canonical_id
    WHERE ce.is_active AND ce.entity_type IS DISTINCT FROM 'non_entity'
      AND length(btrim(ea.alias)) > 1
    ORDER BY lower(btrim(ea.alias)), ea.created_at DESC
  ), obvious AS (
    SELECT a.variant, coalesce(ka.name, p.canonical_name, a.canonical_name) AS target
    FROM a
    LEFT JOIN company_canonical_names p ON p.variant_name = lower(a.canonical_name)
    LEFT JOIN LATERAL (
      SELECT k.name FROM company_keep_apart k
      WHERE a.variant = lower(k.name) OR a.variant LIKE lower(k.name) || ' %'
      ORDER BY length(k.name) DESC
      LIMIT 1
    ) ka ON true
    WHERE a.variant LIKE lower(a.canonical_name) || ' %'
      AND a.canonical_name !~* '\m(of|and|the|de|du|des|da|do|&)$'
      AND length(a.canonical_name) >= 3
  )
  SELECT o.variant, o.target, c.id
  FROM obvious o
  LEFT JOIN company_canonical_names c ON c.variant_name = o.variant
  WHERE (c.id IS NULL
     OR (c.canonical_name <> o.target AND (
           normalize_entity_name(c.canonical_name) = normalize_entity_name(o.variant)
        OR lower(c.canonical_name) LIKE lower(o.target) || ' %')))
    AND NOT EXISTS (
      SELECT 1 FROM company_keep_apart k
      WHERE lower(k.name) = lower(c.canonical_name) AND lower(k.name) <> lower(o.target));
$function$;

CREATE OR REPLACE FUNCTION public.index_country_suffix_plan()
RETURNS TABLE(fragment text, target text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH vis AS (
    SELECT DISTINCT canonical_name AS f FROM rankings_overview
    UNION
    SELECT DISTINCT canonical_name FROM rankings_historical
  ), visl AS (
    SELECT DISTINCT ON (lower(f)) lower(f) AS lf, f FROM vis ORDER BY lower(f), f
  ), s AS (
    SELECT f, lower(f) AS lf, strip_company_geo_legal_tail(f) AS rem FROM vis
  ), c AS (
    SELECT s.f, s.lf, coalesce(m.canonical_name, v.f) AS target
    FROM s
    LEFT JOIN company_canonical_names m ON m.variant_name = s.rem
    LEFT JOIN visl v ON v.lf = s.rem
    WHERE s.rem <> s.lf
      AND length(s.rem) >= 2
      AND s.rem !~ '\m(of|and|the|de|du|des|da|do|del|di|la|le|y|e)$'
      AND s.rem !~ '[&/+-]$'
      AND NOT EXISTS (SELECT 1 FROM company_keep_apart k WHERE lower(k.name) = s.lf)
      -- Generic words, and names that differ from the shorter entry
      -- ("Man Group" is not MAN, "News Corp" is not "News").
      AND s.rem NOT IN ('air', 'virgin', 'telecom', 'bank', 'banco', 'banque', 'national',
                        'royal', 'first', 'general', 'standard', 'united', 'grupo',
                        'credit', 'post', 'mobile', 'energy', 'power', 'airways', 'airlines',
                        'man', 'news', 'home', 'business', 'central', 'life', 'health',
                        'care', 'pet care', 'petcare', 'digital', 'capital', 'media',
                        'services', 'solutions', 'global', 'international', 'industries',
                        'systems', 'technologies', 'the', 'restaurant brands')
  ), direct AS (
    SELECT c.f, c.lf, t.f AS target
    FROM c
    JOIN visl t ON t.lf = lower(c.target)
    WHERE t.lf <> c.lf
  )
  -- One hop: if the parent is itself being folded, go straight to its parent.
  SELECT d.f, coalesce(p.target, d.target)
  FROM direct d
  LEFT JOIN direct p ON p.lf = lower(d.target) AND lower(p.target) <> d.lf;
$function$;

-- The April size filter excluded companies whose size was unknown, with a note
-- the nightly reconcile never matched. Lift those now labelled 5000+.
CREATE OR REPLACE FUNCTION public.lift_stale_size_exclusions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  UPDATE company_overrides co
  SET status = 'active',
      notes = 'Shown again ' || to_char(now(), 'YYYY-MM-DD') || ': now labelled 5000+. Was: ' || co.notes,
      updated_at = now()
  FROM company_employee_tiers cet
  WHERE lower(cet.company_name) = lower(co.canonical_name)
    AND co.status = 'excluded'
    AND co.notes LIKE 'Enterprise filter:%'
    AND cet.estimated_tier IN ('5000-49999', '50000+');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_index_obvious_variants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300000'
AS $function$
DECLARE
  v_added int;
  v_fixed int;
  v_folded int;
  v_folded_new int;
  v_spelling int;
  v_spelling_new int;
  v_lifted int;
  v_plan jsonb;
BEGIN
  -- 1. Variants the alias system knows (20261018100000).
  UPDATE company_canonical_names c
  SET canonical_name = p.target, brand_key = lower(p.target), updated_at = now()
  FROM index_obvious_variant_plan() p
  WHERE c.id = p.existing_id;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  INSERT INTO company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
  SELECT p.variant, p.target, false, 'imported', 'alias', lower(p.target)
  FROM index_obvious_variant_plan() p
  WHERE p.existing_id IS NULL
  ON CONFLICT (variant_name) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- 2. Index entries that are another entry plus country / legal words.
  --    The plan is read once, before the update changes what it would see.
  SELECT coalesce(jsonb_agg(jsonb_build_object('fragment', fragment, 'target', target)), '[]'::jsonb)
  INTO v_plan
  FROM index_country_suffix_plan();

  UPDATE company_canonical_names c
  SET canonical_name = p.target, brand_key = lower(p.target), updated_at = now()
  FROM jsonb_to_recordset(v_plan) AS p(fragment text, target text)
  WHERE lower(c.canonical_name) = lower(p.fragment);
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  INSERT INTO company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
  SELECT DISTINCT ON (lower(p.fragment)) lower(p.fragment), p.target, false, 'imported', 'geo', lower(p.target)
  FROM jsonb_to_recordset(v_plan) AS p(fragment text, target text)
  ORDER BY lower(p.fragment)
  ON CONFLICT (variant_name) DO NOTHING;
  GET DIAGNOSTICS v_folded_new = ROW_COUNT;

  -- 3. Same name spelled differently (accents, spacing, punctuation).
  SELECT coalesce(jsonb_agg(jsonb_build_object('fragment', fragment, 'target', target)), '[]'::jsonb)
  INTO v_plan
  FROM index_spelling_variant_plan();

  UPDATE company_canonical_names c
  SET canonical_name = p.target, brand_key = lower(p.target), updated_at = now()
  FROM jsonb_to_recordset(v_plan) AS p(fragment text, target text)
  WHERE c.canonical_name = p.fragment;
  GET DIAGNOSTICS v_spelling = ROW_COUNT;

  INSERT INTO company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
  SELECT DISTINCT ON (lower(p.fragment)) lower(p.fragment), p.target, false, 'imported', 'alias', lower(p.target)
  FROM jsonb_to_recordset(v_plan) AS p(fragment text, target text)
  ORDER BY lower(p.fragment)
  ON CONFLICT (variant_name) DO NOTHING;
  GET DIAGNOSTICS v_spelling_new = ROW_COUNT;

  -- 4. Companies hidden by the old size filter that are now labelled 5000+.
  v_lifted := lift_stale_size_exclusions();

  RETURN jsonb_build_object('added', v_added, 'fixed', v_fixed,
                            'suffix_folded', v_folded, 'suffix_added', v_folded_new,
                            'spelling_folded', v_spelling, 'spelling_added', v_spelling_new,
                            'size_exclusions_lifted', v_lifted);
END;
$function$;

-- These run from pg_cron only. Supabase grants EXECUTE on new functions to the
-- API roles by default, and the SECURITY DEFINER ones rewrite the public Index.
REVOKE EXECUTE ON FUNCTION public.index_fold_entry(text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_split_variants(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lift_stale_size_exclusions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_index_obvious_variants() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_obvious_variant_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_country_suffix_plan() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.index_spelling_variant_plan() FROM PUBLIC, anon, authenticated;

-- 1. Display names. Initcap'd acronyms take the alias system's spelling
--    (only for entries with name-list rows, so raw generic words stay put).
SELECT public.index_fold_entry(x.f, x.better, false)
FROM (
  SELECT DISTINCT ON (v.f) v.f, ce.canonical_name AS better
  FROM (SELECT DISTINCT canonical_name AS f FROM public.rankings_overview
        UNION SELECT DISTINCT canonical_name FROM public.rankings_historical) v
  JOIN public.entity_aliases ea ON ea.normalized_alias = public.normalize_entity_name(v.f)
  JOIN public.canonical_entities ce ON ce.id = ea.canonical_id
  WHERE ce.is_active AND ce.entity_type IS DISTINCT FROM 'non_entity'
    AND lower(ce.canonical_name) = lower(v.f) AND ce.canonical_name <> v.f
    AND v.f = initcap(v.f)
  ORDER BY v.f, ce.canonical_name
) x;
SELECT public.index_fold_entry(r.f, r.t, r.m) FROM (VALUES
  (0, 'Boston', 'Boston Consulting Group', false),
  (1, 'Banco Do', 'Banco do Brasil', false),
  (2, 'Banco Central Do', 'Banco Central do Brasil', false),
  (3, 'Agricultural Bank of', 'Agricultural Bank of China', false),
  (4, 'Agricultural Development Bank of', 'Agricultural Development Bank of China', false),
  (5, 'State Grid Corporation of', 'State Grid Corporation of China', false),
  (6, 'Postal Savings Bank of', 'Postal Savings Bank of China', false),
  (7, 'Export-import Bank of', 'Export-Import Bank of China', false),
  (8, 'Banque de', 'Banque de France', false),
  (9, 'The Aerospace', 'The Aerospace Corporation', true),
  (10, 'The Very', 'The Very Group', true),
  (11, 'Pa', 'PA Consulting', true),
  (12, 'Fti', 'FTI Consulting', true),
  (13, 'LEK', 'L.E.K. Consulting', true),
  (14, 'Apparel', 'Apparel Group', false),
  (15, 'Ant', 'Ant Group', true),
  (16, 'Radisson Hotel', 'Radisson Hotel Group', true),
  (17, 'Vf', 'VF Corporation', true),
  (18, 'Smiths', 'Smiths Group', true),
  (19, 'Schwarz', 'Schwarz Group', true),
  (20, 'Persistent', 'Persistent Systems', true),
  (21, 'Pjt', 'PJT Partners', true),
  (22, 'Restaurant Brands', 'Restaurant Brands International', true),
  (23, 'Reach', 'Reach plc', false),
  (24, 'Danaher Corporation', 'Danaher', true),
  (25, 'As Watson', 'A.S. Watson', true),
  (26, 'Here', 'HERE Technologies', false),
  (27, 'News', 'News UK', false),
  (28, 'Sia', 'Sia Partners', true),
  (29, 'SAIC', 'SAIC Motor', false),
  (30, 'HUL', 'Hindustan Unilever', true)
) AS r(ord, f, t, m) ORDER BY r.ord;

-- 3. Separate employers out of their parent (order matters: finance arm before Tata Motors).
SELECT public.index_split_variants(s.p, s.rx, s.t) FROM (VALUES
  (0, 'Tata', '^(tcs|tata consultancy services)\M', 'TCS'),
  (1, 'Tata', '^tata motors finance', 'Tata Capital'),
  (2, 'Tata', '^(tata motors|tata passenger electric mobility)\M', 'Tata Motors'),
  (3, 'Tata', '^jaguar land rover', 'JLR'),
  (4, 'Tata', '^tata steel\M', 'Tata Steel'),
  (5, 'Tata', '^tata power\M', 'Tata Power'),
  (6, 'Tata', '^tata consumer\M', 'Tata Consumer Products'),
  (7, 'Tata', '^tata communications\M', 'Tata Communications'),
  (8, 'Tata', '^tata elxsi', 'Tata Elxsi'),
  (9, 'Tata', '^tata technologies', 'Tata Technologies'),
  (10, 'Tata', '^tata starbucks', 'Tata Starbucks'),
  (11, 'Tata', '^tata chemicals', 'Tata Chemicals'),
  (12, 'Tata', '^tata capital', 'Tata Capital'),
  (13, 'Tata', '^tata aig', 'Tata AIG'),
  (14, 'Tata', '^tata projects', 'Tata Projects'),
  (15, 'Tata', '^tata realty', 'Tata Realty and Infrastructure Limited'),
  (16, 'Tata', '^tata housing', 'Tata Housing'),
  (17, 'Tata', '^tata advanced systems', 'Tata Advanced Systems'),
  (18, 'Tata', '^tata electronics', 'Tata Electronics'),
  (19, 'Tata', '^tata autocomp', 'Tata AutoComp Systems'),
  (20, 'Tata', '^tata international', 'Tata International'),
  (21, 'Tata', '^tata teleservices', 'Tata Teleservices'),
  (22, 'Tata', '^tata trent$', 'Trent'),
  (23, 'Tata', '^tata 1mg', 'Tata 1mg'),
  (24, 'Tata', '^(tata digital|tata payments|tata retail ecosystem)', 'Tata Digital'),
  (25, 'Tata', '^tata sia airlines', 'Air India'),
  (26, 'Tata', '^tata strategic management group', 'Tata Strategic Management Group'),
  (27, 'Tata', '^tata memorial centre', 'Tata Memorial Centre'),
  (28, 'Tata', '^tata medical center', 'Tata Medical Center'),
  (29, 'Mahindra', '^tech mahindra', 'Tech Mahindra'),
  (30, 'Mahindra', '^mahindra logistics', 'Mahindra Logistics'),
  (31, 'Mahindra', '^mahindra lifespace', 'Mahindra Lifespaces'),
  (32, 'Mahindra', '^(club mahindra|mahindra holidays)', 'Club Mahindra'),
  (33, 'Mahindra', '^(mahindra finance|mahindra & mahindra financial services)', 'Mahindra Finance'),
  (34, 'Siemens', '^siemens energy', 'Siemens Energy'),
  (35, 'Siemens', '^siemens healthineers', 'Siemens Healthineers'),
  (36, 'Aditya Birla', '^grasim', 'Grasim Industries'),
  (37, 'Aditya Birla', '^hindalco', 'Hindalco'),
  (38, 'Aditya Birla', '^aditya birla fashion', 'Aditya Birla Fashion and Retail'),
  (39, 'Reliance', '^jio financial services', 'Jio Financial Services'),
  (40, 'Reliance', '^(jio|reliance jio)\M', 'Jio'),
  (41, 'Reliance', '^(reliance retail|reliance trends|reliance digital|reliance ajio)', 'Reliance Retail'),
  (42, 'Samsung', '^samsung biologics', 'Samsung Biologics'),
  (43, 'Samsung', '^samsung sdi', 'Samsung SDI'),
  (44, 'Vodafone', '^vodafone idea', 'Vodafone Idea'),
  (45, 'Unilever', '^hindustan unilever', 'Hindustan Unilever'),
  (46, 'Google', '^waymo', 'Waymo'),
  (47, 'Google', '^deepmind', 'Google DeepMind'),
  (48, 'Hilton', '^hilton grand vacations', 'Hilton Grand Vacations'),
  (49, 'Amazon', '^amazon web services', 'AWS'),
  (50, 'Lloyds', '^lloyd''s', 'Lloyd''s of London')
) AS s(ord, p, rx, t) ORDER BY s.ord;

-- 2. Duplicates join one entry.
SELECT public.index_fold_entry(m.f, m.t, true) FROM (VALUES
  (0, '1&1 Drillisch', '1&1'),
  (1, '2K Games', '2K'),
  (2, 'AccorHotels', 'Accor'),
  (3, 'Allcargo', 'Allcargo Logistics'),
  (4, 'Anta', 'Anta Sports'),
  (5, 'Ant Financial', 'Ant Group'),
  (6, 'Alipay', 'Ant Group'),
  (7, 'A.P. Moller - Maersk', 'Maersk'),
  (8, 'Maersk Logistics', 'Maersk'),
  (9, 'Arcos Dourados', 'Arcos Dorados'),
  (10, 'Assaí Atacadista', 'Assaí'),
  (11, 'Assistance Publique – Hôpitaux de Paris', 'AP-HP'),
  (12, 'Asklepios Kliniken', 'Asklepios'),
  (13, 'A.T. Kearney', 'Kearney'),
  (14, 'Atkins', 'AtkinsRéalis'),
  (15, 'Atlantis Resorts', 'Atlantis'),
  (16, 'Atlantis The Palm', 'Atlantis'),
  (17, 'Atlantis The Royal', 'Atlantis'),
  (18, 'Auchan Retail', 'Auchan'),
  (19, 'Amazon AWS', 'AWS'),
  (20, 'Azure', 'Microsoft'),
  (21, 'B2W', 'Americanas'),
  (22, 'B2W Digital', 'Americanas'),
  (23, 'Lojas Americanas', 'Americanas'),
  (24, 'Americanas.com', 'Americanas'),
  (25, 'Banco BTG Pactual', 'BTG Pactual'),
  (26, 'BCG', 'Boston Consulting Group'),
  (27, 'The Boston', 'Boston Consulting Group'),
  (28, 'BCG Platinion', 'Boston Consulting Group'),
  (29, 'Blue Dart', 'Blue Dart Express'),
  (30, 'BofA Securities', 'Bank of America'),
  (31, 'Booking', 'Booking.com'),
  (32, 'Boticário', 'Grupo Boticário'),
  (33, 'O Boticário', 'Grupo Boticário'),
  (34, 'BT Global Services', 'BT'),
  (35, 'BT Security', 'BT'),
  (36, 'British Telecom', 'BT'),
  (37, 'Grupo Casas Bahia', 'Casas Bahia'),
  (38, 'Via Varejo', 'Casas Bahia'),
  (39, 'Charité – Universitätsmedizin Berlin', 'Charité'),
  (40, 'Charles River Laboratories', 'Charles River'),
  (41, 'Chipotle', 'Chipotle Mexican Grill'),
  (42, 'Citibank', 'Citi'),
  (43, 'Citigroup', 'Citi'),
  (44, 'CSPC', 'CSPC Pharmaceutical'),
  (45, 'CSPC Pharma', 'CSPC Pharmaceutical'),
  (46, 'CVC Capital Partners', 'CVC'),
  (47, 'CVS', 'CVS Health'),
  (48, 'Cyrela Brazil Realty', 'Cyrela'),
  (49, 'AXA IM Alts', 'AXA Investment Managers'),
  (50, 'ABFRL', 'Aditya Birla Fashion and Retail'),
  (51, 'Aditya Birla Fashion & Retail', 'Aditya Birla Fashion and Retail'),
  (52, 'AB Foods', 'Associated British Foods'),
  (53, 'Al Tayer Travel', 'Al Tayer'),
  (54, 'Al Tayer Groups', 'Al Tayer'),
  (55, 'Albert Einstein Hospital', 'Hospital Israelita Albert Einstein'),
  (56, 'Hospital Albert Einstein', 'Hospital Israelita Albert Einstein'),
  (57, 'Careem Pay', 'Careem'),
  (58, 'Burjeel Medical City', 'Burjeel'),
  (59, 'Christian Dior', 'Dior'),
  (60, 'Parfums Christian Dior', 'Dior'),
  (61, 'Co-op', 'The Co-op'),
  (62, 'Aviation Industry Corporation of', 'AVIC'),
  (63, 'Industrial and Commercial Bank of', 'ICBC'),
  (64, 'ICBC Technology', 'ICBC'),
  (65, 'People''s Insurance Company of', 'PICC'),
  (66, 'PICC Property and Casualty', 'PICC'),
  (67, 'Picc Property & Casualty', 'PICC'),
  (68, 'Commercial Aircraft Corporation of', 'COMAC'),
  (69, 'DERTOUR', 'DER Touristik'),
  (70, 'DHL Freight', 'DHL'),
  (71, 'Dhl Parcel', 'DHL'),
  (72, 'Dhl Ecommerce Solutions', 'DHL'),
  (73, 'Deutsche Post DHL', 'DHL'),
  (74, 'DIFC FinTech Hive', 'DIFC'),
  (75, 'Discovery', 'Warner Bros. Discovery'),
  (76, 'Discovery+', 'Warner Bros. Discovery'),
  (77, 'Warner Bros. Games', 'Warner Bros. Discovery'),
  (78, 'WB Games', 'Warner Bros. Discovery'),
  (79, 'WB Interactive', 'Warner Bros. Discovery'),
  (80, 'Wbd', 'Warner Bros. Discovery'),
  (81, 'Disney+', 'Disney'),
  (82, 'The Walt Disney Company UK', 'Disney'),
  (83, 'The Walt Disney Company Emea', 'Disney'),
  (84, 'Avenue Supermarts', 'DMart'),
  (85, 'Domino''s Pizza', 'Domino''s'),
  (86, 'DoubleTree by Hilton', 'Hilton'),
  (87, 'Hampton by Hilton', 'Hilton'),
  (88, 'Courtyard by Marriott', 'Marriott'),
  (89, 'Douyin', 'ByteDance'),
  (90, 'Toutiao', 'ByteDance'),
  (91, 'Dove', 'Unilever'),
  (92, 'Axe', 'Unilever'),
  (93, 'Sunsilk', 'Unilever'),
  (94, 'TRESemmé', 'Unilever'),
  (95, 'DPD', 'DPDgroup'),
  (96, 'GeoPost', 'DPDgroup'),
  (97, 'Drägerwerk AG & Co. KGaA', 'Dräger'),
  (98, 'Drägerwerk', 'Dräger'),
  (99, 'Defence Research and Development Organisation', 'DRDO'),
  (100, 'DS', 'DS Automobiles'),
  (101, 'e& (Etisalat)', 'Etisalat'),
  (102, 'Etisalat by e&', 'Etisalat'),
  (103, 'Emirates Telecommunications Group', 'Etisalat'),
  (104, 'Emirates Telecommunications Corporation', 'Etisalat'),
  (105, 'Eli Lilly and Company', 'Eli Lilly'),
  (106, 'Emaar Hospitality', 'Emaar'),
  (107, 'Emirates Steel', 'EMSTEEL'),
  (108, 'Emirates Steel Arkan', 'EMSTEEL'),
  (109, 'Ernst & Young', 'EY'),
  (110, 'Ernst & Young Advisory', 'EY'),
  (111, 'Ey Cybersecurity', 'EY'),
  (112, 'EY-Parthenon', 'EY'),
  (113, 'Parthenon-EY', 'EY'),
  (114, 'Etihad Aviation Group', 'Etihad'),
  (115, 'F5 Networks', 'F5'),
  (116, 'FAB', 'First Abu Dhabi Bank'),
  (117, 'Fancy Feast', 'Nestlé'),
  (118, 'Friskies', 'Nestlé'),
  (119, 'Pro Plan', 'Nestlé'),
  (120, 'Purina Pro Plan', 'Nestlé'),
  (121, 'Purina Petcare', 'Nestlé'),
  (122, 'Purina ONE', 'Nestlé'),
  (123, 'FIEGE Logistik', 'Fiege'),
  (124, 'Fiege Logistics', 'Fiege'),
  (125, 'Fraunhofer Society', 'Fraunhofer-Gesellschaft'),
  (126, 'Free', 'Iliad'),
  (127, 'Free Mobile', 'Iliad'),
  (128, 'Fundação Oswaldo Cruz', 'Fiocruz'),
  (129, 'G42/M42 Healthcare', 'M42'),
  (130, 'GCP', 'Google'),
  (131, 'Alphabet (Google)', 'Google'),
  (132, 'Google (Alphabet)', 'Google'),
  (133, 'GE Aviation', 'GE Aerospace'),
  (134, 'General Electric Aviation', 'GE Aerospace'),
  (135, 'GIG', 'GIG Gulf'),
  (136, 'Gulf Insurance Group', 'GIG Gulf'),
  (137, 'P&G', 'Procter & Gamble'),
  (138, 'Gillette', 'Procter & Gamble'),
  (139, 'Olay', 'Procter & Gamble'),
  (140, 'Pantene', 'Procter & Gamble'),
  (141, 'GlaxoSmithKline', 'GSK'),
  (142, 'Globoplay', 'Globo'),
  (143, 'Grupo Globo', 'Globo'),
  (144, 'Rede Globo', 'Globo'),
  (145, 'TV Globo', 'Globo'),
  (146, 'Editora Globo', 'Globo'),
  (147, 'GM', 'General Motors'),
  (148, 'Grupo Pão de Açúcar', 'GPA'),
  (149, 'Pão de Açúcar', 'GPA'),
  (150, 'Fleury', 'Grupo Fleury'),
  (151, 'Guotai Junan Securities', 'Guotai Junan'),
  (152, 'Haitong', 'Haitong Securities'),
  (153, 'Hapvida NotreDame Intermédica', 'Hapvida'),
  (154, 'NotreDame Intermédica', 'Hapvida'),
  (155, 'HCL', 'HCLTech'),
  (156, 'HDFC', 'HDFC Bank'),
  (157, 'Hellmann', 'Hellmann Worldwide Logistics'),
  (158, 'Hengrui', 'Jiangsu Hengrui Pharmaceuticals'),
  (159, 'Hengrui Medicine', 'Jiangsu Hengrui Pharmaceuticals'),
  (160, 'Jiangsu Hengrui', 'Jiangsu Hengrui Pharmaceuticals'),
  (161, 'Jiangsu Hengrui Medicine', 'Jiangsu Hengrui Pharmaceuticals'),
  (162, 'Cia Hering', 'Hering'),
  (163, 'Hewlett-Packard', 'HP'),
  (164, 'HoYoverse', 'miHoYo'),
  (165, 'Huazhu Hotels Group', 'Huazhu'),
  (166, 'ICICI Prudential Life', 'ICICI Prudential Life Insurance'),
  (167, 'Intercontinental Hotels', 'IHG'),
  (168, 'IHG InterContinental', 'IHG'),
  (169, 'ING-DiBa', 'ING'),
  (170, 'Injazat Data Systems', 'Injazat'),
  (171, 'Inter', 'Banco Inter'),
  (172, 'InterGlobe Aviation', 'IndiGo'),
  (173, 'J.b. Hunt Transport', 'J.B. Hunt'),
  (174, 'Jb Hunt', 'J.B. Hunt'),
  (175, 'Jb Hunt Transport', 'J.B. Hunt'),
  (176, 'JD Digits', 'JD Technology'),
  (177, 'JetBlue Airways', 'JetBlue'),
  (178, 'J&J', 'Johnson & Johnson'),
  (179, 'J.P. Morgan', 'JPMorgan Chase'),
  (180, 'JPM', 'JPMorgan Chase'),
  (181, 'J.P. Morgan Asset Management', 'JPMorgan Chase'),
  (182, 'Kellanova', 'Kellogg'),
  (183, 'Kühne + Nagel', 'Kuehne + Nagel'),
  (184, 'Land Rover', 'JLR'),
  (185, 'E.Leclerc', 'Leclerc'),
  (186, 'Lek', 'L.E.K. Consulting'),
  (187, 'Levi''s', 'Levi Strauss'),
  (188, 'Lg Electronics Gulf Fze', 'LG Electronics'),
  (189, 'L''Occitane en Provence', 'L''Occitane'),
  (190, 'L''Oréal UK & Ireland', 'L''Oréal'),
  (191, 'Louis Vuitton Moet Hennessy', 'LVMH'),
  (192, 'Liverpool Victoria', 'LV='),
  (193, 'LV= General Insurance', 'LV='),
  (194, 'MAF', 'Majid Al Futtaim'),
  (195, 'Magalu', 'Magazine Luiza'),
  (196, 'Mamo Pay', 'Mamo'),
  (197, 'Max Healthcare Institute', 'Max Healthcare'),
  (198, 'Mckinsey Analytics', 'McKinsey'),
  (199, 'Mckinsey Financial Services', 'McKinsey'),
  (200, 'Mckinsey & Co.', 'McKinsey'),
  (201, 'Meituan-Dianping', 'Meituan'),
  (202, 'Mercado Livre', 'Mercado Libre'),
  (203, 'Mercado Envios', 'Mercado Libre'),
  (204, 'Merck Serono', 'Merck'),
  (205, 'MOHAP', 'Ministry of Health and Prevention'),
  (206, 'MRV', 'MRV&Co'),
  (207, 'M&S', 'Marks & Spencer'),
  (208, 'Marks and Spencer', 'Marks & Spencer'),
  (209, 'Münchener Rück', 'Munich Re'),
  (210, 'Nakheel Properties', 'Nakheel'),
  (211, 'NARS Cosmetics', 'NARS'),
  (212, 'Natura', 'Natura &Co'),
  (213, 'New China Life', 'New China Life Insurance'),
  (214, 'NMC Health', 'NMC Healthcare'),
  (215, 'NMC', 'NMC Healthcare'),
  (216, 'North Face', 'The North Face'),
  (217, 'NTT Security', 'NTT'),
  (218, 'NXP', 'NXP Semiconductors'),
  (219, 'Oberoi', 'Oberoi Hotels & Resorts'),
  (220, 'Oman Insurance', 'Sukoon'),
  (221, 'Sukoon Insurance', 'Sukoon'),
  (222, 'One97 Communications', 'Paytm'),
  (223, 'Pedigree', 'Mars'),
  (224, 'Sheba', 'Mars'),
  (225, 'Whiskas', 'Mars'),
  (226, 'Mars Pet Nutrition Germany', 'Mars'),
  (227, 'Oreo', 'Mondelez'),
  (228, 'Pierre et Vacances Center Parcs', 'Pierre & Vacances Center Parcs'),
  (229, 'Pierre & Vacances', 'Pierre & Vacances Center Parcs'),
  (230, 'Ping An Insurance', 'Ping An'),
  (231, 'Ping An Financial Services', 'Ping An'),
  (232, 'Ping An Financial Technology', 'Ping An'),
  (233, 'Ping An Fintech', 'Ping An'),
  (234, 'Ping An Life', 'Ping An'),
  (235, 'Ping An Life Insurance', 'Ping An'),
  (236, 'Ping An Asset Management', 'Ping An'),
  (237, 'Ping An Health', 'Ping An'),
  (238, 'Porto', 'Porto Seguro'),
  (239, '360', 'Qihoo 360'),
  (240, 'RBS', 'NatWest'),
  (241, 'Royal Bank of Scotland', 'NatWest'),
  (242, 'Renesas Electronics', 'Renesas'),
  (243, 'Renner', 'Lojas Renner'),
  (244, 'Ritz-Carlton', 'The Ritz-Carlton'),
  (245, 'Ritz-Carlton Hotel Company', 'The Ritz-Carlton'),
  (246, 'Rockstar', 'Rockstar Games'),
  (247, 'Royal Sun Alliance', 'RSA'),
  (248, 'RSA Insurance', 'RSA'),
  (249, 'Rumo', 'Rumo Logística'),
  (250, 'R+V', 'R+V Versicherung'),
  (251, 'Ryder', 'Ryder System'),
  (252, 'Ryder Supply Chain', 'Ryder System'),
  (253, 'Sanofi-Aventis Deutschland GmbH', 'Sanofi'),
  (254, 'Saturn', 'MediaMarktSaturn'),
  (255, 'SBI Life', 'SBI Life Insurance'),
  (256, 'Schwarz Gruppe', 'Schwarz Group'),
  (257, 'Shangri-La', 'Shangri-La Hotels and Resorts'),
  (258, 'Shangri-La Hotel', 'Shangri-La Hotels and Resorts'),
  (259, 'Smith+nephew', 'Smith & Nephew'),
  (260, 'Société Nationale des Chemins de Fer Français', 'SNCF'),
  (261, 'Sparkasse', 'Sparkassen-Finanzgruppe'),
  (262, 'Sparkassen', 'Sparkassen-Finanzgruppe'),
  (263, 'Star', 'JioStar'),
  (264, 'Viacom18', 'JioStar'),
  (265, 'JioCinema', 'JioStar'),
  (266, 'Steigenberger Hotels & Resorts', 'Steigenberger'),
  (267, 'Steigenberger Hotels And Resorts', 'Steigenberger'),
  (268, 'Strata', 'Strata Manufacturing'),
  (269, 'Subaru of America', 'Subaru'),
  (270, 'Sun Pharma', 'Sun Pharmaceutical Industries'),
  (271, 'Sun Pharmaceutical', 'Sun Pharmaceutical Industries'),
  (272, 'Suning.com', 'Suning'),
  (273, 'IHCL', 'Taj Hotels'),
  (274, 'Taobao', 'Alibaba'),
  (275, 'Tmall', 'Alibaba'),
  (276, 'Fliggy', 'Alibaba'),
  (277, 'Freshippo', 'Alibaba'),
  (278, 'Tata AIA', 'Tata AIA Life Insurance'),
  (279, 'Tata AIA Life', 'Tata AIA Life Insurance'),
  (280, 'Telekom', 'Deutsche Telekom'),
  (281, 'Telekom Security', 'Deutsche Telekom'),
  (282, 'The Estée Lauder Companies', 'Estée Lauder'),
  (283, 'Estée', 'Estée Lauder'),
  (284, 'The Hut Group', 'THG'),
  (285, 'TJX Companies', 'TJX'),
  (286, 'Torrent Pharmaceuticals', 'Torrent Pharma'),
  (287, 'TransferWise', 'Wise'),
  (288, 'UFIDA', 'Yonyou'),
  (289, 'UnitedHealthcare', 'UnitedHealth Group'),
  (290, 'United', 'United Airlines'),
  (291, 'United Technologies', 'RTX'),
  (292, 'UTC', 'RTX'),
  (293, 'Universal Music Entertainment', 'Universal Music'),
  (294, 'Universo Online', 'UOL'),
  (295, 'U.S. Bancorp', 'U.S. Bank'),
  (296, 'Us Bank', 'U.S. Bank'),
  (297, 'VCA', 'VCA Animal Hospitals'),
  (298, 'Vente-privee', 'Veepee'),
  (299, 'ViacomCBS', 'Paramount'),
  (300, 'Watsons', 'A.S. Watson'),
  (301, 'WeChat', 'Tencent'),
  (302, 'WeChat Pay', 'Tencent'),
  (303, 'Tencent Financial', 'Tencent'),
  (304, 'Tenpay', 'Tencent'),
  (305, 'Wegmans Food Markets', 'Wegmans'),
  (306, 'Xbox', 'Microsoft'),
  (307, 'Xbox Game Studios', 'Microsoft'),
  (308, 'Xfinity', 'Comcast'),
  (309, 'XiamenAir', 'Xiamen Airlines'),
  (310, 'XP Investimentos', 'XP'),
  (311, 'Yves Saint Laurent Beauté', 'Yves Saint Laurent Beauty'),
  (312, 'YSL Beauté', 'Yves Saint Laurent Beauty'),
  (313, 'ZEE', 'Zee Entertainment Enterprises'),
  (314, 'Zee Entertainment', 'Zee Entertainment Enterprises'),
  (315, 'ZF', 'ZF Friedrichshafen'),
  (316, 'ZhongAn', 'ZhongAn Online P&C Insurance'),
  (317, 'ZhongAn Online', 'ZhongAn Online P&C Insurance'),
  (318, 'Astellas Farma', 'Astellas'),
  (319, 'Austrian', 'Austrian Airlines'),
  (320, 'BEL', 'Bharat Electronics'),
  (321, 'BOC', 'Bank of China'),
  (322, 'BOE', 'BOE Technology'),
  (323, 'Britannia', 'Britannia Industries'),
  (324, 'CMB', 'China Merchants Bank'),
  (325, 'SBI', 'State Bank of India'),
  (326, 'CCB', 'China Construction Bank'),
  (327, 'Ctrip', 'Trip.com'),
  (328, 'The Cigna', 'Cigna'),
  (329, 'Royal Canin De', 'Royal Canin'),
  (330, 'Sf', 'SF Express'),
  (331, 'Hikma', 'Hikma Pharmaceuticals'),
  (332, 'Max Life', 'Max Life Insurance'),
  (333, 'Niva Bupa', 'Niva Bupa Health Insurance'),
  (334, 'Elevance', 'Elevance Health'),
  (335, 'American International Group', 'AIG'),
  (336, 'Advanced Micro Devices', 'AMD'),
  (337, 'Federal Express', 'FedEx'),
  (338, 'Hoffmann-La Roche', 'Roche'),
  (339, 'Take-Two', 'Take-Two Interactive'),
  (340, 'Amex', 'American Express'),
  (341, 'Mercedes', 'Mercedes-Benz'),
  (342, 'Mercedes-AMG', 'Mercedes-Benz'),
  (343, '3m Do Brasil', '3M'),
  (344, 'Zydus', 'Zydus Lifesciences'),
  (345, 'Old Dominion', 'Old Dominion Freight Line'),
  (346, 'American Eagle', 'American Eagle Outfitters'),
  (347, 'XPO', 'XPO Logistics'),
  (348, 'Fractal', 'Fractal Analytics'),
  (349, 'EA', 'Electronic Arts'),
  (350, 'Ea Games', 'Electronic Arts'),
  (351, 'Steria', 'Sopra Steria'),
  (352, 'Rockwell Collins', 'Collins Aerospace'),
  (353, 'Standard Chartered Bank', 'Standard Chartered'),
  (354, 'Coca-Cola Hellenic', 'Coca-Cola HBC'),
  (355, 'The Clorox Company', 'Clorox'),
  (356, 'Teva Pharmaceutical', 'Teva'),
  (357, 'Bio-Rad', 'Bio-Rad Laboratories'),
  (358, 'Becton', 'BD'),
  (359, 'Dickinson And Company', 'BD'),
  (360, 'The Travelers Companies', 'Travelers'),
  (361, 'Travelers Companies', 'Travelers'),
  (362, 'Banfield', 'Banfield Pet Hospital'),
  (363, 'Valeo.ai', 'Valeo'),
  (364, 'Kimberley-Clark', 'Kimberly-Clark'),
  (365, 'Kempinski Hotels', 'Kempinski'),
  (366, 'The Kraft Heinz Company', 'Kraft Heinz'),
  (367, 'La Poste Groupe', 'La Poste'),
  (368, 'L&T Group', 'Larsen & Toubro'),
  (369, 'Accenture Strategy And Consulting', 'Accenture'),
  (370, 'ITVX', 'ITV'),
  (371, 'Lloyds Bank', 'Lloyds'),
  (372, 'Itau Unibanco', 'Itaú'),
  (373, 'Huk24', 'HUK-COBURG'),
  (374, 'M·a·c Cosmetics', 'MAC'),
  (375, 'Hon Hai', 'Foxconn'),
  (376, 'Hon Hai Precision', 'Foxconn'),
  (377, 'Hon Hai Precision Industry', 'Foxconn'),
  (378, 'Dongfeng Motor', 'Dongfeng'),
  (379, 'Fidelity National Information Services', 'FIS'),
  (380, 'FIVE Hotels and Resorts', 'FIVE Hotels & Resorts'),
  (381, 'Great Wall Motor', 'Great Wall Motors'),
  (382, 'HNA Aviation and Tourism Group', 'HNA'),
  (383, 'Home Inns', 'Home Inn'),
  (384, 'Banque Postale', 'La Banque Postale'),
  (385, 'Tam Airlines', 'LATAM Airlines'),
  (386, 'Lindt', 'Lindt & Sprüngli'),
  (387, 'Localiza&Co', 'Localiza'),
  (388, 'Max Planck', 'Max Planck Institutes'),
  (389, 'WhatsApp', 'Meta'),
  (390, 'Natixis IM', 'Natixis Investment Managers'),
  (391, 'PNC', 'PNC Financial'),
  (392, 'Mediengruppe RTL', 'RTL'),
  (393, 'Rtl+', 'RTL'),
  (394, 'salesforce.com Germany GmbH', 'Salesforce'),
  (395, 'Sap.Io', 'SAP'),
  (396, 'Laboratório Servier', 'Servier'),
  (397, 'SG CIB', 'Société Générale'),
  (398, 'VW Group', 'Volkswagen'),
  (399, 'White & Co', 'White And Co.'),
  (400, 'Towers Watson', 'Willis Towers Watson'),
  (401, 'American Honda Motor Co.', 'Honda'),
  (402, 'Bimbo Bakeries USA', 'Grupo Bimbo'),
  (403, 'NPCC', 'National Petroleum Construction Company'),
  (404, 'Universal Orlando Resort', 'Universal Studios'),
  (405, 'Universal Orlando', 'Universal Studios'),
  (406, 'Arrow (China) Electronics Trading', 'Arrow Electronics'),
  (407, 'Grupo Vila Galé', 'Vila Galé'),
  (408, 'V-Mart', 'V-Mart Retail'),
  (409, 'Keyword Studios', 'Keywords Studios'),
  (410, 'Wanda Hotels', 'Wanda Hotels & Resorts'),
  (411, 'JDA', 'Blue Yonder'),
  (412, 'Brookfield Property Partners', 'Brookfield Properties'),
  (413, 'Alibaba Logistics', 'Cainiao'),
  (414, 'Telefônica/Vivo', 'Telefónica'),
  (415, 'Telefónica Tech UK and Ireland', 'Telefónica'),
  (416, 'Janssen/Johnson & Johnson', 'Janssen'),
  (417, 'Xi''an Aircraft Industry', 'Xi''an Aircraft Industrial Corporation'),
  (418, 'AVIC Xi''an Aircraft Industry', 'Xi''an Aircraft Industrial Corporation'),
  (419, 'Poly Developments and Holdings Group', 'Poly Developments'),
  (420, 'Fujifilm Diosynth', 'FUJIFILM Diosynth Biotechnologies'),
  (421, 'Endemol Shine UK', 'Endemol Shine Group'),
  (422, 'Sinovac', 'Sinovac Biotech'),
  (423, 'Ascott', 'The Ascott Limited'),
  (424, 'Teledyne', 'Teledyne Technologies'),
  (425, 'Address Hotels', 'Address Hotels + Resorts'),
  (426, 'Best Western', 'Best Western Hotels & Resorts'),
  (427, 'Ceva', 'CEVA Logistics'),
  (428, 'Lloyd''s of London Market', 'Lloyd''s of London'),
  (429, '华为', 'Huawei'),
  (430, '腾讯', 'Tencent'),
  (431, '百度', 'Baidu'),
  (432, '阿里巴巴', 'Alibaba'),
  (433, '美团', 'Meituan'),
  (434, '字节跳动', 'ByteDance'),
  (435, '抖音', 'ByteDance'),
  (436, '携程', 'Trip.com'),
  (437, '飞猪', 'Alibaba'),
  (438, '天猫国际', 'Alibaba'),
  (439, '平安人寿', 'Ping An'),
  (440, '中国人保', 'PICC'),
  (441, '中国太平洋保险', 'CPIC'),
  (442, '太保', 'CPIC'),
  (443, '中国人寿保险（集团）', 'China Life Insurance'),
  (444, '中国航发', 'AECC'),
  (445, '中国航空工业集团有限公司', 'AVIC'),
  (446, '成都飞机工业集团', 'Chengdu Aircraft Industrial'),
  (447, '沈阳飞机工业集团', 'Shenyang Aircraft'),
  (448, '西安飞机工业集团', 'Xi''an Aircraft Industrial Corporation'),
  (449, '哈尔滨飞机工业集团', 'Harbin Aircraft Industry Group'),
  (450, '春秋航空', 'Spring Airlines'),
  (451, '吉祥航空', 'Juneyao Airlines')
) AS m(ord, f, t) ORDER BY m.ord;

-- 4. Not employers.
INSERT INTO public.company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT n, 'excluded', 'not_a_company', 'Not an employer: category, place, product or term (2026-10-18 clean-up)'
FROM unnest(ARRAY['Digital Economy and Remote Work Applications', 'Ethics Prosperity', 'Resorts & Spas', 'Landesbanken', 'Sunderland Plant', 'Central', 'Pet Care', 'CSR', 'Business', 'Home', 'Apparel', 'News', 'Reach', 'Veterinary hospital chains', 'local chains', 'media', 'medicines', 'multinational petcare brands', 'multinational pet retailer chains', 'Online Travel Agencies', 'PE-backed developers', 'Petcare companies', 'pet food brands', 'pet retailer chains', 'pet services', 'Prestige brands', 'Real Estate companies', 'regional offices', 'regional retailers', 'Regional startups', 'Savings Banks', 'Specialty Clinics', 'stores', 'supplier companies', 'together', 'trabeculae', 'uhrs', 'University hospitals', 'Vet clinics', 'veterinary chains', 'Veterinary clinics', 'veterinary distributor', 'Veterinary Pharmaceutical Companies', 'pet retailers', 'accessory brands', 'animal welfare organizations', 'Beauty Brands', 'biotech firms', 'clinics', 'consumables', 'developers', 'distributors', 'German public sector', 'Health Care Services', 'human-grade veterinary networks', 'Infrastructure Providers', 'Insurance Market', 'International Oil Companies', 'IT & Digital Transformation Arms of Telecom Companies', 'Lloyd''s Regional Platforms', 'The Big 4', 'Top Employer Germany', 'San Francisco', 'Qatar', 'Darmstadt', 'Arabian Gulf', 'NGOs', 'OTAs', 'REITs', 'Property Management', 'Property Managers', 'Charities', 'Cloud', 'Consulting', 'CRISPR', 'CRM', 'Diagnostics', 'LNG', 'ML', 'Medtech', 'MVP', 'TensorFlow', 'Genshin Impact', 'Honor of Kings', 'LoL', 'Alibaba ecosystem', 'OT', 'PET', 'Solar Coca-Cola', 'Aesthetic Clinic Dubai Uae', 'Esports Middle East', 'Mulliez Family Association', 'UK Government']) AS n
WHERE NOT EXISTS (SELECT 1 FROM public.company_overrides co WHERE lower(co.canonical_name) = lower(n));

-- 5. Size-filter exclusions. Ambiguous names stay hidden; the rest are lifted
--    once labelled 5000+ (also nightly, in sync_index_obvious_variants).
UPDATE public.company_overrides
SET notes = 'Ambiguous name, kept off the Index (2026-10-18). Was: ' || notes, updated_at = now()
WHERE status = 'excluded' AND notes LIKE 'Enterprise filter:%'
  AND canonical_name IN ('Cosmos', 'Thrive', 'Img');

SELECT public.lift_stale_size_exclusions();
