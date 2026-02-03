# Batch Processing Comparison: VisibilityRankingsTab vs CompanyManagementTab

## Overview

This document explains the key differences between how `VisibilityRankingsTab.tsx` efficiently processes prompts/responses versus how `CompanyManagementTab.tsx` does it (which is slower due to individual API calls).

## VisibilityRankingsTab Approach (Efficient) ✅

### Architecture
- **Single Backend Function**: Uses `collect-industry-visibility` edge function
- **Batch Processing**: Processes prompts in configurable batches (default: 1 prompt per batch)
- **Parallel Model Execution**: Runs multiple AI models in parallel using `Promise.all()`
- **Backend Orchestration**: All logic (API calls, analysis, storage) happens server-side

### Flow

```
Frontend (VisibilityRankingsTab.tsx)
  ↓
  Calls collect-industry-visibility with:
    - industry, country
    - batchOffset, batchSize
    - skipResponses flag
  ↓
Backend (collect-industry-visibility/index.ts)
  ↓
  PHASE 1: Create/Find Prompts
    - Creates or finds all prompts for industry/country
    - Returns prompts with IDs
  ↓
  PHASE 2: Collect Responses (if not skipped)
    - Processes batch: promptsWithIds.slice(startIndex, endIndex)
    - For each prompt in batch:
      - Checks existing responses per model
      - Runs missing models in PARALLEL (Promise.all)
        - OpenAI API call
        - Perplexity edge function call  
        - Google AI Overviews edge function call
      - Stores responses
      - Detects competitors
      - Updates database
```

### Key Code Locations

**Frontend** (`src/components/admin/VisibilityRankingsTab.tsx`):
- Lines 615-629: Initializes prompts with `skipResponses: true`
- Lines 641-687: Processes batches sequentially, calling backend function
- Line 649-661: Single function call per batch

**Backend** (`supabase/functions/collect-industry-visibility/index.ts`):
- Lines 691-698: Batch slicing logic
- Lines 707-975: Processes batch of prompts
- Lines 764-957: **PARALLEL model execution** using `Promise.all()`
- Lines 870-940: Stores responses and detects competitors in same function

### Performance Characteristics

- **HTTP Requests**: ~16 requests (one per batch) for 16 prompts
- **Parallelization**: 3 models run simultaneously per prompt
- **Backend Processing**: All orchestration happens server-side
- **Timeout Risk**: Mitigated by small batch sizes (1 prompt per batch)

## CompanyManagementTab Approach (Slow) ❌

### Architecture
- **Multiple Individual Calls**: Makes separate API calls for each prompt-model combination
- **Sequential Processing**: Processes prompts and models one at a time
- **Frontend Orchestration**: Frontend manages the entire flow

### Flow

```
Frontend (CompanyManagementTab.tsx)
  ↓
  For each prompt:
    For each model:
      ↓
      Call test-prompt-{model} edge function
      ↓
      Wait for response
      ↓
      Call analyze-response edge function
      ↓
      Wait for analysis
      ↓
      Next model...
    Next prompt...
```

### Key Code Locations

**Frontend** (`src/components/admin/CompanyManagementTab.tsx`):
- Lines 552-589: Sequential loop through prompts
- Lines 553-558: Individual API call per prompt-model
- Lines 566-578: Separate analyze-response call per combination
- Lines 592-627: Same pattern for TalentX prompts

### Performance Characteristics

- **HTTP Requests**: `prompts × models × 2` requests
  - Example: 10 prompts × 4 models × 2 = **80 HTTP requests**
- **No Parallelization**: All calls are sequential
- **Frontend Overhead**: Network latency × number of requests
- **Timeout Risk**: High due to many sequential calls

## Key Differences Summary

| Aspect | VisibilityRankingsTab | CompanyManagementTab |
|--------|----------------------|---------------------|
| **Backend Function** | Single function (`collect-industry-visibility`) | Multiple functions (`test-prompt-*`, `analyze-response`) |
| **Batch Processing** | ✅ Yes (configurable batch size) | ❌ No |
| **Parallel Execution** | ✅ Yes (models run in parallel) | ❌ No (sequential) |
| **HTTP Requests** | ~16 (one per batch) | 80+ (prompts × models × 2) |
| **Orchestration** | Backend | Frontend |
| **Timeout Risk** | Low (small batches) | High (many sequential calls) |

## Optimization Opportunities for CompanyManagementTab

To improve `CompanyManagementTab.tsx` performance, consider:

1. **Create a Batch Collection Function**: Similar to `collect-industry-visibility`
   - Accepts array of prompts and models
   - Processes them in batches
   - Runs models in parallel
   - Handles analysis and storage internally

2. **Backend Orchestration**: Move logic to edge function
   - Single function call from frontend
   - Backend handles all API calls, analysis, storage
   - Returns summary of results

3. **Parallel Processing**: Use `Promise.all()` for:
   - Multiple prompts processed simultaneously
   - Multiple models per prompt run in parallel
   - Analysis calls run in parallel

4. **Batch Size Configuration**: Allow configurable batch sizes
   - Smaller batches = lower timeout risk
   - Larger batches = fewer HTTP requests
   - Balance based on timeout limits

## Example: Optimized Company Refresh Function

```typescript
// Proposed: collect-company-responses edge function
// Frontend call:
await supabase.functions.invoke('collect-company-responses', {
  body: {
    companyId: '...',
    promptIds: [...], // Array of prompt IDs
    models: [...],     // Array of model names
    batchSize: 5       // Process 5 prompts at a time
  }
});

// Backend would:
// 1. Process prompts in batches
// 2. For each batch, run models in parallel
// 3. Analyze responses in parallel
// 4. Store results
// 5. Return summary
```

This would reduce 80+ HTTP requests to just a few batch requests, dramatically improving performance.

## Other Locations Using Slow Pattern

The following files also use the sequential, individual API call pattern and could benefit from batch processing:

1. **`src/hooks/useRefreshPrompts.ts`** (Lines 158-359)
   - Sequential loop through prompts and models
   - Individual `test-prompt-*` calls
   - Individual `analyze-response` calls
   - **Impact**: High - used for refreshing all user prompts

2. **`src/pages/OnboardingLoading.tsx`** (Lines 273-390)
   - Sequential processing during onboarding
   - Individual model function calls
   - Individual analysis calls
   - **Impact**: High - affects new user onboarding experience

3. **`src/hooks/usePromptsLogic.ts`** (Lines 518-599)
   - Sequential `testWithModel` calls
   - Individual API calls per prompt-model combination
   - **Impact**: Medium - used in prompt generation flow

## Recommended Migration Strategy

1. **Phase 1**: Create `collect-company-responses` edge function
   - Similar architecture to `collect-industry-visibility`
   - Support batch processing
   - Parallel model execution
   - Handle company-specific prompts

2. **Phase 2**: Migrate `CompanyManagementTab.tsx`
   - Replace `executeRefresh` with batch function call
   - Maintain same UI/UX
   - Measure performance improvement

3. **Phase 3**: Migrate `useRefreshPrompts.ts`
   - Update hook to use batch function
   - Maintain progress tracking
   - Improve user experience

4. **Phase 4**: Migrate onboarding flow
   - Update `OnboardingLoading.tsx`
   - Update `usePromptsLogic.ts`
   - Reduce onboarding time significantly

## Performance Impact Estimate

**Current State** (Sequential):
- 10 prompts × 4 models × 2 calls = 80 HTTP requests
- ~3-5 seconds per request = **4-6 minutes total**

**Optimized State** (Batch + Parallel):
- 2-3 batch requests (5 prompts per batch)
- Backend processes models in parallel
- **Estimated: 30-60 seconds total**

**Improvement: 8-12x faster** 🚀
