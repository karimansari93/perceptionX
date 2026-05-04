-- Search insights and search terms features have been retired.
-- Drop the supporting tables and their RLS policies (cascading drops
-- will remove dependent indexes/policies/foreign keys).

DROP TABLE IF EXISTS public.search_insights_results CASCADE;
DROP TABLE IF EXISTS public.search_insights_terms CASCADE;
DROP TABLE IF EXISTS public.search_insights_sessions CASCADE;
DROP TABLE IF EXISTS public.company_search_terms CASCADE;
