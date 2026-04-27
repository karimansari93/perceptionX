# Dead Table Audit — Coordination Check

## Context

We (the perceptionX app) are cleaning up dead code ahead of a prod push. That audit turned up 23 tables in the shared Supabase DB that our codebase doesn't touch anymore — no imports, no migrations, no Supabase Edge Function references, sometimes not even in our generated types.

**Before we drop anything, we need to confirm your app isn't using them.** Our check can only speak for our own code; some of these tables hold real data which suggests a live producer somewhere, and you're the most likely source.

## What I verified on my side

For each candidate table, I checked:

- [x] No references in our `src/` TypeScript / TSX files
- [x] No references in our `supabase/migrations/` SQL files
- [x] No references in our `supabase/functions/` Edge Function code
- [x] No references in our generated `supabase/types.ts`
- [x] Whether any DB-side object (function, view, materialized view) references the table name in its definition

Tables with ZERO references anywhere (including DB side) = **Tier 1**. Tables with DB-side references but no code = **Tier 2** (may be part of your pipelines or a shared pg_cron job, hence this check).

## Tier 1 — dropping these unless you push back

Nothing on our side touches them. Please confirm your side doesn't either.

| Table | Rows | Size | Why suspicious |
|---|---|---|---|
| `company_snapshots` | 6,161 | 14 MB | Populated but no current writer/reader we can find |
| `company_branding` | 9,674 | 1.7 MB | Same |
| `directory_sources` | 93 | 248 kB | Small, empty-like |
| `directory_source_scores` | 141 | 216 kB | Same |
| `company_owned_domains` | 11 | 48 kB | Same |
| `known_sources` | 0 | 96 kB | Empty |
| `company_achievements` | 0 | 48 kB | Empty |
| `company_notification_requests` | 0 | 48 kB | Empty |
| `company_brand_assets` | 0 | 24 kB | Empty |

**Total: 9 tables, ~16.5 MB.** The populated ones (`company_snapshots`, `company_branding`) are the ones we care most about getting confirmation on — if you're writing or reading from either, the data matters.

## Tier 2 — NOT dropping without investigation

These have existing DB-side dependencies (function bodies reference them). We want to know whether the depending function is still wired into your side before deciding. Please flag any your app uses:

| Table | Rows | Size | DB objects referencing |
|---|---|---|---|
| `prompt_responses_with_prompts` | 28,709 | 61 MB | 1 function |
| `rankings_historical` | 20,659 | 28 MB | 3 functions |
| `rankings_overview` | 13,389 | 14 MB | 4 functions, 1 MV |
| `company_visibility_history` | 24,473 | 9.5 MB | 1 view |
| `company_canonical_names` | 23,412 | 7.5 MB | 1 function, 2 views, 2 MVs |
| `mv_company_mentions` | 50,305 | 6.8 MB | 2 functions |
| `company_employee_tiers` | 25,205 | 3.5 MB | 1 function, 1 view, 2 MVs |
| `company_overrides` | 7,342 | 1.9 MB | 1 view, 2 MVs |
| `company_search_index` | 5,298 | 728 kB | 2 functions |
| `mv_industry_stats` | 4,164 | 832 kB | 3 functions |
| `company_entity_classifications` | 953 | 408 kB | 2 functions |
| `company_industry_mappings` | 271 | 208 kB | 1 function |
| `company_variants` | 0 | 40 kB | 1 function |
| `company_master` | 0 | 80 kB | 1 function |

**Total: 14 tables, ~134 MB.** The large ones (`rankings_*`, `prompt_responses_with_prompts`) likely come from a legacy pipeline that stopped running — but if you're populating or reading from them, we need to know.

## What I'd like from you

1. **Quick grep on your side** — for each table name in both tables above, run `grep -r <table_name> .` in your app's repo. Give me back:
   - Tier 1 tables you actively use → don't drop those.
   - Tier 2 tables you actively use → don't drop those either.
   - Tables you don't recognize → I'll move to "safe to drop".

2. **Flag anything that pg_cron on your side populates.** If your app owns a cron job that inserts into any of these tables, it'll fail after we drop them. Same for triggers you own.

3. **Any objections to dropping any specific table**, for any reason (historical data you'd want to snapshot first, pending feature, etc.) — mention it.

## Proposed sequence once you confirm

1. Export anything we might want to keep as a CSV (especially `company_snapshots`, `company_branding`, `rankings_*` if they're decided to be dropped).
2. Apply a migration that:
   - Drops the approved Tier 1 tables
   - Drops the approved Tier 2 tables together with their dangling functions/views/MVs (CASCADE)
3. Verify via a post-deploy check that nothing broke.

## What I'm NOT proposing

- Any change to tables you might add via your own migrations.
- Any change to the core shared tables we actively use (`prompt_responses`, `confirmed_prompts`, `companies`, `organizations`, `organization_companies`, `organization_members`, `company_members`, `ai_themes`, `user_onboarding`, `profiles`, and the `company_*_mv` / `company_sentiment_scores_mv` / `company_relevance_scores_mv` materialized views that our dashboard reads).
- Any migration without your explicit sign-off on each table.

## Timeline

No rush on this. Anytime this week works; I'd rather wait two days for your review than roll back a drop later.

---

*Generated 2026-04-22 during the perceptionX pre-prod cleanup. Feel free to ask questions or ping me for any details on what we did or didn't check.*
