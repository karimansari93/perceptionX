import { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useStarterQuestions } from '@/hooks/useStarterQuestions';
import { ASK_AI_ENABLED, greetingFor } from '@/lib/askAi';
import type { ChatScope } from '@/services/chatService';
import { ScopePickers, scopeSummary, useScopeOptions } from './ChatScopeBar';
import { cn } from '@/lib/utils';

interface AskAiHeroProps {
  companyName?: string;
  /** Selected market label (null = all locations) — pre-ticks the markets. */
  market?: string | null;
  /** Selected job function ('all' = every function) — pre-ticks the functions. */
  jobFunction?: string;
}

// The overview's chat box. Step one is the scope — which markets and job
// functions (several of each are fine), pre-ticked from the dashboard
// filters — then the question. Asking opens the full Ask PerceptionX page
// with the question already sent under that scope, so every answer goes
// through the same analyst (and the same rulebook) as the sidebar chat and
// the ChatGPT/Claude connectors.
export function AskAiHero({ companyName, market, jobFunction }: AskAiHeroProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const organizationId = currentCompany?.organization_id;
  const { questions, isLoading } = useStarterQuestions(organizationId);
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [scope, setScope] = useState<ChatScope>(() => ({
    company: currentCompany?.name ?? companyName ?? null,
    locations: market ? [market] : [],
    jobFunctions: jobFunction && jobFunction !== 'all' ? [jobFunction] : [],
  }));
  // Follow the dashboard filters while the user hasn't customised the scope here.
  const touchedRef = useRef(false);
  useEffect(() => {
    if (touchedRef.current) return;
    setScope({
      company: currentCompany?.name ?? companyName ?? null,
      locations: market ? [market] : [],
      jobFunctions: jobFunction && jobFunction !== 'all' ? [jobFunction] : [],
    });
  }, [currentCompany?.name, companyName, market, jobFunction]);
  const onScopeChange = useCallback((s: ChatScope) => { touchedRef.current = true; setScope(s); }, []);
  const { options } = useScopeOptions(organizationId, scope.company);

  const ask = useCallback((question: string) => {
    const q = question.trim();
    if (!q) return;
    navigate('/chat', { state: { question: q, scope } });
  }, [navigate, scope]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(value);
    }
  }, [ask, value]);

  if (!ASK_AI_ENABLED) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
        <p className="text-gray-600">
          Get a comprehensive view of {companyName}'s AI perception metrics, performance trends, and key insights.
        </p>
      </div>
    );
  }

  return (
    <section
      data-tour="ask-ai"
      className="flex-shrink-0 rounded-2xl border border-[#13274F]/10 bg-gradient-to-br from-white via-white to-[#0DBCBA]/10 shadow-sm px-5 py-4 sm:px-6"
    >
      <div className="flex items-center gap-3 mb-3">
        <img alt="PerceptionX" className="h-8 w-8 object-contain rounded-full" src="/logos/PinkBadge.png" />
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{greetingFor(user)}</h2>
          <p className="text-sm text-gray-500 truncate">
            Ask anything about how AI describes {companyName || 'your organisation'} to candidates.
          </p>
        </div>
      </div>

      {/* Step 1: scope */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mr-1">Ask about</span>
        <ScopePickers scope={scope} options={options} onChange={onScopeChange} size="sm" />
      </div>

      {/* Step 2: question */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask about anything…"
          className="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-[#13274F] focus:outline-none focus:ring-1 focus:ring-[#13274F]"
          style={{ maxHeight: '80px' }}
        />
        <button
          type="button"
          onClick={() => ask(value)}
          disabled={!value.trim()}
          aria-label="Ask PerceptionX"
          className="h-10 w-10 rounded-xl flex-shrink-0 bg-[#13274F] hover:bg-[#1a3468] text-white disabled:opacity-40 flex items-center justify-center transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex gap-2 min-w-0">
        {questions.map((q, i) => (
          <button
            key={`${i}-${q}`}
            type="button"
            onClick={() => ask(q)}
            className={cn(
              'group inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-[#13274F]/40 hover:text-[#13274F] transition-colors',
              isLoading && 'animate-pulse'
            )}
          >
            <span className="truncate" title={q}>{q}</span>
            <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-gray-300 group-hover:text-[#13274F]" />
          </button>
        ))}
      </div>
    </section>
  );
}
