import { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Send,
  Square,
  ArrowUpRight,
  RefreshCw,
  AlertTriangle,
  MessageSquarePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useChat } from '@/hooks/useChat';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSuggestedQuestions } from '@/hooks/useSuggestedQuestions';
import { ChatMessage } from '@/components/chat/ChatMessage';

/**
 * DashboardChatHero
 *
 * The primary chat surface on the dashboard overview. Designed to be the
 * first interaction a user has when they land on the page — not an
 * afterthought pinned in a corner.
 *
 * States:
 *  - Empty: full-height greeting card with a prominent input and four
 *    AI-generated starter questions personalized to the caller's data.
 *  - Active: conversation streams inline below the greeting; follow-up
 *    input stays visible. A "open in full view" affordance hands the
 *    thread off to /chat when the user wants the sidebar/history.
 *
 * Quality commitments:
 *  - Streaming tokens render as they arrive (no dump-then-display).
 *  - Suggestions come from the caller's actual data profile, cached 24h.
 *  - Cmd/Ctrl+K focuses the input from anywhere on the overview.
 *  - Graceful fallbacks for missing org, no data, and network errors.
 */
export function DashboardChatHero() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    startNewConversation,
    stopStreaming,
    organizationId,
  } = useChat();
  const { questions, hasData, isLoading: questionsLoading, refresh: refreshQuestions } =
    useSuggestedQuestions(organizationId);

  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const hasConversation = messages.length > 0;

  // Friendly greeting: use first name when available, fall back to a
  // warm but neutral address. Never show raw email here.
  const firstName = useMemo(() => {
    const meta = (user?.user_metadata as any) || {};
    if (typeof meta.first_name === 'string' && meta.first_name.trim()) return meta.first_name.trim();
    const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
    if (full) return full.split(/\s+/)[0];
    return '';
  }, [user]);

  const greeting = firstName ? `Hi ${firstName} — what would you like to explore?` : 'What would you like to explore today?';
  const subtitle = currentCompany?.name
    ? `Ask anything about ${currentCompany.name}'s AI perception. I have access to your visibility, sentiment, competitors, sources, and themes.`
    : 'Ask anything about your organization\u2019s AI perception data.';

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text || isLoading) return;
    sendMessage(text);
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const autosize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, []);

  // Cmd/Ctrl+K global focus. Scoped to this component's lifetime to
  // avoid conflicting with app-level shortcuts if any are added later.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-scroll conversation as tokens stream.
  useEffect(() => {
    if (hasConversation && conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, hasConversation]);

  const handleSuggestionClick = useCallback((q: string) => {
    if (isLoading) return;
    sendMessage(q);
  }, [isLoading, sendMessage]);

  const handleOpenFullChat = useCallback(() => {
    navigate('/chat');
  }, [navigate]);

  if (!organizationId) {
    // Quiet placeholder — this shouldn't happen for an authenticated user
    // on the overview, but we degrade gracefully if it does.
    return null;
  }

  return (
    <div className="relative w-full rounded-3xl overflow-hidden border border-gray-200/70 bg-gradient-to-br from-rose-50 via-white to-indigo-50 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(19,39,79,0.12)]">
      {/* Decorative glow — purely cosmetic, non-interactive. */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-pink-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-indigo-200/40 blur-3xl" />

      <div className="relative flex flex-col">
        {/* ── Header: greeting ─────────────────────────────────────── */}
        <div className={cn('flex items-start justify-between gap-4 px-6 pt-6 md:px-8 md:pt-8', hasConversation ? 'pb-3' : 'pb-4')}>
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-white/80 backdrop-blur-sm border border-white shadow-sm flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-[#13274F]" />
            </div>
            <div className="min-w-0">
              <h2 className={cn(
                'font-semibold text-gray-900 tracking-tight',
                hasConversation ? 'text-lg md:text-xl' : 'text-2xl md:text-3xl'
              )}>
                {greeting}
              </h2>
              {!hasConversation && (
                <p className="mt-1 text-sm md:text-[15px] text-gray-600 max-w-2xl leading-relaxed">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {hasConversation && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-600 hover:text-gray-900"
                onClick={startNewConversation}
              >
                <MessageSquarePlus className="h-4 w-4 mr-1.5" />
                New
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-600 hover:text-gray-900"
                onClick={handleOpenFullChat}
              >
                Full view
                <ArrowUpRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Conversation (only when there are messages) ──────────── */}
        {hasConversation && (
          <div className="px-6 md:px-8">
            <div className="max-h-[480px] overflow-y-auto rounded-2xl bg-white/60 backdrop-blur-sm border border-white/70 px-4 py-2">
              {messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
              ))}
              {error && (
                <div className="flex items-center gap-2 my-2 py-2.5 px-3 bg-red-50 rounded-lg text-sm text-red-700 border border-red-100">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div ref={conversationEndRef} />
            </div>
          </div>
        )}

        {/* ── Input ─────────────────────────────────────────────────── */}
        <div className="px-6 md:px-8 pt-4 pb-4">
          <div className="relative rounded-2xl bg-white border border-gray-200 shadow-sm focus-within:border-[#13274F] focus-within:ring-2 focus-within:ring-[#13274F]/10 transition-all">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); autosize(); }}
              onKeyDown={handleKeyDown}
              placeholder={hasConversation ? 'Ask a follow-up\u2026' : `Ask about ${currentCompany?.name || 'your data'}\u2026`}
              rows={1}
              className="block w-full resize-none bg-transparent px-5 py-4 pr-14 text-[15px] leading-6 text-gray-900 placeholder:text-gray-400 focus:outline-none"
              style={{ maxHeight: '180px' }}
              aria-label="Ask a question about your AI perception data"
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-2">
              {!hasConversation && (
                <span className="hidden md:inline-flex items-center text-[11px] text-gray-400 px-2 py-1 rounded-md bg-gray-50 border border-gray-100 font-mono">
                  ⌘K
                </span>
              )}
              {isLoading ? (
                <Button
                  onClick={stopStreaming}
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 rounded-xl border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
                  aria-label="Stop generating"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={!value.trim()}
                  size="icon"
                  className="h-9 w-9 rounded-xl bg-[#13274F] hover:bg-[#1a3468] text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* ── Suggestions (only before first message) ─────────────── */}
          {!hasConversation && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {hasData ? 'Suggested for you' : 'Get started'}
                </span>
                <button
                  type="button"
                  onClick={refreshQuestions}
                  disabled={questionsLoading}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 disabled:opacity-50"
                  aria-label="Refresh suggestions"
                >
                  <RefreshCw className={cn('h-3 w-3', questionsLoading && 'animate-spin')} />
                  Refresh
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {questionsLoading && questions.every((q, i) => q === DEFAULT_FALLBACK[i]) ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-xl bg-white/60" />
                  ))
                ) : (
                  questions.slice(0, 4).map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSuggestionClick(q)}
                      disabled={isLoading}
                      className="group text-left px-4 py-3 rounded-xl bg-white/80 hover:bg-white border border-gray-200/80 hover:border-gray-300 transition-all text-sm text-gray-700 hover:text-gray-900 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-[#13274F]/60 group-hover:text-[#13274F] flex-shrink-0" />
                        <span className="leading-snug">{q}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <p className="mt-3 text-[11px] text-gray-400 text-center">
                Grounded in your data. I\u2019ll tell you plainly when something isn\u2019t tracked.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Matches the static fallback used by the hook — if the hook is still
// serving these, we show skeletons instead of the raw fallback strings.
const DEFAULT_FALLBACK = [
  'How is our brand perceived across AI models right now?',
  'What themes come up most often in AI responses about us?',
  'Which competitors are AI models mentioning alongside us?',
  'Which sources are AI models citing when they describe us?',
];
