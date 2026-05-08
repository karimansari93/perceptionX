-- Drop two materialized views with no callers anywhere in code or
-- other database objects:
--   prompt_responses_with_prompts — utility join MV, never queried.
--   company_overview_metrics_mv  — no consumers; the dashboard reads
--                                   sentiment/relevance/etc directly
--                                   from their dedicated MVs.

DROP MATERIALIZED VIEW IF EXISTS public.prompt_responses_with_prompts CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.company_overview_metrics_mv CASCADE;
