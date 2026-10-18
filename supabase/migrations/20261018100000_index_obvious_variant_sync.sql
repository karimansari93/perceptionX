-- Public Index: group obvious company variants automatically (Karim,
-- 2026-10-18: "Thermo Fisher France and Thermo Fisher Scientific ... it's so
-- obvious they should be grouped. That's the stuff I want." Keep distinct
-- employers apart: TCS is not "Tata").
--
-- The public Index maps raw names through company_canonical_names. The alias
-- system (entity_aliases / canonical_entities) has since decided far more
-- names. This copies across only the obvious ones: a variant that is its
-- canonical name plus extra words ("thermo fisher scientific france",
-- "jll china", "dhl singapore"). It
--   - adds missing variants,
--   - fixes legacy rows that map a variant to itself ("Thermo Fisher
--     Scientific UK") or to the target plus extra words ("JLL China" -> JLL),
--   - never splits a group the Index already has (the target is resolved
--     through the Index's own list, so "Sony Group" stays Sony), and
--   - skips truncated alias names ("Industrial and Commercial Bank of").
-- Runs nightly at 03:50 UTC, before run_rankings_maintenance at 04:00.

CREATE TABLE IF NOT EXISTS public.company_canonical_names_backup_20261018 AS
SELECT * FROM public.company_canonical_names;

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
    SELECT a.variant, coalesce(p.canonical_name, a.canonical_name) AS target
    FROM a
    LEFT JOIN company_canonical_names p ON p.variant_name = lower(a.canonical_name)
    WHERE a.variant LIKE lower(a.canonical_name) || ' %'
      AND a.canonical_name !~* '\m(of|and|the|de|du|des|da|do|&)$'
      AND length(a.canonical_name) >= 3
  )
  SELECT o.variant, o.target, c.id
  FROM obvious o
  LEFT JOIN company_canonical_names c ON c.variant_name = o.variant
  WHERE c.id IS NULL
     OR (c.canonical_name <> o.target AND (
           normalize_entity_name(c.canonical_name) = normalize_entity_name(o.variant)
        OR lower(c.canonical_name) LIKE lower(o.target) || ' %'));
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
BEGIN
  UPDATE company_canonical_names c
  SET canonical_name = p.target, brand_key = lower(p.target), updated_at = now()
  FROM index_obvious_variant_plan() p
  WHERE c.id = p.existing_id;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  INSERT INTO company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
  SELECT p.variant, p.target, false, 'alias_sync', 'alias', lower(p.target)
  FROM index_obvious_variant_plan() p
  WHERE p.existing_id IS NULL
  ON CONFLICT (variant_name) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object('added', v_added, 'fixed', v_fixed);
END;
$function$;

SELECT cron.schedule(
  'index-obvious-variant-sync',
  '50 3 * * *',
  $$SELECT public.sync_index_obvious_variants();$$
);
