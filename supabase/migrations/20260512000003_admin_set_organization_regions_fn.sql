-- SECURITY DEFINER function so super admins (is_admin()) can edit the
-- regions list on any organization without widening the org UPDATE RLS.
CREATE OR REPLACE FUNCTION public.admin_set_organization_regions(
  p_org_id uuid,
  p_regions text[]
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organizations;
  v_cleaned text[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Trim, uppercase, drop empties, dedupe while preserving order.
  SELECT COALESCE(array_agg(r ORDER BY ord), '{}')
  INTO v_cleaned
  FROM (
    SELECT DISTINCT ON (upper(btrim(r))) upper(btrim(r)) AS r, ord
    FROM unnest(p_regions) WITH ORDINALITY AS t(r, ord)
    WHERE btrim(r) <> ''
    ORDER BY upper(btrim(r)), ord
  ) s;

  UPDATE public.organizations
  SET regions = v_cleaned
  WHERE id = p_org_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'organization not found';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_organization_regions(uuid, text[]) TO authenticated;
