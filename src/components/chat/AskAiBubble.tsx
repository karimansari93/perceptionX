import { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, MessageCircle, X } from 'lucide-react';
import { useCompany } from '@/contexts/CompanyContext';
import { ASK_AI_ENABLED, ASK_AI_TITLE } from '@/lib/askAi';
import { nudgeFor } from '@/lib/askAiNudges';
import type { ChatScope } from '@/services/chatService';
import { cn } from '@/lib/utils';

interface AskAiBubbleProps {
  /** Dashboard tab the user is on (overview, competitors, sources, …). */
  section: string;
  companyName?: string;
  /** Selected market label (null = all locations). */
  market?: string | null;
  /** Selected job function ('all' = every function). */
  jobFunction?: string;
}

interface Focus {
  area: string | null;
  subject: string | null;
}

// How long the pill glows after the user clicks something new.
const PULSE_MS = 4000;
// The question slides out beside the icon once the user has settled on a tab.
const TEXT_DELAY_MS = 2000;

// The floating Ask PerceptionX bubble (bottom right of the dashboard). It
// is a pill with the icon and a question that follows what the user is
// looking at: "Got a question about your competitors?" on the Competitors
// tab, and "Got a question about Globex?" once they click Globex (any
// element carrying data-ask-subject: a competitor, source or theme). Opening it
// shows tailored starter questions and a composer; asking hands over to the
// Answer page exactly like the overview's chat box, under the dashboard's
// current company, market and job function.
export function AskAiBubble({ section, companyName, market, jobFunction }: AskAiBubbleProps) {
  const navigate = useNavigate();
  const { currentCompany } = useCompany();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [showText, setShowText] = useState(false);
  const [focus, setFocus] = useState<Focus>({ area: null, subject: null });
  const [value, setValue] = useState('');

  const brand = currentCompany?.name ?? companyName ?? null;
  const nudge = useMemo(
    () => nudgeFor({ section, area: focus.area, subject: focus.subject, companyName: brand }),
    [section, focus, brand]
  );

  // A new tab resets the focus to the tab-level question, shown beside the
  // icon after a couple of seconds on the tab.
  useEffect(() => {
    setFocus({ area: null, subject: null });
    setNudging(false);
    setShowText(false);
    const t = window.setTimeout(() => setShowText(true), TEXT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [section]);

  // Watch clicks on the dashboard for things the user is digging into.
  useEffect(() => {
    if (!ASK_AI_ENABLED) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || rootRef.current?.contains(target)) return;
      const subjectEl = target.closest?.('[data-ask-subject]');
      const subject = subjectEl?.getAttribute('data-ask-subject')?.trim();
      if (!subject) return;
      const area = subjectEl?.closest('[data-tour]')?.getAttribute('data-tour') ?? null;
      setFocus({ area, subject });
      setShowText(true);
      if (!open) setNudging(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [open]);

  // The glow fades on its own so the bubble never nags.
  useEffect(() => {
    if (!nudging) return;
    const t = window.setTimeout(() => setNudging(false), PULSE_MS);
    return () => window.clearTimeout(t);
  }, [nudging, focus]);

  const openPanel = useCallback(() => {
    setNudging(false);
    setOpen(true);
    // An open detail sheet hands focus back to its trigger as it closes;
    // take it after that.
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }, []);

  const ask = useCallback((question: string) => {
    const q = question.trim();
    if (!q) return;
    const scope: ChatScope = {
      company: brand,
      locations: market ? [market] : [],
      jobFunctions: jobFunction && jobFunction !== 'all' ? [jobFunction] : [],
    };
    setOpen(false);
    setValue('');
    navigate('/chat', { state: { question: q, scope } });
  }, [brand, market, jobFunction, navigate]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); ask(value); }
    if (e.key === 'Escape') setOpen(false);
  }, [ask, value]);

  if (!ASK_AI_ENABLED) return null;

  return (
    <div
      ref={rootRef}
      // Detail sheets disable pointer events on <body>; the bubble stays usable.
      style={{ pointerEvents: 'auto' }}
      className="fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-3"
    >
      {open && (
        <section
          role="dialog"
          aria-label={ASK_AI_TITLE}
          className="w-[min(380px,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-[#0DBCBA]/30 bg-white shadow-[0_12px_40px_rgba(19,39,79,.18)] animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <header className="flex items-center justify-between bg-[#13274F] px-4 py-3 text-white">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="h-4 w-4" />
              {ASK_AI_TITLE}
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div
            className="space-y-3 px-4 pb-4 pt-3.5"
            style={{ background: 'radial-gradient(120% 130% at 100% 0%, rgba(216,239,240,.6), #fff 60%)' }}
          >
            <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-[#13274F]/[0.06] px-3.5 py-2.5 text-[14px] leading-snug text-[#13274F]">
              {nudge.prompt} I can answer from your own dashboard data.
            </p>

            <div className="flex flex-col items-start gap-1.5">
              {nudge.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#13274F]/[0.12] bg-white px-3 py-1.5 text-left text-[12.5px] text-gray-600 transition-colors hover:border-[#DB5E89] hover:text-[#13274F]"
                >
                  <span className="truncate">{s}</span>
                  <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-gray-400" />
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={nudge.placeholder}
                className="h-10 flex-1 rounded-xl border-[1.5px] border-[#13274F]/30 bg-white px-3 text-[14px] text-[#13274F] placeholder:text-gray-400 focus:border-[#13274F] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => ask(value)}
                disabled={!value.trim()}
                aria-label="Ask PerceptionX"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#13274F] text-white transition-colors hover:bg-[#183056] disabled:opacity-40"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      {open ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Ask PerceptionX"
          aria-expanded
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[#13274F] text-white shadow-[0_8px_24px_rgba(19,39,79,.28)] transition-colors hover:bg-[#183056]"
        >
          <X className="h-6 w-6" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openPanel}
          aria-expanded={false}
          aria-label={showText ? undefined : 'Open Ask PerceptionX'}
          className={cn(
            'flex h-14 max-w-[min(360px,calc(100vw-2.5rem))] items-center gap-2.5 rounded-full bg-[#13274F] text-left text-white shadow-[0_8px_24px_rgba(19,39,79,.28)] transition-all hover:-translate-y-0.5 hover:bg-[#183056]',
            showText ? 'pl-4 pr-5' : 'w-14 justify-center',
            nudging && 'ring-4 ring-[#0DBCBA]/40'
          )}
        >
          <MessageCircle className="h-6 w-6 flex-shrink-0" />
          {showText && (
            <span key={nudge.prompt} className="truncate text-[14px] font-medium animate-in fade-in slide-in-from-right-2 duration-300">{nudge.prompt}</span>
          )}
        </button>
      )}
    </div>
  );
}
