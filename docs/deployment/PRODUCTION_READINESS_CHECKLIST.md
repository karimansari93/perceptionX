# Production Deployment Readiness Checklist
**Date:** January 28, 2026  
**Status:** 🔄 Ready for Review

## ✅ Pre-Deployment Verification

### Code Quality
- [x] **TypeScript:** No type errors (`npm run type-check` passes)
- [x] **Build:** Production build tested locally (`npm run build:prod` passes)
- [ ] **Linter:** ESLint configuration issue (non-blocking, build works)
- [ ] **Test:** Manual testing of critical user flows

### Build Status
- ✅ Production build completes successfully
- ✅ Build output: ~1.07 MB main bundle (305 KB gzipped)
- ⚠️ Large chunk warning (acceptable for production)
- ✅ Console logs stripped in production build
- ✅ Minification enabled

---

## 📦 Git Status Review

### Files to Commit

#### Modified Files (M):
- `env.example` - Environment variable template
- `index.html` - HTML entry point
- `scripts/*.sql` - Various SQL scripts (diagnostic and fix scripts)
- `src/components/**/*.tsx` - Component updates
- `src/hooks/useDashboardData.ts` - Dashboard data hook
- `src/pages/*.tsx` - Page components
- `src/config/security.ts` - Security configuration
- `supabase/functions/**/*.ts` - Edge function updates
- `supabase/migrations/*.sql` - Database migrations

#### New Files (Untracked - ??):
- `README.md` - Project documentation
- `docs/` - Documentation directory
- `scripts/*.sql` - Additional SQL scripts
- `supabase/functions/refresh-company-metrics/` - New edge function
- `supabase/functions/search-companies/` - New edge function
- `supabase/migrations/20250201000000_add_company_id_to_ai_themes.sql`
- `supabase/migrations/20260128000000_create_company_metrics_materialized_views.sql`
- `supabase/migrations/20260128000001_add_performance_indexes.sql`

#### Deleted Files (D):
- Multiple documentation files (moved to `docs/archive/`)
- Legacy SQL scripts (moved to `scripts/`)
- Removed Stripe-related functions (`create-checkout-session`, `handle-subscription-change`)
- Removed admin chatbot function
- Removed DataChatTab component

---

## 🗄️ Database Migrations

### Critical Migrations to Apply (in order):

1. **20250129000002_remove_career_site_tables.sql**
   - Removes legacy career site tables
   - **Status:** Modified, review before applying

2. **20250129000003_fix_duplicate_policies_confirmed_prompts.sql**
   - Fixes duplicate RLS policies
   - **Status:** Modified, review before applying

3. **20250129000004_fix_rls_auth_function_performance.sql**
   - Performance optimization for RLS
   - **Status:** Modified, review before applying

4. **20250130000000_add_job_function_location_to_unique_index.sql**
   - Adds job_function_context and location_context to unique index
   - Includes cleanup of duplicate prompts
   - **Status:** Modified, review before applying

5. **20250131000000_remove_unique_constraint_on_prompts.sql**
   - Removes unique constraint entirely
   - Allows users full control over prompt creation
   - **Status:** Modified, review before applying
   - **Note:** This may supersede migration #4

6. **20250201000000_add_company_id_to_ai_themes.sql** ⭐ NEW
   - Adds company_id column to ai_themes table
   - Populates company_id from prompt_responses
   - Creates performance index
   - **Status:** Untracked, needs to be committed

7. **20260128000000_create_company_metrics_materialized_views.sql** ⭐ NEW
   - Creates materialized views for sentiment and relevance scores
   - Includes refresh function
   - **Status:** Untracked, needs to be committed
   - **Impact:** Performance optimization for dashboard queries

8. **20260128000001_add_performance_indexes.sql** ⭐ NEW
   - Adds composite indexes for common query patterns
   - Improves query performance significantly
   - **Status:** Untracked, needs to be committed

### Migration Checklist:
- [ ] Review all modified migrations for conflicts
- [ ] Test migrations on staging environment first
- [ ] Backup production database before applying
- [ ] Apply migrations in chronological order
- [ ] Verify migrations applied successfully
- [ ] Run verification queries to ensure data integrity
- [ ] Test materialized view refresh function

---

## 🔐 Environment Variables

### Required Production Environment Variables:

#### Frontend (Vite):
- [ ] `VITE_SUPABASE_URL` - Production Supabase project URL
- [ ] `VITE_SUPABASE_ANON_KEY` - Production Supabase anon key
- [ ] `VITE_ENABLE_CRISP_CHAT` - Chat widget configuration (true/false)
- [ ] `NODE_ENV=production` - Production environment flag

#### Edge Functions (Supabase Dashboard):
- [ ] `SUPABASE_URL` - Supabase project URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for admin operations)
- [ ] `OPENAI_API_KEY` - OpenAI API key (for AI functions)
- [ ] Verify all edge function secrets are set
- [ ] Check API keys for external services

### Environment Variable Validation:
- ✅ Frontend validates required env vars in production (`src/integrations/supabase/client.ts`)
- ✅ Edge functions validate configuration on startup

---

## 🚀 Deployment Steps

### 1. Pre-Deployment Preparation

- [ ] Review all modified files
- [ ] Commit all changes with descriptive messages
- [ ] Create a release branch (if using GitFlow)
- [ ] Tag the release version
- [ ] Run final production build locally
- [ ] Test production build locally (`npm run preview`)
- [ ] Review and organize git status (deleted/modified/untracked files)

### 2. Database Migration

- [ ] **Backup production database** (CRITICAL)
- [ ] Apply migrations in chronological order:
  - [ ] `20250129000002_remove_career_site_tables.sql`
  - [ ] `20250129000003_fix_duplicate_policies_confirmed_prompts.sql`
  - [ ] `20250129000004_fix_rls_auth_function_performance.sql`
  - [ ] `20250130000000_add_job_function_location_to_unique_index.sql`
  - [ ] `20250131000000_remove_unique_constraint_on_prompts.sql`
  - [ ] `20250201000000_add_company_id_to_ai_themes.sql`
  - [ ] `20260128000000_create_company_metrics_materialized_views.sql`
  - [ ] `20260128000001_add_performance_indexes.sql`
- [ ] Verify migrations applied successfully
- [ ] Run verification queries:
  ```sql
  -- Verify ai_themes has company_id populated
  SELECT COUNT(*) as total, COUNT(company_id) as with_company_id 
  FROM ai_themes;
  
  -- Verify materialized views exist
  SELECT * FROM company_sentiment_scores_mv LIMIT 1;
  SELECT * FROM company_relevance_scores_mv LIMIT 1;
  
  -- Test refresh function
  SELECT * FROM refresh_company_metrics();
  ```
- [ ] Set up scheduled refresh for materialized views (via pg_cron or edge function)

### 3. Edge Functions Deployment

- [ ] Deploy updated edge functions:
  - [ ] `admin-add-candidate-prompts`
  - [ ] `ai-thematic-analysis`
  - [ ] `ai-thematic-analysis-bulk`
  - [ ] `analyze-response`
  - [ ] `aspect-sentiment-openai`
  - [ ] `company-report`
  - [ ] `company-report-text`
  - [ ] `detect-competitors`
  - [ ] `generate-ai-report`
  - [ ] `test-prompt-openai`
  - [ ] `translate-prompts`
  - [ ] `refresh-company-metrics` ⭐ NEW
  - [ ] `search-companies` ⭐ NEW
- [ ] Verify edge functions are working
- [ ] Test edge function endpoints
- [ ] Verify environment variables are set for all functions

### 4. Frontend Deployment

- [ ] Build production bundle (`npm run build:prod`)
- [ ] Deploy frontend build to hosting platform
- [ ] Verify environment variables are set correctly
- [ ] Test authentication flow
- [ ] Test critical user flows:
  - [ ] User login/signup
  - [ ] Dashboard loading
  - [ ] Company switching
  - [ ] Prompt creation and management
  - [ ] Response viewing
  - [ ] Thematic analysis
  - [ ] Company management
  - [ ] Admin panel access
  - [ ] Materialized view data loading

### 5. Post-Deployment Verification

- [ ] Monitor error logs
- [ ] Check application performance
- [ ] Verify all features working
- [ ] Test on multiple browsers/devices
- [ ] Monitor API usage and rate limits
- [ ] Verify materialized views are refreshing correctly
- [ ] Check database query performance
- [ ] Monitor edge function execution times

---

## 📋 Critical Issues to Address

### Before Production:

1. **ESLint Configuration Issue**
   - ESLint config has a compatibility issue (non-blocking)
   - Build works correctly
   - **Action:** Can be fixed post-deployment

2. **Migration Review Required**
   - Several migrations have been modified
   - Need to verify no conflicts between migrations
   - **Action:** Review migrations #4 and #5 (constraint addition/removal)

3. **Large Bundle Size**
   - Main bundle is ~1.07 MB (305 KB gzipped)
   - Warning about chunk size
   - **Action:** Consider code splitting for future optimization

4. **Materialized Views Setup**
   - New materialized views need scheduled refresh
   - **Action:** Set up pg_cron job or scheduled edge function call

---

## 🔍 Testing Checklist

### Critical User Flows:
- [ ] User authentication (login/signup)
- [ ] Company onboarding
- [ ] Prompt creation and management
- [ ] Response generation and viewing
- [ ] Thematic analysis
- [ ] Dashboard data loading
- [ ] Company metrics display
- [ ] Error handling and recovery
- [ ] Admin panel access

### Edge Cases:
- [ ] Network failures
- [ ] Invalid data handling
- [ ] Permission errors
- [ ] Rate limiting
- [ ] Large data sets
- [ ] Materialized view refresh failures

---

## 📊 Monitoring & Alerts

### Post-Deployment Monitoring:
- [ ] Set up error tracking (Sentry/LogRocket)
- [ ] Monitor API usage and rate limits
- [ ] Track database performance
- [ ] Monitor edge function execution
- [ ] Set up alerts for critical errors
- [ ] Monitor user session health
- [ ] Track materialized view refresh status
- [ ] Monitor query performance improvements

---

## 📝 Rollback Plan

### If Issues Occur:

1. **Frontend Rollback:**
   - Revert to previous deployment
   - Update environment variables if needed

2. **Database Rollback:**
   - Restore database backup
   - Revert migrations if necessary (in reverse order)

3. **Edge Function Rollback:**
   - Deploy previous version of edge functions

4. **Materialized Views:**
   - Drop materialized views if causing issues:
     ```sql
     DROP MATERIALIZED VIEW IF EXISTS company_sentiment_scores_mv;
     DROP MATERIALIZED VIEW IF EXISTS company_relevance_scores_mv;
     DROP FUNCTION IF EXISTS refresh_company_metrics();
     ```

---

## ✅ Final Checklist

Before marking as "Production Ready":
- [ ] All migrations reviewed and tested on staging
- [ ] Production build tested locally
- [ ] Environment variables verified
- [ ] Critical user flows tested
- [ ] Error handling verified
- [ ] Monitoring set up
- [ ] Rollback plan documented
- [ ] Team notified of deployment
- [ ] Database backup completed
- [ ] Materialized views refresh schedule configured

---

## 📌 Notes

- **Migration Order:** Ensure migrations are applied in chronological order
- **Testing:** Test migrations on staging environment first
- **Backup:** Always backup database before applying migrations
- **Documentation:** Keep deployment notes for future reference
- **Materialized Views:** These are performance optimizations - ensure refresh schedule is set up
- **Performance:** New indexes should significantly improve query performance

---

**Last Updated:** January 28, 2026  
**Next Review:** After deployment
