-- Public Index: fold "Name + country / legal form" entries into the parent
-- (Karim, 2026-10-18: "Thermo Fisher France and Thermo Fisher Scientific ...
-- so obvious they should be grouped").
--
-- The alias-based sync (20261018100000) only covers names the alias system
-- has seen. Entries such as "Dhl Uk", "Pepsico Brazil" or "Google Cloud Uk"
-- still showed on the Index on their own. This pass works on what the Index
-- actually shows: an entry whose name is another Index entry plus only
-- country, region or legal-form words ("UK", "Brazil", "Greater China",
-- "Ltd", "GmbH", "Group") joins that entry.
--
-- Guards (keep distinct employers apart, as with TCS vs Tata):
--   - only country / region / legal-form words are removed; business words
--     ("Motors", "Pictures", "Express", "Cloud") never are, so Tata Motors
--     stays apart from Tata;
--   - the parent must already be its own entry on the Index (current or
--     historical), and is resolved through the Index's own list;
--   - a remainder ending in a joining word ("Bank of", "Banco do",
--     "Merck &") is skipped, so Bank of India and Merck & Co. stay apart;
--   - known brands whose country is part of the name (Air France, Virgin
--     Australia ...) are kept apart by the blocklist below.
-- A third pass joins entries that are the same name spelled differently
-- (accents, spacing, punctuation: "Telefonica" / "Telefónica").
-- Runs nightly inside sync_index_obvious_variants (03:50 UTC), before
-- run_rankings_maintenance at 04:00.

CREATE OR REPLACE FUNCTION public.strip_company_geo_legal_tail(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v text := lower(btrim(p_name));
  nv text;
  rx constant text := $re$[\s,/(–-]+\(?(?:united\s+kingdom|united\s+states\s+of\s+america|united\s+states|united\s+arab\s+emirates|great\s+britain|south\s+africa|saudi\s+arabia|new\s+zealand|hong\s+kong|czech\s+republic|south\s+korea|republic\s+of\s+korea|sri\s+lanka|costa\s+rica|puerto\s+rico|middle\s+east\s+(?:&|and)\s+(?:north\s+)?africa|europe,?\s+middle\s+east\s+(?:&|and)\s+africa|middle\s+east|north\s+america|latin\s+america|greater\s+china|mainland\s+china|asia\s+pacific|el\s+salvador|abu\s+dhabi|sdn\s+bhd|pte\s+ltd|pvt\s+ltd|private\s+limited|pty\s+ltd|argentina|australia|austria|belgium|brazil|brasil|bulgaria|canada|chile|china|colombia|croatia|denmark|danmark|estonia|finland|france|germany|deutschland|greece|hungary|india|indonesia|ireland|israel|italy|italia|japan|korea|latvia|lithuania|malaysia|mexico|méxico|netherlands|nederland|norway|norge|peru|philippines|poland|polska|portugal|romania|russia|singapore|slovakia|slovenia|spain|españa|sweden|sverige|switzerland|schweiz|suisse|taiwan|thailand|turkey|türkiye|turkiye|vietnam|egypt|morocco|nigeria|kenya|pakistan|bangladesh|qatar|kuwait|bahrain|oman|jordan|lebanon|luxembourg|ukraine|serbia|cyprus|malta|iceland|ecuador|uruguay|paraguay|bolivia|venezuela|panama|guatemala|österreich|suomi|uk|us|usa|uae|ksa|gb|emea|apac|latam|mena|dach|benelux|nordic|nordics|anz|europe|asia|americas|africa|dubai|l\.?t\.?d\.?|limited\.?|p\.?l\.?c\.?|l\.?l\.?c\.?|l\.?l\.?p\.?|i\.?n\.?c\.?|incorporated\.?|c\.?o\.?r\.?p\.?|corporation\.?|c\.?o\.?|company\.?|g\.?m\.?b\.?h\.?|m\.?b\.?h\.?|a\.?g\.?|k\.?g\.?a\.?a\.?|s\.?a\.?|s\.?a\.?s\.?|s\.?a\.?r\.?l\.?|s\.?p\.?a\.?|s\.?r\.?l\.?|b\.?v\.?|n\.?v\.?|a\.?b\.?|a\.?s\.?|a\.?s\.?a\.?|o\.?y\.?|o\.?y\.?j\.?|k\.?k\.?|p\.?t\.?y\.?|p\.?v\.?t\.?|private\.?|p\.?t\.?e\.?|b\.?h\.?d\.?|t\.?b\.?k\.?|p\.?j\.?s\.?c\.?|j\.?s\.?c\.?|s\.?e\.?|k\.?g\.?|group\.?|holding\.?|holdings\.?|fze|fzco|fzc|fz-llc|fz\s+llc|dmcc)\)?$$re$;
BEGIN
  FOR i IN 1..4 LOOP
    nv := btrim(regexp_replace(v, rx, ''));
    -- Stop before leaving a dangling joiner: "Merck & Co. France" stops at
    -- "merck & co.", not "merck &".
    EXIT WHEN nv = v
      OR nv ~ '\m(of|and|the|de|du|des|da|do|del|di|la|le|y|e)$'
      OR nv ~ '[&/+-]$';
    v := nv;
  END LOOP;
  RETURN v;
END;
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

-- Index entries that are the same name apart from accents, spacing, dots,
-- hyphens or apostrophes ("Telefonica" / "Telefónica", "Mondelez" /
-- "Mondelēz", "J.B. Hunt" / "Jb Hunt") join the spelling with the most
-- mentions.
CREATE OR REPLACE FUNCTION public.index_spelling_variant_plan()
RETURNS TABLE(fragment text, target text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH vis AS (
    SELECT canonical_name AS f, sum(mention_count) AS m FROM rankings_overview GROUP BY 1
    UNION ALL
    SELECT canonical_name, sum(mention_count) FROM rankings_historical GROUP BY 1
  ), v AS (
    SELECT f, sum(m) AS m, regexp_replace(lower(unaccent(f)), '[\s.''’-]', '', 'g') AS k
    FROM vis
    GROUP BY f
  ), ranked AS (
    SELECT f, first_value(f) OVER (PARTITION BY k ORDER BY m DESC, f) AS target
    FROM v
    WHERE length(k) >= 4
  )
  SELECT f, target FROM ranked WHERE f <> target;
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

  RETURN jsonb_build_object('added', v_added, 'fixed', v_fixed,
                            'suffix_folded', v_folded, 'suffix_added', v_folded_new,
                            'spelling_folded', v_spelling, 'spelling_added', v_spelling_new);
END;
$function$;

-- The nightly job now also rebuilds rankings_historical, which nothing
-- refreshed before: older months kept showing "JLL France" after the name
-- list had grouped it. run_rankings_maintenance (04:00) then rebuilds the
-- current rankings on top.
SELECT cron.schedule(
  'index-obvious-variant-sync',
  '50 3 * * *',
  $$SET statement_timeout = '900s';
    SELECT public.sync_index_obvious_variants();
    REFRESH MATERIALIZED VIEW public.rankings_historical;$$
);
