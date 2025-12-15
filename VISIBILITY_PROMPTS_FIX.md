# Fix: Visibility Rankings Only Creating 6 Prompts Instead of 10

## Issue
The `collect-industry-visibility` function was only creating 6 Employee Experience visibility prompts instead of the expected 10.

**Expected themes (10 total):**
1. Mission & Purpose ✓
2. Rewards & Recognition ✓
3. Company Culture ✓
4. Social Impact ✓
5. Inclusion ✓
6. Innovation ✓
7. Wellbeing & Balance ❌ (missing)
8. Leadership ❌ (missing)
9. Security & Perks ❌ (missing)
10. Career Opportunities ❌ (missing)

## Root Cause

The function had several issues in how it checked for existing prompts:

1. **Used `.maybeSingle()`**: This method throws an error if multiple rows match, which could cause the function to skip creating prompts if duplicates existed
2. **Didn't check `location_context`**: The existence check didn't filter by `location_context`, which could lead to:
   - Missing prompts that have different `location_context` values
   - Attempting to create duplicates if prompts exist with different `location_context`
3. **Insufficient error logging**: Errors during prompt creation weren't logged with enough detail to diagnose issues

## Fix Applied

Updated `supabase/functions/collect-industry-visibility/index.ts`:

1. **Changed `.maybeSingle()` to `.limit(1)`**: This prevents errors when multiple matching prompts exist and allows the function to continue processing
2. **Added `location_context` filter**: Now explicitly checks for prompts with `location_context IS NULL` to match industry-wide prompts
3. **Improved error logging**: Added detailed error logging including error codes, details, and hints to help diagnose future issues
4. **Explicit `location_context` setting**: Now explicitly sets `location_context: null` when creating prompts to ensure consistency

## Testing

To verify the fix works:

1. Run the diagnostic script:
   ```sql
   -- Run scripts/debug-visibility-prompts-count.sql
   ```

2. Check that all 10 Employee Experience prompts exist for your industry:
   ```sql
   SELECT prompt_theme, COUNT(*) 
   FROM confirmed_prompts 
   WHERE prompt_type = 'visibility' 
     AND prompt_category = 'Employee Experience'
     AND industry_context = 'Aerospace'
     AND company_id IS NULL
   GROUP BY prompt_theme;
   ```

3. Re-run the collection function for your industry to create missing prompts:
   ```javascript
   // In admin panel or via edge function
   await supabase.functions.invoke('collect-industry-visibility', {
     body: { industry: 'Aerospace', country: 'US' }
   });
   ```

## Expected Behavior

After the fix:
- All 10 Employee Experience prompts should be created
- All 6 Candidate Experience prompts should be created
- Total: 16 industry-wide visibility prompts per industry
- Better error messages if any prompts fail to create

## Related Files

- `supabase/functions/collect-industry-visibility/index.ts` - Main function (fixed)
- `scripts/debug-visibility-prompts-count.sql` - Diagnostic script (new)
- `VISIBILITY_PROMPTS_REVIEW.md` - Original prompt documentation


