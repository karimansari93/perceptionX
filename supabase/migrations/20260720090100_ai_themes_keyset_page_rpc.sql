-- Keyset page over raw ai_themes for the Thematic drilldown
-- (useDashboardData.fetchAIThemes).
--
-- Replaces the PostgREST table read for two measured reasons (2026-07,
-- 18-profile Ford brand, ~130k themes in the 180-day window):
--
-- 1. PostgREST cannot express a row-value comparison, so the keyset cursor
--    had to be encoded as or=(created_at.lt.X,and(created_at.eq.X,id.lt.Y)).
--    Postgres cannot use that OR as a btree boundary: every page re-scanned
--    all previously-fetched rows and filtered them out (EXPLAIN on page 10:
--    "Rows Removed by Filter: 10000"), making page N cost O(N * page size) —
--    the OFFSET pathology the keyset was meant to avoid. Deep pages crossed
--    the ~8s statement timeout under concurrent load. The row-value form
--    (created_at, id) < (X, Y) rides idx_ai_themes_company_created_id
--    (company_id, created_at DESC, id DESC) as an exact index boundary.
--
-- 2. The ai_themes RLS select policy — is_admin() OR
--    user_can_access_company(company_id) — calls a non-inlinable SECURITY
--    DEFINER helper per scanned row (~97 buffer hits per call; measured
--    1.6s for a single 1000-row page even with a perfect index boundary).
--    This function is SECURITY DEFINER and evaluates the identical
--    predicate once against p_company_id, which is equivalent because every
--    returned row has company_id = p_company_id. Returning zero rows on a
--    failed check mirrors RLS semantics (rows silently filtered, never an
--    error).
--
-- Measured worst-case page: ~8s before, ~8ms after.
--
-- Returns only the columns the themes/attributes UIs consume — skips heavy
-- theme_description / context_snippets[] / keywords[] (row width ~609B ->
-- ~100B).
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
    -- of an OR branch, so the row compare stays an index boundary even in a
    -- generic (parameterized) plan.
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
