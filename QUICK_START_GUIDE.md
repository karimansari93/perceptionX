# Quick Start: Fix "Last Updated" Date & Enable Historical Tracking

## What This Fixes

✅ "Last collected" date now updates after admin refresh  
✅ Historical data is preserved (not overwritten)  
✅ Can compare different time periods  
✅ Full audit trail of all refreshes  

## 3-Step Installation

### Step 1: Apply Database Migrations

```bash
cd /Users/karimalansari/Downloads/perceptionX-main

# If using Supabase CLI:
supabase db push

# OR manually in Supabase Dashboard → SQL Editor:
# 1. Copy and run: supabase/migrations/20250114000000_fix_tested_at_column.sql
# 2. Copy and run: supabase/migrations/20250114000001_enable_historical_responses.sql
```

### Step 2: Deploy Edge Function

```bash
# Deploy the updated analyze-response function
supabase functions deploy analyze-response

# Or if using git deployment, just push your changes
git add .
git commit -m "Enable historical response tracking"
git push
```

### Step 3: Test It!

1. Open Admin Panel
2. Select a company
3. Click "Refresh"
4. Choose models and prompt types
5. Wait for completion
6. Go to company dashboard
7. **✅ "Last collected" should show current time**
8. Wait 5 minutes, refresh again
9. **✅ New responses created (not updated)**

---

## Verify It's Working

### In Supabase SQL Editor:

```sql
-- Check a company's response history
SELECT 
  confirmed_prompt_id,
  ai_model,
  tested_at,
  LEFT(response_text, 50) as preview
FROM prompt_responses
WHERE company_id = 'YOUR-COMPANY-ID'
ORDER BY confirmed_prompt_id, ai_model, tested_at DESC;

-- After 2 refreshes, you should see 2 rows per prompt+model combo
```

---

## What Changed

**Before:**
- Admin refresh → UPDATE existing record → Old data lost ❌
- `tested_at` never updated → Dashboard shows old date ❌

**After:**
- Admin refresh → INSERT new record → Historical data preserved ✅
- `tested_at` auto-updates → Dashboard shows latest date ✅

---

## New Features Available

Now that historical data is preserved, use these new functions:

```typescript
import { useDashboardData } from '@/hooks/useDashboardData';

const {
  responses,                    // Current (latest) data
  fetchHistoricalResponses,     // Get data from specific date range
  fetchCollectionDates,         // Get all refresh dates
} = useDashboardData();

// Example: Compare this month vs last month
const thisMonth = await fetchHistoricalResponses(
  new Date('2025-01-01'),
  new Date('2025-01-31')
);

const lastMonth = await fetchHistoricalResponses(
  new Date('2024-12-01'),
  new Date('2024-12-31')
);

// Example: Show timeline of refreshes
const dates = await fetchCollectionDates();
// Returns: ['2025-01-14', '2025-01-10', '2025-01-05', ...]
```

---

## Rollback (If Needed)

If you need to revert:

```sql
-- Re-add unique constraint (prevents historical tracking)
ALTER TABLE prompt_responses 
ADD CONSTRAINT unique_prompt_response_model 
UNIQUE (confirmed_prompt_id, ai_model);

-- Drop the view
DROP VIEW IF EXISTS latest_prompt_responses;

-- Remove trigger
DROP TRIGGER IF EXISTS update_prompt_responses_tested_at ON prompt_responses;
DROP FUNCTION IF EXISTS update_tested_at_on_update();
```

Then revert the edge function changes.

---

## Support

If you encounter issues:

1. Check migration output for errors
2. Verify edge function deployed successfully
3. Check browser console for errors
4. Run verification queries above
5. See full documentation in `HISTORICAL_DATA_IMPLEMENTATION.md`

---

**That's it!** 🎉 Your "Last Updated" date will now reflect the actual refresh time, and all historical data is preserved for analysis.





