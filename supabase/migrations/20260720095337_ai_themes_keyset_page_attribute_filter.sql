-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260720095337; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Add an optional attribute filter to ai_themes_keyset_page so the Thematic
-- drilldown can fetch raw themes for ONE attribute on demand instead of
-- bulk-paginating the whole 180-day window on tab mount (~130k rows / ~130
-- requests on an 18-profile brand). Takes an array because legacy v1
-- attribute ids fold into their v2 successor client-side — the caller passes
-- the v2 id plus its v1 aliases.
--
-- The filter rides the idx_ai_themes_company_created_id scan as a residual
-- filter (no extra index needed: worst case is one full window scan per
-- profile, ~20k rows ≈ tens of ms). A NULL filter keeps the original
-- whole-window behavior.
--
-- Postgres treats a changed parameter list as a new overload, so drop the
-- 5-arg version first — callers using named args are unaffected.
drop function if exists public.ai_themes_keyset_page(uuid, timestamptz, timestamptz, uuid, integer);

create function public.ai_themes_keyset_page(
  p_company_id uuid,
  p_cutoff timestamptz,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 1000,
  p_attribute_ids text[] default null
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
    and (p_attribute_ids is null or t.attribute_id = any(p_attribute_ids))
    and (t.created_at, t.id) < (
      coalesce(p_cursor_created_at, 'infinity'::timestamptz),
      coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

revoke all on function public.ai_themes_keyset_page(uuid, timestamptz, timestamptz, uuid, integer, text[]) from public, anon;
grant execute on function public.ai_themes_keyset_page(uuid, timestamptz, timestamptz, uuid, integer, text[]) to authenticated, service_role;
