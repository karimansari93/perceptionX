-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260401084204; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE FUNCTION get_report_data(
  p_company_id UUID,
  p_p1_start   DATE,
  p_p1_end     DATE,
  p_p2_start   DATE,
  p_p2_end     DATE
)
RETURNS TABLE (
  period               INT,
  company_mentioned    BOOLEAN,
  prompt_type          TEXT,
  detected_competitors TEXT,
  citations            JSONB,
  ai_model             TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    CASE WHEN DATE(pr.tested_at) BETWEEN p_p1_start AND p_p1_end THEN 1 ELSE 2 END AS period,
    pr.company_mentioned,
    cp.prompt_type,
    pr.detected_competitors,
    pr.citations::jsonb,
    pr.ai_model
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
  WHERE pr.company_id = p_company_id
    AND (
      DATE(pr.tested_at) BETWEEN p_p1_start AND p_p1_end
      OR
      DATE(pr.tested_at) BETWEEN p_p2_start AND p_p2_end
    );
$$;

