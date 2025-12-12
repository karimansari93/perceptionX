# 🚀 Production Deployment - Ready Checklist

**Date:** January 31, 2025  
**Status:** ✅ Code Ready | ⚠️ Migrations Need Review

---

## ✅ Pre-Deployment Status

### Code Quality
- ✅ **TypeScript:** No errors (`npm run type-check` passes)
- ✅ **Build:** Production build successful (`npm run build:prod` passes)
- ✅ **Linter:** No errors
- ✅ **Bug Fix:** Fixed duplicate key "AE" in `usePromptsLogic.ts`

### Security
- ✅ No hardcoded secrets
- ✅ Environment variables properly configured
- ✅ Production-safe logger implemented

---

## ⚠️ Critical: Migration Review Required

### Migration Conflict Detected

You have **two migrations** that modify the same constraint:

1. **`20250130000000_add_job_function_location_to_unique_index.sql`**
   - Adds `job_function_context` and `location_context` to unique index
   - Includes cleanup of duplicate prompts
   - Reassigns responses from duplicates

2. **`20250131000000_remove_unique_constraint_on_prompts.sql`**
   - Removes unique constraint entirely
   - Allows full user control

### ⚠️ Decision Required

**Option A:** Apply both migrations sequentially
- Migration 1 runs cleanup, then Migration 2 removes constraint
- **Pros:** Cleanup happens before constraint removal
- **Cons:** More complex, cleanup may be unnecessary

**Option B:** Skip Migration 1, only apply Migration 2
- Just remove the constraint
- **Pros:** Simpler, cleaner
- **Cons:** No duplicate cleanup

**Option C:** Custom approach
- Review current database state
- Apply only what's needed

### Recommendation
If the goal is to remove constraints entirely (Migration 2), you may not need Migration 1. However, Migration 1 includes valuable cleanup logic. **Test on staging first** to decide.

---

## 📋 Git Status

### Modified Files (18)
- Documentation: 3 files
- Scripts: 3 files  
- Frontend: 10 files
- Edge functions: 1 file
- Migrations: 3 files

### New Files (8)
- Documentation: 1 file
- Scripts: 5 files
- Migrations: 2 files

### Recommended Commit Strategy

```bash
# 1. Documentation
git add PRODUCTION_*.md PRE_PRODUCTION_SUMMARY.md DEPLOYMENT_READY.md FIX_MIXED_PROMPT_RESPONSES.md CLIENT_SETUP_GUIDE.md
git commit -m "docs: Add production deployment documentation and readiness checklists"

# 2. Database migrations (review first!)
git add supabase/migrations/20250130000000_*.sql supabase/migrations/20250131000000_*.sql
git commit -m "feat: Update confirmed_prompts constraint handling"

# 3. Diagnostic scripts
git add scripts/*.sql
git commit -m "chore: Add diagnostic and fix scripts for prompt responses"

# 4. Frontend updates
git add src/components/**/*.tsx src/hooks/*.ts src/pages/*.tsx src/services/*.ts
git commit -m "feat: Update prompt management and dashboard components"

# 5. Edge functions
git add supabase/functions/admin-add-candidate-prompts/index.ts
git commit -m "feat: Update admin-add-candidate-prompts edge function"

# 6. Bug fix
git add src/hooks/usePromptsLogic.ts
git commit -m "fix: Remove duplicate country code entries"
```

---

## 🗄️ Database Migration Plan

### Step 1: Backup
```bash
# Always backup production database before migrations
```

### Step 2: Test on Staging
```bash
# Apply migrations to staging first
# Test all functionality
# Verify data integrity
```

### Step 3: Apply to Production
```bash
# Option A: Apply both migrations
supabase db push

# Option B: Apply only Migration 2
# Manually apply 20250131000000_remove_unique_constraint_on_prompts.sql

# Option C: Custom approach based on staging test results
```

### Step 4: Verify
```sql
-- Check that constraint is removed
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'confirmed_prompts';

-- Verify no data corruption
SELECT COUNT(*) FROM confirmed_prompts;
SELECT COUNT(*) FROM prompt_responses;
```

---

## 🌐 Environment Variables

### Required in Production:
- [ ] `VITE_SUPABASE_URL` - Production Supabase URL
- [ ] `VITE_SUPABASE_ANON_KEY` - Production anon key
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` - If using payments
- [ ] `VITE_ENABLE_CRISP_CHAT` - Chat widget config
- [ ] `NODE_ENV=production` - Environment flag

### Edge Function Secrets (Supabase Dashboard):
- [ ] Verify all edge function secrets are set
- [ ] Check service role keys
- [ ] Verify external API keys

---

## 🚀 Deployment Steps

### 1. Pre-Deployment
- [ ] Review all changes: `git diff`
- [ ] Commit changes (see strategy above)
- [ ] Create release branch/tag
- [ ] Push to remote

### 2. Database
- [ ] Backup production database
- [ ] Test migrations on staging
- [ ] Apply migrations to production
- [ ] Verify migrations successful

### 3. Frontend
- [ ] Build production bundle: `npm run build:prod`
- [ ] Deploy `dist/` folder
- [ ] Verify environment variables
- [ ] Test critical flows

### 4. Edge Functions
- [ ] Deploy updated functions
- [ ] Verify deployment
- [ ] Test endpoints

### 5. Post-Deployment
- [ ] Monitor error logs
- [ ] Check performance metrics
- [ ] Verify all features working
- [ ] Test on multiple browsers

---

## ✅ Testing Checklist

### Critical Flows:
- [ ] User authentication (login/signup)
- [ ] Company onboarding
- [ ] Prompt creation
- [ ] Response viewing
- [ ] Thematic analysis
- [ ] Dashboard loading
- [ ] Error handling

### Edge Cases:
- [ ] Network failures
- [ ] Invalid data
- [ ] Permission errors
- [ ] Rate limiting

---

## 📊 Risk Assessment

| Item | Risk Level | Status |
|------|-----------|--------|
| Code Quality | ✅ Low | Ready |
| Build | ✅ Low | Fixed |
| Migrations | ⚠️ Medium | Needs Review |
| Environment Config | ✅ Low | Verify |
| Edge Functions | ⚠️ Medium | Test |

---

## 🎯 Quick Start Commands

```bash
# 1. Review changes
git status
git diff

# 2. Test build
npm run build:prod

# 3. Type check
npm run type-check

# 4. Lint
npm run lint

# 5. Commit (after review)
# See commit strategy above

# 6. Deploy
# Follow deployment steps above
```

---

## 📝 Notes

- **Migration Conflict:** Review both migrations and decide on approach
- **Large Bundle:** Main bundle is 1.3MB - consider code splitting for future optimization
- **Console Logs:** Some debug logs remain (low priority)
- **Testing:** Test migrations on staging before production

---

## 🆘 Rollback Plan

If issues occur:

1. **Frontend:** Revert to previous deployment
2. **Database:** Restore from backup
3. **Edge Functions:** Deploy previous version

---

**Status:** ✅ Code Ready | ⚠️ Migrations Need Decision  
**Estimated Time:** 30-60 minutes (including testing)  
**Blockers:** None (migration review recommended)

---

**Next Action:** Review migration strategy and commit changes

