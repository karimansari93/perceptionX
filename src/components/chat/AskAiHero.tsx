import { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useStarterQuestions } from '@/hooks/useStarterQuestions';
import { ASK_AI_ENABLED, greetingFor } from '@/lib/askAi';
import type { ChatScope } from '@/services/chatService';
import { BrandLogo, ScopePickers, useScopeOptions } from './ChatScopeBar';
import { cn } from '@/lib/utils';

interface AskAiHeroProps {
  companyName?: string;
  /** Selected market label (null = all locations) — pre-ticks the markets. */
  market?: string | null;
  /** Selected job function ('all' = every function) — pre-ticks the functions. */
  jobFunction?: string;
}

// The overview's hero chat block (design handoff, "Overview"): greeting with
// the company's logo, the ASK ABOUT scope chips (company · markets ·
// functions, pre-ticked from the dashboard filters), the composer, and the
// four data-grounded starters as teal pills. Asking opens the Answer page
// with the question already sent under that scope.
export function AskAiHero({ companyName, market, jobFunction }: AskAiHeroProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const organizationId = currentCompany?.organization_id;
  const { starters, isLoading } = useStarterQuestions(organizationId);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); ask(value); }
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

  const brand = scope.company ?? companyName ?? 'your organisation';

  return (
    <section
      data-tour="ask-ai"
      className="flex-shrink-0 rounded-2xl border border-[#0DBCBA]/[0.28] px-[22px] pt-5 pb-[18px] animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ background: 'radial-gradient(120% 130% at 100% 0%, rgba(216,239,240,.75), rgba(236,248,248,.5) 40%, #fff 72%)' }}
    >
      {/* Greeting row */}
      <div className="flex items-start gap-3">
        <span className="mt-[1px] flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg border border-[#13274F]/10 bg-white p-[3px]">
          <BrandLogo name={brand} className="h-full w-full" />
        </span>
        <div className="min-w-0">
          <h2 className="font-headline text-[23px] font-bold leading-[1.2] tracking-[-0.02em] text-[#13274F]">{greetingFor(user)}</h2>
          <p className="mt-[3px] text-[13.5px] text-gray-500">Ask anything about how AI describes {brand} to candidates.</p>
        </div>
      </div>

      {/* Scope row */}
      <div className="mt-[14px] mb-[11px] flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">Ask about</span>
        <ScopePickers scope={scope} options={options} onChange={onScopeChange} variant="pill" />
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2.5">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about anything…"
          className="h-[46px] flex-1 rounded-xl border-[1.5px] border-[#13274F]/35 bg-white px-[15px] text-[15px] text-[#13274F] shadow-[0_1px_2px_rgba(19,39,79,.06)] placeholder:text-gray-400 focus:border-[#13274F] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => ask(value)}
          aria-label="Ask PerceptionX"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#13274F] text-white transition-colors hover:bg-[#183056] disabled:opacity-40"
          disabled={!value.trim()}
        >
          <ArrowRight className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Suggestion pills — three of the four starters; the visibility one is dropped here. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {starters.slice(1, 4).map((s, i) => (
          <button
            key={`${i}-${s.title}`}
            type="button"
            onClick={() => ask(s.title)}
            title={s.sub || undefined}
            className={cn(
              'inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full border border-[#0DBCBA]/35 bg-[#0DBCBA]/[0.09] px-[11px] text-[12.5px] text-[#0F6E6D] transition-colors hover:border-[#0DBCBA] hover:bg-[#0DBCBA]/[0.16]',
              isLoading && 'animate-pulse'
            )}
          >
            <span className="truncate">{s.title}</span>
            <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-[#0DBCBA]/85" />
          </button>
        ))}
      </div>
    </section>
  );
}
