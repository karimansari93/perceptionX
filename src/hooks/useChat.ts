import { useState, useCallback, useRef, useEffect } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import {
  ChatMessage,
  ChatConversation,
  StreamChunk,
  sendChatMessage,
  createConversation,
  listConversations,
  loadConversationMessages,
  saveMessage,
  updateConversationTitle,
  deleteConversation as deleteConversationService,
} from '@/services/chatService';

export function useChat() {
  const { currentCompany, userCompanies } = useCompany();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<string> | null>(null);

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

  // Send a message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading || !organizationId) return;

    setError(null);
    setIsLoading(true);

    // Add user message to the UI
    const userMessage: ChatMessage = { role: 'user', content: text.trim() };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);

    // Create conversation if this is the first message
    let conversationId = currentConversationId;
    if (!conversationId) {
      try {
        const title = text.trim().length > 50 ? text.trim().substring(0, 47) + '...' : text.trim();
        const convo = await createConversation(organizationId, title);
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
      // Build history excluding the current user message (it's sent separately)
      const history = messages.map(m => ({ role: m.role, content: m.content }));

      const stream = await sendChatMessage(text.trim(), organizationId, history);
      const reader = stream.getReader();
      streamReaderRef.current = reader as any;

      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value.type === 'text') {
          fullResponse += value.value;
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              updated[updated.length - 1] = { ...lastMsg, content: fullResponse, statusText: undefined, isStreaming: true };
            }
            return updated;
          });
        } else if (value.type === 'status') {
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              updated[updated.length - 1] = { ...lastMsg, statusText: value.value, isStreaming: true };
            }
            return updated;
          });
        }
      }

      // Mark streaming as complete
      setMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          updated[updated.length - 1] = { ...lastMsg, content: fullResponse, statusText: undefined, isStreaming: false };
        }
        return updated;
      });

      // Save assistant message to DB
      if (fullResponse && conversationId) {
        try {
          await saveMessage(conversationId, 'assistant', fullResponse);
        } catch (err) {
          console.error('Failed to save assistant message:', err);
        }
      }

      // Update conversation title if this was the first exchange
      if (messages.length === 0 && conversationId) {
        const title = text.trim().length > 50 ? text.trim().substring(0, 47) + '...' : text.trim();
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
        }
        return updated;
      });
    } finally {
      streamReaderRef.current = null;
      setIsLoading(false);
    }
  }, [messages, currentConversationId, organizationId, isLoading]);

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
        updated[updated.length - 1] = { ...lastMsg, isStreaming: false };
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
