// Public Activate page at /activate/:token — authenticated by the link token
// alone (no login). The recipient declares country + entity (two taps, no
// inference) and gets the review platforms that feed AI answers about their
// employer in their market. We route; we never script — copy stays
// non-directive throughout. Spec: docs/ACTIVATE_LINK_ROUTER.md
//
// Visuals follow the high-fidelity design handoff (full-bleed brand canvas,
// on-colour ink system, link-in-bio pills, count-up stat block). Everything
// derives from two client tokens: --activate-primary / --activate-accent plus
// a computed on-colour, so a pale brand flips the whole canvas to navy ink in
// one step. Company/platform marks resolve from logo.dev by domain, with
// initials fallback.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router-dom';
import ReactCountryFlag from 'react-country-flag';
import { AlertCircle, ArrowRight, ChevronLeft, ExternalLink, Search } from 'lucide-react';
import { useMetaTags } from '@/hooks/useMetaTags';
import {
  ActivateConfig,
  ActivateRoute,
  COUNTRY_CODES,
  countryInSentence,
  countryName,
  getActivateByToken,
  JOB_FUNCTIONS,
  logActivateEvent,
  measuredMarketCodes,
  parseStatPct,
  rankSocialRoutes,
  resolveRoutes,
  SENIORITIES,
} from '@/lib/activate/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; config: ActivateConfig };

type Step = 'country' | 'entity' | 'profile' | 'routes';

const UNSURE = 'unsure';

// Publishable logo.dev token from the design handoff (pk_ keys are meant for
// the client); override per environment via VITE_LOGO_DEV_TOKEN.
const LOGO_DEV_TOKEN = import.meta.env.VITE_LOGO_DEV_TOKEN ?? 'pk_ekarmbf-SbmRJ537a9wdxA';

const logoSrc = (domain: string, size = 120) =>
  `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=${size}&format=png`;

const PLATFORM_NAMES: Record<string, string> = {
  kununu: 'kununu',
  glassdoor: 'Glassdoor',
  indeed: 'Indeed',
  seek: 'Seek',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

const PLATFORM_DOMAINS: Record<string, string> = {
  kununu: 'kununu.com',
  glassdoor: 'glassdoor.com',
  indeed: 'indeed.com',
  seek: 'seek.com.au',
  linkedin: 'linkedin.com',
  reddit: 'reddit.com',
  instagram: 'instagram.com',
  tiktok: 'tiktok.com',
};

function platformName(key: string): string {
  return PLATFORM_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Design handoff's AA mechanism: luminance > 0.45 → navy ink, else white. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#FFFFFF';
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(v.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#13274F' : '#FFFFFF';
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Activate() {
  const { token } = useParams<{ token: string }>();
  // One random id per pageview: identifies a pageview, not a person. Never
  // persisted — the only thing tying a click to the declaration before it.
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [step, setStep] = useState<Step>('country');
  const [market, setMarket] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null); // company id or UNSURE
  const [functionId, setFunctionId] = useState<string | null>(null);
  const [seniorityId, setSeniorityId] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedOnce = useRef(false);

  useMetaTags({
    title:
      load.kind === 'ready'
        ? `${load.config.org.display_name} — where AI listens`
        : 'Activate — PerceptionX',
    description: 'See which platforms shape AI answers about your employer in your market.',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLoad({ kind: 'invalid' });
        return;
      }
      const res = await getActivateByToken(token, sessionId);
      if (cancelled) return;
      if (res.error || !res.config) {
        setLoad({ kind: 'invalid' });
        return;
      }
      const cfg = res.config;
      // Sender prefills are declarations too (they're what routes), but the
      // recipient can always override from the routes screen.
      const preMarket = cfg.prefill_market_code;
      const preEntity =
        cfg.prefill_entity_company_id &&
        cfg.entities.some((e) => e.id === cfg.prefill_entity_company_id)
          ? cfg.prefill_entity_company_id
          : null;
      if (preMarket) {
        setMarket(preMarket);
        logActivateEvent(token, sessionId, 'market_declared', { marketCode: preMarket });
        if (preEntity || cfg.entities.length === 0) {
          setEntityId(preEntity ?? UNSURE);
          logActivateEvent(token, sessionId, 'entity_declared', {
            marketCode: preMarket,
            entityCompanyId: preEntity,
          });
          setStep('routes');
          setPrefilled(true);
        } else {
          setStep('entity');
        }
      }
      setLoad({ kind: 'ready', config: cfg });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, sessionId]);

  // Focus follows the step heading (skip the initial mount).
  useEffect(() => {
    if (load.kind !== 'ready') return;
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step, load.kind]);

  if (load.kind === 'loading') {
    return (
      <Canvas primary="#13274F" accent="#DB5E89">
        <div className="min-h-screen flex items-center justify-center">
          <div className="act-spinner" role="status" aria-label="Opening" />
        </div>
      </Canvas>
    );
  }

  if (load.kind === 'invalid') {
    return <DeadLink />;
  }

  const { config } = load;
  const { org } = config;

  const declareMarket = (code: string) => {
    setMarket(code);
    logActivateEvent(token!, sessionId, 'market_declared', { marketCode: code });
    if (config.entities.length === 0) {
      setEntityId(UNSURE);
      logActivateEvent(token!, sessionId, 'entity_declared', { marketCode: code });
      setStep('routes');
    } else {
      setStep('entity');
    }
  };

  const declareEntity = (id: string) => {
    setEntityId(id);
    logActivateEvent(token!, sessionId, 'entity_declared', {
      marketCode: market,
      entityCompanyId: id === UNSURE ? null : id,
    });
    setStep('profile');
  };

  const declareProfile = (fn: string | null, sen: string | null) => {
    setFunctionId(fn);
    setSeniorityId(sen);
    if (fn || sen) {
      logActivateEvent(token!, sessionId, 'profile_declared', {
        marketCode: market,
        functionId: fn,
        seniorityId: sen,
      });
    }
    setStep('routes');
  };

  return (
    <Canvas primary={org.primary_color} accent={org.accent_color}>
      <main
        aria-live="polite"
        className="relative z-[1] mx-auto flex min-h-screen w-full max-w-[460px] flex-col items-center gap-4 px-[22px] pb-11 pt-16 md:px-8"
      >
        <div key={step} className="act-step flex w-full flex-col items-center gap-4">
          {step === 'country' && (
            <CountryStep
              org={org}
              measured={measuredMarketCodes(config.routes)}
              onPick={declareMarket}
              headingRef={headingRef}
            />
          )}
          {step === 'entity' && (
            <EntityStep
              org={org}
              entities={config.entities}
              onPick={declareEntity}
              onBack={() => setStep('country')}
              headingRef={headingRef}
            />
          )}
          {step === 'profile' && (
            <ProfileStep
              onDone={declareProfile}
              onBack={() => setStep('entity')}
              initialFunction={functionId}
              initialSeniority={seniorityId}
              headingRef={headingRef}
            />
          )}
          {step === 'routes' && market && (
            <RoutesStep
              token={token!}
              sessionId={sessionId}
              org={org}
              audience={config.audience}
              market={market}
              entityName={
                entityId && entityId !== UNSURE
                  ? config.entities.find((e) => e.id === entityId)?.name ?? null
                  : null
              }
              entityId={entityId === UNSURE ? null : entityId}
              resolved={resolveRoutes(config.routes, market, entityId === UNSURE ? null : entityId)}
              social={rankSocialRoutes(
                resolveRoutes(config.routes, market, entityId === UNSURE ? null : entityId, 'social')
                  .routes,
                functionId,
                seniorityId,
              )}
              themes={config.themes}
              prefilled={prefilled}
              onChange={() => {
                setPrefilled(false);
                setEntityId(null);
                setStep('country');
              }}
              headingRef={headingRef}
            />
          )}
        </div>
      </main>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Canvas: everything derives from the two client tokens + computed on-colour.
// ---------------------------------------------------------------------------

function Canvas({
  primary,
  accent,
  children,
}: {
  primary: string;
  accent: string;
  children: ReactNode;
}) {
  const vars = {
    '--activate-primary': primary,
    '--activate-accent': accent,
    '--activate-on': onColor(primary),
  } as CSSProperties;
  return (
    <div style={vars} className="act-canvas relative min-h-screen overflow-hidden">
      <style>{activateCss}</style>
      <div className="act-blob act-blob-organic" aria-hidden />
      <div className="act-blob act-blob-ring" aria-hidden />
      <div className="act-blob act-blob-accent" aria-hidden />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function CompanyAvatar({
  org,
  size,
  markSize,
  className = '',
}: {
  org: ActivateConfig['org'];
  size: number;
  markSize: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = org.logo_domain
    ? logoSrc(org.logo_domain, 160)
    : org.logo_url ?? null;
  const initials = org.display_name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 3)
    .toUpperCase();
  return (
    <div
      className={`act-avatar flex items-center justify-center rounded-full bg-white ${className}`}
      style={{ width: size, height: size, boxShadow: '0 8px 24px rgba(0,0,0,.16)' }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          width={markSize}
          height={markSize}
          style={{ width: markSize, height: markSize, objectFit: 'contain' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="font-headline font-bold"
          style={{ color: 'var(--activate-primary)', fontSize: size * 0.32 }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

// Three steps now (the profile step is skippable) — a deliberate deviation
// from the two-step handoff, driven by the function/seniority gathering ask.
function StepDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex gap-1.5">
        <span className="act-dot" data-filled="true" />
        <span className="act-dot" data-filled={step >= 2} />
        <span className="act-dot" data-filled={step === 3} />
      </div>
      <span className="act-eyebrow">Step {step} of 3</span>
    </div>
  );
}

function Flag({ code, size }: { code: string; size: number }) {
  return (
    <ReactCountryFlag
      countryCode={code}
      svg
      aria-hidden
      style={{ width: size, height: size, borderRadius: 3 }}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 1 — welcome + country
// ---------------------------------------------------------------------------

function CountryStep({
  org,
  measured,
  onPick,
  headingRef,
}: {
  org: ActivateConfig['org'];
  measured: string[];
  onPick: (code: string) => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const byName = (a: string, b: string) => countryName(a).localeCompare(countryName(b));
  const others = COUNTRY_CODES.filter((c) => !measured.includes(c)).sort(byName);
  const matches = q
    ? [...measured, ...others].filter(
        (c) => countryName(c).toLowerCase().includes(q) || c.toLowerCase() === q,
      )
    : [];

  return (
    <>
      <CompanyAvatar org={org} size={88} markSize={58} className="act-avatar-entry" />
      <h1 className="act-display">{org.display_name}</h1>
      {org.tagline && <p className="act-tagline">{org.tagline}</p>}
      {org.blurb && <p className="act-blurb">{org.blurb}</p>}
      <StepDots step={1} />
      <h2 ref={headingRef} tabIndex={-1} className="act-question outline-none">
        Where are you based?
      </h2>

      <label className="act-search w-full">
        <Search size={17} className="shrink-0 act-search-icon" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search countries"
          aria-label="Search countries"
        />
      </label>

      {q === '' ? (
        <>
          <div className="flex w-full flex-col gap-2.5">
            {measured.map((code) => (
              <button key={code} onClick={() => onPick(code)} className="act-pill-solid">
                <Flag code={code} size={20} />
                <span className="flex-1 text-left">{countryName(code)}</span>
                <span className="act-measured-chip">Measured</span>
              </button>
            ))}
          </div>
          <p className="act-eyebrow mt-2 self-start" style={{ opacity: 0.9 }}>
            Everywhere else
          </p>
          <div
            className="act-scroll flex w-full flex-col gap-2 overflow-y-auto"
            role="listbox"
            aria-label="All countries"
          >
            {others.map((code) => (
              <button key={code} onClick={() => onPick(code)} className="act-pill-ghost" role="option" aria-selected="false">
                <Flag code={code} size={18} />
                <span className="flex-1 text-left">{countryName(code)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex w-full flex-col gap-2" role="listbox" aria-label="Search results">
          {matches.length === 0 && (
            <p className="py-2 text-center text-sm" style={{ color: 'color-mix(in srgb, var(--activate-on) 70%, transparent)' }}>
              No matches — try another spelling
            </p>
          )}
          {matches.slice(0, 30).map((code) => (
            <button
              key={code}
              onClick={() => {
                setQuery('');
                onPick(code);
              }}
              className="act-pill-ghost"
              style={{ minHeight: 52 }}
              role="option"
              aria-selected="false"
            >
              <Flag code={code} size={18} />
              <span className="flex-1 text-left">{countryName(code)}</span>
              {measured.includes(code) && <span className="act-measured-chip">Measured</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — entity
// ---------------------------------------------------------------------------

function EntityStep({
  org,
  entities,
  onPick,
  onBack,
  headingRef,
}: {
  org: ActivateConfig['org'];
  entities: ActivateConfig['entities'];
  onPick: (id: string) => void;
  onBack: () => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <>
      <div className="flex w-full items-center justify-between">
        <button onClick={onBack} className="act-back">
          <ChevronLeft size={15} aria-hidden />
          Back
        </button>
        <StepDots step={2} />
      </div>
      <CompanyAvatar org={org} size={64} markSize={42} />
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="act-question outline-none"
        style={{ fontSize: 22 }}
      >
        Which part of {org.display_name}?
      </h2>
      <p className="act-hint">
        It helps us point you at the right pages. Pick "Not sure" and we'll keep it general.
      </p>
      <div className="flex w-full flex-col" style={{ gap: 11 }}>
        {entities.map((e) => (
          <button key={e.id} onClick={() => onPick(e.id)} className="act-entity">
            <span className="flex-1 text-left">{e.name}</span>
            <ArrowRight size={17} aria-hidden style={{ color: 'var(--activate-primary)' }} />
          </button>
        ))}
        <button onClick={() => onPick(UNSURE)} className="act-entity">
          <span className="flex-1 text-left">Not sure</span>
          <ArrowRight size={17} aria-hidden style={{ color: 'var(--activate-primary)' }} />
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — optional profile (function + seniority)
//
// Review routing never keys on these (measured: function doesn't move the
// review mix). They rank the social section and are gathered as signal.
// ---------------------------------------------------------------------------

function ProfileStep({
  onDone,
  onBack,
  initialFunction,
  initialSeniority,
  headingRef,
}: {
  onDone: (functionId: string | null, seniorityId: string | null) => void;
  onBack: () => void;
  initialFunction: string | null;
  initialSeniority: string | null;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const [fn, setFn] = useState<string | null>(initialFunction);
  const [sen, setSen] = useState<string | null>(initialSeniority);
  return (
    <>
      <div className="flex w-full items-center justify-between">
        <button onClick={onBack} className="act-back">
          <ChevronLeft size={15} aria-hidden />
          Back
        </button>
        <StepDots step={3} />
      </div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="act-question outline-none"
        style={{ fontSize: 22 }}
      >
        Last one — what kind of work do you do?
      </h2>
      <p className="act-hint">
        Optional. It helps us point at the places where people like you actually get heard.
      </p>

      <p className="act-eyebrow self-start">Your kind of work</p>
      <div className="flex w-full flex-wrap gap-2">
        {JOB_FUNCTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => setFn(fn === o.id ? null : o.id)}
            className="act-select-chip"
            data-on={fn === o.id}
            aria-pressed={fn === o.id}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="act-eyebrow self-start" style={{ marginTop: 4 }}>
        Seniority
      </p>
      <div className="flex w-full flex-wrap gap-2">
        {SENIORITIES.map((o) => (
          <button
            key={o.id}
            onClick={() => setSen(sen === o.id ? null : o.id)}
            className="act-select-chip"
            data-on={sen === o.id}
            aria-pressed={sen === o.id}
          >
            {o.label}
          </button>
        ))}
      </div>

      <button onClick={() => onDone(fn, sen)} className="act-primary-btn mt-2">
        Show my places
        <ArrowRight size={16} aria-hidden />
      </button>
      <button onClick={() => onDone(null, null)} className="act-skip">
        Skip
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — routes (payoff)
// ---------------------------------------------------------------------------

function RoutesStep({
  token,
  sessionId,
  org,
  audience,
  market,
  entityName,
  entityId,
  resolved,
  social,
  themes,
  prefilled,
  onChange,
  headingRef,
}: {
  token: string;
  sessionId: string;
  org: ActivateConfig['org'];
  audience: ActivateConfig['audience'];
  market: string;
  entityName: string | null;
  entityId: string | null;
  resolved: ReturnType<typeof resolveRoutes>;
  social: ReturnType<typeof rankSocialRoutes>;
  themes: ActivateConfig['themes'];
  prefilled: boolean;
  onChange: () => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  // Market-specific theme weights win over the portfolio-wide set.
  const marketThemes = themes.filter((t) => t.market_code === market);
  const shownThemes = (marketThemes.length > 0
    ? marketThemes
    : themes.filter((t) => t.market_code === null)
  ).slice(0, 5);
  const { tier, routes } = resolved;
  const top = routes[0];
  const statPct = tier === 1 ? parseStatPct(top?.rationale_stat ?? null) : null;

  const who =
    audience === 'candidate'
      ? `candidates hear about life at ${org.display_name}`
      : audience === 'alumni'
        ? `people hear about working at ${org.display_name}`
        : `people hear about life at ${org.display_name}`;

  return (
    <>
      <div className="flex w-full items-center justify-between gap-3">
        <CompanyAvatar org={org} size={46} markSize={30} />
        <div className="flex flex-col items-end gap-1">
          <button onClick={onChange} className="act-context" data-prefilled={prefilled}>
            <span>
              Based in {countryName(market)}
              {entityName ? ` · ${entityName}` : ''}
            </span>
            <span className="underline underline-offset-2" style={{ opacity: 0.75 }}>
              change
            </span>
          </button>
          {prefilled && <span className="act-prefill-caption">prefilled by the sender</span>}
        </div>
      </div>

      {tier === 1 && statPct !== null ? (
        <StatBlock
          pct={statPct}
          sentence={
            <>
              of AI answers about working at {org.display_name} in {countryInSentence(market)}{' '}
              cite <strong className="font-bold">{platformName(top.platform)}</strong>.
            </>
          }
          headingRef={headingRef}
        />
      ) : (
        <div className="act-rise flex flex-col items-center gap-2 text-center">
          <h2 ref={headingRef} tabIndex={-1} className="act-generic-heading outline-none">
            These are the platforms AI leans on most for employer answers worldwide.
          </h2>
          <p className="act-generic-sub">
            We don't measure {countryInSentence(market)} yet, so there's no local number to show
            you.
          </p>
        </div>
      )}

      <p className="act-intro">
        Here's where {who}. If you'd like to share your experience — that's entirely up to you.
      </p>

      <div className="act-cards flex w-full flex-col gap-3">
        {routes.map((route, i) => (
          <PlatformCard
            key={route.platform}
            route={route}
            // The stat block already tells the top platform's story — repeating
            // the same sentence on its card reads as a glitch.
            hideRationale={i === 0 && tier === 1 && statPct !== null}
            onOpen={() =>
              logActivateEvent(token, sessionId, 'platform_click', {
                marketCode: market,
                entityCompanyId: entityId,
                platform: route.platform,
                tier: route.tier,
              })
            }
          />
        ))}
      </div>

      {social.routes.length > 0 && (
        <section className="act-rise-late mt-3 flex w-full flex-col items-center gap-3">
          <p className="act-eyebrow">Beyond reviews</p>
          <h3 className="act-question" style={{ fontSize: 19 }}>
            AI reads the public conversation too
          </h3>
          {shownThemes.length > 0 && (
            <>
              <p className="act-intro" style={{ maxWidth: 320 }}>
                Right now, these themes carry the most weight in how AI describes working at{' '}
                {org.display_name}:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {shownThemes.map((t) => (
                  <span key={t.theme} className="act-theme-chip">
                    {t.theme}
                  </span>
                ))}
              </div>
            </>
          )}
          <p className="act-intro" style={{ maxWidth: 320 }}>
            If you ever post about your work life, these are the places AI listens. What you make
            of any of it is yours.
          </p>
          <div className="flex w-full flex-col gap-3">
            {social.routes.map((route) => (
              <PlatformCard
                key={route.platform}
                route={route}
                matched={social.matched.has(route.platform)}
                onOpen={() =>
                  logActivateEvent(token, sessionId, 'platform_click', {
                    marketCode: market,
                    entityCompanyId: entityId,
                    platform: route.platform,
                    tier: route.tier,
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      <footer className="mt-2 flex flex-col items-center gap-2.5 text-center">
        <p className="act-honesty">We don't see what you write — or whether you write at all.</p>
        <span className="act-px-pill">
          <span className="act-px-dot" aria-hidden />
          Routed by PerceptionX
        </span>
      </footer>
    </>
  );
}

function StatBlock({
  pct,
  sentence,
  headingRef,
}: {
  pct: number;
  sentence: ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const [value, setValue] = useState(prefersReducedMotion() ? pct : 0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(pct);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setValue(pct * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  return (
    <div className="act-rise flex flex-col items-center gap-2 text-center">
      <div className="relative flex items-center justify-center">
        <span className="act-ring" aria-hidden />
        <h2 ref={headingRef} tabIndex={-1} className="act-stat outline-none" aria-label={`${pct}%`}>
          {value.toFixed(1)}%
        </h2>
      </div>
      <p className="act-stat-sentence">{sentence}</p>
    </div>
  );
}

function PlatformCard({
  route,
  onOpen,
  hideRationale = false,
  matched = false,
}: {
  route: ActivateRoute;
  onOpen: () => void;
  hideRationale?: boolean;
  /** Social affinity match for the declared profile — floats up + gets a chip. */
  matched?: boolean;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const domain = PLATFORM_DOMAINS[route.platform];
  const name = platformName(route.platform);
  const subLine = route.rationale_stat ?? route.fit_note;
  // use_direct_link → strip the Referer too: a bare URL alone still announces
  // this page to the platform unless the anchor is noreferrer.
  const rel = route.use_direct_link ? 'noopener noreferrer' : 'noopener';
  return (
    <div className="act-card act-rise-late overflow-hidden bg-white">
      <a
        href={route.destination_url}
        target="_blank"
        rel={rel}
        onClick={onOpen}
        className="flex items-center"
        style={{ minHeight: 66, padding: '14px 18px', gap: 13 }}
        aria-label={`${name} — opens in a new tab`}
      >
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: 34, height: 34, borderRadius: 9, background: '#F4F6F7' }}
        >
          {domain && !logoFailed ? (
            <img
              src={logoSrc(domain)}
              alt=""
              width={34}
              height={34}
              style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'contain' }}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span className="font-headline text-base font-semibold" style={{ color: '#13274F' }}>
              {name.charAt(0)}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-headline font-semibold" style={{ fontSize: 16.5, letterSpacing: '-.01em', color: '#13274F' }}>
              {name}
            </span>
            {matched && <span className="act-measured-chip">Your world</span>}
          </span>
          {subLine && !hideRationale && (
            <span className="block" style={{ fontSize: 12.5, lineHeight: 1.4, color: 'rgba(19,39,79,.6)' }}>
              {subLine}
            </span>
          )}
        </span>
        <ExternalLink size={16} aria-hidden style={{ color: 'rgba(19,39,79,.4)' }} />
      </a>
      {route.write_url && (
        <a
          href={route.write_url}
          target="_blank"
          rel={rel}
          onClick={onOpen}
          className="flex items-center justify-between font-semibold"
          style={{
            minHeight: 46,
            padding: '0 18px',
            borderTop: '1px solid rgba(19,39,79,.08)',
            fontSize: 13.5,
            color: 'var(--activate-primary)',
          }}
          aria-label={`Write on ${name} — opens in a new tab`}
        >
          Write on {name}
          <ArrowRight size={13} aria-hidden />
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dead link — neutral, no branding leakage
// ---------------------------------------------------------------------------

function DeadLink() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: '#F4F6F7' }}>
      <div
        className="flex w-full flex-col items-center gap-3 bg-white text-center"
        style={{
          maxWidth: 330,
          borderRadius: 24,
          border: '1px solid rgba(19,39,79,.1)',
          padding: '30px 26px',
        }}
      >
        <span
          className="flex items-center justify-center rounded-full"
          style={{ width: 44, height: 44, background: '#F4F6F7' }}
        >
          <AlertCircle size={22} aria-hidden style={{ color: 'rgba(19,39,79,.55)' }} />
        </span>
        <h1 className="font-headline font-semibold" style={{ fontSize: 19, color: '#13274F' }}>
          This link isn't active
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(19,39,79,.62)' }}>
          It may have expired or been withdrawn. If you were sent it by a colleague, ask them for
          a fresh one.
        </p>
        <span
          className="mt-1 inline-flex items-center gap-1.5 rounded-full font-medium"
          style={{
            padding: '7px 12px',
            background: '#F4F6F7',
            fontSize: 11,
            letterSpacing: '.06em',
            color: 'rgba(19,39,79,.76)',
          }}
        >
          <span
            aria-hidden
            style={{ width: 6, height: 6, borderRadius: 999, background: '#DB5E89' }}
          />
          Routed by PerceptionX
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas + component styling. Every translucent fill/border/muted text is a
// color-mix of the computed on-colour, so arbitrary client tokens stay AA.
// ---------------------------------------------------------------------------

const activateCss = `
.act-canvas {
  background:
    radial-gradient(115% 85% at 12% -6%,
      color-mix(in oklab, var(--activate-accent) 62%, var(--activate-primary)), transparent 62%),
    radial-gradient(95% 70% at 100% 26%,
      color-mix(in oklab, var(--activate-accent) 30%, var(--activate-primary)), transparent 58%),
    radial-gradient(110% 80% at 82% 108%,
      color-mix(in oklab, var(--activate-primary) 74%, #000), transparent 64%),
    var(--activate-primary);
  color: var(--activate-on);
  font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
}

/* Float shapes */
.act-blob { position: absolute; pointer-events: none; z-index: 0; }
.act-blob-organic {
  width: 190px; height: 190px; top: 8%; left: -60px;
  border-radius: 46% 54% 60% 40% / 50% 44% 56% 50%;
  background: color-mix(in srgb, var(--activate-on) 10%, transparent);
  animation: act-drift-a 11s ease-in-out infinite alternate;
}
.act-blob-ring {
  width: 220px; height: 220px; top: 55%; right: -90px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--activate-on) 22%, transparent);
  animation: act-drift-b 13s ease-in-out infinite alternate;
}
.act-blob-accent {
  width: 96px; height: 96px; bottom: 6%; left: 12%;
  border-radius: 42% 58% 52% 48% / 55% 45% 55% 45%;
  background: color-mix(in oklab, var(--activate-accent) 55%, transparent);
  animation: act-drift-a 9s ease-in-out infinite alternate-reverse;
}
@keyframes act-drift-a { from { transform: translate(0,0) rotate(0); } to { transform: translate(14px,18px) rotate(7deg); } }
@keyframes act-drift-b { from { transform: translate(0,0) rotate(0); } to { transform: translate(-16px,12px) rotate(-6deg); } }
@media (min-width: 768px) {
  .act-blob-organic { left: 4%; transform: scale(1.6); }
  .act-blob-ring { right: 6%; transform: scale(1.6); }
  .act-blob-accent { left: 8%; }
}

/* Step transition + rises */
.act-step { animation: act-step-in 360ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes act-step-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.act-avatar-entry { animation: act-pop 500ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes act-pop { 0% { transform: scale(.86); opacity: 0; } 70% { transform: scale(1.03); opacity: 1; } 100% { transform: scale(1); } }
.act-rise { animation: act-rise 520ms cubic-bezier(.2,.8,.2,1) 80ms both; }
.act-rise-late { animation: act-rise 500ms cubic-bezier(.2,.8,.2,1) 160ms both; }
@keyframes act-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

/* Type */
.act-display {
  font-family: 'Geologica', sans-serif; font-weight: 700;
  font-size: 27px; line-height: 1.1; letter-spacing: -.02em;
}
.act-tagline { font-size: 14px; line-height: 1.5; color: color-mix(in srgb, var(--activate-on) 72%, transparent); }
.act-blurb {
  font-size: 15px; line-height: 1.55; max-width: 300px; text-align: center;
  text-wrap: pretty; color: color-mix(in srgb, var(--activate-on) 88%, transparent);
}
.act-question {
  font-family: 'Geologica', sans-serif; font-weight: 600;
  font-size: 20px; line-height: 1.2; letter-spacing: -.015em; text-align: center;
}
.act-hint {
  font-size: 14px; line-height: 1.55; max-width: 290px; text-align: center;
  color: color-mix(in srgb, var(--activate-on) 72%, transparent);
}
.act-eyebrow {
  font-size: 10.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: color-mix(in srgb, var(--activate-on) 62%, transparent);
}
.act-dot { width: 20px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--activate-on) 32%, transparent); }
.act-dot[data-filled="true"] { background: var(--activate-on); }

/* Search */
.act-search {
  display: flex; align-items: center; gap: 10px; height: 50px;
  border-radius: 999px; padding: 0 16px;
  background: color-mix(in srgb, var(--activate-on) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--activate-on) 28%, transparent);
}
.act-search:focus-within { border-color: color-mix(in srgb, var(--activate-on) 55%, transparent); }
.act-search-icon { color: color-mix(in srgb, var(--activate-on) 70%, transparent); }
.act-search input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  font-size: 15px; font-weight: 500; color: var(--activate-on);
}
.act-search input::placeholder { color: color-mix(in srgb, var(--activate-on) 55%, transparent); }

/* Pills */
.act-pill-solid {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 56px; padding: 0 18px; border-radius: 999px;
  background: #fff; border: none; box-shadow: 0 6px 16px rgba(0,0,0,.14);
  font-size: 15.5px; font-weight: 600; color: #13274F;
  transition: transform 180ms; cursor: pointer;
}
.act-pill-solid:hover, .act-pill-solid:active { transform: translateY(-2px); }
.act-measured-chip {
  font-size: 9.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  padding: 5px 8px; border-radius: 999px;
  background: color-mix(in oklab, var(--activate-accent) 20%, #fff);
  color: color-mix(in oklab, var(--activate-accent) 80%, #13274F);
}
.act-pill-ghost {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 50px; padding: 0 18px; border-radius: 999px;
  background: color-mix(in srgb, var(--activate-on) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--activate-on) 30%, transparent);
  font-size: 15px; font-weight: 500; color: var(--activate-on);
  transition: background 180ms; cursor: pointer;
}
.act-pill-ghost:hover { background: color-mix(in srgb, var(--activate-on) 22%, transparent); }
.act-scroll { max-height: 184px; }
@media (min-width: 768px) { .act-scroll { max-height: 320px; } }

/* Entity chips */
.act-entity {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 60px; padding: 0 20px; border-radius: 999px;
  background: #fff; border: none; box-shadow: 0 6px 16px rgba(0,0,0,.14);
  font-family: 'Geologica', sans-serif; font-weight: 500;
  font-size: 17px; letter-spacing: -.01em; color: #13274F;
  transition: transform 180ms; cursor: pointer;
}
.act-entity:hover, .act-entity:active { transform: translateY(-2px); }

/* Back */
.act-back {
  display: inline-flex; align-items: center; gap: 4px; min-height: 44px;
  background: transparent; border: none; cursor: pointer;
  font-size: 14px; font-weight: 600;
  color: color-mix(in srgb, var(--activate-on) 82%, transparent);
}

/* Context pill */
.act-context {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px;
  padding: 0 14px; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--activate-on) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--activate-on) 34%, transparent);
  font-size: 12.5px; font-weight: 600; color: var(--activate-on); text-align: left;
}
.act-context[data-prefilled="true"] {
  background: color-mix(in srgb, var(--activate-on) 22%, transparent);
  border-color: color-mix(in srgb, var(--activate-on) 52%, transparent);
}
.act-prefill-caption { font-size: 11px; color: color-mix(in srgb, var(--activate-on) 58%, transparent); }

/* Stat block */
.act-stat {
  font-family: 'Geologica', sans-serif; font-weight: 700;
  font-size: 66px; line-height: 1; letter-spacing: -.04em;
  font-variant-numeric: tabular-nums; position: relative; z-index: 1;
}
@media (min-width: 768px) { .act-stat { font-size: 88px; } }
.act-ring {
  position: absolute; width: 96px; height: 96px; border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--activate-on) 45%, transparent);
  animation: act-pulse 1.5s ease-out 500ms both;
}
@keyframes act-pulse { from { transform: scale(.55); opacity: 1; } to { transform: scale(2); opacity: 0; } }
.act-stat-sentence {
  font-size: 16px; line-height: 1.45; max-width: 300px;
  color: color-mix(in srgb, var(--activate-on) 88%, transparent);
}
.act-generic-heading {
  font-family: 'Geologica', sans-serif; font-weight: 600;
  font-size: 25px; line-height: 1.2; max-width: 320px;
}
.act-generic-sub { font-size: 14px; color: color-mix(in srgb, var(--activate-on) 68%, transparent); }
.act-intro {
  font-size: 14.5px; line-height: 1.55; max-width: 320px; text-align: center;
  color: color-mix(in srgb, var(--activate-on) 74%, transparent);
}

/* Route cards */
.act-card { border-radius: 24px; box-shadow: 0 8px 20px rgba(0,0,0,.16); }

/* Profile step */
.act-select-chip {
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 0 16px; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--activate-on) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--activate-on) 30%, transparent);
  font-size: 14px; font-weight: 500; color: var(--activate-on);
  transition: background 180ms, transform 180ms;
}
.act-select-chip:hover { background: color-mix(in srgb, var(--activate-on) 22%, transparent); }
.act-select-chip[data-on="true"] {
  background: #fff; border-color: #fff; color: #13274F; font-weight: 600;
  box-shadow: 0 6px 16px rgba(0,0,0,.14);
}
.act-primary-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 56px; padding: 0 26px; border-radius: 999px; border: none; cursor: pointer;
  background: #fff; color: #13274F; box-shadow: 0 6px 16px rgba(0,0,0,.14);
  font-family: 'Geologica', sans-serif; font-weight: 600; font-size: 16px;
  transition: transform 180ms;
}
.act-primary-btn:hover { transform: translateY(-2px); }
.act-skip {
  background: transparent; border: none; cursor: pointer; min-height: 44px;
  font-size: 14px; font-weight: 600;
  color: color-mix(in srgb, var(--activate-on) 62%, transparent);
  text-decoration: underline; text-underline-offset: 3px;
}

/* Theme chips — topic visibility, never sentiment */
.act-theme-chip {
  display: inline-flex; align-items: center; min-height: 34px;
  padding: 0 14px; border-radius: 999px;
  background: color-mix(in srgb, var(--activate-on) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--activate-on) 32%, transparent);
  font-size: 13px; font-weight: 600; color: var(--activate-on);
}

/* Footer */
.act-honesty {
  font-size: 12.5px; line-height: 1.5; max-width: 300px;
  color: color-mix(in srgb, var(--activate-on) 66%, transparent);
}
.act-px-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 999px;
  background: color-mix(in srgb, var(--activate-on) 12%, transparent);
  font-size: 11px; font-weight: 500; letter-spacing: .06em;
  color: color-mix(in srgb, var(--activate-on) 76%, transparent);
}
.act-px-dot { width: 6px; height: 6px; border-radius: 999px; background: #DB5E89; }

/* Spinner */
.act-spinner {
  width: 38px; height: 38px; border-radius: 50%;
  border: 2.5px solid color-mix(in srgb, var(--activate-on) 26%, transparent);
  border-top-color: var(--activate-on);
  animation: act-spin 900ms linear infinite;
}
@keyframes act-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .act-blob, .act-step, .act-avatar-entry, .act-rise, .act-rise-late, .act-ring { animation: none; }
  .act-ring { opacity: 0; }
  .act-pill-solid:hover, .act-pill-solid:active,
  .act-entity:hover, .act-entity:active { transform: none; }
}
`;
