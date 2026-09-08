import { useState, useCallback, useRef, useEffect } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import {
  ChatMessage,
  ChatConversation,
  ChatScope,
  SourceLink,
  sendChatMessage,
  createConversation,
  listConversations,
  loadConversationMessages,
  saveMessage,
  updateConversationTitle,
  deleteConversation as deleteConversationService,
} from '@/services/chatService';

const titleFor = (text: string) => (text.length > 50 ? text.substring(0, 47) + '...' : text);

export function useChat() {
  const { currentCompany } = useCompany();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<unknown> | null>(null);

  const organizationId = currentCompany?.organization_id;

  // Load conversations list
  const loadConversations = useCallback(async () => {
    if (!organizationId) return;

    setIsLoadingConversations(true);
    try {
      const convos = await listConversations(organizationId);
      setConversations(convos);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [organizationId]);

  // Load conversations when org changes
  useEffect(() => {
    if (organizationId) {
      loadConversations();
    }
  }, [organizationId, loadConversations]);

  // Load a specific conversation
  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const msgs = await loadConversationMessages(conversationId);
      setMessages(msgs);
      setCurrentConversationId(conversationId);
    } catch (err: any) {
      console.error('Failed to load conversation:', err);
      setError('Failed to load conversation');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    // Cancel any ongoing stream
    if (streamReaderRef.current) {
      streamReaderRef.current.cancel();
      streamReaderRef.current = null;
    }
    setMessages([]);
    setCurrentConversationId(null);
    setError(null);
    setIsLoading(false);
  }, []);

  // Patch the streaming assistant message in place.
  const patchLast = useCallback((patch: Partial<ChatMessage>) => {
    setMessages(prev => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        updated[updated.length - 1] = { ...lastMsg, ...patch };
      }
      return updated;
    });
  }, []);

  // Send a message, under the dashboard scope (company / market / function)
  // the user has set — shown as chips on the question and applied by the
  // analyst as tool filters.
  const sendMessage = useCallback(async (text: string, scope?: ChatScope | null) => {
    if (!text.trim() || isLoading || !organizationId) return;

    setError(null);
    setIsLoading(true);

    // Add user message to the UI
    const userMessage: ChatMessage = { role: 'user', content: text.trim(), ...(scope ? { scope } : {}) };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);

    // Create conversation if this is the first message
    let conversationId = currentConversationId;
    if (!conversationId) {
      try {
        const convo = await createConversation(organizationId, titleFor(text.trim()));
        conversationId = convo.id;
        setCurrentConversationId(conversationId);
        setConversations(prev => [convo, ...prev]);
      } catch (err: any) {
        console.error('Failed to create conversation:', err);
        setError('Failed to create conversation');
        setIsLoading(false);
        return;
      }
    }

    // Save user message to DB
    try {
      await saveMessage(conversationId, 'user', text.trim());
    } catch (err) {
      console.error('Failed to save user message:', err);
    }

    // Add streaming assistant message placeholder
    const assistantMessage: ChatMessage = { role: 'assistant', content: '', isStreaming: true };
    setMessages([...currentMessages, assistantMessage]);

    try {
      // Build history excluding the current user message (it's sent
      // separately). Cap at the last N turns to keep the prompt small — the
      // server applies the same window.
      const HISTORY_WINDOW = 20;
      const recent = messages.slice(-HISTORY_WINDOW);
      const history = recent.map(m => ({ role: m.role, content: m.content }));

      const stream = await sendChatMessage(text.trim(), organizationId, history, conversationId, scope);
      const reader = stream.getReader();
      streamReaderRef.current = reader;

      let fullResponse = '';
      let sources: SourceLink[] = [];
      let competitors: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value.type === 'text') {
          fullResponse += value.value;
          patchLast({ content: fullResponse, statusText: undefined, isStreaming: true });
        } else if (value.type === 'status') {
          patchLast({ statusText: value.value, isStreaming: true });
        } else if (value.type === 'sources') {
          sources = value.value;
          patchLast({ sources });
        } else if (value.type === 'competitors') {
          competitors = value.value;
          patchLast({ competitors });
        }
      }

      // Mark streaming as complete
      patchLast({ content: fullResponse, statusText: undefined, isStreaming: false, sources, competitors });

      // Save assistant message to DB
      if (fullResponse && conversationId) {
        try {
          await saveMessage(conversationId, 'assistant', fullResponse, sources);
        } catch (err) {
          console.error('Failed to save assistant message:', err);
        }
      }

      // Update conversation title if this was the first exchange
      if (messages.length === 0 && conversationId) {
        const title = titleFor(text.trim());
        try {
          await updateConversationTitle(conversationId, title);
          setConversations(prev =>
            prev.map(c => c.id === conversationId ? { ...c, title } : c)
          );
        } catch (err) {
          console.error('Failed to update conversation title:', err);
        }
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'Failed to get response');

      // Remove the empty assistant message on error
      setMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
          updated.pop();
        } else if (lastMsg && lastMsg.role === 'assistant') {
          updated[updated.length - 1] = { ...lastMsg, isStreaming: false, statusText: undefined };
        }
        return updated;
      });
    } finally {
      streamReaderRef.current = null;
      setIsLoading(false);
    }
  }, [messages, currentConversationId, organizationId, isLoading, patchLast]);

  // Delete a conversation
  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await deleteConversationService(conversationId);
      setConversations(prev => prev.filter(c => c.id !== conversationId));

      // If we deleted the current conversation, reset
      if (currentConversationId === conversationId) {
        startNewConversation();
      }
    } catch (err: any) {
      console.error('Failed to delete conversation:', err);
      setError('Failed to delete conversation');
    }
  }, [currentConversationId, startNewConversation]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    if (streamReaderRef.current) {
      streamReaderRef.current.cancel();
      streamReaderRef.current = null;
    }
    setIsLoading(false);

    // Mark the current streaming message as complete
    setMessages(prev => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.isStreaming) {
        updated[updated.length - 1] = { ...lastMsg, isStreaming: false, statusText: undefined };
      }
      return updated;
    });
  }, []);

  return {
    messages,
    conversations,
    currentConversationId,
    isLoading,
    isLoadingConversations,
    error,
    sendMessage,
    loadConversation,
    loadConversations,
    startNewConversation,
    deleteConversation,
    stopStreaming,
    organizationId,
  };
}
