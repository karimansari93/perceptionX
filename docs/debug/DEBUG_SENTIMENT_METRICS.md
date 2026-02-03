# Debug: Sentiment / Relevance Not Showing for Company 0ae3a533

## Problem summary

- **Company ID:** `0ae3a533-518f-4096-a4da-5885d480a257`
- **Symptom:** Dashboard shows **0** for Sentiment (and no themes in themes card) when this company is selected, even after refresh.
- **User:** Is in `company_members` for this company as **owner** (`user_id`: `a6be7ef3-b700-472d-949e-b438f176258a`).

## Facts

1. **Materialized view has data:** When querying as **postgres/superuser** in SQL Editor:
   ```sql
   SELECT * FROM company_sentiment_scores_mv WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257' ORDER BY response_month DESC LIMIT 20;
   ```
   Returns **20 rows** with valid `sentiment_ratio`, `total_themes`, etc.

2. **Authenticated role sees nothing:** When running as `SET ROLE authenticated;` then the same query, result is **0 rows**.

3. **Another company works:** For company `f1a42f4d-a9d6-46e3-9d74-113e17f4db49`, the **same API** (REST request with user JWT) returns a full array of sentiment rows; dashboard shows sentiment for that company.

4. **RLS on MV not allowed:** PostgreSQL does **not** support `ALTER MATERIALIZED VIEW ... ENABLE ROW LEVEL SECURITY`, so we cannot use RLS on the MVs.

5. **Current fix attempt:** We created **views** `company_sentiment_scores` and `company_relevance_scores` that select from the MVs and filter with `WHERE EXISTS (SELECT 1 FROM company_members cm WHERE cm.company_id = mv.company_id AND cm.user_id = auth.uid())`. The frontend was switched to query these views instead of the MVs. **Still nothing** for company 0ae3a533.

6. **ai_themes:** `SELECT COUNT(*) FROM ai_themes WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257'` returns **0**. So frontend fallback (which uses `aiThemes`) has no data for this company either.

---

## Code to debug

### 1. Migration: Secure views (current approach)

**File:** `supabase/migrations/20260203000000_rls_company_metrics_mv.sql`

```sql
-- ============================================================================
-- Secure views over company metrics materialized views
-- ============================================================================
-- PostgreSQL does not support RLS on materialized views. So we create regular
-- views that filter by company_members so authenticated users see only rows
-- for companies they belong to. The app queries these views instead of the MVs.

-- Sentiment: view that exposes MV rows only for companies the user is a member of
CREATE OR REPLACE VIEW company_sentiment_scores AS
SELECT mv.*
FROM company_sentiment_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);

GRANT SELECT ON company_sentiment_scores TO authenticated;

COMMENT ON VIEW company_sentiment_scores IS
  'RLS-safe view over company_sentiment_scores_mv; use this for dashboard queries.';

-- Relevance: same
CREATE OR REPLACE VIEW company_relevance_scores AS
SELECT mv.*
FROM company_relevance_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);

GRANT SELECT ON company_relevance_scores TO authenticated;

COMMENT ON VIEW company_relevance_scores IS
  'RLS-safe view over company_relevance_scores_mv; use this for dashboard queries.';
```

### 2. Frontend: Fetching company metrics

**File:** `src/hooks/useDashboardData.ts`

**State (around lines 42–45):**
```ts
const [companySentimentMetrics, setCompanySentimentMetrics] = useState<any | null>(null);
const [companyRelevanceMetrics, setCompanyRelevanceMetrics] = useState<any | null>(null);
const [companyMetricsLoading, setCompanyMetricsLoading] = useState(false);
```

**fetchCompanyMetrics (lines 350–472):**
```ts
  // Fetch company metrics from materialized views (backend-calculated)
  const fetchCompanyMetrics = useCallback(async () => {
    if (!user || !currentCompany?.id) return;

    try {
      setCompanyMetricsLoading(true);

      // Fetch sentiment and relevance metrics from materialized views
      const [sentimentResult, relevanceResult] = await Promise.all([
        supabase
          .from('company_sentiment_scores')
          .select('*')
          .eq('company_id', currentCompany.id)
          .order('response_month', { ascending: false })
          .limit(100),
        supabase
          .from('company_relevance_scores')
          .select('*')
          .eq('company_id', currentCompany.id)
          .order('response_month', { ascending: false })
          .limit(100)
      ]);

      if (sentimentResult.error && sentimentResult.error.code !== 'PGRST116') {
        console.warn('Error fetching sentiment metrics from materialized view:', sentimentResult.error);
      } else if (sentimentResult.data && sentimentResult.data.length > 0) {
        const aggregated = sentimentResult.data.reduce((acc, row) => {
          acc.totalThemes += row.total_themes || 0;
          acc.positiveThemes += row.positive_themes || 0;
          acc.negativeThemes += row.negative_themes || 0;
          acc.neutralThemes += row.neutral_themes || 0;
          acc.totalSentimentScore += (row.avg_sentiment_score || 0) * (row.total_themes || 0);
          acc.totalWeight += row.total_themes || 0;
          return acc;
        }, {
          totalThemes: 0,
          positiveThemes: 0,
          negativeThemes: 0,
          neutralThemes: 0,
          totalSentimentScore: 0,
          totalWeight: 0
        });

        const sentimentRatio = (aggregated.positiveThemes + aggregated.negativeThemes) > 0
          ? aggregated.positiveThemes / (aggregated.positiveThemes + aggregated.negativeThemes)
          : 0;
        const avgSentimentScore = aggregated.totalWeight > 0
          ? aggregated.totalSentimentScore / aggregated.totalWeight
          : 0;

        if (aggregated.totalThemes > 0) {
          setCompanySentimentMetrics({
            sentiment_ratio: sentimentRatio,
            avg_sentiment_score: avgSentimentScore,
            total_themes: aggregated.totalThemes,
            positive_themes: aggregated.positiveThemes,
            negative_themes: aggregated.negativeThemes,
            neutral_themes: aggregated.neutralThemes
          });
        } else {
          setCompanySentimentMetrics(null);
        }
      } else {
        setCompanySentimentMetrics(null);
      }

      // ... relevance handled similarly, then setCompanyRelevanceMetrics ...
    } catch (error: any) {
      console.warn('Error fetching company metrics from materialized views:', error);
      setCompanySentimentMetrics(null);
      setCompanyRelevanceMetrics(null);
    } finally {
      setCompanyMetricsLoading(false);
    }
  }, [user, currentCompany?.id]);
```

### 3. Frontend: How metrics are used for the breakdown

**File:** `src/hooks/useDashboardData.ts` (metrics useMemo, ~lines 1457–1520)

- If `companySentimentMetrics` is set, `averageSentiment = companySentimentMetrics.sentiment_ratio` and counts are derived from `positive_themes` / `total_themes`, etc.
- If `companySentimentMetrics` is null, frontend falls back to computing from `aiThemes` + `responses` (only for prompt_type in experience/competitive/talentx_*). For this company `ai_themes` has 0 rows by `company_id`, so fallback also yields no sentiment.

**File:** `src/components/dashboard/OverviewTab.tsx` (breakdown, ~lines 189–205)

```ts
  const breakdowns = [
    {
      title: 'Sentiment',
      value: Math.round(metrics.averageSentiment * 100), // 0–100
      trend: metrics.sentimentTrendComparison,
      color: 'green',
      description: 'How positively your brand is perceived based on AI thematic analysis.'
    },
    // ...
  ];
```

So if the API returns no rows for `company_sentiment_scores` when `company_id = 0ae3a533`, `sentimentResult.data` is `[]`, `setCompanySentimentMetrics(null)` runs, and the breakdown shows 0.

### 4. Materialized view definition (sentiment)

**File:** `supabase/migrations/20260201000001_mv_prompt_types_four_intents.sql` (excerpt)

```sql
CREATE MATERIALIZED VIEW company_sentiment_scores_mv AS
WITH sentiment_responses AS (
  SELECT
    pr.id, pr.company_id, pr.tested_at,
    cp.prompt_type, cp.prompt_category, cp.prompt_theme,
    COALESCE(cp.industry_context, c.industry) as industry_context,
    DATE_TRUNC('month', pr.tested_at) as response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE cp.prompt_type IN (
    'experience', 'competitive', 'discovery', 'informational',
    'talentx_experience', 'talentx_competitive', 'talentx_discovery', 'talentx_informational'
  )
    AND pr.company_id IS NOT NULL
),
ai_themes_aggregated AS (
  SELECT
    sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context,
    COUNT(DISTINCT at.id) as total_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment_score > 0.1) as positive_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment_score < -0.1) as negative_themes,
    COUNT(DISTINCT at.id) FILTER (WHERE at.sentiment_score >= -0.1 AND at.sentiment_score <= 0.1) as neutral_themes,
    AVG(at.sentiment_score) as avg_sentiment_score
  FROM sentiment_responses sr
  LEFT JOIN ai_themes at ON sr.id = at.response_id
  GROUP BY sr.company_id, sr.response_month, sr.prompt_type, sr.prompt_category, sr.prompt_theme, sr.industry_context
)
SELECT
  company_id, response_month, prompt_type, prompt_category, prompt_theme, industry_context,
  total_themes, positive_themes, negative_themes, neutral_themes,
  CASE WHEN (positive_themes + negative_themes) > 0 THEN positive_themes::NUMERIC / (positive_themes + negative_themes) ELSE 0 END as sentiment_ratio,
  COALESCE(avg_sentiment_score, 0) as avg_sentiment_score,
  NOW() as calculated_at
FROM ai_themes_aggregated
WHERE total_themes > 0;
```

### 5. Refresh function (for context)

**File:** `supabase/migrations/20260128000000_create_company_metrics_materialized_views.sql` (excerpt)

```sql
CREATE OR REPLACE FUNCTION refresh_company_metrics()
RETURNS TABLE (view_name TEXT, refresh_started TIMESTAMPTZ, refresh_completed TIMESTAMPTZ, success BOOLEAN, error_message TEXT) AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY company_sentiment_scores_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY company_relevance_scores_mv;
  -- returns status rows
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION refresh_company_metrics() TO service_role;
```

---

## What to verify / try

1. **View + auth.uid() in Supabase/PostgREST:** When the dashboard calls `GET /rest/v1/company_sentiment_scores?company_id=eq.0ae3a533-...` with the user JWT, does PostgREST run the view with `auth.uid()` set to `a6be7ef3-b700-472d-949e-b438f176258a`? If `auth.uid()` is NULL or different when the view is evaluated, the `EXISTS (company_members ... auth.uid())` would filter out all rows.
2. **Direct view test in SQL:** In Supabase SQL Editor, simulate the authenticated user and query the view, e.g. set `request.jwt.claims` / role and run `SELECT * FROM company_sentiment_scores WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257'` and see if any rows return.
3. **RPC alternative:** Implement `get_company_sentiment_metrics(p_company_id uuid)` that checks `company_members` and `auth.uid()` inside the function, then returns `SELECT * FROM company_sentiment_scores_mv WHERE company_id = p_company_id`, and have the frontend call this RPC instead of querying the view. That guarantees the check runs in the same request context as the JWT.
4. **Network:** For the failing company, inspect the actual REST response for `company_sentiment_scores` (body and status). Confirm whether the API returns `[]` or an error.

Use this doc plus the snippets above to debug why company 0ae3a533 still gets no sentiment despite the view and membership.
