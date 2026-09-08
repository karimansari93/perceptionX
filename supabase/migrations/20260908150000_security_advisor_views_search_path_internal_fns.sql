-- Security advisor sweep (2026-09-08), second batch. Fixes the remaining
-- ERROR-level lint and the low-risk WARN-level ones. Deliberately NOT touched:
--
--   * materialized_view_in_api: rankings_overview, rankings_historical and
--     company_search_index are read anonymously by employers.perceptionx.ai
--     (see 20260721000000_restore_public_index_anon_grants - do not revoke
--     anon SELECT again). The other *_mv relations were granted to anon /
--     authenticated explicitly in their own migrations; matviews cannot carry
--     RLS, so restricting them means moving reads behind RPCs, which is a
--     separate project.
--   * extension_in_public (pg_net, unaccent, pg_trgm): relocating extensions
--     can break functions that reference them unqualified; low real-world risk.
--   * auth_leaked_password_protection: dashboard-only setting.

-- ---------------------------------------------------------------------------
-- 1. security_definer_view (ERROR): the three recency URL-status views ran as
--    their owner, bypassing RLS on url_recency_cache and
--    recency_rescore_job_urls for anyone who could select from the view.
--    Switch to SECURITY INVOKER so callers use their own permissions. The
--    callers are: the admin Recency Coverage tab (admins, who pass the RLS
--    policies on both tables), process-recency-rescore-tick (service role,
--    bypasses RLS) and enqueue_recency_rescore (SECURITY DEFINER, unaffected).
-- ---------------------------------------------------------------------------
alter view public.v_organization_url_status set (security_invoker = true);
alter view public.v_company_url_status      set (security_invoker = true);
alter view public.v_rescore_job_url_status  set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 2. function_search_path_mutable (WARN): pin search_path so a caller cannot
--    shadow the tables/functions these bodies reference. Bodies already use
--    public.-qualified names (or none), so `public` keeps them working and
--    matches the convention used elsewhere in this repo.
-- ---------------------------------------------------------------------------
alter function public._max_response_day_before(uuid, uuid, date)          set search_path = public;
alter function public.get_latest_collection_start(uuid, uuid)             set search_path = public;
alter function public.enqueue_recency_rescore(uuid, uuid, timestamptz)    set search_path = public;
alter function public.claude_batch_tick()                                 set search_path = public;
alter function public.activate_current_terms_version()                    set search_path = public;
alter function public.api_db_country(text)                                set search_path = public;
alter function public.mcp_clean_cited_title(text)                         set search_path = public;
alter function public.mcp_normalize_cited_url(text)                       set search_path = public;

-- ---------------------------------------------------------------------------
-- 3. anon_security_definer_function_executable (WARN): internal maintenance
--    functions that only pg_cron (runs as postgres) or other SQL functions
--    call. Postgres grants EXECUTE to PUBLIC by default, so anyone with the
--    project URL could invoke them over PostgREST and trigger refreshes,
--    batch collectors or classification runs. None are referenced by the
--    frontend or by any edge function. Keep them callable by the owner and
--    the service role only.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public._refresh_cm_competitor_stats(uuid)',
    'public._refresh_cm_domain_stats(uuid)',
    'public._refresh_cm_llm_stats(uuid)',
    'public._refresh_cm_page_stats(uuid)',
    'public._refresh_cm_scope_daily_stats(uuid)',
    'public._refresh_cm_scope_prompt_type_stats(uuid)',
    'public._refresh_cm_scope_stats(uuid)',
    'public.classify_company_size_tick(integer)',
    'public.claude_batch_tick()',
    'public.queue_all_companies_metrics_dirty()',
    'public.recanonicalize_competitors_batch(text[], integer)',
    'public.refresh_firecrawl_dead_domains()',
    'public.refresh_tier_classification_queue()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

-- enqueue_recency_rescore is called by the admin UI as a signed-in user, so
-- authenticated keeps EXECUTE; only the anonymous role loses it.
revoke execute on function public.enqueue_recency_rescore(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.enqueue_recency_rescore(uuid, uuid, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
