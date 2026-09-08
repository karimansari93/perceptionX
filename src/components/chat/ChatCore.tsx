import { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { ArrowLeft, ArrowUp, History, Plus, AlertTriangle, MessageSquare, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChat } from '@/hooks/useChat';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterQuestions } from '@/hooks/useStarterQuestions';
import { greetingFor } from '@/lib/askAi';
import type { ChatConversation, ChatScope } from '@/services/chatService';
import { ChatMessage } from './ChatMessage';
import { ChatWelcome, conversationMeta, relativeAge } from './ChatWelcome';
import { ScopePickers, scopeSummary, useScopeOptions } from './ChatScopeBar';
import { cn } from '@/lib/utils';

export type ChatView = 'new' | 'thread' | 'list';

interface ChatCoreProps {
  /** A question to send as soon as the chat is ready (from the overview chat box). */
  initialQuestion?: string | null;
  /** The dashboard filters the handed-over question was asked under. */
  initialScope?: ChatScope | null;
  /** Identifies the navigation that carried the question (sent once per key). */
  handoverKey?: string;
  onInitialQuestionSent?: () => void;
  /** The page shows the current view in its breadcrumb. */
  onViewChange?: (view: ChatView) => void;
}

// Handovers already sent this session, keyed by navigation entry + question,
// so a remount, a double-invoked effect or a dev hot reload never asks the
// same question twice.
const sentHandovers = new Set<string>();

const pillClass = 'inline-flex h-[30px] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[12.5px] text-gray-600 transition-colors hover:border-[#DB5E89] hover:text-[#13274F]';

// The three views of Ask AI (design handoff): the new-chat page, the answer
// page (a thread), and the chats list.
export function ChatCore({ initialQuestion, initialScope, handoverKey, onInitialQuestionSent, onViewChange }: ChatCoreProps) {
  const { currentCompany } = useCompany();
  const { user } = useAuth();
  const {
    messages,
    conversations,
    currentConversationId,
    isLoading,
    error,
    sendMessage,
    loadConversation,
    startNewConversation,
    deleteConversation,
    stopStreaming,
    organizationId,
  } = useChat();
  const { starters, isLoading: startersLoading } = useStarterQuestions(organizationId);
  const [showList, setShowList] = useState(false);

  // The scope every question is asked under: the handed-over filters, else
  // the dashboard's current company with every market and function.
  const [scope, setScope] = useState<ChatScope>(() => ({
    company: initialScope?.company ?? currentCompany?.name ?? null,
    locations: initialScope?.locations ?? [],
    jobFunctions: initialScope?.jobFunctions ?? [],
  }));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const { options: scopeOptions } = useScopeOptions(organizationId, scope.company);
  useEffect(() => {
    if (scopeOptions?.brand && !scope.company) setScope(s => ({ ...s, company: scopeOptions.brand }));
  }, [scopeOptions?.brand, scope.company]);

  const view: ChatView = showList ? 'list' : messages.length === 0 && !currentConversationId ? 'new' : 'thread';
  useEffect(() => { onViewChange?.(view); }, [view, onViewChange]);

  const send = useCallback((text: string) => { setShowList(false); sendMessage(text, scopeRef.current); }, [sendMessage]);
  const openConversation = useCallback((id: string) => {
    setShowList(false);
    const c = conversations.find(x => x.id === id);
    // A reopened thread shows the scope it was answered in, not today's filters.
    if (c?.scope) setScope({ company: c.scope.company ?? null, locations: c.scope.locations ?? [], jobFunctions: c.scope.jobFunctions ?? [] });
    loadConversation(id);
  }, [conversations, loadConversation]);
  const newChat = useCallback(() => { setShowList(false); startNewConversation(); }, [startNewConversation]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // A question handed over from the overview chat box: send it once, as its
  // own new conversation, as soon as the org is known.
  useEffect(() => {
    const q = initialQuestion?.trim();
    if (!q || !organizationId || isLoading) return;
    const token = `${handoverKey ?? ''}:${q}`;
    if (sentHandovers.has(token)) return;
    sentHandovers.add(token);
    startNewConversation();
    setTimeout(() => {
      sendMessage(q, scopeRef.current);
      onInitialQuestionSent?.();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, handoverKey, organizationId]);

  const current = useMemo(() => conversations.find(c => c.id === currentConversationId) ?? null, [conversations, currentConversationId]);

  if (!organizationId) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center text-gray-500">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-yellow-500" />
          <p className="text-sm">No organisation found. Ask your PerceptionX admin to add you to one.</p>
        </div>
      </div>
    );
  }

  if (view === 'list') {
    return <ChatList conversations={conversations} onOpen={openConversation} onNew={newChat} onDelete={deleteConversation} />;
  }

  if (view === 'new') {
    return (
      <div className="h-full overflow-y-auto">
        <ChatWelcome
          greeting={greetingFor(user)}
          companyName={scope.company ?? currentCompany?.name}
          scope={scope}
          scopeOptions={scopeOptions}
          onScopeChange={setScope}
          starters={starters}
          startersLoading={startersLoading}
          recent={conversations}
          onSend={send}
          onOpenConversation={openConversation}
          onOpenList={() => setShowList(true)}
          disabled={isLoading}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread bar */}
      <div className="flex-none px-8 pt-4">
        <div className="mx-auto flex max-w-[760px] items-center gap-2.5">
          <button type="button" onClick={newChat} className={pillClass}><ArrowLeft className="h-3.5 w-3.5" />New chat</button>
          <button type="button" onClick={() => setShowList(true)} className={pillClass}><History className="h-3.5 w-3.5" />All chats</button>
          <div className="flex-1" />
          {current && (
            <span className="truncate text-xs text-gray-400">{current.title} · {relativeAge(current.updated_at)} ago</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-8 pb-6 pt-6">
          {messages.map((msg, i) => (
            <ChatMessage key={msg.id ?? i} message={msg} onAsk={send} />
          ))}
          {error && (
            <div className="flex items-center gap-3 text-sm text-[#dc2626]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
              {messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                <button type="button" onClick={() => send(messages[messages.length - 1].content)} className={pillClass}>Retry</button>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Follow-up composer — pinned to the bottom; content fades under it. */}
      <div className="-mt-8 flex-none px-8 pb-6 pt-4" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0), #fff 32%)' }}>
        <ThreadComposer
          scope={scope}
          options={scopeOptions}
          onScopeChange={setScope}
          onSend={send}
          onStop={stopStreaming}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

// h. Follow-up composer: scope token (click to change the scope) + input +
// round send.
function ThreadComposer({ scope, options, onScopeChange, onSend, onStop, isLoading }: {
  scope: ChatScope; options: ReturnType<typeof useScopeOptions>['options'];
  onScopeChange: (s: ChatScope) => void; onSend: (q: string) => void; onStop: () => void; isLoading: boolean;
}) {
  const [draft, setDraft] = useState('');
  const submit = useCallback(() => { const t = draft.trim(); if (!t || isLoading) return; onSend(t); setDraft(''); }, [draft, isLoading, onSend]);
  const onKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }, [submit]);
  return (
    <div className="mx-auto flex max-w-[760px] items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-[14px] py-3">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Change the scope for the next question"
            className="flex-none truncate rounded-lg border border-[#13274F]/[0.12] bg-[#13274F]/[0.03] px-2 py-[3px] text-[11px] text-[#13274F] hover:border-[#DB5E89] max-w-[280px]"
          >
            {scopeSummary(scope)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-[420px] p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">Ask about</div>
          <ScopePickers scope={scope} options={options} onChange={onScopeChange} variant="chip" showPeriod />
        </PopoverContent>
      </Popover>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKey}
        placeholder="Ask a follow-up"
        className="min-w-0 flex-1 border-0 bg-transparent text-[14.5px] text-[#13274F] placeholder:text-gray-400 focus:outline-none"
      />
      {isLoading ? (
        <button type="button" onClick={onStop} aria-label="Stop" className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-red-200 text-red-500 hover:bg-red-50">
          <span className="h-3 w-3 rounded-[2px] bg-current" />
        </button>
      ) : (
        <button type="button" onClick={submit} disabled={!draft.trim()} aria-label="Send" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#13274F] text-white transition-colors hover:bg-[#183056] disabled:opacity-40">
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// The chats list: every question asked, with the scope it was answered in.
function ChatList({ conversations, onOpen, onNew, onDelete }: {
  conversations: ChatConversation[]; onOpen: (id: string) => void; onNew: () => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-headline text-[22px] font-semibold tracking-[-0.02em] text-[#13274F]">Chats</h1>
            <p className="mt-1 text-sm text-gray-500">Every question you have asked, with the data scope it was answered in.</p>
          </div>
          <button type="button" onClick={onNew} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#13274F] px-3.5 text-[12.5px] font-medium text-white hover:bg-[#183056]">
            <Plus className="h-3.5 w-3.5" />New chat
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="grid grid-cols-[1.6fr_1.2fr_auto] gap-3 border-b border-gray-200 bg-gray-50 px-[14px] py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-500">
            <span>Chat</span><span>Company · market · function</span><span className="text-right">Updated</span>
          </div>
          {conversations.length === 0 ? (
            <div className="px-[14px] py-6 text-sm text-gray-400">No chats yet.</div>
          ) : conversations.map(c => (
            <div key={c.id} className="group grid grid-cols-[1.6fr_1.2fr_auto] items-center gap-3 border-b border-gray-100 px-[14px] py-3 last:border-b-0 hover:bg-gray-50/60">
              <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-0 items-center gap-2 text-left">
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <span className="truncate text-sm font-semibold text-[#13274F]">{c.title}</span>
              </button>
              <span className="truncate text-xs text-gray-500">{c.scope ? scopeSummary({ company: c.scope.company, locations: c.scope.locations ?? [], jobFunctions: c.scope.jobFunctions ?? [] }) : '—'}</span>
              <span className="flex items-center justify-end gap-2 text-[11px] text-gray-400">
                {relativeAge(c.updated_at)}
                <button type="button" onClick={() => onDelete(c.id)} title="Delete" className="rounded p-1 text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { conversationMeta };
