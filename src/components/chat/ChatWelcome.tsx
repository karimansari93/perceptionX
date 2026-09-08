import { ArrowUp, History, MessageSquare } from 'lucide-react';
import { useCallback, useState, KeyboardEvent } from 'react';
import type { ChatConversation, ChatScope, ScopeOptions, Starter } from '@/services/chatService';
import { ScopePickers, scopeSummary } from './ChatScopeBar';
import { cn } from '@/lib/utils';

interface ChatWelcomeProps {
  greeting: string;
  companyName?: string | null;
  scope: ChatScope;
  scopeOptions: ScopeOptions | null;
  onScopeChange: (scope: ChatScope) => void;
  starters: Starter[];
  startersLoading?: boolean;
  recent: ChatConversation[];
  onSend: (question: string) => void;
  onOpenConversation: (id: string) => void;
  onOpenList: () => void;
  disabled?: boolean;
}

// Relative age for the recent list: "2h", "1d", "3 Sep".
export function relativeAge(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function conversationMeta(c: ChatConversation): string {
  const s = c.scope;
  const scopeText = s ? scopeSummary({ company: s.company, locations: s.locations ?? [], jobFunctions: s.jobFunctions ?? [] }) : '';
  return [scopeText, relativeAge(c.updated_at)].filter(Boolean).join(' · ');
}

// The Ask AI page (design handoff, "Ask AI page / new chat"): greeting,
// a composer card with the scope chips (company · markets · functions ·
// period), four data-grounded starters, and the three most recent chats.
export function ChatWelcome({
  greeting, companyName, scope, scopeOptions, onScopeChange, starters, startersLoading,
  recent, onSend, onOpenConversation, onOpenList, disabled,
}: ChatWelcomeProps) {
  const [draft, setDraft] = useState('');
  const send = useCallback((q: string) => { const t = q.trim(); if (!t || disabled) return; onSend(t); setDraft(''); }, [onSend, disabled]);
  const onKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); send(draft); } }, [send, draft]);
  const brand = companyName || scope.company || 'your organisation';

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 py-16">
      <div className="w-full max-w-[720px] animate-in fade-in slide-in-from-bottom-2 duration-300">
        {/* Greeting */}
        <div className="mb-[26px] flex flex-col items-center gap-[14px] text-center">
          <img alt="" src="/logos/PinkBadge.png" className="h-11 w-11 object-contain" />
          <h2 className="font-headline text-[30px] font-semibold leading-tight tracking-[-0.02em] text-[#13274F]">{greeting}</h2>
          <p className="max-w-[600px] text-sm text-gray-500">
            Built on PerceptionX's own measurement of what ChatGPT, Perplexity and Google AI tell candidates about {brand} — the same numbers as your dashboard, linked to the pages those platforms cite.
          </p>
        </div>

        {/* Composer card */}
        <div className="rounded-2xl border border-gray-200 bg-white px-[18px] pt-4 pb-[14px]">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about anything…"
            disabled={disabled}
            className="w-full border-0 bg-transparent px-0 pt-0.5 pb-3 text-[15px] text-[#13274F] placeholder:text-gray-400 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ScopePickers scope={scope} options={scopeOptions} onChange={onScopeChange} disabled={disabled} variant="chip" showPeriod />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => send(draft)}
              disabled={disabled || !draft.trim()}
              aria-label="Send"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#13274F] text-white transition-colors hover:bg-[#183056] disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Starters */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {starters.map((s, i) => (
            <button
              key={`${i}-${s.title}`}
              type="button"
              onClick={() => send(s.title)}
              disabled={disabled}
              className={cn('rounded-xl border border-gray-200 bg-white p-[14px] text-left transition-colors hover:border-[#DB5E89]', startersLoading && 'animate-pulse')}
            >
              <div className="text-[13.5px] font-semibold text-[#13274F]">{s.title}</div>
              {s.sub && <div className="mt-1 text-xs text-gray-500">{s.sub}</div>}
            </button>
          ))}
        </div>

        {/* Recent */}
        <div className="mt-7 border-t border-[#13274F]/[0.12] pt-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">Recent</span>
            <button
              type="button"
              onClick={onOpenList}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-gray-200 px-2.5 text-xs text-gray-600 transition-colors hover:border-[#DB5E89] hover:text-[#13274F]"
            >
              <History className="h-[13px] w-[13px]" />
              All chats
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="py-3 text-xs text-gray-400">No chats yet — your questions will show up here.</div>
          ) : (
            <div>
              {recent.slice(0, 3).map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenConversation(c.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-1 py-[9px] text-left transition-colors hover:bg-gray-50/60',
                    i < Math.min(recent.length, 3) - 1 && 'border-b border-gray-100'
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#13274F]">{c.title}</span>
                  <span className="flex-shrink-0 text-[11px] text-gray-400">{conversationMeta(c)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
