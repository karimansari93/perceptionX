-- Debug prompts in database
-- Run this in your Supabase SQL Editor

-- Check if confirmed_prompts table exists and has data
SELECT 
  'confirmed_prompts' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as with_company_id,
  COUNT(CASE WHEN company_id IS NULL THEN 1 END) as without_company_id
FROM confirmed_prompts;

-- Check if there are any prompts at all (with sample data)
SELECT id, user_id, company_id, prompt_type, created_at
FROM confirmed_prompts 
ORDER BY created_at DESC 
LIMIT 5;

-- Check if there are any users who have completed onboarding
SELECT 
  'user_onboarding' as table_name,
  COUNT(*) as total_rows
FROM user_onboarding;

-- Check if there are any prompt_responses
SELECT 
  'prompt_responses' as table_name,
  COUNT(*) as total_rows
FROM prompt_responses;

-- Check if there are any companies
SELECT 
  'companies' as table_name,
  COUNT(*) as total_rows
FROM companies;

-- Check if there are any organization_companies
SELECT 
  'organization_companies' as table_name,
  COUNT(*) as total_rows
FROM organization_companies;
















