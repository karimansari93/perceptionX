import { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { ASK_AI_ENABLED, greetingFor } from '@/lib/askAi';
import type { ChatScope } from '@/services/chatService';
import { BrandLogo, ScopePickers, useScopeOptions } from './ChatScopeBar';
import { AttachButton, DraftAttachments, dropRing, useFileDraft } from './ChatAttachments';
import { DEFAULT_FILE_QUESTION } from '@/lib/chatAttachments';
import { setHandoverFiles } from '@/lib/chatHandover';
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
// functions, pre-ticked from the dashboard filters) and the composer, kept
// compact so it shares the top row with the actions card. Asking opens the Answer page with the question already sent
// under that scope.
export function AskAiHero({ companyName, market, jobFunction }: AskAiHeroProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentCompany, viewAsMember } = useCompany();
  const organizationId = currentCompany?.organization_id;
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const attach = useFileDraft();
  const ask = useCallback((question: string) => {
    const q = question.trim() || (attach.files.length ? DEFAULT_FILE_QUESTION : '');
    if (!q) return;
    setHandoverFiles(attach.files);
    attach.clear();
    navigate('/chat', { state: { question: q, scope } });
  }, [navigate, scope, attach]);

  // Enter sends, Shift+Enter adds a line (as in ChatGPT).
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(value); }
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
      {...attach.dropProps}
      className={cn('relative isolate flex h-full flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-[#0DBCBA]/[0.28] px-4 py-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300', dropRing(attach.dragging))}
      style={{ background: 'radial-gradient(120% 130% at 100% 0%, rgba(216,239,240,.75), rgba(236,248,248,.5) 40%, #fff 72%)' }}
    >
      {/* Brand mark: a faint dark-blue P on the right that fades into the card. Behind
          the content (-z-10 inside the isolated card), never clickable. */}
      <img
        src="/logos/P-Icon-Dark-large.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 top-1/2 -z-10 h-[150%] -translate-y-1/2 select-none opacity-[0.07]"
        style={{ maskImage: 'linear-gradient(to left, black 30%, transparent 85%)', WebkitMaskImage: 'linear-gradient(to left, black 30%, transparent 85%)' }}
      />
      {/* Greeting row */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[#13274F]/10 bg-white p-[3px]">
          <BrandLogo name={brand} className="h-full w-full" />
        </span>
        <h2 className="min-w-0 truncate font-headline text-[18px] font-bold leading-[1.2] tracking-[-0.02em] text-[#13274F]">
          {viewAsMember ? `Hey ${viewAsMember.name.split(' ')[0]}, what do you want to do today?` : greetingFor(user)}
        </h2>
      </div>

      {/* Scope row and composer, pinned to the bottom when the card is taller
          than its content (it shares a row with the actions card). */}
      <div className="mt-auto pt-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">Ask about</span>
        <ScopePickers scope={scope} options={options} onChange={onScopeChange} variant="pill" />
      </div>
      {/* Composer: a roomy box like ChatGPT's, text on top, attach and send
          along its bottom edge. Clicking anywhere in it focuses the text. */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="cursor-text rounded-2xl border-[1.5px] border-[#13274F]/25 bg-white px-3.5 pb-2.5 pt-3 shadow-[0_2px_8px_rgba(19,39,79,.06)] transition-colors focus-within:border-[#13274F]/60"
      >
        <DraftAttachments files={attach.files} onRemove={attach.remove} />
        <textarea
          ref={inputRef}
          value={value}
          rows={2}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={attach.files.length ? 'Ask about these files, or send to get the key insights' : `Ask how AI describes ${brand} to candidates, or attach a report…`}
          className="block max-h-40 min-h-[48px] w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed text-[#13274F] placeholder:text-gray-400 focus:outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <AttachButton onFiles={attach.add} count={attach.files.length} />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); ask(value); }}
            aria-label="Ask PerceptionX"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#13274F] text-white transition-colors hover:bg-[#183056] disabled:opacity-30"
            disabled={!value.trim() && !attach.files.length}
          >
            <ArrowUp className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
      </div>

    </section>
  );
}
