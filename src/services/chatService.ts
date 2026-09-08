import { supabase } from '@/integrations/supabase/client';

// A page the tools returned for an assistant turn (the `sources` SSE event):
// the only URLs the analyst is allowed to link, so the UI renders them from
// data rather than from the model's text.
export interface SourceLink {
  title: string;
  url: string;
  domain: string;
}

// The dashboard filters a question is asked under (company / market / job
// function). Sent with the message so the analyst applies the same
// location / job_function filters, and shown as chips on the question.
export interface ChatScope {
  company?: string | null;
  locations: string[];
  jobFunctions: string[];
}

export const EMPTY_SCOPE: ChatScope = { company: null, locations: [], jobFunctions: [] };

export interface ScopeOptions {
  brands: string[];
  brand: string | null;
  markets: string[];
  job_functions: string[];
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  isStreaming?: boolean;
  statusText?: string;
  sources?: SourceLink[];
  competitors?: string[];
  scope?: ChatScope;
}

export type StreamChunk =
  | { type: 'text'; value: string }
  | { type: 'status'; value: string }
  | { type: 'sources'; value: SourceLink[] }
  | { type: 'competitors'; value: string[] };

export interface ChatConversation {
  id: string;
  organization_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StarterQuestions {
  questions: string[];
  source: 'data' | 'fallback';
}

function functionsUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-with-data`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

/**
 * Send a chat message and receive a streaming response from the analyst.
 * Returns a ReadableStream of StreamChunk objects (text deltas, tool status
 * lines, and the sources the tools returned for this turn).
 */
export async function sendChatMessage(
  message: string,
  organizationId: string,
  conversationHistory: ChatMessage[],
  conversationId?: string | null,
  scope?: ChatScope | null,
): Promise<ReadableStream<StreamChunk>> {
  const response = await fetch(functionsUrl(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      message,
      organizationId,
      conversationId: conversationId ?? undefined,
      scope: scope ?? undefined,
      conversationHistory: conversationHistory.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Chat request failed: ${response.status}`);
  }
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream<StreamChunk>({
    async pull(controller) {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { controller.close(); return; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) { controller.error(new Error(parsed.error)); return; }
            if (typeof parsed.text === 'string' && parsed.text) controller.enqueue({ type: 'text', value: parsed.text });
            if (typeof parsed.status === 'string') controller.enqueue({ type: 'status', value: parsed.status });
            if (Array.isArray(parsed.sources)) {
              const sources = parsed.sources
                .filter((s: any) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
                .map((s: any) => ({ title: String(s.title || s.url), url: s.url, domain: String(s.domain || '') }));
              controller.enqueue({ type: 'sources', value: sources });
            }
            if (Array.isArray(parsed.competitors)) {
              controller.enqueue({ type: 'competitors', value: parsed.competitors.filter((c: unknown) => typeof c === 'string' && c).map(String) });
            }
          } catch (e) {
            console.warn('Skipped unparseable SSE chunk:', data, e);
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
 * The four data-grounded starter questions for an organization (built on the
 * server from px-tools data; cached there for a day).
 */
export async function fetchStarterQuestions(organizationId: string): Promise<StarterQuestions> {
  const response = await fetch(functionsUrl(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'starters', organizationId }),
  });
  if (!response.ok) throw new Error(`Starter questions failed: ${response.status}`);
  const body = await response.json();
  const questions = Array.isArray(body?.questions) ? body.questions.map(String).slice(0, 4) : [];
  if (questions.length !== 4) throw new Error('Starter questions malformed');
  return { questions, source: body.source === 'data' ? 'data' : 'fallback' };
}

/**
 * Scope options for the chat's scope bar: the organization's brands and the
 * tracked markets and job functions of one brand (the same spellings the
 * analyst's tools match against).
 */
export async function fetchScopeOptions(organizationId: string, company?: string | null): Promise<ScopeOptions> {
  const response = await fetch(functionsUrl(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'scope', organizationId, scope: company ? { company } : undefined }),
  });
  if (!response.ok) throw new Error(`Scope options failed: ${response.status}`);
  const body = await response.json();
  return {
    brands: Array.isArray(body?.brands) ? body.brands.map(String) : [],
    brand: typeof body?.brand === 'string' ? body.brand : null,
    markets: Array.isArray(body?.markets) ? body.markets.map(String) : [],
    job_functions: Array.isArray(body?.job_functions) ? body.job_functions.map(String) : [],
  };
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
 * List conversations for the current user in an organization, most recent
 * first. Paginated to avoid loading hundreds of rows into the sidebar —
 * users who need older threads can request the next page.
 */
export async function listConversations(
  organizationId: string,
  { limit = 30, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<ChatConversation[]> {
  const cappedLimit = Math.max(1, Math.min(100, limit));
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .range(offset, offset + cappedLimit - 1);

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
    sources: Array.isArray(m.sources) ? (m.sources as SourceLink[]) : undefined,
  }));
}

/**
 * Save a message to a conversation (with the sources the tools returned for
 * an assistant turn, so a reopened thread keeps its sources footer).
 */
export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  sources?: SourceLink[],
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      ...(sources && sources.length ? { sources } : {}),
    })
    .select()
    .single();

  if (error) throw error;
  return {
    id: data.id,
    role: data.role as 'user' | 'assistant',
    content: data.content,
    created_at: data.created_at,
    sources: Array.isArray(data.sources) ? (data.sources as SourceLink[]) : undefined,
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
