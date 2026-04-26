-- ============================================================================
-- Allow authenticated admins to write to url_recency_cache
-- ============================================================================
-- Edge functions write via service role (bypasses RLS). The admin Recency
-- Coverage manual review queue writes directly from the browser as the
-- authenticated user — that path needs an explicit policy.

ALTER TABLE url_recency_cache ENABLE ROW LEVEL SECURITY;

-- Admins (matched by email) can read, insert, and update cache rows directly.
-- This is for the manual review queue in the admin UI.

DROP POLICY IF EXISTS "Admins can read url_recency_cache" ON url_recency_cache;
CREATE POLICY "Admins can read url_recency_cache"
  ON url_recency_cache FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) IN ('karim@perceptionx.ai', 'karim@olivtek.com'));

DROP POLICY IF EXISTS "Admins can insert url_recency_cache" ON url_recency_cache;
CREATE POLICY "Admins can insert url_recency_cache"
  ON url_recency_cache FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'email'::text) IN ('karim@perceptionx.ai', 'karim@olivtek.com'));

DROP POLICY IF EXISTS "Admins can update url_recency_cache" ON url_recency_cache;
CREATE POLICY "Admins can update url_recency_cache"
  ON url_recency_cache FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) IN ('karim@perceptionx.ai', 'karim@olivtek.com'))
  WITH CHECK ((auth.jwt() ->> 'email'::text) IN ('karim@perceptionx.ai', 'karim@olivtek.com'));

NOTIFY pgrst, 'reload schema';
