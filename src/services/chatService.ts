import { supabase } from '@/integrations/supabase/client';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  isStreaming?: boolean;
  statusText?: string;
}

export interface StreamChunk {
  type: 'text' | 'status';
  value: string;
}

export interface ChatConversation {
  id: string;
  organization_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/**
 * Send a chat message and receive a streaming response from Claude.
 * Returns a ReadableStream that yields StreamChunk objects (text or status updates).
 */
export async function sendChatMessage(
  message: string,
  organizationId: string,
  conversationHistory: ChatMessage[]
): Promise<ReadableStream<StreamChunk>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const response = await fetch(`${supabaseUrl}/functions/v1/chat-with-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      message,
      organizationId,
      conversationHistory: conversationHistory.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Chat request failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream<StreamChunk>({
    async pull(controller) {
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              controller.close();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                controller.error(new Error(parsed.error));
                return;
              }
              if (parsed.text) {
                controller.enqueue({ type: 'text', value: parsed.text });
              }
              if (parsed.status) {
                controller.enqueue({ type: 'status', value: parsed.status });
              }
            } catch (e) {
              console.warn('Skipped unparseable SSE chunk:', data, e);
            }
          }
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

/**
 * Create a new chat conversation.
 */
export async function createConversation(
  organizationId: string,
  title: string = 'New conversation'
): Promise<ChatConversation> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({
      organization_id: organizationId,
      user_id: user.id,
      title,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ChatConversation;
}

/**
 * List all conversations for the current user in an organization.
 */
export async function listConversations(
  organizationId: string
): Promise<ChatConversation[]> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []) as ChatConversation[];
}

/**
 * Load all messages for a conversation.
 */
export async function loadConversationMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((m: any) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    created_at: m.created_at,
  }));
}

/**
 * Save a message to a conversation.
 */
export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
    })
    .select()
    .single();

  if (error) throw error;
  return {
    id: data.id,
    role: data.role as 'user' | 'assistant',
    content: data.content,
    created_at: data.created_at,
  };
}

/**
 * Update a conversation's title.
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  const { error } = await supabase
    .from('chat_conversations')
    .update({ title })
    .eq('id', conversationId);

  if (error) throw error;
}

/**
 * Delete a conversation and all its messages.
 */
export async function deleteConversation(
  conversationId: string
): Promise<void> {
  const { error } = await supabase
    .from('chat_conversations')
    .delete()
    .eq('id', conversationId);

  if (error) throw error;
}
