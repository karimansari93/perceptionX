-- Ask PerceptionX: files a user attaches to a chat question (PDF, Excel, CSV),
-- so the analyst can read them alongside the PerceptionX data, e.g. to compare
-- an internal engagement survey with what AI tells candidates.
--
-- Files live in the private `chat-attachments` bucket at
--   {organization_id}/{user_id}/{conversation_id}/{uuid}-{file name}
-- and are private to the user who uploaded them. They are kept for as long as
-- the conversation exists: deleting the conversation deletes its rows here
-- (cascade) and the app removes the stored files first.
--
-- chat-with-data reads the files with the service role, only for the caller's
-- own conversation, and caches what it extracts (spreadsheet text, PDF text
-- and page count) in extracted_text / page_count so follow-up questions do
-- not re-parse the file.

CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  extracted_text text,
  page_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_attachments_conversation_idx
  ON public.chat_attachments (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS chat_attachments_message_idx
  ON public.chat_attachments (message_id);

ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;

-- The uploader only; the row must sit in one of their own conversations and
-- point at a file under their own folder.
CREATE POLICY "chat_attachments select own"
  ON public.chat_attachments FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "chat_attachments insert own"
  ON public.chat_attachments FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = (SELECT auth.uid())
        AND c.organization_id = chat_attachments.organization_id
    )
    AND split_part(storage_path, '/', 1) = organization_id::text
    AND split_part(storage_path, '/', 2) = (SELECT auth.uid())::text
    AND split_part(storage_path, '/', 3) = conversation_id::text
  );

CREATE POLICY "chat_attachments delete own"
  ON public.chat_attachments FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- How many files each question carried, for cost monitoring.
ALTER TABLE public.chat_request_log
  ADD COLUMN IF NOT EXISTS attachment_count integer NOT NULL DEFAULT 0;

-- ─── Storage bucket ───────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments', 'chat-attachments', false, 20971520,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Upload: only into {an org you belong to}/{your own user id}/...
CREATE POLICY "chat-attachments insert own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id::text = (storage.foldername(name))[1]
        AND om.user_id = (SELECT auth.uid())
    )
  );

-- Read and delete: your own files only. No one else in the organisation, and
-- no platform-admin read path from the app.
CREATE POLICY "chat-attachments select own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

CREATE POLICY "chat-attachments delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );
