# Testing Search Insights Function

## Step 1: Trigger the Function

### Option A: Through the Dashboard UI
1. Go to your dashboard
2. Navigate to the Search tab
3. Click "Start Search" or similar button
4. This will call the `search-insights` edge function

### Option B: Direct API Call (for testing)
```bash
# Replace with your actual values
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/search-insights \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Cloudera",
    "company_id": "YOUR_COMPANY_ID"
  }'
```

## Step 2: Monitor Function Logs

1. Go to your Supabase Dashboard
2. Navigate to **Edge Functions** → **search-insights**
3. Click on **Logs** tab
4. Watch for these critical log messages in order:

### Expected Log Sequence:
```
✅ Company name received: [CompanyName]
📋 Request parameters: {...}
✅ Using provided company_id: [ID] (or derived)
🔍 Starting COMBINED search insights...
✅ Added X results for "[term]"
🔄 Finished processing all related searches. Final allResults.length: X
🔄 Completed data collection phase. Total results collected: X
📊 Final results: X total results...
🚨 CRITICAL: Reached database storage step...
💾 Storing combined search insights in database...
💾 Creating search session with: {...}
✅ Created search session: [session_id]
💾 Inserting X search results...
🚀 About to call supabase.insert() for X results
🚀 Insert call completed. Error: NO, Data: X rows
✅ Stored X search results (inserted X rows)
✅ VERIFICATION: Found X results for session [session_id]
```

### If Something Goes Wrong:
- **No "🚨 CRITICAL" log**: Function timed out before database step
- **"🚀 Insert call completed. Error: YES"**: Database insertion failed - check error details
- **"❌ CRITICAL ERROR"**: Check the error message and details

## Step 3: Check Database Directly

Run the diagnostic script to verify data was inserted:

```sql
-- Run this in Supabase SQL Editor
-- File: scripts/diagnose-search-insights.sql
```

Or run these quick checks:

```sql
-- Check if session was created
SELECT 
  id,
  company_id,
  company_name,
  total_results,
  created_at
FROM search_insights_sessions
ORDER BY created_at DESC
LIMIT 5;

-- Check if results were inserted
SELECT 
  COUNT(*) as result_count,
  company_id,
  session_id
FROM search_insights_results
GROUP BY company_id, session_id
ORDER BY session_id DESC
LIMIT 5;

-- Check most recent results
SELECT 
  id,
  session_id,
  company_id,
  search_term,
  domain,
  title,
  created_at
FROM search_insights_results
ORDER BY created_at DESC
LIMIT 10;
```

## Step 4: Verify from Frontend

1. Go to your dashboard Search tab
2. Check if data loads automatically
3. If not, check browser console for errors
4. Verify the `company_id` in the query matches what was inserted

## Step 5: Common Issues to Check

### Issue: No data in database
**Check:**
- Function logs for errors
- If `company_id` is NULL in database
- If RLS policies are blocking access
- If function timed out (check execution time)

### Issue: Data exists but not visible in UI
**Check:**
- Frontend is querying with correct `company_id`
- RLS policies allow user to see the data
- Browser console for query errors

### Issue: Function times out
**Check:**
- Function execution time in logs
- Consider reducing number of related searches processed
- Consider batching database inserts

## Step 6: Debug Specific Issues

### If you see "Error storing search results":
1. Check the error code and message in logs
2. Common issues:
   - **23503**: Foreign key violation (session_id doesn't exist)
   - **23505**: Unique constraint violation
   - **42501**: RLS policy violation (shouldn't happen with service role)
   - **PGRST116**: Column doesn't exist

### If you see "Cannot proceed without company_id":
1. Check if user has a default company
2. Check if company exists in database
3. Verify company_id is being passed correctly

### If function completes but no data:
1. Check if session was created (Step 3 queries)
2. Check if results insertion was attempted (logs)
3. Check if there were any silent errors

## Quick Test Query

Run this to see everything at once:

```sql
SELECT 
  s.id as session_id,
  s.company_id,
  s.company_name,
  s.total_results as expected_results,
  COUNT(r.id) as actual_results_count,
  s.created_at,
  CASE 
    WHEN COUNT(r.id) = 0 THEN '❌ NO RESULTS INSERTED'
    WHEN COUNT(r.id) < s.total_results THEN '⚠️ PARTIAL INSERT'
    ELSE '✅ ALL RESULTS INSERTED'
  END as status
FROM search_insights_sessions s
LEFT JOIN search_insights_results r ON r.session_id = s.id
WHERE s.created_at > NOW() - INTERVAL '1 hour'
GROUP BY s.id, s.company_id, s.company_name, s.total_results, s.created_at
ORDER BY s.created_at DESC;
```

