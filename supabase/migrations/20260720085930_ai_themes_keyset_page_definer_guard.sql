-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260720085930; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Rewrite ai_themes_keyset_page as SECURITY DEFINER with a single upfront
-- access check.
--
-- The ai_themes RLS select policy — is_admin() OR
-- user_can_access_company(company_id) — calls a non-inlinable SECURITY
-- DEFINER helper per scanned row (~97 buffer hits per call): measured
-- 1.6s / 97,787 buffers for a single 1000-row page even with a perfect
-- index boundary. Every row this function returns has company_id =
-- p_company_id, so evaluating the identical predicate once against
-- p_company_id is exactly equivalent to the per-row policy, and the page
-- drops to a pure index scan.
--
-- Returning zero rows on failed access mirrors RLS semantics (rows are
-- silently filtered, not errored).
create or replace function public.ai_themes_keyset_page(
  p_company_id uuid,
  p_cutoff timestamptz,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 1000
)
returns table (
  id uuid,
  response_id uuid,
  theme_name text,
  sentiment text,
  sentiment_score double precision,
  attribute_id text,
  attribute_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    -- Null cursor (first page) degenerates to an always-true bound instead
    -- of an OR branch, so the row compare stays an index boundary on
    -- idx_ai_themes_company_created_id even in a generic plan. The OR-form
    -- keyset predicate PostgREST generates cannot be a btree boundary at
    -- all: it re-scanned every previously-fetched row on each page.
    and (t.created_at, t.id) < (
      coalesce(p_cursor_created_at, 'infinity'::timestamptz),
      coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

revoke all on function public.ai_themes_keyset_page(uuid, timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.ai_themes_keyset_page(uuid, timestamptz, timestamptz, uuid, integer) to authenticated, service_role;
