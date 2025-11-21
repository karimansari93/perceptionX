# Relevance Score Debug Summary

## Problem Identified
All Relevance scores showing 0% across all companies in the Overview tab.

## Root Cause
The Relevance score calculation in `useDashboardData.ts` (lines 1263-1266) depends on data from the `url_recency_cache` table:

```typescript
const averageRelevance = recencyData.length > 0 
  ? recencyData.reduce((sum, item) => sum + (item.recency_score || 0), 0) / recencyData.length 
  : 0;
```

**If `recencyData` is empty or all scores are NULL → Relevance = 0%**

## Why This Happens

### Data Flow
1. **Prompt responses** are stored with citations (URLs)
2. **extract-recency-scores** edge function analyzes URLs to extract publication dates
3. **url_recency_cache** table stores the recency scores (0-100)
4. **fetchRecencyData** in useDashboardData queries the cache
5. **averageRelevance** is calculated and displayed

### Most Likely Issues
1. ❌ **url_recency_cache is empty** - Edge function never ran or failed
2. ❌ **All recency_score values are NULL** - Extraction failed (problematic domains, no dates found, timeouts)
3. ❌ **URL mismatch** - Citations have slightly different URLs than cache
4. ❌ **fetchRecencyData failing** - Batch query errors, URI too long

## Solution Implemented

I've created a **comprehensive debugging tool** that will identify the exact issue:

### New Tool: RelevanceDebugger Component

**Location:** `src/components/admin/RelevanceDebugger.tsx`

**Features:**
- 6-step diagnostic process
- Company-specific analysis
- Color-coded results (✅ success, ⚠️ warning, ❌ error)
- Detailed JSON output for each step
- Actionable solutions provided

**Access:**
1. Go to `/admin` (requires admin access)
2. Click "Debug Relevance" tab (new tab added)
3. Select a company
4. Click "Run Diagnostics"

### Diagnostic Steps

**Step 1:** Check if prompt responses exist
**Step 2:** Extract all URLs from citations  
**Step 3:** Check url_recency_cache for these URLs
**Step 4:** Analyze recency score distribution
**Step 5:** Test the actual fetchRecencyData query
**Step 6:** Provide final recommendation

## Quick Test Instructions

1. **Open Admin Panel**
   ```
   Navigate to: http://localhost:5173/admin (or your deployed URL)
   ```

2. **Go to Debug Relevance Tab**
   - New tab in the admin panel
   - Lists all companies

3. **Run Diagnostics for ONE Company**
   - Click "Run Diagnostics" next to any company showing 0% relevance
   - Wait 5-10 seconds for results

4. **Review Results**
   - Look for red ❌ error messages
   - Check the "details" JSON for specific data
   - Step 6 will tell you exactly what to do

## Expected Findings

Based on the code analysis, you'll likely see ONE of these:

### Finding A: Cache is Completely Empty (Most Likely)
**Step 3 Error:** "No URLs found in url_recency_cache"

**Cause:** The extract-recency-scores edge function hasn't been called for this company's citations.

**Solution:** Manually trigger the edge function:
```javascript
// In browser console or admin panel
const { data: responses } = await supabase
  .from('prompt_responses')
  .select('citations')
  .eq('company_id', 'COMPANY_ID_FROM_DEBUGGER');

const allUrls = responses.flatMap(r => {
  const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
  return (citations || []).filter(c => c.url).map(c => ({
    url: c.url,
    domain: c.domain,
    title: c.title
  }));
});

await supabase.functions.invoke('extract-recency-scores', {
  body: { citations: allUrls }
});

// Wait 10 minutes, then refresh dashboard
```

### Finding B: All Scores are NULL
**Step 3 Warning:** "Found X cached URLs but ALL have NULL recency_score"

**Cause:** Extraction is failing. Check the extraction_method distribution in Step 3 details.

**If mostly 'problematic-domain':** Expected - sites like Glassdoor, Indeed, LinkedIn are intentionally skipped (they cause timeouts/rate limits)

**If mostly 'not-found':** URLs don't contain dates and scraping failed - may be expected for many sites

**If mostly 'timeout':** Edge function is timing out - check logs

### Finding C: URL Mismatch
**Step 5 Error:** "fetchRecencyData would return 0 matches"

**Cause:** The URLs in citations don't exactly match the URLs in the cache (different formatting).

**Solution:** Compare URLs in Step 2 details vs Step 3 details to see the difference. May need to normalize URLs.

### Finding D: Everything Works!
**All steps show ✅ success**

**Cause:** Data is fine, but dashboard isn't refreshing.

**Solution:** Hard refresh the dashboard (Ctrl+Shift+R or Cmd+Shift+R)

## Code Changes Made

### 1. RelevanceDebugger.tsx (NEW)
- Comprehensive diagnostic tool
- Runs 6 validation steps
- Provides actionable solutions
- Shows detailed data at each step

### 2. Admin.tsx (MODIFIED)
- Added "Debug Relevance" tab to admin panel
- Added debug modal for displaying results
- Lists all companies with "Run Diagnostics" button

### 3. Documentation (NEW)
- RELEVANCE_DEBUG_SUMMARY.md (this file)
- RELEVANCE_SCORE_DEBUG_GUIDE.md (detailed guide)

## Immediate Action Items

1. ✅ **Run the debugger** on 2-3 companies showing 0% relevance
2. ✅ **Identify the common pattern** (likely cache is empty for all)
3. ✅ **Follow the solution** provided by Step 6 of the debugger
4. ✅ **Re-run diagnostics** after applying the fix to confirm

## Why This Is Better Than Manual Debugging

**Before:**
- Manually query multiple tables
- Guess at what might be wrong
- Hard to see the full data flow
- No clear solutions

**After:**
- One-click diagnostics
- See exactly which step is failing
- Get actionable solutions
- Verify fixes work immediately

## Timeline to Resolution

- **If cache is empty:** 10-15 minutes (trigger extraction + wait)
- **If URL mismatch:** 30-60 minutes (investigate + fix normalization)
- **If systematic failure:** 1-2 hours (debug edge function)

## Questions to Answer After Running Diagnostics

1. **Is this affecting ALL companies or just some?**
   - Run diagnostics on 3-5 companies
   - If all show the same error → systematic issue
   - If only some → company-specific issue

2. **When did the problem start?**
   - Check when the last successful relevance score was recorded
   - Review edge function deployment history

3. **Are new companies affected?**
   - Create a test company
   - Run through onboarding
   - Check if relevance scores populate

## Success Criteria

After fixing the issue:
- ✅ url_recency_cache has data for company citations
- ✅ recency_score values are NOT NULL
- ✅ fetchRecencyData returns matches
- ✅ averageRelevance > 0
- ✅ Dashboard shows Relevance % > 0

## Next Steps

**RIGHT NOW:**
1. Run the debugger on ANY company showing 0%
2. Share the Step 3 and Step 5 results
3. Follow the recommendation from Step 6

**This will immediately tell us:**
- Is the cache empty? (most likely)
- Are scores NULL?
- Is there a query issue?

Then we can apply the specific fix needed.

---

## Need Help?

If the debugger shows an unexpected error pattern, share:
1. Company ID tested
2. Screenshot of diagnostic results (especially Steps 3, 5, 6)
3. Any error messages from browser console

