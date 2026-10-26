-- Members can read their organisation's live Amplify share links, so a People
-- action on the Actions tab can offer "Share with employees". activate_links
-- and activate_branding stay admin-only; this function returns just what a
-- share button needs.
--
-- Live = not revoked, not expired. Links labelled "delete me" are internal
-- build checks and are never returned. Read-only.

CREATE OR REPLACE FUNCTION public.list_amplify_links(p_organization_id uuid)
RETURNS TABLE (token text, label text, prefill_market_code text, link_subdomain text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT l.token, l.label, l.prefill_market_code, b.link_subdomain, l.created_at
    FROM activate_links l
    LEFT JOIN activate_branding b ON b.org_id = l.org_id
   WHERE l.org_id = p_organization_id
     AND (is_org_member(p_organization_id) OR is_admin())
     AND l.revoked_at IS NULL
     AND (l.expires_at IS NULL OR l.expires_at > now())
     AND COALESCE(l.label, '') NOT ILIKE '%delete me%'
   ORDER BY l.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.list_amplify_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_amplify_links(uuid) TO authenticated;
