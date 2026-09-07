import { useCallback, useRef, useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useStarterQuestions } from '@/hooks/useStarterQuestions';
import { ASK_AI_ENABLED, greetingFor } from '@/lib/askAi';
import { cn } from '@/lib/utils';

interface AskAiHeroProps {
  companyName?: string;
  /** Selected market label (null = all locations) — travels with the question. */
  market?: string | null;
  /** Selected job function ('all' = every function) — travels with the question. */
  jobFunction?: string;
}

// The overview's chat box. Typing a question here opens the full Ask
// PerceptionX page with that question already sent, so every answer goes
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

  // The dashboard's filters travel with the question, so the chat asks (and
  // says it asks) about this company, market and function.
  const scopeCompany = currentCompany?.name ?? companyName ?? null;
  const scopeLocation = market ?? null;
  const scopeFunction = jobFunction && jobFunction !== 'all' ? jobFunction : null;
  const scopeLabel = [scopeCompany, scopeLocation ?? 'All locations', scopeFunction ?? 'All functions'].filter(Boolean).join(' · ');

  const ask = useCallback((question: string) => {
    const q = question.trim();
    if (!q) return;
    navigate('/chat', {
      state: { question: q, scope: { company: scopeCompany, location: scopeLocation, jobFunction: scopeFunction } },
    });
  }, [navigate, scopeCompany, scopeLocation, scopeFunction]);

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
      className="rounded-2xl border border-[#13274F]/10 bg-gradient-to-br from-white via-white to-[#0DBCBA]/10 shadow-sm px-6 py-6 sm:px-8 sm:py-7"
    >
      <div className="flex items-center gap-3 mb-4">
        <img alt="PerceptionX" className="h-9 w-9 object-contain rounded-full" src="/logos/PinkBadge.png" />
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">{greetingFor(user)}</h2>
          <p className="text-sm text-gray-500 truncate">
            Ask anything about how AI describes {companyName || 'your organisation'} to candidates.
            <span className="text-gray-400"> Asking about: {scopeLabel}.</span>
          </p>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="e.g. Which Glassdoor pages come up most, with links?"
          className="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:border-[#13274F] focus:outline-none focus:ring-1 focus:ring-[#13274F]"
          style={{ maxHeight: '120px' }}
        />
        <button
          type="button"
          onClick={() => ask(value)}
          disabled={!value.trim()}
          aria-label="Ask PerceptionX"
          className="h-11 w-11 rounded-xl flex-shrink-0 bg-[#13274F] hover:bg-[#1a3468] text-white disabled:opacity-40 flex items-center justify-center transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {questions.map((q, i) => (
          <button
            key={`${i}-${q}`}
            type="button"
            onClick={() => ask(q)}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-[#13274F]/40 hover:text-[#13274F] transition-colors',
              isLoading && 'animate-pulse'
            )}
          >
            <span>{q}</span>
            <ArrowUpRight className="h-3 w-3 text-gray-300 group-hover:text-[#13274F]" />
          </button>
        ))}
      </div>
    </section>
  );
}
