-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260522133132; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- A canonical's website_domain (used for logos) must come from its own
-- self-named variant row, not from max(website_domain) across geo/bottler/
-- subsidiary variants that carry their own regional domains (swirecocacola.com,
-- unileverdeutschland.com, rochediabetescare.com, ...).
--
-- For every canonical that HAS a self-named variant row with a real domain,
-- clear website_domain on all its OTHER variant rows so the MV's
-- max(website_domain) can only resolve to the canonical's own domain.
-- Canonicals with no self-named row are left untouched (nothing better to use).
WITH has_self AS (
  SELECT DISTINCT lower(canonical_name) AS ck
  FROM public.company_canonical_names
  WHERE lower(variant_name) = lower(canonical_name)
    AND website_domain IS NOT NULL AND website_domain <> ''
)
UPDATE public.company_canonical_names c
SET website_domain = NULL
WHERE lower(c.variant_name) <> lower(c.canonical_name)
  AND c.website_domain IS NOT NULL
  AND lower(c.canonical_name) IN (SELECT ck FROM has_self);
