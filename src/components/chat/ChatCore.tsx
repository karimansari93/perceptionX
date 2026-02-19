import { useEffect, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import { useCompany } from '@/contexts/CompanyContext';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatWelcome } from './ChatWelcome';
import { ChatConversationList } from './ChatConversationList';
import { AlertTriangle } from 'lucide-react';

interface ChatCoreProps {
  mode: 'full' | 'compact';
}

export function ChatCore({ mode }: ChatCoreProps) {
  const { currentCompany } = useCompany();
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const showConversationList = mode === 'full';

  if (!organizationId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center text-gray-500">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
          <p className="text-sm">No organization found. Please complete onboarding first.</p>
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
              companyName={currentCompany?.name}
            />
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-4">
              {messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
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
        />
      </div>
    </div>
  );
}
