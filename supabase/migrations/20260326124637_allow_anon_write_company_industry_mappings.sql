-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260326124637; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE POLICY "Anyone can insert company mappings"
ON public.company_industry_mappings
FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Anyone can delete company mappings"
ON public.company_industry_mappings
FOR DELETE TO anon
USING (true);

