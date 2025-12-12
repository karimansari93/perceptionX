# Fix for Mixed-Up Prompt Responses

## Problem Description

Responses for different job functions (Software Engineers vs Sales Professionals) are incorrectly assigned to the same `confirmed_prompt_id`. This happens when:

1. Multiple confirmed prompts exist with the same `prompt_type`, `prompt_theme`, and `industry_context` but different `job_function_context`
2. Responses are generated and assigned to the wrong confirmed prompt ID
3. The migration script `20250130000000_add_job_function_location_to_unique_index.sql` may have incorrectly reassigned responses during cleanup

## Root Cause

The issue occurs because:
- Responses are assigned by `confirmed_prompt_id` directly (which is correct)
- However, if the wrong `confirmed_prompt_id` is passed during response generation, or if responses were incorrectly merged during a migration, they end up on the wrong prompt
- The unique constraint ensures prompts are distinct by `(onboarding_id, prompt_type, prompt_category, prompt_theme, industry_context, job_function_context, location_context)`, but responses can still be assigned incorrectly if the wrong ID is used

## Solution

We need to:
1. **Diagnose**: Identify responses that are assigned to prompts with mismatched `job_function_context`
2. **Fix**: Reassign responses to the correct `confirmed_prompt_id` based on content analysis
3. **Verify**: Confirm all responses are now correctly assigned

## Scripts Created

### 1. `scripts/diagnose-mixed-prompt-responses.sql`
- Shows the current state of mixed-up responses
- Identifies which responses belong to which job function based on content
- Shows which prompts should exist for each job function

### 2. `scripts/fix-mixed-prompt-responses.sql`
- Basic fix script for the specific problematic prompt ID mentioned
- Uses content analysis to infer job function from response text
- Reassigns responses to correct prompts

### 3. `scripts/fix-mixed-prompt-responses-comprehensive.sql`
- Comprehensive fix that handles all mixed-up responses for a company
- More robust content analysis
- Handles edge cases better

## How to Use

### Step 1: Run Diagnostic
```sql
-- Run the diagnostic script to see the current state
\i scripts/diagnose-mixed-prompt-responses.sql
```

This will show:
- All prompts with job function contexts
- The problematic prompt ID and its responses
- Which responses belong to which job function based on content

### Step 2: Review Fix Plan
```sql
-- Run the comprehensive fix script (first two sections only)
-- This shows the reassignment plan without making changes
\i scripts/fix-mixed-prompt-responses-comprehensive.sql
```

Review the output to ensure the reassignments make sense.

### Step 3: Apply the Fix
```sql
-- Uncomment Step 3 in fix-mixed-prompt-responses-comprehensive.sql
-- Then run it to perform the actual reassignment
```

### Step 4: Verify
```sql
-- Uncomment Step 4 in fix-mixed-prompt-responses-comprehensive.sql
-- This will show the final state after reassignment
```

## Content Analysis Rules

The scripts use the following heuristics to infer job function from response content:

### Software Engineers
- Keywords: "software engineer", "coding", "LeetCode", "algorithm", "data structure", "system design", "technical interview", "programming", "Java", "Python", "Kotlin", "PHP"

### Sales Professionals  
- Keywords: "sales professional", "sales role", "fundraising", "customer service", "closing deals", "sales targets", "pipeline management", "sales quota"

## Important Notes

1. **Manual Review Required**: Responses that cannot be classified automatically (no clear job function keywords) will be skipped and marked for manual review
2. **Backup First**: Always backup your database before running UPDATE queries
3. **Test on Staging**: Test these scripts on a staging/development environment first
4. **Specific Company**: The scripts are currently configured for company ID `60be0418-ff09-4f50-aba6-48a971b7c5c3` (GoFundMe). Update the company_id in the scripts if fixing other companies.

## Prevention

To prevent this issue in the future:

1. **Always use exact confirmed_prompt_id**: When generating responses, ensure you're using the correct `confirmed_prompt_id` that matches the `job_function_context` you're processing
2. **Validate before assignment**: Before assigning a response, verify that the `confirmed_prompt_id`'s `job_function_context` matches the response content
3. **Add constraints**: Consider adding application-level validation to ensure responses match their prompt's job function context

## Example Query to Check for Mixed Responses

```sql
-- Find all cases where responses might be assigned to wrong prompts
SELECT 
  cp.id as prompt_id,
  cp.job_function_context,
  COUNT(pr.id) as response_count,
  COUNT(DISTINCT CASE 
    WHEN pr.response_text ILIKE '%software engineer%' OR pr.response_text ILIKE '%LeetCode%' THEN 'SWE'
    WHEN pr.response_text ILIKE '%sales%' OR pr.response_text ILIKE '%fundraising%' THEN 'Sales'
  END) as distinct_content_types
FROM confirmed_prompts cp
JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
WHERE cp.job_function_context IS NOT NULL
  AND cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
GROUP BY cp.id, cp.job_function_context
HAVING COUNT(DISTINCT CASE 
  WHEN pr.response_text ILIKE '%software engineer%' OR pr.response_text ILIKE '%LeetCode%' THEN 'SWE'
  WHEN pr.response_text ILIKE '%sales%' OR pr.response_text ILIKE '%fundraising%' THEN 'Sales'
END) > 1;
```




