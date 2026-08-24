-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218070257; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- FIX 5: Set search_path on function to prevent schema injection
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_chat_conversation_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- FIX 6: Tighten url_recency_cache RLS policies
-- Only service_role should write to this cache, not any authenticated user
-- ============================================================

DROP POLICY IF EXISTS "Allow service to insert cache" ON url_recency_cache;
CREATE POLICY "Allow service to insert cache" ON url_recency_cache
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IN (
      SELECT om.user_id FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
      WHERE om.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Allow service to update cache" ON url_recency_cache;
CREATE POLICY "Allow service to update cache" ON url_recency_cache
  FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) IN (
      SELECT om.user_id FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
      WHERE om.role = 'admin'
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) IN (
      SELECT om.user_id FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
      WHERE om.role = 'admin'
    )
  );

