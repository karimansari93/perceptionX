-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218070216; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- FIX 1: Wrap auth.uid() in (SELECT ...) so it's evaluated once
-- ============================================================

-- chat_conversations: SELECT
DROP POLICY "Users can read own conversations" ON chat_conversations;
CREATE POLICY "Users can read own conversations" ON chat_conversations
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- chat_conversations: INSERT
DROP POLICY "Users can insert own conversations" ON chat_conversations;
CREATE POLICY "Users can insert own conversations" ON chat_conversations
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- chat_conversations: UPDATE
DROP POLICY "Users can update own conversations" ON chat_conversations;
CREATE POLICY "Users can update own conversations" ON chat_conversations
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

-- chat_conversations: DELETE
DROP POLICY "Users can delete own conversations" ON chat_conversations;
CREATE POLICY "Users can delete own conversations" ON chat_conversations
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- chat_messages: SELECT
DROP POLICY "Users can read messages from own conversations" ON chat_messages;
CREATE POLICY "Users can read messages from own conversations" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = chat_messages.conversation_id
        AND chat_conversations.user_id = (SELECT auth.uid())
    )
  );

-- chat_messages: INSERT
DROP POLICY "Users can insert messages into own conversations" ON chat_messages;
CREATE POLICY "Users can insert messages into own conversations" ON chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = chat_messages.conversation_id
        AND chat_conversations.user_id = (SELECT auth.uid())
    )
  );

