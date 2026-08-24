-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260306122426; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Mark known non-employers as 'source'
UPDATE company_entity_classifications
SET entity_type = 'source', reason = 'Non-employer entity — directory, certification, forum, or advocacy org'
WHERE company_name IN (
  'blind', 'b corp', 'fair360', 'ftse', 'g2', 'goodfirms',
  'great place to work®', 'great place to work brazil', 'great place to work france',
  'great place to work india', 'great place to work uk', 'hrc',
  'linkedin top companies', 'nasscom', 'reddit', 'sequoia',
  'station f', 'stonewall', 'sustainalytics', 'vault',
  'built in', 'built in london', 'newsweek', 'real leaders'
);

-- Mark everything else still ambiguous as 'company'
UPDATE company_entity_classifications
SET entity_type = 'company', reason = 'Confirmed employer'
WHERE entity_type = 'ambiguous';

