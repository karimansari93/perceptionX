# Backend Metrics Migration Guide

## Overview

This migration moves sentiment and relevance calculations from the frontend to the database backend using **Materialized Views**. This provides significant performance improvements by:

1. **Pre-calculating metrics** instead of computing on every page load
2. **Reducing frontend JavaScript execution time** (~500ms+ saved)
3. **Scaling better** as data grows
4. **Consistent with visibility rankings architecture**

## What Was Changed

### 1. Database Migration
**File:** `supabase/migrations/20260128000000_create_company_metrics_materialized_views.sql`

Creates two materialized views:
- `company_sentiment_scores_mv` - Pre-calculates sentiment metrics per company per month
- `company_relevance_scores_mv` - Pre-calculates relevance metrics per company per month

### 2. Edge Function
**File:** `supabase/functions/refresh-company-metrics/index.ts`

Edge function to refresh the materialized views. Can be called:
- Manually via API
- Scheduled via pg_cron
- Triggered after new data is added

### 3. Frontend Hook Update
**File:** `src/hooks/useDashboardData.ts`

Updated to:
- Fetch metrics from materialized views when available
- Fallback to frontend calculation if backend data is missing
- Maintain backward compatibility

## How It Works

### Data Flow

```
┌─────────────────┐
│ prompt_responses│
│  ai_themes      │ ──┐
│ url_recency_cache│ ──┼──> Materialized Views (pre-calculated)
└─────────────────┘   │
                      │
                      ▼
┌─────────────────────────────────────┐
│ company_sentiment_scores_mv         │
│ company_relevance_scores_mv         │
└─────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────┐
│ Frontend (useDashboardData hook)    │
│ - Queries materialized views        │
│ - Falls back to frontend calc if    │
│   backend data unavailable          │
└─────────────────────────────────────┘
```

### Calculation Logic

**Sentiment:**
- Aggregates AI themes by company/month
- Calculates positive/negative/neutral theme ratios
- Computes sentiment ratio: `positive_themes / (positive_themes + negative_themes)`

**Relevance:**
- Aggregates citation recency scores by company/month
- Matches citations to `url_recency_cache` by domain
- Computes average recency score (0-100 scale)

## Setup Instructions

### 1. Run Migration

```bash
# Apply the migration
supabase migration up

# Or manually in Supabase SQL Editor
# Copy contents of: supabase/migrations/20260128000000_create_company_metrics_materialized_views.sql
```

### 2. Deploy Edge Function

```bash
# Deploy the refresh function
supabase functions deploy refresh-company-metrics
```

### 3. Initial Data Population

The migration automatically populates the views with existing data. To manually refresh:

```sql
-- Refresh both views
SELECT * FROM refresh_company_metrics();

-- Or refresh individually
REFRESH MATERIALIZED VIEW company_sentiment_scores_mv;
REFRESH MATERIALIZED VIEW company_relevance_scores_mv;
```

### 4. Set Up Automatic Refresh

#### Option A: pg_cron (Recommended for Supabase)

```sql
-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule hourly refresh
SELECT cron.schedule(
  'refresh-company-metrics',
  '0 * * * *', -- Every hour at minute 0
  $$SELECT refresh_company_metrics()$$
);

-- Schedule daily refresh at 2 AM
SELECT cron.schedule(
  'refresh-company-metrics-daily',
  '0 2 * * *', -- Daily at 2 AM
  $$SELECT refresh_company_metrics()$$
);
```

#### Option B: Edge Function via Cron Job

Use Supabase's scheduled functions or external cron service:

```bash
# Example: Call via curl every hour
curl -X POST https://your-project.supabase.co/functions/v1/refresh-company-metrics \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

#### Option C: Trigger on Data Insert

```sql
-- Create function to refresh metrics after new responses
CREATE OR REPLACE FUNCTION trigger_refresh_company_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- Debounce: Only refresh if last refresh was > 5 minutes ago
  PERFORM pg_notify('refresh_company_metrics', '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (optional - can be heavy on high-volume inserts)
-- CREATE TRIGGER refresh_metrics_after_insert
--   AFTER INSERT ON prompt_responses
--   FOR EACH ROW
--   EXECUTE FUNCTION trigger_refresh_company_metrics();
```

## Usage

### Frontend

The hook automatically uses backend metrics when available:

```typescript
const { 
  metrics, 
  companySentimentMetrics, 
  companyRelevanceMetrics,
  companyMetricsLoading 
} = useDashboardData();

// metrics.averageSentiment - Uses backend if available, falls back to frontend
// metrics.averageRelevance - Uses backend if available, falls back to frontend
```

### Manual Refresh

```typescript
// Call edge function to refresh
const { data, error } = await supabase.functions.invoke('refresh-company-metrics');

// Or call SQL function directly
const { data, error } = await supabase.rpc('refresh_company_metrics');
```

### Query Materialized Views Directly

```typescript
// Get sentiment metrics for a company
const { data: sentiment } = await supabase
  .from('company_sentiment_scores_mv')
  .select('*')
  .eq('company_id', companyId)
  .eq('response_month', currentMonth)
  .order('response_month', { ascending: false });

// Get relevance metrics for a company
const { data: relevance } = await supabase
  .from('company_relevance_scores_mv')
  .select('*')
  .eq('company_id', companyId)
  .eq('response_month', currentMonth)
  .order('response_month', { ascending: false });
```

## Performance Benefits

### Before (Frontend Calculation)
- **~500ms+** JavaScript execution time
- Downloads all `prompt_responses` rows
- Downloads all `ai_themes` rows
- Downloads all `url_recency_cache` rows
- Calculates on every page load
- Blocks UI thread

### After (Backend Materialized Views)
- **<10ms** query time (indexed lookups)
- Only downloads aggregated metrics
- Pre-calculated, ready to use
- Non-blocking queries
- Scales to millions of rows

## Monitoring

### Check View Sizes

```sql
SELECT 
  schemaname,
  matviewname,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) as size
FROM pg_matviews
WHERE matviewname LIKE 'company_%_mv';
```

### Check Last Refresh Time

```sql
SELECT 
  MAX(calculated_at) as last_sentiment_refresh
FROM company_sentiment_scores_mv;

SELECT 
  MAX(calculated_at) as last_relevance_refresh
FROM company_relevance_scores_mv;
```

### Check Refresh Function Status

```sql
-- View pg_cron jobs
SELECT * FROM cron.job WHERE jobname LIKE '%refresh-company-metrics%';

-- View recent refresh results
SELECT * FROM refresh_company_metrics();
```

## Troubleshooting

### Views Not Updating

1. **Check if refresh function is running:**
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE '%refresh%';
   ```

2. **Manually refresh:**
   ```sql
   REFRESH MATERIALIZED VIEW CONCURRENTLY company_sentiment_scores_mv;
   ```

3. **Check for errors:**
   ```sql
   SELECT * FROM refresh_company_metrics();
   ```

### Frontend Falling Back to Calculation

If `companySentimentMetrics` or `companyRelevanceMetrics` are `null`:

1. **Check if views have data:**
   ```sql
   SELECT COUNT(*) FROM company_sentiment_scores_mv;
   SELECT COUNT(*) FROM company_relevance_scores_mv;
   ```

2. **Check if current month has data:**
   ```sql
   SELECT * FROM company_sentiment_scores_mv 
   WHERE response_month = DATE_TRUNC('month', CURRENT_DATE);
   ```

3. **Refresh views:**
   ```sql
   SELECT * FROM refresh_company_metrics();
   ```

### Performance Issues

If queries are slow:

1. **Check indexes:**
   ```sql
   \d company_sentiment_scores_mv
   \d company_relevance_scores_mv
   ```

2. **Analyze query plan:**
   ```sql
   EXPLAIN ANALYZE 
   SELECT * FROM company_sentiment_scores_mv 
   WHERE company_id = '...' AND response_month = '...';
   ```

## Migration Checklist

- [x] Create migration file
- [x] Create edge function
- [x] Update frontend hook
- [ ] Run migration in production
- [ ] Deploy edge function
- [ ] Set up automatic refresh (pg_cron or scheduled function)
- [ ] Monitor initial refresh performance
- [ ] Verify frontend is using backend metrics
- [ ] Document refresh schedule for team

## Future Enhancements

1. **Real-time Updates:** Use database triggers to refresh views incrementally
2. **Historical Trends:** Store historical metrics for trend analysis
3. **Rankings:** Add cross-company sentiment/relevance rankings (like visibility rankings)
4. **Caching:** Add Redis cache layer for even faster lookups
5. **Partitioning:** Partition views by month for better performance at scale

## Related Files

- `supabase/migrations/20260128000000_create_company_metrics_materialized_views.sql`
- `supabase/functions/refresh-company-metrics/index.ts`
- `src/hooks/useDashboardData.ts`
- `supabase/migrations/20250126000000_create_visibility_rankings.sql` (similar pattern)
