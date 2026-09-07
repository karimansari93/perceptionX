import { useEffect, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterQuestions } from '@/hooks/useStarterQuestions';
import { greetingFor } from '@/lib/askAi';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatWelcome } from './ChatWelcome';
import { ChatConversationList } from './ChatConversationList';
import { AlertTriangle } from 'lucide-react';

interface ChatCoreProps {
  mode: 'full' | 'compact';
  /** A question to send as soon as the chat is ready (from the overview chat box). */
  initialQuestion?: string | null;
  onInitialQuestionSent?: () => void;
}

export function ChatCore({ mode, initialQuestion, onInitialQuestionSent }: ChatCoreProps) {
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
  const sentInitialRef = useRef<string | null>(null);
  useEffect(() => {
    const q = initialQuestion?.trim();
    if (!q || !organizationId || isLoading) return;
    if (sentInitialRef.current === q) return;
    sentInitialRef.current = q;
    startNewConversation();
    // sendMessage reads the (now empty) message list on the next tick.
    setTimeout(() => {
      sendMessage(q);
      onInitialQuestionSent?.();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, organizationId]);

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
              onSuggestionClick={sendMessage}
              greeting={greetingFor(user)}
              companyName={currentCompany?.name}
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

        {/* Input area */}
        <ChatInput
          onSend={sendMessage}
          onStop={stopStreaming}
          isLoading={isLoading}
          disabled={!organizationId}
          placeholder="Ask about your AI employer perception data…"
        />
      </div>
    </div>
  );
}
