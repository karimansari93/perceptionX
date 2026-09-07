import { useCallback, useState } from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { ChatCore } from '@/components/chat/ChatCore';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ASK_AI_SUBLINE, ASK_AI_TITLE } from '@/lib/askAi';
import type { ChatScope } from '@/services/chatService';

function ChatContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  useDocumentTitle(ASK_AI_TITLE);

  // A question can arrive from the overview chat box (router state) or a
  // link (?q=). It is sent once and then cleared from the URL/state so a
  // reload doesn't re-ask it.
  const [initialScope] = useState<ChatScope | null>(() => (location.state as { scope?: ChatScope } | null)?.scope ?? null);
  const [initialQuestion, setInitialQuestion] = useState<string | null>(() => {
    const fromState = (location.state as { question?: string } | null)?.question;
    return (fromState || searchParams.get('q') || '').trim() || null;
  });
  // The router entry that carried the question: ChatCore sends each
  // (entry, question) pair once, even across remounts or dev hot reloads.
  const [handoverKey] = useState(() => location.key);
  const handleSent = useCallback(() => {
    setInitialQuestion(null);
    navigate('/chat', { replace: true, state: null });
  }, [navigate]);

  return (
    <div className="flex h-screen bg-gray-50 w-full">
      <AppSidebar
        activeSection="chat"
        onSectionChange={() => {}}
      />
      <SidebarInset className="flex-1 flex flex-col">
        {/* Minimal header */}
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-white/80 backdrop-blur-sm">
          <img
            alt="PerceptionX"
            className="w-8 h-8 object-contain rounded-full"
            src="/logos/PinkBadge.png"
          />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">{ASK_AI_TITLE}</h1>
            <p className="text-xs text-gray-500 truncate">{ASK_AI_SUBLINE}</p>
          </div>
        </div>

        {/* Full-page chat */}
        <div className="flex-1 overflow-hidden">
          <ChatCore
            mode="full"
            initialQuestion={initialQuestion}
            initialScope={initialScope}
            handoverKey={handoverKey}
            onInitialQuestionSent={handleSent}
          />
        </div>
      </SidebarInset>
    </div>
  );
}

export default function Chat() {
  return (
    <SidebarProvider>
      <ChatContent />
    </SidebarProvider>
  );
}
