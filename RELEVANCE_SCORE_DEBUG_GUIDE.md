# Relevance Score Debugging Guide

## Problem
All Relevance scores are showing 0% across all companies in the dashboard Overview tab.

## Root Cause Analysis

The Relevance score is calculated based on URL recency data from the `url_recency_cache` table. The score can be 0% for several reasons:

### Data Flow
1. **Citations are extracted** from AI responses (Perplexity, ChatGPT, Gemini, Claude)
2. **extract-recency-scores edge function** is called to analyze URLs
3. **url_recency_cache table** is populated with recency scores (0-100)
4. **useDashboardData.ts** queries the cache and calculates average relevance
5. **OverviewTab.tsx** displays the relevance score

### Potential Issues

1. **No data in url_recency_cache** - The edge function hasn't been run or failed
2. **All recency_score values are NULL** - Extraction failed for all URLs
3. **URL mismatch** - URLs in citations don't match URLs in cache
4. **Extraction failures** - Marked as 'not-found', 'timeout', or 'problematic-domain'
5. **fetchRecencyData errors** - Query failures or network issues

## New Debugging Tool

I've created a comprehensive **RelevanceDebugger** component that runs 6-step diagnostics:

### Step 1: Check Prompt Responses
- Verifies that prompt_responses exist for the company
- Shows response count and sample data

### Step 2: Extract URLs from Citations
- Parses all citations to find unique URLs
- Shows total URL count and samples

### Step 3: Check url_recency_cache
- Queries cache for extracted URLs
- Shows cache hit rate
- Identifies extraction methods used
- Highlights if all scores are NULL

### Step 4: Analyze Score Distribution  
- Calculates average recency score
- Shows score distribution (0-20%, 20-40%, etc.)
- Displays sample dates and methods

### Step 5: Test fetchRecencyData Logic
- Simulates the actual query from useDashboardData
- Shows how many matches would be found
- Calculates what the average relevance would be

### Step 6: Final Recommendation
- Provides actionable solutions based on findings
- Indicates severity (error/warning/success)

## How to Use the Debugger

1. **Access the Admin Panel**
   - Navigate to `/admin`
   - You must be an admin user

2. **Open Debug Relevance Tab**
   - Click on "Debug Relevance" in the tab menu
   - You'll see a list of all companies

3. **Run Diagnostics**
   - Click "Run Diagnostics" next to any company
   - Wait for the 6-step diagnostic to complete (usually 5-10 seconds)

4. **Review Results**
   - Each step shows:
     - ✅ Success (green) - Step passed
     - ⚠️  Warning (yellow) - Issue but not critical
     - ❌ Error (red) - Critical issue found
     - ℹ️  Info (blue) - In progress
   - Expand the details JSON to see specific data

5. **Follow Recommendations**
   - Step 6 provides specific actions to take
   - Solutions are provided in error messages

## Common Issues and Solutions

### Issue 1: "No URLs found in url_recency_cache"
**Cause:** The extract-recency-scores edge function hasn't been run for this company's citations.

**Solution:**
1. Check if the edge function is deployed: `supabase functions list`
2. Manually trigger it for the company:
   ```javascript
   const { data: responses } = await supabase
     .from('prompt_responses')
     .select('citations')
     .eq('company_id', 'YOUR_COMPANY_ID');
   
   const citations = responses.flatMap(r => 
     (typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations || [])
       .filter(c => c.url)
       .map(c => ({ url: c.url, domain: c.domain, title: c.title }))
   );
   
   await supabase.functions.invoke('extract-recency-scores', {
     body: { citations }
   });
   ```

### Issue 2: "All cached URLs have NULL recency_score"
**Cause:** Extraction is failing for all URLs, likely due to:
- 'problematic-domain' (Glassdoor, Indeed, LinkedIn, Reddit, etc.)
- 'not-found' (No date found in URL or content)
- 'timeout' (Edge function timeout)

**Solution:**
1. Check extraction_method distribution in Step 3 details
2. If mostly 'problematic-domain': These domains are intentionally skipped (known to cause timeouts/rate limits)
3. If mostly 'not-found': URLs don't contain dates - this is expected for many sites
4. If mostly 'timeout': Check edge function logs for issues

### Issue 3: "URL mismatch between citations and cache"
**Cause:** Citation URLs don't exactly match the URLs stored in cache (different formatting, parameters, etc.).

**Solution:**
1. Check sample URLs from Step 2 vs cached URLs
2. Look for differences (www. prefix, trailing slash, URL parameters)
3. May need to normalize URLs before caching

### Issue 4: "Low cache hit rate (< 30%)"
**Cause:** Most URLs haven't been processed yet or cache was cleared.

**Solution:**
1. Run the extract-recency-scores function manually (see Issue 1)
2. Wait for async processing to complete (can take several minutes)
3. Re-run diagnostics after 5-10 minutes

## Technical Details

### Relevance Calculation
```typescript
// In useDashboardData.ts (line 1263-1266)
const averageRelevance = recencyData.length > 0 
  ? recencyData.reduce((sum, item) => sum + (item.recency_score || 0), 0) / recencyData.length 
  : 0;
```

### fetchRecencyData Process
1. Get all URLs from citations
2. Query url_recency_cache in batches of 25 URLs
3. Filter for non-null recency_score values
4. Calculate average score
5. If 0 matches found → averageRelevance = 0

### extract-recency-scores Function
- Triggered automatically during onboarding (batched at end)
- Triggered when storing prompt responses
- Triggered when storing search results
- Uses Firecrawl API to scrape content for dates
- Falls back to URL pattern matching
- Caches results to avoid duplicate API calls

## Files Modified

1. **src/components/admin/RelevanceDebugger.tsx** (NEW)
   - Comprehensive diagnostic component
   - 6-step validation process
   - Color-coded results with detailed JSON output

2. **src/pages/Admin.tsx**
   - Added "Debug Relevance" tab
   - Added debug modal
   - Import RelevanceDebugger component

3. **This guide** (RELEVANCE_SCORE_DEBUG_GUIDE.md)

## Next Steps

1. **Run diagnostics on all companies** showing 0% relevance
2. **Identify common patterns** (are they all missing cache data? all problematic domains?)
3. **Fix systematic issues** (e.g., if cache is empty for everyone, trigger extraction)
4. **Monitor over time** to ensure scores update correctly

## Expected Outcomes

After running diagnostics, you should see one of these scenarios:

### Scenario A: Cache is Empty (Most Likely)
- **Step 3** will show "No URLs found in url_recency_cache"
- **Action:** Manually trigger extract-recency-scores for affected companies
- **Timeline:** Scores should update within 10-15 minutes

### Scenario B: Scores are NULL
- **Step 3** will show cached URLs but NULL scores
- **Action:** Review extraction_method distribution
- **Timeline:** May need to re-run extraction with debugging enabled

### Scenario C: URL Mismatch
- **Step 5** will show "fetchRecencyData would return 0 matches"
- **Action:** Investigate URL normalization issues
- **Timeline:** May require code changes to URL handling

### Scenario D: Everything Works
- **All steps** will show success ✅
- **Action:** Check if user needs to refresh dashboard or clear cache
- **Timeline:** Immediate

## Contact

If you discover a systematic issue affecting all companies, please document:
1. Which diagnostic step failed
2. The specific error message
3. Details JSON from that step
4. Company ID(s) affected

This information will help identify and fix root causes quickly.

