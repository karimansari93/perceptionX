-- Check if company 0ae3a533-518f-4096-a4da-5885d480a257 is "completed"
-- Run in Supabase SQL Editor

-- 1. Raw counts
SELECT 
  '1. Raw counts' AS section,
  (SELECT COUNT(*) FROM confirmed_prompts WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257'::uuid AND is_active = true) AS active_prompts,
  (SELECT COUNT(*) FROM prompt_responses WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257'::uuid) AS total_responses,
  (SELECT data_collection_status FROM companies WHERE id = '0ae3a533-518f-4096-a4da-5885d480a257'::uuid) AS db_status;

-- 2. Per-prompt response counts
WITH prompt_resp AS (
  SELECT 
    cp.id,
    cp.prompt_type,
    cp.prompt_category,
    cp.prompt_theme,
    LEFT(cp.prompt_text, 60) AS prompt_preview,
    COUNT(pr.id) AS response_count
  FROM confirmed_prompts cp
  LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id AND pr.company_id = cp.company_id
  WHERE cp.company_id = '0ae3a533-518f-4096-a4da-5885d480a257'::uuid
    AND cp.is_active = true
  GROUP BY cp.id, cp.prompt_type, cp.prompt_category, cp.prompt_theme, cp.prompt_text
)
SELECT 
  prompt_type,
  prompt_category,
  response_count,
  CASE WHEN response_count >= 5 THEN 'YES' ELSE 'NO' END AS has_full_coverage,
  prompt_preview
FROM prompt_resp
ORDER BY response_count ASC, prompt_type;

-- 3. Summary verdict
WITH prompt_resp AS (
  SELECT 
    cp.id,
    COUNT(pr.id) AS response_count
  FROM confirmed_prompts cp
  LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id AND pr.company_id = cp.company_id
  WHERE cp.company_id = '0ae3a533-518f-4096-a4da-5885d480a257'::uuid
    AND cp.is_active = true
  GROUP BY cp.id
)
SELECT 
  COUNT(*) AS total_prompts,
  SUM(CASE WHEN response_count >= 5 THEN 1 ELSE 0 END) AS prompts_with_full_coverage,
  SUM(CASE WHEN response_count = 0 THEN 1 ELSE 0 END) AS prompts_with_zero_responses,
  CASE 
    WHEN COUNT(*) > 0 AND SUM(CASE WHEN response_count >= 5 THEN 1 ELSE 0 END) = COUNT(*) 
    THEN 'COMPLETED' 
    ELSE 'INCOMPLETE' 
  END AS verdict
FROM prompt_resp;
