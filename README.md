# PerceptionX

## Project Structure

### Database Migrations
**Location**: `/supabase/migrations/`

All database schema changes are stored here as timestamped migration files. These are automatically applied when deploying to Supabase.

**Standard Format**: `YYYYMMDDHHMMSS_description.sql`

**Important**: Never edit existing migrations. Always create new migrations for schema changes.

### SQL Scripts
**Location**: `/scripts/`

One-off SQL scripts for:
- Data fixes and migrations
- Debugging queries
- Utility functions
- Testing scripts

These are run manually as needed, not automatically applied.

### Documentation
**Location**: `/docs/`

- `/docs/guides/` – User-facing guides and setup
- `/docs/deployment/` – Production and deployment checklists
- `/docs/debug/` – Debug and troubleshooting notes
- `/docs/scripts/` – Script-related readmes
- `/docs/archive/` – Historical fix summaries (reference only)

### Source Code
**Location**: `/src/`

Main application source code (React/TypeScript).

### Supabase Functions
**Location**: `/supabase/functions/`

Edge functions for backend logic.

## Quick Start

See `/docs/guides/QUICK_START_GUIDE.md` for setup instructions.

## Contributing

- Database changes: Create migrations in `/supabase/migrations/`
- Documentation: Add guides to `/docs/guides/`
- Scripts: Add utility scripts to `/scripts/`
