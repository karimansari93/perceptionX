-- sync_index_obvious_variants: company_canonical_names.source only allows
-- 'ai_generated' / 'manual' / 'imported'. Rows copied from the alias system
-- are 'imported' (the first run with 'alias_sync' failed and rolled back).
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
  SELECT p.variant, p.target, false, 'imported', 'alias', lower(p.target)
  FROM index_obvious_variant_plan() p
  WHERE p.existing_id IS NULL
  ON CONFLICT (variant_name) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object('added', v_added, 'fixed', v_fixed);
END;
$function$;
