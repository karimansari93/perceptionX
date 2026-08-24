-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713143936; this file was
-- back-filled afterwards and therefore post-dates the deployment.


update public.url_recency_cache c
set extraction_method = 'social-post', recency_score = null
from public.url_recency_cache_reclass_backup_2026_07 b
where c.id = b.id
  and b.target_method = 'social-post'
  and c.extraction_method in ('not-found','problematic-domain')
  and c.manually_reviewed_at is null;

