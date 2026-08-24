-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260807085549; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Movement ("trend") data for company snapshots. The generator narrates how
-- each company has moved — score/rank direction since its first tracked
-- period, competitors passed or lost to, gap to the next company above —
-- inside snapshot_text (which flows to the app profile, the crawler-rendered
-- page, and the API summary), and stores the structured series in a new
-- company_snapshots.trend column for future UI (sparklines, badges).

ALTER TABLE public.company_snapshots ADD COLUMN IF NOT EXISTS trend jsonb;

-- Per-period per-slice ranks from the historical MV, same ordering as
-- api_company. ~20k rows total; the generator pages through it once.
CREATE OR REPLACE FUNCTION public.api_slice_rank_history()
RETURNS TABLE(company text, industry text, country text, period text, rank integer, score numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT h.canonical_name,
         h.industry_context,
         h.country,
         h.index_period,
         (rank() OVER (PARTITION BY h.industry_context, h.country, h.index_period
                       ORDER BY h.score_all DESC, h.mention_count DESC, h.canonical_name ASC))::int,
         h.score_all
  FROM rankings_historical h
  ORDER BY h.industry_context, h.country, h.index_period, 5;
$function$;

-- api_industry_ranks gains data_period so the generator can label the
-- "current" measurement correctly for slices served from the historical
-- fallback (their current data IS a past period, not this month).
-- Return type changes, so drop + recreate.
DROP FUNCTION IF EXISTS public.api_industry_ranks();
CREATE FUNCTION public.api_industry_ranks()
RETURNS TABLE(company text, industry text, country text, rank integer, total integer, score numeric, mentions bigint, data_period text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ro.canonical_name,
         ro.industry_context,
         ro.country,
         (rank() OVER (PARTITION BY ro.industry_context, ro.country
                       ORDER BY ro.score_all DESC, ro.mention_count DESC, ro.canonical_name ASC))::int,
         (count(*) OVER (PARTITION BY ro.industry_context, ro.country))::int,
         ro.score_all,
         ro.mention_count,
         ro.data_period
  FROM rankings_overview ro
  WHERE ro.industry_context IS NOT NULL AND ro.industry_context <> ''
  ORDER BY ro.industry_context, ro.country, 4;
$function$;

GRANT EXECUTE ON FUNCTION public.api_slice_rank_history() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_industry_ranks() TO anon, authenticated, service_role;
