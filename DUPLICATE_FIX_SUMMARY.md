# Duplicate Constraint Violation Fix Summary

## Problem Description
The application was experiencing database constraint violations with the error:
```
Error storing analysis: {
  code: "23505",
  details: "Key (confirmed_prompt_id, ai_model)=(468e0437-80a2-4de4-9b07-c5186b05e405, perplexity) already exists.",
  hint: null,
  message: 'duplicate key value violates unique constraint "unique_prompt_response_model"'
}
```

This error occurred because the database has a unique constraint `unique_prompt_response_model` on the `prompt_responses` table that prevents duplicate combinations of `confirmed_prompt_id` and `ai_model`.

## Root Causes Identified

1. **Multiple Code Paths**: The `analyze-response` function was being called from multiple places:
   - `OnboardingLoading.tsx` - during onboarding
   - `useRefreshPrompts.ts` - when refreshing prompts
   - `usePromptsLogic.ts` - during prompt testing

2. **No Duplicate Prevention**: None of these code paths checked if a response already existed before calling the function

3. **Fallback Mechanisms**: When analysis failed, there were direct database inserts that could also create duplicates

4. **Race Conditions**: Multiple simultaneous calls could lead to duplicate insertions

## Solutions Implemented

### 1. Enhanced Edge Function (`supabase/functions/analyze-response/index.ts`)

**Before**: Simple insert operation that would fail on duplicates
```typescript
const { data: promptResponse, error: insertError } = await supabase
  .from('prompt_responses')
  .insert(insertData)
  .select()
  .single();
```

**After**: Check for existing response and update if found, insert if not
```typescript
// Check if a response already exists for this prompt and model
const { data: existingResponse, error: checkError } = await supabase
  .from('prompt_responses')
  .select('id')
  .eq('confirmed_prompt_id', confirmed_prompt_id)
  .eq('ai_model', ai_model)
  .single();

if (existingResponse) {
  // Update existing response
  const { data: updatedResponse, error: updateError } = await supabase
    .from('prompt_responses')
    .update(insertData)
    .eq('id', existingResponse.id)
    .select()
    .single();
} else {
  // Insert new response
  const { data: newResponse, error: insertError } = await supabase
    .from('prompt_responses')
    .insert(insertData)
    .select()
    .single();
}
```

**TalentX Processing**: Added proper conflict resolution for `talentx_perception_scores` table
```typescript
.upsert({
  // ... data
}, {
  onConflict: 'user_id,attribute_id,prompt_type,ai_model'
});
```

### 2. Utility Functions (`src/lib/utils.ts`)

Added two new utility functions for centralized duplicate prevention:

#### `checkExistingPromptResponse()`
- Checks if a prompt response already exists for a given prompt and AI model
- Returns boolean indicating existence
- Handles database errors gracefully

#### `safeStorePromptResponse()`
- Safely stores or updates prompt responses
- Automatically checks for existing responses
- Updates existing responses or inserts new ones
- Prevents duplicates at the application level

### 3. Application-Level Duplicate Prevention

#### `OnboardingLoading.tsx`
- Added check before calling `analyze-response`
- Skips analysis if response already exists
- Prevents duplicate calls during onboarding

#### `useRefreshPrompts.ts`
- Added duplicate check before analysis
- Updated fallback mechanisms to use safe storage
- Prevents duplicate responses when refreshing prompts

#### `usePromptsLogic.ts`
- Added duplicate check before analysis
- Prevents duplicate responses during prompt testing

### 4. Fallback Mechanism Updates

All fallback mechanisms now use the `safeStorePromptResponse` utility instead of direct database inserts, ensuring that even when analysis fails, duplicates are prevented.

## Benefits of the Solution

1. **Prevents Duplicates**: Multiple layers of protection against duplicate data
2. **Graceful Handling**: Updates existing responses instead of failing
3. **Centralized Logic**: Single source of truth for duplicate prevention
4. **Performance**: Avoids unnecessary API calls and database operations
5. **User Experience**: No more error messages about constraint violations
6. **Data Integrity**: Maintains unique constraints while allowing updates

## Testing Recommendations

1. **Test Multiple Onboarding Sessions**: Ensure no duplicates are created
2. **Test Prompt Refresh**: Verify existing responses are updated, not duplicated
3. **Test Concurrent Operations**: Ensure race conditions don't create duplicates
4. **Test Error Scenarios**: Verify fallback mechanisms work without duplicates
5. **Test TalentX Prompts**: Ensure TalentX analysis doesn't create duplicates

## Monitoring

Monitor the application logs for:
- Duplicate prevention messages
- Successful response updates
- Any remaining constraint violations

The solution should eliminate the constraint violation errors while maintaining data integrity and improving user experience.
