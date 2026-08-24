-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260208143416; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Create materialized view for the expensive prompt_responses query
CREATE MATERIALIZED VIEW IF NOT EXISTS prompt_responses_with_prompts AS
SELECT 
  pr.id,
  pr.ai_model,
  pr.response_text,
  pr.detected_competitors,
  pr.created_at,
  pr.company_id,
  pr.confirmed_prompt_id,
  jsonb_build_object(
    'industry_context', cp.industry_context,
    'prompt_theme', cp.prompt_theme,
    'prompt_category', cp.prompt_category,
    'location_context', cp.location_context
  ) as confirmed_prompts
FROM prompt_responses pr
INNER JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id;

-- Create index on the materialized view
CREATE INDEX IF NOT EXISTS idx_pr_with_prompts_created_at 
ON prompt_responses_with_prompts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pr_with_prompts_company_id 
ON prompt_responses_with_prompts(company_id);

-- Refresh function (call this after inserts)
CREATE OR REPLACE FUNCTION refresh_prompt_responses_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY prompt_responses_with_prompts;
END;
$$ LANGUAGE plpgsql;
