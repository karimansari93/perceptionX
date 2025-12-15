# Production Deployment Checklist
**Date:** January 31, 2025  
**Status:** 🔄 Ready for Review

## Pre-Deployment Checklist

### ✅ Code Quality & Build
- [x] **TypeScript:** No type errors (`npm run type-check` passes)
- [x] **Build:** Production build tested locally (`npm run build:prod`) - ✅ Fixed duplicate key error
- [x] **Linter:** No linter errors
- [ ] **Test:** Manual testing of critical user flows

### 📦 Git Status Review

#### Modified Files (Review Before Committing):
- `CLIENT_SETUP_GUIDE.md` - Documentation updates
- `PRODUCTION_FIXES_SUMMARY.md` - Production fixes documentation
- `PRODUCTION_READINESS_AUDIT.md` - Audit documentation
- `scripts/debug-thematic-analysis.sql` - Debug script
- `scripts/fix-industry-wide-company-ids.sql` - Fix script
- `scripts/verify-16-prompts-fix.sql` - Verification script
- `src/components/UserMenu.tsx` - Component changes
- `src/components/dashboard/AddCompanyModal.tsx` - Modal updates
- `src/components/dashboard/AddIndustryPromptModal.tsx` - Modal updates
- `src/components/dashboard/PromptsTab.tsx` - Tab component updates
- `src/components/dashboard/ResponseDetailsModal.tsx` - Modal updates
- `src/components/dashboard/ThematicAnalysisTab.tsx` - Tab updates
- `src/hooks/usePromptsLogic.ts` - Hook updates
- `src/pages/Dashboard.tsx` - Page updates
- `src/services/promptManagement.ts` - Service updates
- `supabase/functions/admin-add-candidate-prompts/index.ts` - Edge function updates
- `supabase/migrations/20250129000002_remove_career_site_tables.sql` - Migration
- `supabase/migrations/20250129000003_fix_duplicate_policies_confirmed_prompts.sql` - Migration
- `supabase/migrations/20250129000004_fix_rls_auth_function_performance.sql` - Migration

#### New Files (Untracked - Need to Commit):
- `FIX_MIXED_PROMPT_RESPONSES.md` - Documentation for prompt response fixes
- `scripts/create-sales-professionals-prompt-and-fix.sql` - Fix script
- `scripts/diagnose-mixed-prompt-responses.sql` - Diagnostic script
- `scripts/find-missing-prompts.sql` - Diagnostic script
- `scripts/fix-mixed-prompt-responses-comprehensive.sql` - Comprehensive fix script
- `scripts/fix-mixed-prompt-responses.sql` - Fix script
- `supabase/migrations/20250130000000_add_job_function_location_to_unique_index.sql` - **IMPORTANT MIGRATION**
- `supabase/migrations/20250131000000_remove_unique_constraint_on_prompts.sql` - **IMPORTANT MIGRATION**

### 🗄️ Database Migrations

#### Critical Migrations to Apply:
1. **20250130000000_add_job_function_location_to_unique_index.sql**
   - Adds job_function_context and location_context to unique index
   - Includes cleanup of duplicate prompts
   - **Action:** Review and apply to production

2. **20250131000000_remove_unique_constraint_on_prompts.sql**
   - Removes unique constraint entirely
   - Allows users full control over prompt creation
   - **Action:** Review and apply to production

#### Migration Order:
- Apply migrations in chronological order
- Test migrations on staging first
- Backup database before applying migrations

### 🔐 Environment Variables

#### Required Production Environment Variables:
- [ ] `VITE_SUPABASE_URL` - Production Supabase project URL
- [ ] `VITE_SUPABASE_ANON_KEY` - Production Supabase anon key
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` - Production Stripe key (if using payments)
- [ ] `VITE_ENABLE_CRISP_CHAT` - Chat widget configuration
- [ ] `NODE_ENV=production` - Production environment flag

#### Edge Function Environment Variables:
- [ ] Verify all edge function secrets are set in Supabase dashboard
- [ ] Check service role keys are configured
- [ ] Verify API keys for external services

### 🚀 Deployment Steps

#### 1. Pre-Deployment
- [ ] Review all modified files
- [ ] Commit all changes with descriptive messages
- [ ] Create a release branch (if using GitFlow)
- [ ] Tag the release version
- [ ] Run final production build locally
- [ ] Test production build locally (`npm run preview`)

#### 2. Database Migration
- [ ] Backup production database
- [ ] Apply migrations in order:
  - [ ] `20250130000000_add_job_function_location_to_unique_index.sql`
  - [ ] `20250131000000_remove_unique_constraint_on_prompts.sql`
- [ ] Verify migrations applied successfully
- [ ] Run verification queries to ensure data integrity

#### 3. Frontend Deployment
- [ ] Deploy frontend build to hosting platform
- [ ] Verify environment variables are set correctly
- [ ] Test authentication flow
- [ ] Test critical user flows:
  - [ ] User login/signup
  - [ ] Dashboard loading
  - [ ] Prompt creation
  - [ ] Response viewing
  - [ ] Thematic analysis
  - [ ] Company management

#### 4. Edge Functions Deployment
- [ ] Deploy updated edge functions:
  - [ ] `admin-add-candidate-prompts`
- [ ] Verify edge functions are working
- [ ] Test edge function endpoints

#### 5. Post-Deployment Verification
- [ ] Monitor error logs
- [ ] Check application performance
- [ ] Verify all features working
- [ ] Test on multiple browsers/devices
- [ ] Monitor API usage and rate limits

### 📋 Critical Issues to Address

#### Before Production:
1. ✅ **Build Error Fixed:**
   - Fixed duplicate key "AE" in `usePromptsLogic.ts`
   - Production build now passes successfully
   - **Status:** ✅ Resolved

2. **Migration Conflict:**
   - Migration `20250130000000` adds unique constraint
   - Migration `20250131000000` removes unique constraint
   - **Action:** Review if both are needed or if one supersedes the other
   - **Note:** Migration 20250131000000 appears to supersede 20250130000000 (removes constraint entirely)

3. **Mixed Prompt Responses:**
   - Documentation exists for fixing mixed prompt responses
   - Scripts available for diagnosis and fixes
   - **Action:** Review if fixes need to be applied before deployment

4. **Console Logs:**
   - Some debug console.log statements remain
   - Critical error/warn statements have been replaced with logger
   - **Action:** Low priority, but consider cleanup

### 🔍 Testing Checklist

#### Critical User Flows:
- [ ] User authentication (login/signup)
- [ ] Company onboarding
- [ ] Prompt creation and management
- [ ] Response generation and viewing
- [ ] Thematic analysis
- [ ] Dashboard data loading
- [ ] Error handling and recovery

#### Edge Cases:
- [ ] Network failures
- [ ] Invalid data handling
- [ ] Permission errors
- [ ] Rate limiting
- [ ] Large data sets

### 📊 Monitoring & Alerts

#### Post-Deployment Monitoring:
- [ ] Set up error tracking (Sentry/LogRocket)
- [ ] Monitor API usage and rate limits
- [ ] Track database performance
- [ ] Monitor edge function execution
- [ ] Set up alerts for critical errors
- [ ] Monitor user session health

### 📝 Rollback Plan

#### If Issues Occur:
1. **Frontend Rollback:**
   - Revert to previous deployment
   - Update environment variables if needed

2. **Database Rollback:**
   - Restore database backup
   - Revert migrations if necessary

3. **Edge Function Rollback:**
   - Deploy previous version of edge functions

### ✅ Final Checklist

Before marking as "Production Ready":
- [ ] All migrations reviewed and tested
- [ ] Production build tested locally
- [ ] Environment variables verified
- [ ] Critical user flows tested
- [ ] Error handling verified
- [ ] Monitoring set up
- [ ] Rollback plan documented
- [ ] Team notified of deployment

---

## Notes

- **Migration Order:** Ensure migrations are applied in chronological order
- **Testing:** Test migrations on staging environment first
- **Backup:** Always backup database before applying migrations
- **Documentation:** Keep deployment notes for future reference

---

**Last Updated:** January 31, 2025  
**Next Review:** After deployment


