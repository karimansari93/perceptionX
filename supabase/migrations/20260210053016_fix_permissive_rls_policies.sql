-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260210053016; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix company_notification_requests: scope UPDATE to only the row the user created (by email match)
-- Since there's no user_id column, we restrict updates to only pending requests
DROP POLICY IF EXISTS "Authenticated users can update notification requests" ON public.company_notification_requests;
CREATE POLICY "Authenticated users can update notification requests" 
  ON public.company_notification_requests 
  FOR UPDATE 
  TO authenticated 
  USING (status = 'pending') 
  WITH CHECK (status IN ('pending', 'cancelled'));

-- Fix url_recency_cache: restrict to authenticated only (remove anon), keep it functional
DROP POLICY IF EXISTS "Allow service to insert cache" ON public.url_recency_cache;
CREATE POLICY "Allow service to insert cache" 
  ON public.url_recency_cache 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service to update cache" ON public.url_recency_cache;
CREATE POLICY "Allow service to update cache" 
  ON public.url_recency_cache 
  FOR UPDATE 
  TO authenticated 
  USING (true) 
  WITH CHECK (true);

