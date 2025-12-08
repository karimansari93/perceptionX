# Debugging Relevance Score

## What I've Added

I've added comprehensive debug logging to help identify why relevance scores might be showing 0%. The logs will appear in the browser console (only in development mode).

## How to Debug

### Step 1: Check Browser Console

1. Open your browser's developer console (F12 or Cmd+Option+I)
2. Navigate to the dashboard
3. Look for logs prefixed with `[Relevance Debug]`

You should see logs like:
- `[Relevance Debug] fetchRecencyData: Starting with X unique URLs from Y responses`
- `[Relevance Debug] fetchRecencyData: Found X matches from URL queries`
- `[Relevance Debug] Average relevance calculated: X`

### Step 2: Check What the Logs Tell You

#### If you see "No URLs found in citations"
- **Problem**: Responses don't have citations with URLs
- **Solution**: Check if `prompt_responses` table has valid citations

#### If you see "No exact URL matches found"
- **Problem**: URLs in citations don't match URLs in `url_recency_cache`
- **Solution**: Check if URLs are normalized/encoded differently

#### If you see "Found X matches" but "Average relevance calculated: 0"
- **Problem**: All `recency_score` values are NULL or 0
- **Solution**: The `extract-recency-scores` edge function needs to be run

#### If you see "No matches from URL queries" and "Domain-based search found 0 matches"
- **Problem**: No data in `url_recency_cache` table
- **Solution**: Run the `extract-recency-scores` edge function

## Data Flow

1. **Citations** are stored in `prompt_responses.citations` (JSON array)
2. **fetchRecencyData** extracts URLs from citations
3. **Queries** `url_recency_cache` table for matching URLs
4. **Calculates** average of `recency_score` values (0-100)
5. **Displays** as "Relevance Score" in the dashboard

## Common Issues

### Issue 1: Empty url_recency_cache
**Symptoms**: Console shows "No matches found"
**Fix**: 
```sql
-- Check if cache has data
SELECT COUNT(*) FROM url_recency_cache WHERE recency_score IS NOT NULL;
```

### Issue 2: URL Mismatch
**Symptoms**: Citations have URLs but cache lookup returns 0 matches
**Fix**: Check URL normalization - trailing slashes, http vs https, etc.

### Issue 3: All NULL Scores
**Symptoms**: Matches found but all have `recency_score = NULL`
**Fix**: Re-run `extract-recency-scores` edge function for those URLs

### Issue 4: extract-recency-scores Not Running
**Symptoms**: No data in cache at all
**Fix**: Check if edge function is being called when responses are stored

## Manual Test

You can manually test the relevance score calculation:

```javascript
// In browser console on dashboard page
// Check what recencyData contains
console.log('Recency Data:', window.recencyData); // If exposed
```

Or use the RelevanceDebugger component in the admin panel:
1. Go to `/admin`
2. Click "Debug Relevance" tab
3. Select a company
4. Click "Run Diagnostics"

## Next Steps

1. **Check the console logs** - They will tell you exactly where the issue is
2. **Verify data exists** - Check if `url_recency_cache` has entries
3. **Check extraction** - Ensure `extract-recency-scores` is running
4. **Verify URLs match** - Compare URLs in citations vs cache

## Code Changes Made

Added debug logging to:
- `fetchRecencyData` function (lines ~284-433)
- Relevance calculation (lines ~1376-1382)

All logs are prefixed with `[Relevance Debug]` and only appear in development mode.

