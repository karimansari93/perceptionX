# Testing Search Insights with Admin Button

## Step 1: Access the Admin Panel

1. Go to your admin panel
2. Navigate to a company detail page
3. Click on the **"Search Insights"** tab
4. You should see the "Run Search Insights" button

## Step 2: Click the Button

1. Click **"Run Search Insights"** button
2. A modal will open showing progress
3. Watch the progress messages in real-time

## Step 3: What to Look For in the Modal

### Expected Progress Messages (in order):

```
✅ Starting search insights for [CompanyName]
✅ Calling search-insights edge function
✅ Edge function completed successfully
✅ Captured X total results and Y related searches
✅ Combined search terms: [list of terms]
```

### If Something Goes Wrong:

**Error in Modal:**
- `Edge function returned error: [error message]`
- Check the error message for details

**Function Times Out:**
- Modal might hang on "Calling search-insights edge function"
- No completion message appears
- Check Edge Function logs for timeout

## Step 4: Check the Logs

While the function is running (or after):

1. Open **Supabase Dashboard** in another tab
2. Go to **Edge Functions** → **search-insights** → **Logs**
3. Look for these critical logs:

```
🚨 CRITICAL: Reached database storage step...
💾 Storing combined search insights in database...
✅ Created search session: [session_id]
🚀 About to call supabase.insert() for X results
🚀 Insert call completed. Error: NO, Data: X rows
✅ Stored X search results (inserted X rows)
✅ VERIFICATION: Found X results for session [session_id]
```

## Step 5: Verify Data Was Saved

After the function completes, run this query in Supabase SQL Editor:

```sql
-- Check if data was inserted for the company you just tested
SELECT 
  s.id as session_id,
  s.company_id,
  s.company_name,
  s.total_results as expected,
  COUNT(r.id) as actual_inserted,
  s.created_at,
  CASE 
    WHEN COUNT(r.id) = 0 THEN '❌ NO RESULTS'
    WHEN COUNT(r.id) < s.total_results THEN '⚠️ PARTIAL'
    ELSE '✅ SUCCESS'
  END as status
FROM search_insights_sessions s
LEFT JOIN search_insights_results r ON r.session_id = s.id
WHERE s.company_id = 'YOUR_COMPANY_ID_HERE'  -- Replace with actual company_id
  AND s.created_at > NOW() - INTERVAL '5 minutes'
GROUP BY s.id, s.company_id, s.company_name, s.total_results, s.created_at
ORDER BY s.created_at DESC;
```

## Step 6: Troubleshooting

### Issue: Modal shows "Completed" but no data in DB

**Check:**
1. Look at Edge Function logs - did you see the database insertion logs?
2. Run the SQL query above - is `actual_inserted = 0`?
3. Check if `company_id` matches what you expect

### Issue: Modal shows error immediately

**Check:**
1. Error message in the modal
2. Edge Function logs for the actual error
3. Common errors:
   - `Missing companyName parameter` - companyName not passed
   - `Invalid authentication` - auth token issue
   - `SerpAPI key not configured` - API key missing

### Issue: Modal hangs/never completes

**Check:**
1. Edge Function logs - did function timeout?
2. Check function execution time
3. Function might be taking too long (>60 seconds)

## Step 7: Enhanced Testing

To see more detailed logs, you can also:

1. **Open Browser Console** (F12)
2. Look for any console errors
3. The component logs errors: `console.error('Error running search insights:', error)`

## Quick Verification Query

After clicking the button, immediately run this to see if data appeared:

```sql
-- Quick check: Latest session and results
SELECT 
  s.id,
  s.company_name,
  s.total_results,
  COUNT(r.id) as results_count,
  s.created_at
FROM search_insights_sessions s
LEFT JOIN search_insights_results r ON r.session_id = s.id
WHERE s.created_at > NOW() - INTERVAL '2 minutes'
GROUP BY s.id, s.company_name, s.total_results, s.created_at
ORDER BY s.created_at DESC
LIMIT 1;
```

If `results_count = 0` but `total_results > 0`, the insertion failed.


