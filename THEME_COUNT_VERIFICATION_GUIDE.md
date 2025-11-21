# Theme Count Verification Guide

This guide explains how to verify that sentiment calculation is correctly counting positive and negative themes for a specific company.

## Company ID
Your company ID: `3196174e-2e92-4ee1-88a9-34b245b970db`

## Method 1: Visual Debug Component (Recommended)

A debug component has been added to the Overview tab that shows:
- **Database Query (Direct)**: Counts from a direct SQL query
- **In-Memory (UI Calculation)**: Counts from the actual UI calculation
- **Match Status**: Whether the two match

### How to View:
1. Navigate to the Dashboard
2. Go to the "Overview" tab
3. Look for a yellow debug card at the top showing theme counts
4. Compare the two columns to verify they match

### What to Check:
- ✅ **Total Themes** should match
- ✅ **Positive Themes** should match  
- ✅ **Negative Themes** should match
- ✅ **Positive Ratio** should match

If they don't match, there may be a filtering issue.

## Method 2: SQL Query Verification

Run the SQL queries in `scripts/verify-theme-counts-by-company.sql` to verify counts directly from the database.

### Quick Query:
```sql
SELECT 
  pr.company_id,
  c.name as company_name,
  COUNT(*) as total_themes,
  COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) as positive_themes,
  COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END) as negative_themes,
  COUNT(CASE WHEN at.sentiment_score >= -0.1 AND at.sentiment_score <= 0.1 THEN 1 END) as neutral_themes,
  ROUND(
    COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END)::numeric / 
    NULLIF(COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) + COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END), 0) * 100, 
    2
  ) as positive_ratio_percent
FROM ai_themes at
INNER JOIN prompt_responses pr ON at.response_id = pr.id
INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
INNER JOIN companies c ON pr.company_id = c.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
GROUP BY pr.company_id, c.name;
```

### Expected Results:
- Should only count themes from responses where:
  - `prompt_responses.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'`
  - `confirmed_prompts.prompt_type` is one of: `sentiment`, `competitive`, `talentx_sentiment`, `talentx_competitive`
- Positive themes: `sentiment_score > 0.1`
- Negative themes: `sentiment_score < -0.1`
- Neutral themes: `-0.1 <= sentiment_score <= 0.1`

## Method 3: Check Response Filtering

Verify that responses are correctly filtered by company:

```sql
-- Check how many responses belong to your company
SELECT 
  COUNT(*) as total_responses,
  COUNT(DISTINCT id) as unique_response_ids
FROM prompt_responses
WHERE company_id = '3196174e-2e92-4ee1-88a9-34b245b970db';

-- Check how many themes are linked to those responses
SELECT 
  COUNT(*) as total_themes
FROM ai_themes at
INNER JOIN prompt_responses pr ON at.response_id = pr.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db';
```

## How the Calculation Works

1. **Filter Responses**: Only responses where `company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'`
2. **Filter by Prompt Type**: Only sentiment/competitive prompts
3. **Filter Themes**: Only themes whose `response_id` is in the filtered responses
4. **Count Themes**:
   - Positive: `sentiment_score > 0.1`
   - Negative: `sentiment_score < -0.1`
   - Neutral: `-0.1 <= sentiment_score <= 0.1`
5. **Calculate Ratio**: `positive_themes / (positive_themes + negative_themes)`

## Troubleshooting

### If counts don't match:

1. **Check company_id in prompt_responses**:
   ```sql
   SELECT id, company_id, confirmed_prompt_id 
   FROM prompt_responses 
   WHERE id IN (SELECT DISTINCT response_id FROM ai_themes LIMIT 10);
   ```

2. **Check if themes are linked to correct responses**:
   ```sql
   SELECT 
     at.response_id,
     pr.company_id,
     COUNT(*) as theme_count
   FROM ai_themes at
   LEFT JOIN prompt_responses pr ON at.response_id = pr.id
   GROUP BY at.response_id, pr.company_id
   ORDER BY theme_count DESC
   LIMIT 20;
   ```

3. **Verify prompt types**:
   ```sql
   SELECT 
     cp.prompt_type,
     COUNT(DISTINCT pr.id) as response_count,
     COUNT(at.id) as theme_count
   FROM prompt_responses pr
   INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
   LEFT JOIN ai_themes at ON pr.id = at.response_id
   WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
   GROUP BY cp.prompt_type;
   ```

## Removing Debug Component

Once verification is complete, remove the debug component by:
1. Removing the import in `OverviewTab.tsx`
2. Removing the debug component JSX (lines ~1244-1254)
3. Optionally removing `companyId` prop if not needed elsewhere

