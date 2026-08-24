-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312130619; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Remove false Meta mappings (unrelated companies containing "metal"/"meta")
DELETE FROM company_canonical_names
WHERE canonical_name = 'Meta'
  AND variant_name IN (
    'american iron & metal',
    'cie autometal',
    'das meta',
    'desktop metal',
    'hometap',
    'ig metall',
    'kymeta',
    'metacar',
    'metacnbeauty',
    'meta it',
    'metalenz',
    'metalfrio solutions',
    'metalfrio solutions sa',
    'metamask',
    'metaphysic',
    'metaphysic.ai',
    'meta serviços em informática',
    'metaview',
    'metav.rs',
    'metax',
    'rheinmetall',
    'rheinmetall ag',
    'rheinmetall automotive',
    'spartan light metal products',
    'villares metals'
  );

-- Keep legitimate Meta mappings:
-- 'facebook', 'facebook ai research', 'meta', 'meta ai', 
-- 'meta platforms', 'meta platforms inc', 'meta platforms inc.'

-- Refresh the materialized view to apply changes
REFRESH MATERIALIZED VIEW rankings_overview;

NOTIFY pgrst, 'reload schema';

