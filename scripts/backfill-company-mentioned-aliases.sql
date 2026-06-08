-- One-time data fix: backfill company_mentioned for responses that mention a
-- company only via a localized/transliterated alias (e.g. Korean "넷플릭스").
--
-- This is the historical counterpart to migration
-- 20260608111428_add_company_mention_aliases.sql, which created the
-- company_mention_aliases table + apply_company_mention_aliases() trigger that
-- now handles NEW responses automatically. Run this once (already run on prod
-- 2026-06-08) to fix rows ingested before the trigger existed.
--
-- Idempotent: only flips rows still marked false that match an active alias.
-- Apply the migration FIRST (the alias table must exist and be seeded).

-- 1) Backfill existing rows using the same predicate as the trigger.
UPDATE public.prompt_responses pr
SET company_mentioned = true
FROM public.confirmed_prompts cp, public.companies c
WHERE pr.confirmed_prompt_id = cp.id
  AND c.id = COALESCE(pr.company_id, cp.company_id)
  AND pr.company_mentioned = false
  AND EXISTS (
    SELECT 1 FROM public.company_mention_aliases a
    WHERE a.is_active
      AND lower(a.company_name) = lower(c.name)
      AND position(lower(a.alias) in lower(pr.response_text)) > 0
  );
-- Prod run 2026-06-08: 772 rows updated (Netflix 685, Spotify 87).

-- 2) Refresh the materialized views that depend on company_mentioned so the
--    dashboard reflects the change. MV refresh crons are currently disabled
--    (see 20260602000001_disable_mv_refresh_crons.sql), so this is required.
--    CONCURRENTLY cannot run inside a transaction block — run each on its own.
REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_overview_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_llm_rankings_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_relevance_scores_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.competitor_benchmarks_mv;

-- 3) Verify: no false rows remain that an active alias would match (expect 0 rows).
-- SELECT c.name, count(*)
-- FROM public.prompt_responses pr
-- JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
-- JOIN public.companies c ON c.id = COALESCE(pr.company_id, cp.company_id)
-- JOIN public.company_mention_aliases a
--   ON a.is_active AND lower(a.company_name) = lower(c.name)
-- WHERE pr.company_mentioned = false
--   AND position(lower(a.alias) in lower(pr.response_text)) > 0
-- GROUP BY c.name;
