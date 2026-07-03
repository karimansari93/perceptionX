-- Drop stale backup table public.ford_energy_split_backup_20260625.
-- A one-off backup (created 2026-06-25) left in the public schema. RLS was enabled so it was
-- not publicly exposed, but nothing in the application code references it, so it is removed as
-- cleanup alongside the ford_tested_at_backup_20260520 drop.
DROP TABLE IF EXISTS public.ford_energy_split_backup_20260625;
