# Duplicate Prevention Strategy for Onboarding Flow

## Overview
This document outlines the comprehensive strategy implemented to prevent duplicate rows from being created in the onboarding flow tables: `profiles`, `confirmed_prompts`, and `prompt_responses`.

## Problem Statement
The onboarding flow was creating duplicate rows in several scenarios:
1. **Multiple onboarding sessions** creating duplicate `user_onboarding` records
2. **Repeated prompt generation** creating duplicate `confirmed_prompts`
3. **Retry mechanisms** creating duplicate `prompt_responses`
4. **Race conditions** in profile creation

## Solution Components

### 1. Application-Level Prevention

#### Profiles Table
- **File**: `src/hooks/useSubscription.ts`
- **Change**: Replaced `insert` with `upsert` operation
- **Benefit**: Prevents duplicate profiles even under race conditions
- **Code**:
```typescript
.upsert({
  id: user.id,
  email: user.email,
  // ... other fields
}, {
  onConflict: 'id',
  ignoreDuplicates: false
})
```

#### User Onboarding Table
- **File**: `src/pages/Onboarding.tsx`
- **Change**: Added check for existing onboarding records before creation
- **Benefit**: Reuses existing onboarding data instead of creating duplicates
- **Code**:
```typescript
// Check if user already has an onboarding record
const { data: existingOnboarding } = await supabase
  .from('user_onboarding')
  .select('id, company_name, industry')
  .eq('user_id', user?.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

if (existingOnboarding) {
  setOnboardingId(existingOnboarding.id);
} else {
  // Create new record only if none exists
}
```

#### Confirmed Prompts Table
- **File**: `src/pages/OnboardingLoading.tsx`
- **Change**: Added check for existing prompts before insertion
- **Benefit**: Prevents duplicate prompt sets for the same onboarding session
- **Code**:
```typescript
// Check if prompts already exist for this onboarding session
const { data: existingPrompts } = await supabase
  .from('confirmed_prompts')
  .select('id, prompt_text, prompt_type')
  .eq('onboarding_id', onboardingId);

if (!existingPrompts || existingPrompts.length === 0) {
  // Only create prompts if they don't exist
}
```

#### Prompt Responses Table
- **File**: `src/pages/OnboardingLoading.tsx`
- **Change**: Added check for existing responses before processing
- **Benefit**: Prevents duplicate responses for the same prompt and AI model
- **Code**:
```typescript
// Check if response already exists for this prompt and model
const { data: existingResponse } = await supabase
  .from('prompt_responses')
  .select('id')
  .eq('confirmed_prompt_id', confirmedPrompt.id)
  .eq('ai_model', model.name)
  .single();

if (existingResponse) {
  // Skip if response already exists
  continue;
}
```

### 2. Database-Level Prevention

#### Unique Constraints
- **File**: `supabase/migrations/20250103000007_prevent_duplicate_rows.sql`
- **Constraints Added**:
  1. `unique_user_onboarding_per_user` - One onboarding record per user
  2. `unique_prompt_per_onboarding` - One prompt per type per onboarding session
  3. `unique_response_per_prompt_model` - One response per prompt per AI model
  4. `unique_talentx_analysis` - One analysis per attribute per AI model

#### Performance Indexes
- **Indexes Created**:
  1. `idx_user_onboarding_user_id_unique`
  2. `idx_confirmed_prompts_onboarding_type_unique`
  3. `idx_prompt_responses_prompt_model_unique`
  4. `idx_talentx_scores_user_attribute_model_unique`

### 3. Data Cleanup

#### Cleanup Script
- **File**: `scripts/cleanup-duplicate-data.sql`
- **Purpose**: Remove existing duplicate data before applying constraints
- **Tables Cleaned**:
  1. `user_onboarding` - Keep most recent per user
  2. `confirmed_prompts` - Keep first created per type
  3. `prompt_responses` - Keep first created per model
  4. `talentx_perception_scores` - Keep first created per analysis

#### Cleanup Function
- **File**: `supabase/migrations/20250103000007_prevent_duplicate_rows.sql`
- **Function**: `cleanup_duplicate_onboarding_data()`
- **Purpose**: Programmatic cleanup of duplicate data

## Implementation Order

### Phase 1: Application Changes (Immediate)
1. ✅ Update `useSubscription.ts` with upsert logic
2. ✅ Update `Onboarding.tsx` with duplicate checking
3. ✅ Update `OnboardingLoading.tsx` with duplicate prevention

### Phase 2: Data Cleanup (Before Migration)
1. Run `scripts/cleanup-duplicate-data.sql` in Supabase SQL Editor
2. Verify no duplicates remain

### Phase 3: Database Constraints (After Cleanup)
1. Run `supabase/migrations/20250103000007_prevent_duplicate_rows.sql`
2. Verify constraints are applied successfully

## Testing Scenarios

### 1. Multiple Onboarding Sessions
- **Test**: User completes onboarding, then starts again
- **Expected**: Reuse existing onboarding data, no duplicates created
- **Verification**: Check `user_onboarding` table for single record per user

### 2. Prompt Regeneration
- **Test**: User navigates back and forth between onboarding steps
- **Expected**: Existing prompts reused, no new prompts created
- **Verification**: Check `confirmed_prompts` table for single prompt per type

### 3. Response Retries
- **Test**: Network issues cause retry of AI model testing
- **Expected**: Existing responses skipped, no duplicates created
- **Verification**: Check `prompt_responses` table for single response per model

### 4. Race Conditions
- **Test**: Multiple simultaneous profile creation attempts
- **Expected**: Single profile created via upsert
- **Verification**: Check `profiles` table for single record per user

## Monitoring and Maintenance

### Regular Checks
- Monitor for constraint violations in application logs
- Check database performance with new indexes
- Verify data integrity across tables

### Future Improvements
- Add database triggers for additional validation
- Implement soft deletes for audit trails
- Add data quality monitoring dashboards

## Rollback Plan

If issues arise with the constraints:
1. Drop the unique constraints
2. Revert to application-level prevention only
3. Investigate constraint conflicts
4. Reapply with modified constraints if needed

## Benefits

1. **Data Integrity**: Prevents duplicate records at multiple levels
2. **Performance**: Faster queries with proper indexing
3. **User Experience**: Consistent onboarding flow without data conflicts
4. **Maintenance**: Easier debugging and data analysis
5. **Scalability**: Better performance as user base grows

## Conclusion

This comprehensive duplicate prevention strategy addresses the root causes of data duplication while maintaining system performance and user experience. The multi-layered approach ensures data integrity even under edge cases and race conditions.
