-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260721171542; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Methodology v2, safe re-apply step 2/4: model exclusion inside the
-- ai_themes keyset RPC (the dashboard's theme drilldown path). Body is the
-- live 20260720095337 definition plus the EXISTS filter on the parent
-- response's ai_model.
CREATE OR REPLACE FUNCTION public.ai_themes_keyset_page(p_company_id uuid, p_cutoff timestamp with time zone, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_attribute_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(id uuid, response_id uuid, theme_name text, sentiment text, sentiment_score double precision, attribute_id text, attribute_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_admin() or user_can_access_company(p_company_id)) then
    return;
  end if;

  return query
  select t.id, t.response_id, t.theme_name, t.sentiment, t.sentiment_score,
         t.attribute_id, t.attribute_name, t.created_at
  from public.ai_themes t
  where t.company_id = p_company_id
    and t.created_at >= p_cutoff
    and (p_attribute_ids is null or t.attribute_id = any(p_attribute_ids))
    -- Methodology v2: excluded models never reach client-facing surfaces
    and exists (
      select 1 from public.prompt_responses pr
      where pr.id = t.response_id
        and pr.ai_model not in ('claude','gemini','deepseek')
    )
    and (t.created_at, t.id) < (
      coalesce(p_cursor_created_at, 'infinity'::timestamptz),
      coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$function$;
