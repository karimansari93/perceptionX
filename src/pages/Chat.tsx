import { useCallback, useState } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { ChevronRight } from 'lucide-react';
import { AppSidebar } from '@/components/AppSidebar';
import { ChatCore, type ChatView } from '@/components/chat/ChatCore';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ASK_AI_TITLE } from '@/lib/askAi';
import type { ChatScope } from '@/services/chatService';

const CRUMB: Record<ChatView, string> = { new: 'New chat', thread: 'Chats', list: 'Chats' };

function ChatContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  useDocumentTitle(ASK_AI_TITLE);
  const [view, setView] = useState<ChatView>('new');

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
    <div className="flex h-screen w-full bg-white">
      <AppSidebar activeSection="chat" onSectionChange={() => {}} />
      <SidebarInset className="flex min-h-0 flex-1 flex-col">
        {/* Header: the dashboard's breadcrumb treatment */}
        <header className="flex h-16 flex-none items-center border-b border-gray-200/50 bg-white/80 px-4 backdrop-blur-sm sm:px-8">
          <SidebarTrigger className="mr-4 h-7 w-7 text-[#13274F] md:hidden" />
          <div className="flex items-center gap-3">
            <span className="hidden text-base font-light text-gray-500 sm:inline">Dashboard</span>
            <ChevronRight className="mx-1 hidden h-5 w-5 text-[#13274F] sm:inline" />
            <span className="text-base font-medium text-gray-700">{CRUMB[view]}</span>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <ChatCore
            initialQuestion={initialQuestion}
            initialScope={initialScope}
            handoverKey={handoverKey}
            onInitialQuestionSent={handleSent}
            onViewChange={setView}
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
