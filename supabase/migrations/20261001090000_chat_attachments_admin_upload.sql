-- Platform admins can attach files to Ask PerceptionX while viewing an
-- organization they are not a member of ("view as organization"), matching
-- chat-with-data, which lets platform admins chat for any organization.
-- Files still go into the admin's own folder ({org}/{admin user id}/...), so
-- read and delete stay owner-only and nothing about other users' files
-- changes.

DROP POLICY IF EXISTS "chat-attachments insert own" ON storage.objects;

CREATE POLICY "chat-attachments insert own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND (
      EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id::text = (storage.foldername(name))[1]
          AND om.user_id = (SELECT auth.uid())
      )
      OR (SELECT public.is_admin())
    )
  );
