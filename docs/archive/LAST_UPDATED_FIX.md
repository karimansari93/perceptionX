# Last Updated Date Not Reflecting After Admin Refresh - FIXED

## Problem Summary

When refreshing data from the admin panel, the data was being collected successfully but the "Last collected" date in the dashboard was not updating to reflect the latest refresh.

## Root Cause

The fundamental issue is how prompts and responses are reused:

1. **Prompts are Reused**: `confirmed_prompts` are created once per company and don't have a `tested_at` timestamp. The same prompts are used every time you refresh.

2. **Responses are UPDATED, Not Recreated**: When you refresh from the admin panel:
   - The `analyze-response` function checks if a response already exists for that prompt + AI model combination
   - If it exists, it **UPDATES** the existing `prompt_responses` record (line 147-160 in analyze-response/index.ts)
   - If it doesn't exist, it creates a new one
   
3. **The `tested_at` Timestamp Wasn't Updating**: 
   - The `tested_at` column exists but had no trigger to update it on UPDATE operations
   - When admin refreshes data → records get UPDATED → `tested_at` stays at the original date
   - Dashboard shows "Last collected: [old date]" instead of "Just now"

4. **Code Robustness**: The dashboard code was querying `tested_at` but didn't have fallback logic in case this field wasn't properly maintained.

## Solution Applied

### 1. Database Migration (`supabase/migrations/20250114000000_fix_tested_at_column.sql`)

Created a new migration that:
- Ensures the `tested_at` column exists in `prompt_responses` table
- Populates any missing `tested_at` values with `updated_at`
- **Adds a trigger** that automatically updates `tested_at` to the current timestamp whenever a record is updated
- Adds a performance index on `tested_at` column

### 2. Code Improvements (`src/hooks/useDashboardData.ts`)

Updated the dashboard data hook to:
- Sort by `updated_at` instead of `tested_at` (more reliable)
- Add fallback logic when reading timestamps: `tested_at || updated_at || created_at`
- This ensures the code works even if `tested_at` is null for any reason

## How to Apply the Fix

### Step 1: Apply the Database Migration

Run the migration in your Supabase project:

```bash
# If using Supabase CLI
supabase db push

# Or manually run the SQL in your Supabase dashboard
# SQL Editor → New Query → Copy contents of:
# supabase/migrations/20250114000000_fix_tested_at_column.sql
```

### Step 2: Verify the Fix

1. Go to the admin panel
2. Select a company and click "Refresh"
3. Choose your LLM models and prompt types
4. Wait for the refresh to complete
5. Go to the company's dashboard
6. The "Last collected" date should now show the current date/time

## Technical Details

### The Trigger Function

```sql
CREATE OR REPLACE FUNCTION update_tested_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tested_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';
```

This trigger runs **before every UPDATE** on `prompt_responses`, automatically setting `tested_at` to the current timestamp.

### Query Changes

**Before:**
```typescript
.order('tested_at', { ascending: false })
```

**After:**
```typescript
.order('updated_at', { ascending: false })
```

And when reading the date:
```typescript
const lastUpdatedDate = new Date(
  mostRecentResponse.tested_at || 
  mostRecentResponse.updated_at || 
  mostRecentResponse.created_at
);
```

## Files Modified

1. ✅ `supabase/migrations/20250114000000_fix_tested_at_column.sql` (NEW)
2. ✅ `src/hooks/useDashboardData.ts` (UPDATED)

## Testing Checklist

- [x] Migration created with trigger
- [x] Code updated with fallback logic  
- [x] No linter errors
- [ ] Apply migration to database
- [ ] Test admin refresh
- [ ] Verify "Last collected" updates
- [ ] Test with multiple companies
- [ ] Test with Pro (TalentX) prompts

## Notes

- The fix is backward compatible - existing data will be migrated automatically
- The trigger ensures all future updates will have the correct `tested_at` timestamp
- The code fallback ensures resilience even if database issues occur

---

**Date:** January 14, 2025  
**Status:** Ready to apply

