-- Fix prompt_responses that have company_id: null
-- This script will update existing responses with the correct company_id

-- First, let's see what we're working with
SELECT 
  id,
  confirmed_prompt_id,
  company_id,
  created_at
FROM prompt_responses 
WHERE company_id IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Update prompt_responses where company_id is null
-- We'll match by confirmed_prompt_id to find the correct company
UPDATE prompt_responses 
SET company_id = (
  SELECT cp.company_id 
  FROM confirmed_prompts cp
  WHERE cp.id = prompt_responses.confirmed_prompt_id
)
WHERE company_id IS NULL
  AND EXISTS (
    SELECT 1 
    FROM confirmed_prompts cp
    WHERE cp.id = prompt_responses.confirmed_prompt_id
      AND cp.company_id IS NOT NULL
  );

-- Check the results
SELECT 
  id,
  confirmed_prompt_id,
  company_id,
  created_at
FROM prompt_responses 
WHERE company_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Count how many were fixed
SELECT 
  COUNT(*) as total_responses,
  COUNT(company_id) as responses_with_company_id,
  COUNT(*) - COUNT(company_id) as responses_without_company_id
FROM prompt_responses;

