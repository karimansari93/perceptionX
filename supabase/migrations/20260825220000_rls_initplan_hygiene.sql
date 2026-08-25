-- Advisor hygiene: wrap per-row auth.*() calls in scalar subqueries so the
-- planner evaluates them once per query (initplan) instead of once per row,
-- and drop one duplicate index. Semantics identical; performance only.
-- (Supabase linter: auth_rls_initplan, duplicate_index.)

alter policy "Users can view batch configs" on public.company_batch_configs
  using ((select auth.uid()) = user_id);

alter policy "Users can view their batch queue items" on public.company_batch_queue
  using (exists (
    select 1
    from company_batch_configs
    where company_batch_configs.id = company_batch_queue.config_id
      and company_batch_configs.user_id = (select auth.uid())
  ));

alter policy "Service role write entity classifications" on public.company_entity_classifications
  using ((select auth.role()) = 'service_role'::text);

alter policy "Admins can read url_recency_cache" on public.url_recency_cache
  using (((select auth.jwt()) ->> 'email'::text) = any (array['karim@perceptionx.ai'::text, 'karim@olivtek.com'::text]));

alter policy "Admins can insert url_recency_cache" on public.url_recency_cache
  with check (((select auth.jwt()) ->> 'email'::text) = any (array['karim@perceptionx.ai'::text, 'karim@olivtek.com'::text]));

alter policy "Admins can update url_recency_cache" on public.url_recency_cache
  using (((select auth.jwt()) ->> 'email'::text) = any (array['karim@perceptionx.ai'::text, 'karim@olivtek.com'::text]))
  with check (((select auth.jwt()) ->> 'email'::text) = any (array['karim@perceptionx.ai'::text, 'karim@olivtek.com'::text]));

-- {idx_directory_source_scores_source, idx_directory_source_scores_source_id}
-- are identical; keep one.
drop index if exists public.idx_directory_source_scores_source_id;
