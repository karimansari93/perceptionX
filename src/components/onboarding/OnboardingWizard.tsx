// The client onboarding as a screen-per-question wizard: one question at a
// time, the question text typed out ChatGPT-style, and free back/forward
// navigation like a classic onboarding. Answers commit straight into the
// payload, so moving back and forth never loses anything.
//
// The screen list is dynamic: with more than one market the flow asks whether
// functions are uniform, and "different by market" expands into one screen per
// market ("Which functions matter in Germany?"), pre-filled from the previous
// market so shared setups take one tap.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ClipboardCheck,
  Factory,
  Flag,
  Globe2,
  Pencil,
  Target,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CANONICAL_JOB_FUNCTIONS,
  OnboardingPayload,
  MANAGED_PLATFORM_OPTIONS,
  US_STATES,
  isValidUrl,
  normalizeJobFunction,
  normalizeUrl,
  validateForSubmit,
} from '@/lib/onboarding/types';
import { marketFunctionPairs } from '@/lib/onboarding/generateConfirmedPrompts';
import { saveOnboardingDraft, submitOnboarding } from '@/lib/onboarding/api';
import { COUNTRY_NAMES } from '@/lib/marketName';

// Countries + US states: US-only companies track state-level markets.
const MARKET_OPTIONS = [...Object.values(COUNTRY_NAMES), ...US_STATES].sort();
import { DemoDataCard } from './DemoDataCard';
import {
  Chip,
  ChipAdder,
  ContinueButton,
  CountryPicker,
  EntityEditor,
  MultiChipSelect,
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
function trackedSubBrands(p: OnboardingPayload) {
  return p.employer_entities.filter((e) => e.track_separately && e.name.trim());
}

function buildScreenIds(p: OnboardingPayload): string[] {
  const ids = ['welcome', 'entities', 'functions', 'markets'];
  if (p.markets.length > 1) ids.push('scope');
  if (p.markets.length > 1 && p.function_scope === 'per_market') {
    ids.push(...p.markets.map((m) => MF_PREFIX + m));
  }
  // Each tracked sub-brand gets its own scope screen (inherit or its own).
  ids.push(...trackedSubBrands(p).map((e) => ESC_PREFIX + e.name.trim()));
  ids.push('demo', 'industries');
  // With several industries, map each function to the one it competes in
  // (e.g. tech roles → Technology, frontline → Automotive).
  if (p.industries.length > 1 && p.job_functions.length > 0) ids.push('fn_industries');
  ids.push(
    'career_site',
    'owned_properties',
    'platforms',
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
  if (['industries', 'fn_industries'].includes(id)) return 'Talent market';
  if (['career_site', 'owned_properties', 'platforms'].includes(id)) return 'Your channels';
  if (['leadership', 'focus'].includes(id)) return 'Priorities';
  if (['known_context', 'recipients', 'notes'].includes(id)) return 'People & context';
  return 'Review & submit';
}

function questionOf(id: string, company: string, p: OnboardingPayload): { text: string; hint?: string } {
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
      text: `Does ${name} hire the same way?`,
      hint: `If ${name} has its own hiring footprint — different functions or markets than ${company} — set it here so we track it accurately.`,
    };
  }
  switch (id) {
    case 'welcome':
      return {
        text: `Let's set up your PerceptionX project for ${company}.`,
        hint: `This takes about 5 minutes. We'll ask what to track and show you the kind of data you'll get back. Ready?`,
      };
    case 'entities':
      return {
        text: `Confirm the employer entities we should track.`,
        hint: `${company} is always included. Add any divisions, subsidiaries or brands with their own hiring identity — the way PepsiCo spans Frito-Lay, Gatorade and Quaker — and each gets its own results.`,
      };
    case 'functions':
      return {
        text: `Which job functions matter most?`,
        hint: 'Pick as many as you like — these become the lens we measure through.',
      };
    case 'markets':
      return {
        text: `Which markets should we cover?`,
        hint: `We recommend focusing on the markets where you plan to hire or want to raise the quality of talent. You can add every location you operate in, but spreading too wide can blur the data into something less actionable.`,
      };
    case 'scope':
      return {
        text: `Same functions in every market?`,
        hint: `If each of your ${p.markets.length} markets has its own priorities, we'll go through them one by one.`,
      };
    case 'demo':
      return {
        text: `Here's an example of how your data will look.`,
        hint: `Every function and market you've picked is scored on three dimensions — Visibility, Sentiment and Relevance.`,
      };
    case 'industries':
      return {
        text: `What industries do you compete in for talent?`,
        hint: `You can leave this blank. If you add one, we benchmark you inside it — say Biotechnology, and we'll ask the AI models questions like "What's the best Biotechnology company to work for?"`,
      };
    case 'fn_industries':
      return {
        text: `Which industry does each function compete in?`,
        hint: `We benchmark every function inside the industry it actually competes in — tech roles against tech companies, frontline roles against your core industry.`,
      };
    case 'career_site':
      return {
        text: `Your main careers page?`,
        hint: 'This is our starting point for evaluating your EVP online.',
      };
    case 'owned_properties':
      return {
        text: `Any other owned pages?`,
        hint: `LinkedIn, Instagram, grad-program microsites — pages you run yourselves that candidates might land on.`,
      };
    case 'platforms':
      return {
        text: `Which review platforms do you officially manage?`,
        hint: `Where you respond to reviews or own the employer profile. Keeps your owned-source share accurate — and stops us recommending a lever you already control.`,
      };
    case 'leadership':
      return {
        text: `What does leadership want to learn?`,
        hint: `The one question your exec team most wants this project to answer.`,
      };
    case 'focus':
      return {
        text: `Anything the report should dig into?`,
        hint: `Specific questions or areas you want us to go deep on.`,
      };
    case 'known_context':
      return {
        text: `Anything happening we should know about?`,
        hint: `Restructuring, an RTO mandate, a news cycle, a Glassdoor spike — it helps us read the sentiment data in context.`,
      };
    case 'recipients':
      return {
        text: `Who should get the first draft?`,
        hint: `Add everyone who should see the report, and mark one person as the primary contact.`,
      };
    case 'notes':
      return {
        text: `Anything else we should know?`,
        hint: `Anything at all — context, constraints, questions.`,
      };
    default:
      return {
        text: `Here's your project brief.`,
        hint: `Check it over — you can edit anything — then submit and we'll take it from there.`,
      };
  }
}

function canProceed(id: string, p: OnboardingPayload): boolean {
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

interface OnboardingWizardProps {
  token: string;
  companyName: string;
  initialDraft: OnboardingPayload | null;
  initialPayload: OnboardingPayload;
}

export function OnboardingWizard({ token, companyName, initialDraft, initialPayload }: OnboardingWizardProps) {
  const [payload, setPayload] = useState<OnboardingPayload>(() => {
    const base = initialDraft ?? initialPayload;
    // Older drafts predate these fields — backfill defaults.
    return {
      function_scope: 'uniform',
      market_functions: [],
      function_industries: [],
      ...base,
    };
  });
  const screens = useMemo(() => buildScreenIds(payload), [payload]);
  // Every visit lands on the welcome screen — a returning client gets a
  // "welcome back" variant with a one-tap jump to where they left off, instead
  // of being dropped mid-flow with no orientation.
  const [resumeTarget] = useState<string | null>(() => {
    const saved = initialDraft?.meta?.step;
    return typeof saved === 'string' && saved !== 'welcome' ? saved : null;
  });
  const [currentId, setCurrentId] = useState<string>('welcome');
  // Old drafts may point at screens that no longer exist (removed steps).
  const resumeValid = resumeTarget && screens.includes(resumeTarget) ? resumeTarget : null;
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
  const latestSnapshot = useRef<OnboardingPayload | null>(null);
  const savedRef = useRef<string>(''); // JSON of the last snapshot we sent
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  // While a returning client is still parked on the welcome screen, keep the
  // stored pointer on their real position — saving 'welcome' here would wipe
  // the resume target the welcome screen exists to offer.
  const stepToSave = currentId === 'welcome' && resumeValid ? resumeValid : currentId;
  const flushSave = useCallback(() => {
    const snap = latestSnapshot.current;
    if (!snap) return;
    const key = JSON.stringify(snap);
    if (key === savedRef.current) return; // nothing new since last save
    savedRef.current = key;
    saveChain.current = saveChain.current.then(() => saveOnboardingDraft(token, snap)).catch(() => {});
  }, [token]);

  // Debounced save for within-screen edits (typing, chip toggles).
  useEffect(() => {
    if (submitted) return;
    latestSnapshot.current = { ...payload, meta: { step: stepToSave } };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
    return () => clearTimeout(saveTimer.current);
  }, [payload, stepToSave, submitted, flushSave]);

  // Crossing to a new screen is a durable checkpoint: flush immediately so the
  // resume pointer is always current even if the tab closes mid-flow.
  useEffect(() => {
    if (submitted) return;
    latestSnapshot.current = { ...payloadRef.current, meta: { step: stepToSave } };
    flushSave();
  }, [stepToSave, submitted, flushSave]);

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
    (p: Partial<OnboardingPayload> | ((prev: OnboardingPayload) => Partial<OnboardingPayload>)) => {
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
    const clean: OnboardingPayload = {
      ...payload,
      career_site_url: normalizeUrl(payload.career_site_url),
    };
    const res = await submitOnboarding(token, clean);
    setSubmitting(false);
    if (res.ok || res.error === 'already_submitted') {
      setSubmitted(true);
    } else {
      toast.error('That didn’t go through — give it another try in a moment.');
    }
  }, [payload, problems, token]);

  const question =
    currentId === 'welcome' && resumeValid
      ? {
          text: `Welcome back — let's finish setting up ${companyName}.`,
          hint: `Everything you've entered so far is saved. Pick up where you left off, or step back through your answers from the start.`,
        }
      : questionOf(currentId, companyName, payload);
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

  // Rail navigation: every section the client has reached stays clickable in
  // both directions — going back never locks the sections they already
  // completed. Answers persist, so revisiting is always safe. Seeded from the
  // saved draft so a returning client's progress shows from the welcome screen.
  const [maxSectionReached, setMaxSectionReached] = useState(() =>
    resumeTarget ? Object.keys(SECTION_META).indexOf(sectionOf(resumeTarget)) : 0,
  );
  const currentSectionIndex = sections.indexOf(currentSection);
  useEffect(() => {
    if (currentSectionIndex > maxSectionReached) setMaxSectionReached(currentSectionIndex);
  }, [currentSectionIndex, maxSectionReached]);

  const jumpToSection = useCallback(
    (s: string) => {
      const target = screens.find((id) => sectionOf(id) === s);
      if (target) go(target);
    },
    [screens, go],
  );

  if (submitted) {
    return (
      <Frame
        companyName={companyName}
        section="All done"
        sections={sections}
        sectionIndex={sections.length}
        maxSectionIndex={sections.length}
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
      sectionIndex={currentSectionIndex}
      maxSectionIndex={maxSectionReached}
      within={within}
      onSectionClick={jumpToSection}
    >
      <div className="max-w-xl w-full flex flex-col min-h-full mx-auto lg:mx-0">
        {/* Question */}
        <div className="pt-8 sm:pt-12 pb-6">
          <div className="flex items-center gap-3 mb-3 min-h-[1.5rem]">
            {idx > 0 && (
              <button
                type="button"
                onClick={goBack}
                className={`inline-flex items-center gap-1 text-xs text-slate-400 hover:text-nightsky rounded transition-colors ${focusRing}`}
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Back
              </button>
            )}
            {sections.indexOf(currentSection) >= 0 && (
              <p className="text-xs text-slate-400">
                Step {sections.indexOf(currentSection) + 1}/{sections.length}
              </p>
            )}
            {showBackToReview && (
              <button
                type="button"
                onClick={() => go('review')}
                className={`ml-auto text-xs font-medium text-teal hover:text-nightsky rounded transition-colors ${focusRing}`}
              >
                Return to review →
              </button>
            )}
          </div>
          <h2 className="font-headline font-semibold text-nightsky text-xl sm:text-3xl leading-snug min-h-[2.5em]">
            <TypeText key={currentId} text={question.text} onDone={() => setTyped(true)} />
          </h2>
          {question.hint && (
            <p
              className={`mt-2 text-sm sm:text-[15px] leading-relaxed text-slate-500 transition-opacity duration-300 ${
                typed ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {question.hint}
            </p>
          )}
          <div className="mt-6 h-px bg-nightsky/[0.07]" aria-hidden />
        </div>

        {/* Answer area — fades in once the question has finished typing */}
        <div
          className={`pb-6 transition-opacity duration-300 ${typed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
            resumeTarget={resumeValid}
          />
        </div>
      </div>
    </Frame>
  );
}

/** Sidebar metadata per section: icon + one-line description. */
const SECTION_META: Record<string, { icon: typeof Target; blurb: string }> = {
  'What we track': { icon: Target, blurb: 'Entities, functions & markets' },
  'Your data preview': { icon: BarChart3, blurb: 'A sample of your report' },
  'Talent market': { icon: Factory, blurb: 'Industries you compete in' },
  'Your channels': { icon: Globe2, blurb: 'Career site & owned pages' },
  Priorities: { icon: Flag, blurb: 'What matters most' },
  'People & context': { icon: Users, blurb: 'Context & recipients' },
  'Review & submit': { icon: ClipboardCheck, blurb: 'Check and confirm' },
};

function Frame({
  companyName,
  section,
  sections,
  sectionIndex,
  maxSectionIndex,
  within,
  onSectionClick,
  children,
}: {
  companyName: string;
  section: string;
  sections: string[];
  /** Index of the active section in `sections`; -1 on Welcome, length when done. */
  sectionIndex: number;
  /** Furthest section the client has reached — everything up to here is clickable. */
  maxSectionIndex: number;
  /** 0..1 completion inside the active section. */
  within: number;
  /** When set, visited sections in the rail navigate to that section (back or forward). */
  onSectionClick?: (section: string) => void;
  children: React.ReactNode;
}) {
  // h-[100dvh] (not min-h) so <main> is the real scroll container — the
  // review screen's sticky submit bar pins to its bottom edge.
  return (
    <div className="flex h-[100dvh]">
      {/* Navy step rail — desktop */}
      <aside className="hidden lg:flex flex-col w-80 shrink-0 bg-nightsky text-white relative overflow-hidden">
        {/* Decorative geometry, echoing the brand */}
        <svg
          className="absolute bottom-0 left-0 w-full opacity-[0.07]"
          viewBox="0 0 320 260"
          fill="none"
          aria-hidden
        >
          <circle cx="60" cy="200" r="80" stroke="white" strokeWidth="1" />
          <circle cx="60" cy="200" r="52" stroke="white" strokeWidth="1" />
          <path d="M180 260 a80 80 0 0 1 80 -80 v80 z" stroke="white" strokeWidth="1" />
          <rect x="230" y="120" width="70" height="70" stroke="white" strokeWidth="1" />
          <circle cx="300" cy="60" r="46" stroke="white" strokeWidth="1" />
        </svg>

        <div className="relative p-7 pb-4">
          <img
            src="/logos/PerceptionX-PrimaryLogo-ForOnDark-large.png"
            alt="PerceptionX"
            className="h-7 w-auto"
          />
          <p className="mt-3 text-xs text-white/50">
            Setting up <span className="text-white/90 font-medium">{companyName}</span>
          </p>
        </div>

        <nav className="relative flex-1 px-7 py-4" aria-label="Onboarding steps">
          <ol className="space-y-0">
            {sections.map((s, i) => {
              const meta = SECTION_META[s] ?? { icon: Target, blurb: '' };
              const Icon = meta.icon;
              const state =
                i === sectionIndex ? 'active' : i <= maxSectionIndex ? 'done' : 'todo';
              const clickable = state === 'done' && !!onSectionClick;
              const row = (
                <>
                  <span
                    className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      state === 'active'
                        ? 'bg-white text-nightsky'
                        : state === 'done'
                          ? 'bg-teal/20 text-teal group-hover:bg-teal group-hover:text-nightsky'
                          : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {state === 'done' ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : (
                      <Icon className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 pt-0.5 text-left">
                    <span
                      className={`block text-sm font-medium leading-tight ${
                        state === 'active'
                          ? 'text-white'
                          : state === 'done'
                            ? 'text-white/80 group-hover:text-white'
                            : 'text-white/50'
                      }`}
                    >
                      {s}
                    </span>
                    <span className="block text-xs text-white/40 mt-0.5">{meta.blurb}</span>
                  </span>
                </>
              );
              return (
                <li key={s} className="relative flex pb-7 last:pb-0">
                  {/* connector */}
                  {i < sections.length - 1 && (
                    <span
                      aria-hidden
                      className={`absolute left-[17px] top-9 bottom-0 w-px ${
                        i < maxSectionIndex ? 'bg-teal/60' : 'bg-white/15'
                      }`}
                    />
                  )}
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => onSectionClick(s)}
                      aria-label={`Go to ${s}`}
                      className={`group flex gap-3.5 w-full rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-nightsky`}
                    >
                      {row}
                    </button>
                  ) : (
                    <span
                      className="flex gap-3.5 w-full"
                      aria-current={state === 'active' ? 'step' : undefined}
                    >
                      {row}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <p className="relative p-7 pt-4 text-[11px] text-white/35">
          All rights reserved @PerceptionX
        </p>
      </aside>

      {/* Content — calm near-white so the navy rail reads as intentional
          contrast; rose stays in the accents */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-white to-[#F6F7FB]">
        {/* Slim header — mobile only (the rail covers desktop) */}
        <header className="lg:hidden shrink-0 z-10 bg-white/80 backdrop-blur-md border-b border-nightsky/[0.06]">
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
        <main className="flex-1 overflow-y-auto px-4 lg:px-14">{children}</main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-screen controls — all commit straight into the payload
// ---------------------------------------------------------------------------

interface ScreenControlProps {
  id: string;
  companyName: string;
  payload: OnboardingPayload;
  patch: (p: Partial<OnboardingPayload> | ((prev: OnboardingPayload) => Partial<OnboardingPayload>)) => void;
  goNext: () => void;
  problems: string[];
  submitting: boolean;
  onSubmit: () => void;
  onJump: (id: string) => void;
  /** Saved screen for a returning client — welcome offers a one-tap resume. */
  resumeTarget?: string | null;
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
  resumeTarget,
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

    // "Same as parent" is a complete answer — advance straight away. Custom
    // opens the editors, and Continue appears only for that path.
    const chooseInherit = () => {
      updateEntity(() => ({ scope_mode: 'inherit' }));
      goNext();
    };
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
                countries={MARKET_OPTIONS}
                selected={markets}
                onChange={(m) => updateEntity(() => ({ markets: m }))}
              />
            </div>
          </div>
        )}

        {mode === 'custom' &&
          next('Continue', funcs.length === 0 || markets.length === 0)}
      </div>
    );
  }

  switch (id) {
    case 'welcome':
      if (resumeTarget) {
        return (
          <div className="flex flex-col items-center gap-2 pt-2">
            <ContinueButton
              label="Pick up where I left off"
              onClick={() => onJump(resumeTarget)}
            />
            <SkipButton label="Start from the first question" onClick={goNext} />
          </div>
        );
      }
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
            showHelp={false}
          />
          {next('Confirm entities')}
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
            function_industries: has
              ? (prev.function_industries ?? []).filter(
                  (m) => m.function.toLowerCase() !== canon.toLowerCase(),
                )
              : prev.function_industries,
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
      const countries = MARKET_OPTIONS;
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

    case 'industries':
      return (
        <div className="space-y-3">
          <ChipAdder
            values={payload.industries}
            onChange={(v) =>
              patch((prev) => ({
                industries: v,
                // Drop mappings pointing at removed industries.
                function_industries: (prev.function_industries ?? []).filter((m) =>
                  v.some((i) => i.toLowerCase() === m.industry.toLowerCase()),
                ),
              }))
            }
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

    case 'fn_industries':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {payload.job_functions.map((fn) => {
              const current =
                (payload.function_industries ?? []).find(
                  (m) => m.function.toLowerCase() === fn.toLowerCase(),
                )?.industry ?? payload.industries[0];
              return (
                <div
                  key={fn}
                  className="rounded-2xl border border-silver bg-white/60 px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  <p className="text-sm font-medium text-nightsky sm:w-40 shrink-0">{fn}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {payload.industries.map((ind) => (
                      <Chip
                        key={ind}
                        label={ind}
                        selected={current?.toLowerCase() === ind.toLowerCase()}
                        onClick={() =>
                          patch((prev) => ({
                            function_industries: [
                              ...(prev.function_industries ?? []).filter(
                                (m) => m.function.toLowerCase() !== fn.toLowerCase(),
                              ),
                              { function: fn, industry: ind },
                            ],
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {next('Continue')}
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
        <div>
          <ReviewSummary companyName={companyName} payload={payload} onEdit={onJump} />
          {/* Submit stays pinned to the bottom of the viewport so nobody has to
              discover it by scrolling. */}
          <div className="sticky bottom-0 -mx-4 mt-4 bg-gradient-to-t from-white via-white/95 to-transparent pt-6 pb-4 px-4">
            {problems.length > 0 && (
              <ul className="text-xs text-pink space-y-1 mb-2 text-center" role="alert">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-center">
              <ContinueButton
                label={submitting ? 'Submitting…' : 'Submit project brief'}
                onClick={onSubmit}
                disabled={submitting || problems.length > 0}
              />
            </div>
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
  payload: OnboardingPayload;
  onEdit: (screenId: string) => void;
}) {
  const industryOf = (fn: string) =>
    (payload.function_industries ?? []).find((m) => m.function.toLowerCase() === fn.toLowerCase())
      ?.industry ?? payload.industries[0];
  const fnsInMarket = (market: string) =>
    payload.function_scope === 'per_market'
      ? (payload.market_functions.find((x) => x.market === market)?.functions ?? [])
      : payload.job_functions;
  const perMarket = payload.markets.length > 1 && payload.function_scope === 'per_market';
  const multiIndustry = payload.industries.length > 1;
  const subBrands = payload.employer_entities.filter((e) => e.track_separately && e.name.trim());

  return (
    <div className="space-y-4">
      {/* Entities */}
      <ReviewCard title="Who we track" screen="entities" onEdit={onEdit}>
        <div className="flex flex-wrap gap-1.5">
          <DisplayPill tone="solid">{companyName}</DisplayPill>
          {subBrands.map((e) => (
            <DisplayPill key={e.name}>{e.name}</DisplayPill>
          ))}
        </div>
        {subBrands.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {subBrands.map((e) => (
              <li key={e.name} className="flex items-start gap-2 text-xs text-slate-500">
                <span className="font-medium text-nightsky shrink-0">{e.name}</span>
                <span className="flex-1 min-w-0">
                  {e.scope_mode === 'custom'
                    ? `${(e.job_functions ?? []).join(', ') || '—'} · in ${
                        (e.markets ?? []).join(', ') || '—'
                      }`
                    : `same coverage as ${companyName}`}
                </span>
                <EditPencil
                  label={`Edit ${e.name} scope`}
                  onClick={() => onEdit(ESC_PREFIX + e.name.trim())}
                />
              </li>
            ))}
          </ul>
        )}
      </ReviewCard>

      {/* Coverage: functions × markets (× industries) */}
      <ReviewCard title="Coverage" screen="functions" onEdit={onEdit}>
        {perMarket ? (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-[11px] font-medium uppercase tracking-wide text-slate-400 pb-2 pr-3 min-w-[104px]">
                    Function
                  </th>
                  {payload.markets.map((m) => (
                    <th
                      key={m}
                      className="text-[11px] font-medium uppercase tracking-wide text-slate-400 pb-2 px-2 text-center whitespace-nowrap"
                    >
                      {m}
                    </th>
                  ))}
                  {multiIndustry && (
                    <th className="text-[11px] font-medium uppercase tracking-wide text-slate-400 pb-2 pl-3 whitespace-nowrap">
                      Benchmarked in
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {payload.job_functions.map((fn) => (
                  <tr key={fn} className="border-t border-slate-100">
                    <td className="text-sm font-medium text-nightsky py-2 pr-3 border-t border-slate-100">
                      {fn}
                    </td>
                    {payload.markets.map((m) => {
                      const on = fnsInMarket(m).some(
                        (x) => x.toLowerCase() === fn.toLowerCase(),
                      );
                      return (
                        <td key={m} className="py-2 px-2 text-center border-t border-slate-100">
                          <span
                            role="img"
                            aria-label={on ? `${fn} tracked in ${m}` : `${fn} not tracked in ${m}`}
                            className={`inline-block w-2.5 h-2.5 rounded-full ${
                              on ? 'bg-teal' : 'border border-slate-200'
                            }`}
                          />
                        </td>
                      );
                    })}
                    {multiIndustry && (
                      <td className="py-2 pl-3 border-t border-slate-100">
                        <DisplayPill tone="tint">{industryOf(fn)}</DisplayPill>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex justify-end">
              <EditPencil label="Edit functions by market" onClick={() => onEdit('scope')} text="Adjust by market" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <LabelledChips label="Functions">
              {payload.job_functions.map((fn) => (
                <span key={fn} className="inline-flex items-center gap-1">
                  <DisplayPill>{fn}</DisplayPill>
                  {multiIndustry && <DisplayPill tone="tint">{industryOf(fn)}</DisplayPill>}
                </span>
              ))}
            </LabelledChips>
            <LabelledChips label="Markets">
              {payload.markets.map((m) => (
                <DisplayPill key={m}>{m}</DisplayPill>
              ))}
            </LabelledChips>
          </div>
        )}
        {payload.industries.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <LabelledChips label={multiIndustry ? 'Industries' : 'Benchmarked in'}>
              {payload.industries.map((i) => (
                <DisplayPill key={i} tone="tint">
                  {i}
                </DisplayPill>
              ))}
            </LabelledChips>
            {multiIndustry && (
              <div className="mt-2 flex justify-end">
                <EditPencil
                  label="Edit industry by function"
                  onClick={() => onEdit('fn_industries')}
                  text="Adjust by function"
                />
              </div>
            )}
          </div>
        )}
      </ReviewCard>

      {/* Channels */}
      <ReviewCard title="Your channels" screen="career_site" onEdit={onEdit}>
        <dl className="space-y-2.5">
          <ChannelRow label="Career site">
            <span className="text-teal underline underline-offset-2 break-all">
              {payload.career_site_url || '—'}
            </span>
          </ChannelRow>
          <ChannelRow
            label="Owned pages"
            onEdit={() => onEdit('owned_properties')}
            editLabel="Edit owned pages"
          >
            {payload.owned_properties.length ? (
              <span className="space-y-1 block">
                {payload.owned_properties.map((o) => (
                  <span key={o.url} className="block break-all">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1.5">
                      {o.type.replace('_', ' ')}
                    </span>
                    {o.url}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-slate-400">None</span>
            )}
          </ChannelRow>
          <ChannelRow
            label="Managed platforms"
            onEdit={() => onEdit('platforms')}
            editLabel="Edit managed platforms"
          >
            {payload.managed_platforms.length ? (
              <span className="flex flex-wrap gap-1.5">
                {payload.managed_platforms.map((p) => (
                  <DisplayPill key={p}>{p}</DisplayPill>
                ))}
              </span>
            ) : (
              <span className="text-slate-400">None officially managed</span>
            )}
          </ChannelRow>
        </dl>
      </ReviewCard>

      {/* Context */}
      <ReviewCard title="Context for the report" screen="leadership" onEdit={onEdit}>
        <dl className="space-y-2.5">
          <ChannelRow label="Leadership wants to learn" onEdit={() => onEdit('leadership')} editLabel="Edit leadership objective">
            {payload.leadership_objective || <span className="text-slate-400">Skipped</span>}
          </ChannelRow>
          <ChannelRow label="Dig into" onEdit={() => onEdit('focus')} editLabel="Edit focus questions">
            {payload.focus_questions || <span className="text-slate-400">Skipped</span>}
          </ChannelRow>
          <ChannelRow label="Good to know" onEdit={() => onEdit('known_context')} editLabel="Edit known context">
            {payload.known_context || <span className="text-slate-400">Nothing flagged</span>}
          </ChannelRow>
          <ChannelRow label="Anything else" onEdit={() => onEdit('notes')} editLabel="Edit notes">
            {payload.additional_notes || <span className="text-slate-400">Nothing else</span>}
          </ChannelRow>
        </dl>
      </ReviewCard>

      {/* Recipients */}
      <ReviewCard title="Report goes to" screen="recipients" onEdit={onEdit}>
        <ul className="space-y-2">
          {payload.report_recipients.map((r) => (
            <li key={r.email} className="flex items-center gap-2.5 min-w-0">
              <span className="w-7 h-7 rounded-full bg-nightsky/5 text-nightsky text-[11px] font-semibold flex items-center justify-center shrink-0">
                {r.name
                  .split(/\s+/)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-nightsky truncate">
                  {r.name}
                  {r.role ? <span className="text-slate-400"> · {r.role}</span> : null}
                </span>
                <span className="block text-xs text-slate-400 truncate">{r.email}</span>
              </span>
              {r.is_primary && <DisplayPill tone="rose">Primary</DisplayPill>}
            </li>
          ))}
          {payload.report_recipients.length === 0 && (
            <li className="text-sm text-slate-400">No recipients yet</li>
          )}
        </ul>
      </ReviewCard>
    </div>
  );
}

// --- review building blocks -------------------------------------------------

function ReviewCard({
  title,
  screen,
  onEdit,
  children,
}: {
  title: string;
  screen: string;
  onEdit: (screen: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-silver bg-white shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal">
          {title}
        </h3>
        <EditPencil label={`Edit ${title.toLowerCase()}`} onClick={() => onEdit(screen)} />
      </div>
      {children}
    </section>
  );
}

function EditPencil({
  label,
  onClick,
  text,
}: {
  label: string;
  onClick: () => void;
  text?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center gap-1 text-slate-400 hover:text-nightsky rounded p-1 shrink-0 text-xs ${focusRing}`}
    >
      {text}
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function DisplayPill({
  children,
  tone = 'soft',
}: {
  children: React.ReactNode;
  tone?: 'soft' | 'solid' | 'tint' | 'rose';
}) {
  const styles = {
    soft: 'bg-slate-100 text-nightsky',
    solid: 'bg-nightsky text-white',
    tint: 'bg-teal/10 text-teal',
    rose: 'bg-pink/10 text-pink',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function LabelledChips({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function ChannelRow({
  label,
  children,
  onEdit,
  editLabel,
}: {
  label: string;
  children: React.ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs text-slate-500 w-32 sm:w-40 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-nightsky flex-1 min-w-0 break-words">{children}</dd>
      {onEdit && editLabel && <EditPencil label={editLabel} onClick={onEdit} />}
    </div>
  );
}
