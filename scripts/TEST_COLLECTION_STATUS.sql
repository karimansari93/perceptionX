-- Test query to check if migration was applied and see collection status
-- Run this in Supabase SQL Editor to verify the migration

-- Check if columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'companies' 
  AND column_name IN (
    'data_collection_status',
    'data_collection_progress',
    'data_collection_started_at',
    'data_collection_completed_at',
    'onboarding_id'
  )
ORDER BY column_name;

-- Check if enum type exists
SELECT t.typname, e.enumlabel
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname = 'data_collection_status'
ORDER BY e.enumsortorder;

-- Check companies with incomplete collection
SELECT 
  id,
  name,
  data_collection_status,
  data_collection_progress,
  data_collection_started_at,
  onboarding_id
FROM companies
WHERE data_collection_status IS NOT NULL
  AND data_collection_status NOT IN ('completed', 'failed')
ORDER BY data_collection_started_at DESC;

-- Check all companies (to see default values)
SELECT 
  id,
  name,
  data_collection_status,
  created_at
FROM companies
ORDER BY created_at DESC
LIMIT 10;

