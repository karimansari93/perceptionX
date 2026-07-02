// The conversational intake as a screen-per-question wizard: one question at a
// time, the question text typed out ChatGPT-style, and free back/forward
// navigation like a classic onboarding. Answers commit straight into the
// payload, so moving back and forth never loses anything.
//
// The screen list is dynamic: with more than one market the flow asks whether
// functions are uniform, and "different by market" expands into one screen per
// market ("Which functions matter in Germany?"), pre-filled from the previous
// market so shared setups take one tap.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  CANONICAL_JOB_FUNCTIONS,
  IntakePayload,
  MANAGED_PLATFORM_OPTIONS,
  isValidUrl,
  normalizeJobFunction,
  normalizeUrl,
  validateForSubmit,
} from '@/lib/intake/types';
import { marketFunctionPairs } from '@/lib/intake/generateConfirmedPrompts';
import { saveIntakeDraft, submitIntake } from '@/lib/intake/api';
import { COUNTRY_NAMES } from '@/lib/marketName';
import { DemoDataCard } from './DemoDataCard';
import {
  Chip,
  ChipAdder,
  ContinueButton,
  CountryPicker,
  EntityEditor,
  MultiChipSelect,
  PriorityEditor,
  PropertyEditor,
  RecipientEditor,
  SkipButton,
  focusRing,
  inputClass,
} from './inputs';

// ---------------------------------------------------------------------------
// Screen list (dynamic)
// ---------------------------------------------------------------------------

const MF_PREFIX = 'mf:';
const ESC_PREFIX = 'esc:'; // per-sub-brand scope screen

/** Tracked-separately sub-brands, in entry order. */
function trackedSubBrands(p: IntakePayload) {
  return p.employer_entities.filter((e) => e.track_separately && e.name.trim());
}

function buildScreenIds(p: IntakePayload): string[] {
  const ids = ['welcome', 'entities', 'functions', 'markets'];
  if (p.markets.length > 1) ids.push('scope');
  if (p.markets.length > 1 && p.function_scope === 'per_market') {
    ids.push(...p.markets.map((m) => MF_PREFIX + m));
  }
  // Each tracked sub-brand gets its own scope screen (inherit or its own).
  ids.push(...trackedSubBrands(p).map((e) => ESC_PREFIX + e.name.trim()));
  ids.push(
    'demo',
    'competitors',
    'industries',
    'career_site',
    'owned_properties',
    'platforms',
    'priorities',
    'leadership',
    'focus',
    'known_context',
    'recipients',
    'notes',
    'review',
  );
  return ids;
}

function sectionOf(id: string): string {
  if (id === 'welcome') return 'Welcome';
  if (
    ['entities', 'functions', 'markets', 'scope'].includes(id) ||
    id.startsWith(MF_PREFIX) ||
    id.startsWith(ESC_PREFIX)
  )
    return 'What we track';
  if (id === 'demo') return 'Your data preview';
  if (['competitors', 'industries'].includes(id)) return 'Talent market';
  if (['career_site', 'owned_properties', 'platforms'].includes(id)) return 'Your channels';
  if (['priorities', 'leadership', 'focus'].includes(id)) return 'Priorities';
  if (['known_context', 'recipients', 'notes'].includes(id)) return 'People & context';
  return 'Review & submit';
}

function questionOf(id: string, company: string, p: IntakePayload): { text: string; hint?: string } {
  if (id.startsWith(MF_PREFIX)) {
    const market = id.slice(MF_PREFIX.length);
    const idx = p.markets.indexOf(market);
    return {
      text: `Which functions matter in ${market}?`,
      hint:
        idx > 0
          ? `Pre-filled from ${p.markets[idx - 1]} — adjust for ${market}, or keep it as is.`
          : 'Pick from the functions you chose — you can vary them per market.',
    };
  }
  if (id.startsWith(ESC_PREFIX)) {
    const name = id.slice(ESC_PREFIX.length);
    return {
      text: `Does ${name} hire for the same roles and markets as ${company}?`,
      hint: `If ${name} has its own hiring footprint — different functions or countries — set it here so we track it accurately.`,
    };
  }
  switch (id) {
    case 'welcome':
      return {
        text: `Hi — I'm going to set up your PerceptionX project for ${company}. This takes about 5 minutes. I'll ask what to track and show you the kind of data you'll get back. Ready?`,
      };
    case 'entities':
      return {
        text: `Which distinct employer entities should we track and report on separately? Some companies have divisions or sub-brands with their own hiring identity — like a credit arm or a studio.`,
      };
    case 'functions':
      return {
        text: `Which job functions matter most for this project?`,
        hint: 'Pick as many as you like — these become the lens we measure through.',
      };
    case 'markets':
      return {
        text: `And which markets should we cover?`,
        hint: 'Search the list or add your own — we handle prompt language and market tiering on our side.',
      };
    case 'scope':
      return {
        text: `Do all ${p.markets.length} markets share the same functions, or does each market have its own priorities?`,
        hint: `If they differ, we'll go through each market one by one.`,
      };
    case 'demo':
      return {
        text: `Here's the shape of what you'll get. Every function and market you've picked is scored on three dimensions — Visibility, Sentiment and Relevance:`,
      };
    case 'competitors':
      return {
        text: `Who do you think you compete with for this talent?`,
        hint: `This helps us tune how we prompt the AI models — we don't track named competitors as a feature, it's context for your report.`,
      };
    case 'industries':
      return {
        text: `What industries do you compete in for talent?`,
        hint: `You can leave this blank. If you add one, we benchmark you inside it — say Biotechnology, and we'll ask the AI models questions like "What's the best Biotechnology company to work for?"`,
      };
    case 'career_site':
      return {
        text: `Your main careers page?`,
        hint: 'This is our starting point for evaluating your EVP online.',
      };
    case 'owned_properties':
      return {
        text: `Any other owned pages we should know about — LinkedIn, Instagram, grad-program microsites?`,
      };
    case 'platforms':
      return {
        text: `Which employer review platforms do you officially manage or respond on?`,
        hint: `Keeps your owned-source share accurate — and stops us recommending a lever you already control.`,
      };
    case 'priorities':
      return { text: `Your top 3–5 talent priorities for the next 12 months?` };
    case 'leadership':
      return { text: `What's the main thing leadership wants to learn from this?` };
    case 'focus':
      return { text: `Any specific questions or areas you want the report to dig into?` };
    case 'known_context':
      return {
        text: `Anything happening we should be aware of — restructuring, an RTO mandate, a news cycle, a Glassdoor spike?`,
        hint: 'It helps us read the sentiment data in context.',
      };
    case 'recipients':
      return { text: `Who should get the first draft of the report?` };
    case 'notes':
      return { text: `Anything else we should know?` };
    default:
      return {
        text: `Here's your project brief. Check it over — you can edit anything — then submit and we'll take it from there.`,
      };
  }
}

function canProceed(id: string, p: IntakePayload): boolean {
  if (id === 'functions') return p.job_functions.length > 0;
  if (id === 'markets') return p.markets.length > 0;
  if (id.startsWith(MF_PREFIX)) {
    const entry = p.market_functions.find((x) => x.market === id.slice(MF_PREFIX.length));
    return (entry?.functions.length ?? 0) > 0;
  }
  if (id.startsWith(ESC_PREFIX)) {
    const e = p.employer_entities.find((x) => x.name === id.slice(ESC_PREFIX.length));
    if (!e || e.scope_mode !== 'custom') return true;
    return (e.job_functions?.length ?? 0) > 0 && (e.markets?.length ?? 0) > 0;
  }
  if (id === 'career_site') return isValidUrl(p.career_site_url);
  if (id === 'recipients')
    return (
      p.report_recipients.length > 0 &&
      p.report_recipients.filter((r) => r.is_primary).length === 1
    );
  return true;
}

// ---------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cb = () => setReduced(mq.matches);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  }, []);
  return reduced;
}

/** ChatGPT-style typewriter for the question text. Instant under reduced motion. */
function TypeText({ text, onDone }: { text: string; onDone: () => void }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? text.length : 0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (reduced) {
      setShown(text.length);
      onDoneRef.current();
      return;
    }
    setShown(0);
    let i = 0;
    const timer = setInterval(() => {
      i += 2; // two chars a tick reads fluid without dragging
      setShown(i);
      if (i >= text.length) {
        clearInterval(timer);
        onDoneRef.current();
      }
    }, 14);
    return () => clearInterval(timer);
  }, [text, reduced]);

  return (
    <span aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {shown < text.length && (
        <span aria-hidden className="inline-block w-[2px] h-[1.1em] align-text-bottom bg-pink ml-0.5 animate-pulse" />
      )}
    </span>
  );
}

interface IntakeWizardProps {
  token: string;
  companyName: string;
  initialDraft: IntakePayload | null;
  initialPayload: IntakePayload;
}

export function IntakeWizard({ token, companyName, initialDraft, initialPayload }: IntakeWizardProps) {
  const [payload, setPayload] = useState<IntakePayload>(() => {
    const base = initialDraft ?? initialPayload;
    // Older drafts predate function_scope — backfill defaults.
    return { function_scope: 'uniform', market_functions: [], ...base };
  });
  const screens = useMemo(() => buildScreenIds(payload), [payload]);
  const [currentId, setCurrentId] = useState<string>(() => {
    const saved = initialDraft?.meta?.step;
    return typeof saved === 'string' ? saved : 'welcome';
  });
  const [typed, setTyped] = useState(false);
  const [visitedReview, setVisitedReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // If the current screen no longer exists (e.g. a market was removed), fall
  // back to the nearest surviving screen.
  const idx = screens.indexOf(currentId);
  useEffect(() => {
    if (idx === -1) setCurrentId(screens[Math.min(screens.length - 1, 3)]);
  }, [idx, screens]);

  useEffect(() => {
    if (currentId === 'review') setVisitedReview(true);
  }, [currentId]);

  // Pre-fill a market's functions the first time its screen opens: previous
  // market's selection (shared setups take one tap) or the full function list.
  useEffect(() => {
    if (!currentId.startsWith(MF_PREFIX)) return;
    const market = currentId.slice(MF_PREFIX.length);
    setPayload((p) => {
      if (p.market_functions.some((x) => x.market === market)) return p;
      const mIdx = p.markets.indexOf(market);
      const prev = mIdx > 0 ? p.market_functions.find((x) => x.market === p.markets[mIdx - 1]) : null;
      return {
        ...p,
        market_functions: [
          ...p.market_functions,
          { market, functions: prev ? [...prev.functions] : [...p.job_functions] },
        ],
      };
    });
  }, [currentId]);

  // Server-side draft persistence (resumable via token) so a client can close
  // the tab and come back later. Saves are debounced AND serialized through a
  // promise chain: two in-flight requests could land out of order and leave a
  // stale snapshot as the stored draft.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const latestSnapshot = useRef<IntakePayload | null>(null);
  const savedRef = useRef<string>(''); // JSON of the last snapshot we sent
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const flushSave = useCallback(() => {
    const snap = latestSnapshot.current;
    if (!snap) return;
    const key = JSON.stringify(snap);
    if (key === savedRef.current) return; // nothing new since last save
    savedRef.current = key;
    saveChain.current = saveChain.current.then(() => saveIntakeDraft(token, snap)).catch(() => {});
  }, [token]);

  // Debounced save for within-screen edits (typing, chip toggles).
  useEffect(() => {
    if (submitted) return;
    latestSnapshot.current = { ...payload, meta: { step: currentId } };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
    return () => clearTimeout(saveTimer.current);
  }, [payload, currentId, submitted, flushSave]);

  // Crossing to a new screen is a durable checkpoint: flush immediately so the
  // resume pointer is always current even if the tab closes mid-flow.
  useEffect(() => {
    if (submitted) return;
    latestSnapshot.current = { ...payloadRef.current, meta: { step: currentId } };
    flushSave();
  }, [currentId, submitted, flushSave]);

  // Belt-and-braces: also flush the moment the tab is hidden or the page is
  // being unloaded (mobile app-switch, closing the tab), not only on the timer.
  useEffect(() => {
    if (submitted) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushSave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushSave);
    };
  }, [submitted, flushSave]);

  // Accepts a partial or an updater so rapid same-tick updates (fast clicks)
  // never work from a stale payload.
  const patch = useCallback(
    (p: Partial<IntakePayload> | ((prev: IntakePayload) => Partial<IntakePayload>)) => {
      setPayload((prev) => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) }));
    },
    [],
  );

  const go = useCallback(
    (target: string) => {
      setTyped(false);
      setCurrentId(target);
    },
    [],
  );
  const goNext = useCallback(() => {
    const i = screens.indexOf(currentId);
    if (i >= 0 && i < screens.length - 1) go(screens[i + 1]);
  }, [screens, currentId, go]);
  const goBack = useCallback(() => {
    const i = screens.indexOf(currentId);
    if (i > 0) go(screens[i - 1]);
  }, [screens, currentId, go]);

  const problems = useMemo(() => validateForSubmit(payload), [payload]);

  const handleSubmit = useCallback(async () => {
    if (problems.length > 0) {
      toast.error(problems[0]);
      return;
    }
    setSubmitting(true);
    const clean: IntakePayload = {
      ...payload,
      career_site_url: normalizeUrl(payload.career_site_url),
    };
    const res = await submitIntake(token, clean);
    setSubmitting(false);
    if (res.ok || res.error === 'already_submitted') {
      setSubmitted(true);
    } else {
      toast.error('That didn’t go through — give it another try in a moment.');
    }
  }, [payload, problems, token]);

  const question = questionOf(currentId, companyName, payload);
  const proceedOk = canProceed(currentId, payload);
  const showBackToReview =
    visitedReview && currentId !== 'review' && proceedOk && !submitted;

  // Section-level progress for the header: one segment per section (Welcome
  // excluded), the active segment filling as its screens complete.
  const sections = useMemo(() => {
    const list: string[] = [];
    for (const id of screens) {
      const s = sectionOf(id);
      if (s !== 'Welcome' && list[list.length - 1] !== s) list.push(s);
    }
    return list;
  }, [screens]);
  const currentSection = sectionOf(currentId);
  const sectionScreens = screens.filter((id) => sectionOf(id) === currentSection);
  const within = (sectionScreens.indexOf(currentId) + 1) / Math.max(sectionScreens.length, 1);

  if (submitted) {
    return (
      <Frame
        companyName={companyName}
        section="All done"
        sections={sections}
        sectionIndex={sections.length}
        within={1}
      >
        <div className="max-w-xl mx-auto text-center space-y-3 py-16">
          <h2 className="font-headline font-semibold text-nightsky text-xl">
            Thank you — your project brief is in.
          </h2>
          <p className="text-sm text-slate-600">
            Our team will review it and be in touch at the address we have on file. You can close
            this page.
          </p>
        </div>
      </Frame>
    );
  }

  return (
    <Frame
      companyName={companyName}
      section={currentSection}
      sections={sections}
      sectionIndex={sections.indexOf(currentSection)}
      within={within}
    >
      <div className="max-w-xl mx-auto w-full flex flex-col min-h-full">
        {/* Question */}
        <div className="pt-10 sm:pt-16 pb-6">
          {idx > 0 && (
            <button
              type="button"
              onClick={goBack}
              className={`mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-nightsky rounded ${focusRing}`}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
          )}
          <h2 className="font-headline font-semibold text-nightsky text-lg sm:text-2xl leading-snug min-h-[2.5em]">
            <TypeText key={currentId} text={question.text} onDone={() => setTyped(true)} />
          </h2>
          {question.hint && (
            <p
              className={`mt-2 text-sm text-slate-500 transition-opacity duration-300 ${
                typed ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {question.hint}
            </p>
          )}
        </div>

        {/* Answer area — fades in once the question has finished typing */}
        <div
          className={`pb-12 transition-opacity duration-300 ${typed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <ScreenControl
            id={currentId}
            companyName={companyName}
            payload={payload}
            patch={patch}
            goNext={goNext}
            problems={problems}
            submitting={submitting}
            onSubmit={handleSubmit}
            onJump={go}
          />
          {showBackToReview && (
            <div className="mt-4 flex justify-center">
              <SkipButton label="Back to review" onClick={() => go('review')} />
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
}

function Frame({
  companyName,
  section,
  sections,
  sectionIndex,
  within,
  children,
}: {
  companyName: string;
  section: string;
  sections: string[];
  /** Index of the active section in `sections`; -1 on Welcome, length when done. */
  sectionIndex: number;
  /** 0..1 completion inside the active section. */
  within: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-[100dvh] bg-gradient-to-b from-white to-[#FFE4EC]">
      <header className="shrink-0 sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-nightsky/[0.06]">
        <div className="max-w-xl mx-auto px-4">
          <div className="flex items-center justify-between gap-4 pt-4 pb-3">
            <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-6 w-auto" />
            <p className="text-xs text-slate-400 truncate">
              Setting up <span className="font-semibold text-nightsky">{companyName}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 pb-3.5">
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal whitespace-nowrap"
              aria-live="polite"
            >
              {section}
            </span>
            <div className="flex-1 flex items-center gap-1.5" aria-hidden>
              {sections.map((s, i) => (
                <div key={s} className="flex-1 h-1 rounded-full bg-nightsky/[0.08] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-teal transition-[width] duration-500 motion-reduce:transition-none"
                    style={{
                      width:
                        i < sectionIndex ? '100%' : i === sectionIndex ? `${Math.round(within * 100)}%` : '0%',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-screen controls — all commit straight into the payload
// ---------------------------------------------------------------------------

interface ScreenControlProps {
  id: string;
  companyName: string;
  payload: IntakePayload;
  patch: (p: Partial<IntakePayload> | ((prev: IntakePayload) => Partial<IntakePayload>)) => void;
  goNext: () => void;
  problems: string[];
  submitting: boolean;
  onSubmit: () => void;
  onJump: (id: string) => void;
}

function ScreenControl({
  id,
  companyName,
  payload,
  patch,
  goNext,
  problems,
  submitting,
  onSubmit,
  onJump,
}: ScreenControlProps) {
  const next = (label = 'Continue', disabled = false) => (
    <div className="flex justify-end pt-4">
      <ContinueButton label={label} onClick={goNext} disabled={disabled} />
    </div>
  );

  if (id.startsWith(MF_PREFIX)) {
    const market = id.slice(MF_PREFIX.length);
    const mIdx = payload.markets.indexOf(market);
    const prevMarket = mIdx > 0 ? payload.markets[mIdx - 1] : null;
    const entry = payload.market_functions.find((x) => x.market === market);
    const selected = entry?.functions ?? [];
    const setFns = (functions: string[]) =>
      patch((prev) => ({
        market_functions: [
          ...prev.market_functions.filter((x) => x.market !== market),
          { market, functions },
        ],
      }));
    const toggle = (v: string) =>
      patch((prev) => {
        const cur = prev.market_functions.find((x) => x.market === market)?.functions ?? [];
        const functions = cur.some((x) => x.toLowerCase() === v.toLowerCase())
          ? cur.filter((x) => x.toLowerCase() !== v.toLowerCase())
          : [...cur, v];
        return {
          market_functions: [
            ...prev.market_functions.filter((x) => x.market !== market),
            { market, functions },
          ],
        };
      });
    const prevFns = prevMarket
      ? payload.market_functions.find((x) => x.market === prevMarket)?.functions
      : null;
    // Forgot a function earlier? Adding one here also joins the master list,
    // so it's available on every other market screen.
    const addCustom = (v: string) => {
      const canon = normalizeJobFunction(v);
      if (!canon) return;
      patch((prev) => {
        const cur = prev.market_functions.find((x) => x.market === market)?.functions ?? [];
        return {
          job_functions: prev.job_functions.some((x) => x.toLowerCase() === canon.toLowerCase())
            ? prev.job_functions
            : [...prev.job_functions, canon],
          market_functions: [
            ...prev.market_functions.filter((x) => x.market !== market),
            {
              market,
              functions: cur.some((x) => x.toLowerCase() === canon.toLowerCase())
                ? cur
                : [...cur, canon],
            },
          ],
        };
      });
    };
    return (
      <div className="space-y-3">
        <MultiChipSelect
          options={payload.job_functions}
          selected={selected}
          onToggle={toggle}
          onAddCustom={addCustom}
          addPlaceholder={`Forgot one? Add a function for ${market}`}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          {prevFns && prevFns.length > 0 && (
            <SkipButton label={`Same as ${prevMarket}`} onClick={() => { setFns([...prevFns]); }} />
          )}
          <SkipButton label="All of them" onClick={() => setFns([...payload.job_functions])} />
        </div>
        {next('Continue', selected.length === 0)}
      </div>
    );
  }

  // Sub-brand scope: inherit the parent's functions/markets, or set its own.
  if (id.startsWith(ESC_PREFIX)) {
    const name = id.slice(ESC_PREFIX.length);
    const entity = payload.employer_entities.find((e) => e.name === name);
    if (!entity) return null;
    const mode = entity.scope_mode ?? 'inherit';
    const funcs = entity.job_functions ?? [];
    const markets = entity.markets ?? [];

    const updateEntity = (fn: (e: typeof entity) => Partial<typeof entity>) =>
      patch((prev) => ({
        employer_entities: prev.employer_entities.map((e) =>
          e.name === name ? { ...e, ...fn(e) } : e,
        ),
      }));

    const chooseInherit = () =>
      updateEntity(() => ({ scope_mode: 'inherit' }));
    const chooseCustom = () =>
      updateEntity((e) => ({
        scope_mode: 'custom',
        // Seed from the parent so shared roles/markets are one edit away.
        job_functions: e.job_functions ?? [...payload.job_functions],
        markets: e.markets ?? [...payload.markets],
      }));
    const toggleFn = (v: string) => {
      const canon = normalizeJobFunction(v);
      if (!canon) return;
      updateEntity((e) => {
        const cur = e.job_functions ?? [];
        const has = cur.some((x) => x.toLowerCase() === canon.toLowerCase());
        return {
          job_functions: has
            ? cur.filter((x) => x.toLowerCase() !== canon.toLowerCase())
            : [...cur, canon],
        };
      });
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Chip
            label={`Same as ${companyName}`}
            selected={mode === 'inherit'}
            onClick={chooseInherit}
          />
          <Chip
            label="It has its own roles & markets"
            selected={mode === 'custom'}
            onClick={chooseCustom}
          />
        </div>

        {mode === 'custom' && (
          <div className="space-y-4 rounded-2xl border border-silver bg-white/60 p-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Functions for {name}
              </p>
              <MultiChipSelect
                options={
                  payload.job_functions.length ? payload.job_functions : [...CANONICAL_JOB_FUNCTIONS]
                }
                selected={funcs}
                onToggle={toggleFn}
                onAddCustom={toggleFn}
                addPlaceholder={`Add a function for ${name}`}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Markets for {name}
              </p>
              <CountryPicker
                countries={Object.values(COUNTRY_NAMES).sort()}
                selected={markets}
                onChange={(m) => updateEntity(() => ({ markets: m }))}
              />
            </div>
          </div>
        )}

        {next(
          'Continue',
          mode === 'custom' && (funcs.length === 0 || markets.length === 0),
        )}
      </div>
    );
  }

  switch (id) {
    case 'welcome':
      return (
        <div className="flex justify-center pt-2">
          <ContinueButton label="Ready — let’s go" onClick={goNext} />
        </div>
      );

    case 'entities':
      return (
        <div className="space-y-3">
          <EntityEditor
            companyName={companyName}
            entities={payload.employer_entities}
            onChange={(v) => patch({ employer_entities: v })}
          />
          {payload.employer_entities.length === 0
            ? next(`Just ${companyName}`)
            : next('Continue')}
        </div>
      );

    case 'functions': {
      const toggle = (v: string) => {
        const canon = normalizeJobFunction(v);
        patch((prev) => {
          const has = prev.job_functions.some((x) => x.toLowerCase() === canon.toLowerCase());
          return {
            job_functions: has
              ? prev.job_functions.filter((x) => x.toLowerCase() !== canon.toLowerCase())
              : [...prev.job_functions, canon],
            // Keep per-market selections consistent with the master list.
            market_functions: has
              ? prev.market_functions.map((m) => ({
                  ...m,
                  functions: m.functions.filter((x) => x.toLowerCase() !== canon.toLowerCase()),
                }))
              : prev.market_functions,
          };
        });
      };
      return (
        <div className="space-y-3">
          <MultiChipSelect
            options={CANONICAL_JOB_FUNCTIONS}
            selected={payload.job_functions}
            onToggle={toggle}
            onAddCustom={toggle}
            addPlaceholder="Add your own function"
          />
          {next('Continue', payload.job_functions.length === 0)}
        </div>
      );
    }

    case 'markets': {
      const countries = Object.values(COUNTRY_NAMES).sort();
      return (
        <div className="space-y-3">
          <CountryPicker
            countries={countries}
            selected={payload.markets}
            onChange={(markets) =>
              patch({
                markets,
                // Drop mappings for removed markets; single market → uniform.
                market_functions: payload.market_functions.filter((m) =>
                  markets.includes(m.market),
                ),
                function_scope: markets.length > 1 ? payload.function_scope : 'uniform',
              })
            }
          />
          {next('Continue', payload.markets.length === 0)}
        </div>
      );
    }

    case 'scope': {
      // Jump explicitly: the screens array in goNext's closure predates the
      // scope change, so "next" would skip the freshly added market screens.
      // "Same everywhere" skips the per-market screens straight to the first
      // sub-brand scope screen (if any), else the demo.
      const subs = trackedSubBrands(payload);
      const afterScope = subs.length ? ESC_PREFIX + subs[0].name.trim() : 'demo';
      return (
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="flex flex-wrap justify-center gap-2">
            <Chip
              label="Same functions everywhere"
              selected={payload.function_scope === 'uniform'}
              onClick={() => {
                patch({ function_scope: 'uniform' });
                onJump(afterScope);
              }}
            />
            <Chip
              label="Different by market — let’s go one by one"
              selected={payload.function_scope === 'per_market'}
              onClick={() => {
                patch({ function_scope: 'per_market' });
                onJump(MF_PREFIX + payload.markets[0]);
              }}
            />
          </div>
        </div>
      );
    }

    case 'demo':
      return (
        <div className="space-y-5">
          <DemoDataCard pairs={marketFunctionPairs(payload)} />
          <div className="flex justify-center">
            <ContinueButton label="Makes sense, continue" onClick={goNext} />
          </div>
        </div>
      );

    case 'competitors':
      return (
        <div className="space-y-3">
          <ChipAdder
            values={payload.talent_competitors}
            onChange={(v) => patch({ talent_competitors: v })}
            placeholder="A company you compete with for talent"
          />
          <div className="flex justify-end gap-2 pt-4">
            {payload.talent_competitors.length === 0 ? (
              <SkipButton label="No names for now" onClick={goNext} />
            ) : (
              <ContinueButton label="Continue" onClick={goNext} />
            )}
          </div>
        </div>
      );

    case 'industries':
      return (
        <div className="space-y-3">
          <ChipAdder
            values={payload.industries}
            onChange={(v) => patch({ industries: v })}
            placeholder="An industry — e.g. Automotive, Fintech"
          />
          <div className="flex justify-end gap-2 pt-4">
            {payload.industries.length === 0 ? (
              <SkipButton label="Skip for now" onClick={goNext} />
            ) : (
              <ContinueButton label="Continue" onClick={goNext} />
            )}
          </div>
        </div>
      );

    case 'career_site': {
      const valid = isValidUrl(payload.career_site_url);
      return (
        <div className="space-y-2">
          <input
            value={payload.career_site_url}
            onChange={(e) => patch({ career_site_url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) {
                e.preventDefault();
                goNext();
              }
            }}
            placeholder="e.g. careers.yourcompany.com"
            inputMode="url"
            className={inputClass}
            aria-label="Career site URL"
            aria-invalid={payload.career_site_url.trim() !== '' && !valid}
          />
          {payload.career_site_url.trim() !== '' && !valid && (
            <p className="text-xs text-pink">
              That doesn't look like a URL yet — something like careers.yourcompany.com works.
            </p>
          )}
          {next('Continue', !valid)}
        </div>
      );
    }

    case 'owned_properties':
      return (
        <div className="space-y-3">
          <PropertyEditor
            properties={payload.owned_properties}
            onChange={(v) => patch({ owned_properties: v })}
          />
          <div className="flex justify-end gap-2 pt-4">
            {payload.owned_properties.length === 0 ? (
              <SkipButton label="None to add" onClick={goNext} />
            ) : (
              <ContinueButton label="Continue" onClick={goNext} />
            )}
          </div>
        </div>
      );

    case 'platforms': {
      const toggle = (v: string) =>
        patch((prev) => ({
          managed_platforms: prev.managed_platforms.some(
            (x) => x.toLowerCase() === v.toLowerCase(),
          )
            ? prev.managed_platforms.filter((x) => x.toLowerCase() !== v.toLowerCase())
            : [...prev.managed_platforms, v],
        }));
      return (
        <div className="space-y-3">
          <MultiChipSelect
            options={MANAGED_PLATFORM_OPTIONS}
            selected={payload.managed_platforms}
            onToggle={toggle}
            onAddCustom={toggle}
            addPlaceholder="Add another platform"
          />
          <div className="flex justify-end gap-2 pt-4">
            {payload.managed_platforms.length === 0 ? (
              <SkipButton label="We don't manage any officially" onClick={goNext} />
            ) : (
              <ContinueButton label="Continue" onClick={goNext} />
            )}
          </div>
        </div>
      );
    }

    case 'priorities':
      return (
        <div className="space-y-3">
          <PriorityEditor
            values={payload.ta_priorities}
            onChange={(v) => patch({ ta_priorities: v })}
          />
          <div className="flex justify-end gap-2 pt-4">
            {payload.ta_priorities.length === 0 ? (
              <SkipButton label="Skip for now" onClick={goNext} />
            ) : (
              <ContinueButton label="Continue" onClick={goNext} />
            )}
          </div>
        </div>
      );

    case 'leadership':
      return (
        <TextScreen
          value={payload.leadership_objective}
          onChange={(v) => patch({ leadership_objective: v })}
          placeholder="e.g. Whether AI tools are putting the right story in front of senior engineers"
          skipLabel="Skip for now"
          goNext={goNext}
        />
      );

    case 'focus':
      return (
        <TextScreen
          value={payload.focus_questions}
          onChange={(v) => patch({ focus_questions: v })}
          placeholder="e.g. Where do we lose senior engineers to competitors?"
          skipLabel="Skip for now"
          goNext={goNext}
        />
      );

    case 'known_context':
      return (
        <TextScreen
          value={payload.known_context}
          onChange={(v) => patch({ known_context: v })}
          placeholder="e.g. A restructure announced in March; an RTO mandate in the press"
          skipLabel="Nothing to flag"
          goNext={goNext}
        />
      );

    case 'recipients': {
      const ok =
        payload.report_recipients.length > 0 &&
        payload.report_recipients.filter((r) => r.is_primary).length === 1;
      return (
        <div className="space-y-3">
          <RecipientEditor
            recipients={payload.report_recipients}
            onChange={(v) => patch({ report_recipients: v })}
          />
          {next('Continue', !ok)}
        </div>
      );
    }

    case 'notes':
      return (
        <TextScreen
          value={payload.additional_notes}
          onChange={(v) => patch({ additional_notes: v })}
          placeholder="Anything at all"
          skipLabel="Nothing else"
          goNext={goNext}
        />
      );

    case 'review':
      return (
        <div className="space-y-4">
          <ReviewSummary companyName={companyName} payload={payload} onEdit={onJump} />
          {problems.length > 0 && (
            <ul className="text-xs text-pink space-y-1" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-center pb-4">
            <ContinueButton
              label={submitting ? 'Submitting…' : 'Submit project brief'}
              onClick={onSubmit}
              disabled={submitting || problems.length > 0}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}

function TextScreen({
  value,
  onChange,
  placeholder,
  skipLabel,
  required,
  goNext,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  skipLabel?: string;
  required?: boolean;
  goNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className={`${inputClass} resize-none`}
        aria-label={placeholder}
        aria-required={required}
      />
      <div className="flex justify-end gap-2 pt-2">
        {!required && skipLabel && value.trim() === '' ? (
          <SkipButton label={skipLabel} onClick={goNext} />
        ) : (
          <ContinueButton
            label="Continue"
            disabled={!!required && value.trim() === ''}
            onClick={goNext}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review summary — every answer editable (jumps back to its screen)
// ---------------------------------------------------------------------------

function ReviewSummary({
  companyName,
  payload,
  onEdit,
}: {
  companyName: string;
  payload: IntakePayload;
  onEdit: (screenId: string) => void;
}) {
  const rows: { label: string; value: string; screen: string }[] = [
    {
      label: 'Employer entities',
      value:
        payload.employer_entities.length === 0
          ? `Just ${companyName}`
          : `${companyName} + ${payload.employer_entities
              .map((e) => `${e.name}${e.track_separately ? ' (tracked separately)' : ''}`)
              .join(', ')}`,
      screen: 'entities',
    },
    { label: 'Job functions', value: payload.job_functions.join(', ') || '—', screen: 'functions' },
    { label: 'Markets', value: payload.markets.join(', ') || '—', screen: 'markets' },
  ];

  if (payload.markets.length > 1) {
    rows.push(
      payload.function_scope === 'per_market'
        ? {
            label: 'Functions by market',
            value: payload.markets
              .map((m) => {
                const fns = payload.market_functions.find((x) => x.market === m)?.functions ?? [];
                return `${m} — ${fns.join(', ') || '—'}`;
              })
              .join(' · '),
            screen: 'scope',
          }
        : { label: 'Functions by market', value: 'Same functions in every market', screen: 'scope' },
    );
  }

  // One row per tracked sub-brand with its own scope.
  for (const e of payload.employer_entities) {
    if (!e.track_separately || !e.name.trim()) continue;
    const custom = e.scope_mode === 'custom';
    rows.push({
      label: `${e.name} scope`,
      value: custom
        ? `${(e.job_functions ?? []).join(', ') || '—'} · in ${(e.markets ?? []).join(', ') || '—'}`
        : `Same as ${companyName}`,
      screen: ESC_PREFIX + e.name.trim(),
    });
  }

  rows.push(
    {
      label: 'Talent competitors (context only)',
      value: payload.talent_competitors.join(', ') || '—',
      screen: 'competitors',
    },
    { label: 'Industries', value: payload.industries.join(', ') || '—', screen: 'industries' },
    { label: 'Career site', value: payload.career_site_url || '—', screen: 'career_site' },
    {
      label: 'Owned properties',
      value: payload.owned_properties.map((o) => o.url).join(', ') || '—',
      screen: 'owned_properties',
    },
    {
      label: 'Managed platforms',
      value: payload.managed_platforms.join(', ') || '—',
      screen: 'platforms',
    },
    { label: 'Talent priorities', value: payload.ta_priorities.join(' · ') || '—', screen: 'priorities' },
    { label: 'Leadership objective', value: payload.leadership_objective || '—', screen: 'leadership' },
    { label: 'Focus questions', value: payload.focus_questions || '—', screen: 'focus' },
    { label: 'Known context', value: payload.known_context || '—', screen: 'known_context' },
    {
      label: 'Report recipients',
      value:
        payload.report_recipients
          .map((r) => `${r.name}${r.is_primary ? ' (primary)' : ''} <${r.email}>`)
          .join(', ') || '—',
      screen: 'recipients',
    },
    { label: 'Anything else', value: payload.additional_notes || '—', screen: 'notes' },
  );

  return (
    <details open className="rounded-2xl border border-silver bg-white shadow-sm overflow-hidden">
      <summary
        className={`cursor-pointer select-none px-4 py-3 font-headline font-semibold text-sm text-nightsky ${focusRing}`}
      >
        Your project brief — {companyName}
      </summary>
      <dl className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.label} className="px-4 py-2.5 flex items-start gap-3">
            <dt className="text-xs text-slate-500 w-36 sm:w-40 shrink-0 pt-0.5">{row.label}</dt>
            <dd className="text-sm text-nightsky flex-1 break-words">{row.value}</dd>
            <button
              type="button"
              onClick={() => onEdit(row.screen)}
              aria-label={`Edit ${row.label}`}
              className={`text-slate-400 hover:text-nightsky rounded p-1 shrink-0 ${focusRing}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </dl>
    </details>
  );
}
