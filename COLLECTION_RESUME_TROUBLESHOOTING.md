# Data Collection Resume - Troubleshooting Guide

## Issue: "Nothing showed" after refresh

If the collection banner doesn't appear after refreshing during data collection, follow these steps:

### Step 1: Verify Migration Was Applied

Run the test query in `TEST_COLLECTION_STATUS.sql` in your Supabase SQL Editor. This will show:
- Whether the columns exist
- Whether the enum type exists
- Companies with incomplete collection status

**Expected Result:** You should see all 5 columns listed:
- `data_collection_status`
- `data_collection_progress`
- `data_collection_started_at`
- `data_collection_completed_at`
- `onboarding_id`

**If columns are missing:** Run the migration `supabase/migrations/20250125000000_add_data_collection_tracking.sql`

### Step 2: Check Browser Console

Open your browser's developer console (F12) and look for logs prefixed with `[Collection]`:

- `[Collection] Checking for incomplete collection for company: <id>`
- `[Collection] Company data: {...}`
- `[Collection] Found incomplete collection! Status: ...`

**If you see "Migration not applied yet":** The migration hasn't been run. Apply it first.

**If you see "No incomplete collection found":** The company's status is already `completed` or `failed`, or it's `null` (which means completed for old companies).

### Step 3: Check Database Status

Run this query to see the current status of your company:

```sql
SELECT 
  id,
  name,
  data_collection_status,
  data_collection_progress,
  data_collection_started_at,
  onboarding_id
FROM companies
WHERE name = 'YOUR_COMPANY_NAME'
ORDER BY created_at DESC
LIMIT 1;
```

**Possible Status Values:**
- `pending` - Collection hasn't started
- `collecting_search_insights` - Currently collecting search data
- `collecting_llm_data` - Currently collecting LLM responses
- `completed` - Collection finished
- `failed` - Collection failed
- `null` - Old company (before migration), treated as completed

### Step 4: Manual Test

To test if the system works:

1. **Create a new company** through the Add Company modal
2. **Wait for collection to start** (you should see the progress banner)
3. **Refresh the page immediately** (before collection completes)
4. **Check console logs** - you should see auto-resume logs
5. **Check the banner** - should appear within 2 seconds

### Step 5: Manual Resume (If Auto-Resume Fails)

If auto-resume doesn't work, you can manually trigger it by:

1. Opening browser console
2. Finding the `resumeCollection` function from the hook
3. Or temporarily add a button to trigger it

### Common Issues

#### Issue: Migration not applied
**Solution:** Run the migration SQL file in Supabase SQL Editor

#### Issue: Status is null (old companies)
**Solution:** Old companies created before migration have `null` status, which is treated as completed. Only new companies will have tracking.

#### Issue: Status stuck in "collecting" state
**Solution:** Manually update the status:
```sql
UPDATE companies 
SET data_collection_status = 'completed'
WHERE id = 'YOUR_COMPANY_ID';
```

#### Issue: Banner doesn't show
**Check:**
1. Is `isCollectingData` true? (Check React DevTools)
2. Is `collectionProgress` not null? (Check React DevTools)
3. Are there any console errors?

### Debugging Commands

**Check if hook is detecting status:**
```javascript
// In browser console, after page loads
// The hook should log collection status
```

**Check current company:**
```javascript
// In React DevTools, find Dashboard component
// Check: collectionStatus, isCollectingData, collectionProgress
```

**Manually check database:**
```sql
-- See all companies with incomplete collection
SELECT id, name, data_collection_status, data_collection_progress
FROM companies
WHERE data_collection_status IN ('pending', 'collecting_search_insights', 'collecting_llm_data');
```

### Expected Behavior

1. **When adding a company:**
   - Status set to `pending` immediately
   - Status changes to `collecting_search_insights` when search starts
   - Status changes to `collecting_llm_data` when LLM collection starts
   - Progress updated in database after each operation
   - Status set to `completed` when done

2. **When refreshing during collection:**
   - Hook detects incomplete status on page load
   - Sets `collectionStatus` and `isCollectingData = true`
   - Auto-resumes after 2 seconds
   - Banner shows progress
   - Collection continues from where it left off

3. **Banner display:**
   - Shows when `isRefreshing || isCollectingData` is true
   - Displays progress: `completed/total operations`
   - Shows current model and prompt being processed

