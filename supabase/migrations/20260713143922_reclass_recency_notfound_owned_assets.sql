-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713143922; this file was
-- back-filled afterwards and therefore post-dates the deployment.


update public.url_recency_cache c
set extraction_method = 'owned-asset', recency_score = 93
from public.url_recency_cache_reclass_backup_2026_07 b
where c.id = b.id
  and b.target_method = 'owned-asset'
  and c.extraction_method in ('not-found','problematic-domain')
  and c.manually_reviewed_at is null;

