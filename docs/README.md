# Documentation Organization

This directory contains all project documentation. Keep markdown and doc-related files here so the repo root stays clean for production.

## Structure

### `/docs/guides/`
**User-facing documentation** – setup and usage:
- `CLIENT_SETUP_GUIDE.md` – New client organization setup
- `QUICK_START_GUIDE.md` – Quick start
- `ADMIN_SETUP.md` – Admin panel setup
- `REFRESH_FUNCTIONALITY_GUIDE.md` – Refresh features

### `/docs/deployment/`
**Production & deployment** – checklists and summaries:
- `PRODUCTION_DEPLOYMENT_SUMMARY.md`
- `PRODUCTION_READINESS_CHECKLIST.md`
- `PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- `DEPLOYMENT_READY.md`
- `PRE_PRODUCTION_SUMMARY.md`

### `/docs/debug/`
**Debug & troubleshooting** – CORS, sentiment, missing responses:
- `DEBUG_CORS_EDGE_FUNCTIONS.md`
- `DEBUG_SENTIMENT_METRICS.md`
- `WHY_RESPONSES_MISSING_FROM_PROMPTS_TAB.md`

### `/docs/scripts/`
**Script-related docs** – readmes for `/scripts/` utilities:
- `ICON_DOWNLOAD_README.md`

### `/docs/archive/`
**Historical** – past fixes, summaries, and debug notes. Kept for reference, not actively maintained.

## Other Locations

- **Database migrations**: `/supabase/migrations/`
- **SQL scripts**: `/scripts/` – one-off fixes and utilities
- **Project overview**: `/README.md`
