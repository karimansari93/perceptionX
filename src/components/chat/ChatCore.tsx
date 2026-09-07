import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterQuestions } from '@/hooks/useStarterQuestions';
import { greetingFor } from '@/lib/askAi';
import type { ChatScope } from '@/services/chatService';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatWelcome } from './ChatWelcome';
import { ChatConversationList } from './ChatConversationList';
import { ChatScopeBar } from './ChatScopeBar';
import { AlertTriangle } from 'lucide-react';

interface ChatCoreProps {
  mode: 'full' | 'compact';
  /** A question to send as soon as the chat is ready (from the overview chat box). */
  initialQuestion?: string | null;
  /** The dashboard filters the handed-over question was asked under. */
  initialScope?: ChatScope | null;
  /** Identifies the navigation that carried the question (sent once per key). */
  handoverKey?: string;
  onInitialQuestionSent?: () => void;
}

// Handovers already sent this session, keyed by navigation entry + question,
// so a remount, a double-invoked effect or a dev hot reload never asks the
// same question twice.
const sentHandovers = new Set<string>();

export function ChatCore({ mode, initialQuestion, initialScope, handoverKey, onInitialQuestionSent }: ChatCoreProps) {
  const { currentCompany } = useCompany();
  const { user } = useAuth();
  const {
    messages,
    conversations,
    currentConversationId,
    isLoading,
    isLoadingConversations,
    error,
    sendMessage,
    loadConversation,
    startNewConversation,
    deleteConversation,
    stopStreaming,
    organizationId,
  } = useChat();
  const { questions, isLoading: questionsLoading } = useStarterQuestions(organizationId);

  // The scope every question is asked under: the handed-over filters, else
  // the dashboard's current company with no market / function filter.
  const [scope, setScope] = useState<ChatScope>(() => ({
    company: initialScope?.company ?? currentCompany?.name ?? null,
    location: initialScope?.location ?? null,
    jobFunction: initialScope?.jobFunction ?? null,
  }));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const send = useCallback((text: string) => sendMessage(text, scopeRef.current), [sendMessage]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // A question handed over from the overview chat box: send it once, as its
  // own new conversation, as soon as the org is known.
  useEffect(() => {
    const q = initialQuestion?.trim();
    if (!q || !organizationId || isLoading) return;
    const token = `${handoverKey ?? ''}:${q}`;
    if (sentHandovers.has(token)) return;
    sentHandovers.add(token);
    startNewConversation();
    // sendMessage reads the (now empty) message list on the next tick.
    setTimeout(() => {
      sendMessage(q, scopeRef.current);
      onInitialQuestionSent?.();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, handoverKey, organizationId]);

  const showConversationList = mode === 'full';

  if (!organizationId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center text-gray-500">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
          <p className="text-sm">No organisation found. Ask your PerceptionX admin to add you to one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Conversation sidebar (full mode only) */}
      {showConversationList && (
        <div className="w-64 flex-shrink-0 hidden md:block">
          <ChatConversationList
            conversations={conversations}
            currentConversationId={currentConversationId}
            isLoading={isLoadingConversations}
            onSelect={loadConversation}
            onNew={startNewConversation}
            onDelete={deleteConversation}
          />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <ChatWelcome
              onSuggestionClick={send}
              greeting={greetingFor(user)}
              companyName={scope.company ?? currentCompany?.name}
              questions={questions}
              questionsLoading={questionsLoading}
            />
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-4">
              {messages.map((msg, i) => (
                <ChatMessage key={msg.id ?? i} message={msg} />
              ))}

              {/* Error display */}
              {error && (
                <div className="flex items-center gap-2 py-3 px-4 bg-red-50 rounded-lg text-sm text-red-600 mt-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scope + input */}
        <div className="border-t bg-white">
          <ChatScopeBar organizationId={organizationId} scope={scope} onChange={setScope} disabled={isLoading} />
          <ChatInput
            onSend={send}
            onStop={stopStreaming}
            isLoading={isLoading}
            disabled={!organizationId}
            placeholder="Ask about your AI employer perception data…"
            bare
          />
        </div>
      </div>
    </div>
  );
}
