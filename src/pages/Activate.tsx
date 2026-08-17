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
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Search,
} from 'lucide-react';
import { useMetaTags } from '@/hooks/useMetaTags';
import {
  ActivateChannel,
  ActivateConfig,
  ActivateHighlight,
  ActivateRoute,
  COUNTRY_CODES,
  countryInSentence,
  countryName,
  entitiesForMarket,
  entityCompanyIdFor,
  entityOwningCompanyId,
  getActivateByToken,
  highlightFor,
  JOB_FUNCTIONS,
  logActivateEvent,
  measuredMarketCodes,
  rankSocialRoutes,
  resolveRoutes,
} from '@/lib/activate/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; config: ActivateConfig };

type Step = 'intro' | 'country' | 'entity' | 'profile' | 'willing' | 'routes';

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
  ambitionbox: 'AmbitionBox',
  undelucram: 'Undelucram.ro',
  profession: 'Profession.hu',
  infojobs: 'InfoJobs',
  comparably: 'Comparably',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  blind: 'Blind',
  quora: 'Quora',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  openwork: 'OpenWork',
  jobtalk: 'JobTalk',
  jobplanet: 'JobPlanet',
  gowork: 'GoWork.pl',
  workventure: 'WorkVenture',
  levels: 'Levels.fyi',
  note: 'note',
  naver: 'Naver Blog',
  brunch: 'brunch',
  fourprogrammers: '4programmers.net',
};

const PLATFORM_DOMAINS: Record<string, string> = {
  kununu: 'kununu.com',
  glassdoor: 'glassdoor.com',
  indeed: 'indeed.com',
  seek: 'seek.com.au',
  ambitionbox: 'ambitionbox.com',
  undelucram: 'undelucram.ro',
  profession: 'profession.hu',
  infojobs: 'infojobs.com.br',
  comparably: 'comparably.com',
  linkedin: 'linkedin.com',
  reddit: 'reddit.com',
  blind: 'teamblind.com',
  quora: 'quora.com',
  instagram: 'instagram.com',
  tiktok: 'tiktok.com',
  youtube: 'youtube.com',
  facebook: 'facebook.com',
  openwork: 'openwork.jp',
  jobtalk: 'jobtalk.jp',
  jobplanet: 'jobplanet.co.kr',
  gowork: 'gowork.pl',
  workventure: 'workventure.com',
  levels: 'levels.fyi',
  note: 'note.com',
  naver: 'naver.com',
  brunch: 'brunch.co.kr',
  fourprogrammers: '4programmers.net',
};

/**
 * How to actually leave something, per platform. Procedural only — these say
 * where to tap, never what to say.
 */
const PLATFORM_HOWTO: Record<string, string[]> = {
  glassdoor: [
    'Open the company profile',
    'Sign in or create a free account',
    'Choose “Reviews”, then “Add a review”',
    'Pick your job title, location and dates',
    'Write in your own words and submit',
  ],
  indeed: [
    'Open the company profile',
    'Choose “Review this company”',
    'Rate the areas you want to — skip the rest',
    'Write in your own words and submit',
  ],
  kununu: [
    'Open the company profile',
    'Choose “Bewertung schreiben”',
    'Pick your role and location',
    'Write in your own words and submit',
  ],
  ambitionbox: [
    'Open the company page',
    'Choose “Write a review”',
    'Sign in with any email address',
    'Write in your own words and submit',
  ],
  reddit: [
    'Open the thread',
    'Sign in or create an account',
    'Reply with whatever you think is worth knowing',
  ],
  quora: ['Open the question', 'Sign in or create an account', 'Choose “Answer” and write'],
  blind: [
    'Open the company page',
    'Verify with your work email — Blind hides who you are',
    'Post or reply',
  ],
  linkedin: ['Open LinkedIn and start a post', 'Say what you want about your work', 'Post it'],
};

const HOWTO_BY_CHANNEL: Record<string, string[]> = {
  review: [
    'Open the company profile',
    'Sign in or create a free account',
    'Find the option to write a review',
    'Write in your own words and submit',
  ],
  forum: ['Open the page', 'Sign in or create an account', 'Reply in your own words'],
  social: ['Open the app', 'Post about your work', 'Mention the company if you want to'],
};

function howToFor(route: ActivateRoute): string[] {
  return PLATFORM_HOWTO[route.platform] ?? HOWTO_BY_CHANNEL[route.channel] ?? [];
}

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
  const [step, setStep] = useState<Step>('intro');
  const [market, setMarket] = useState<string | null>(null);
  // Entity NAME (entities are deduped by name) or UNSURE; the market-specific
  // company id is derived from it, so brand × market orgs resolve correctly.
  const [entityKey, setEntityKey] = useState<string | null>(null);
  const [functionId, setFunctionId] = useState<string | null>(null);
  // What the recipient is open to doing. Empty = they skipped, so show all.
  const [channels, setChannels] = useState<ActivateChannel[]>([]);
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
      const preEntity = cfg.prefill_entity_company_id
        ? entityOwningCompanyId(cfg.entities, cfg.prefill_entity_company_id)
        : undefined;
      if (preMarket) {
        setMarket(preMarket);
        logActivateEvent(token, sessionId, 'market_declared', { marketCode: preMarket });
        if (preEntity || cfg.entities.length === 0) {
          setEntityKey(preEntity?.name ?? UNSURE);
          logActivateEvent(token, sessionId, 'entity_declared', {
            marketCode: preMarket,
            entityCompanyId: preEntity ? entityCompanyIdFor(preEntity, preMarket) : null,
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

  // Entities are name-deduped; only those present in the declared market show.
  const marketEntities = market ? entitiesForMarket(config.entities, market) : config.entities;
  const selectedEntity =
    entityKey && entityKey !== UNSURE
      ? config.entities.find((e) => e.name === entityKey)
      : undefined;
  // The company row representing that entity in this market — what routes and
  // events key on.
  const entityCompanyId =
    selectedEntity && market ? entityCompanyIdFor(selectedEntity, market) : null;

  const declareMarket = (code: string) => {
    setMarket(code);
    logActivateEvent(token!, sessionId, 'market_declared', { marketCode: code });
    if (entitiesForMarket(config.entities, code).length === 0) {
      setEntityKey(UNSURE);
      logActivateEvent(token!, sessionId, 'entity_declared', { marketCode: code });
      setStep('profile');
    } else {
      setStep('entity');
    }
  };

  const declareEntity = (name: string) => {
    setEntityKey(name);
    const picked = name === UNSURE ? undefined : config.entities.find((e) => e.name === name);
    logActivateEvent(token!, sessionId, 'entity_declared', {
      marketCode: market,
      entityCompanyId: picked && market ? entityCompanyIdFor(picked, market) : null,
    });
    setStep('profile');
  };

  const declareProfile = (fn: string | null) => {
    setFunctionId(fn);
    if (fn) {
      logActivateEvent(token!, sessionId, 'profile_declared', {
        marketCode: market,
        functionId: fn,
      });
    }
    setStep('willing');
  };

  const declareWilling = (picked: ActivateChannel[]) => {
    setChannels(picked);
    if (picked.length > 0) {
      logActivateEvent(token!, sessionId, 'profile_declared', {
        marketCode: market,
        functionId,
        channels: picked,
      });
    }
    setStep('routes');
  };

  return (
    <Canvas primary={org.primary_color} accent={org.accent_color} fonts={org}>
      <main
        aria-live="polite"
        className="relative z-[1] mx-auto flex min-h-screen w-full max-w-[460px] flex-col items-center gap-4 px-[22px] pb-11 pt-16 md:px-8 md:pt-28"
      >
        {step === 'routes' && market && (
          <RoutesTopBar
            org={org}
            market={market}
            entityName={selectedEntity?.name ?? null}
            prefilled={prefilled}
            onChange={() => {
              setPrefilled(false);
              setEntityKey(null);
              setStep('country');
            }}
          />
        )}

        <div key={step} className="act-step flex w-full flex-col items-center gap-4">
          {step === 'intro' && (
            <IntroStep org={org} onDone={() => setStep('country')} headingRef={headingRef} />
          )}
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
              entities={marketEntities}
              onPick={declareEntity}
              onBack={() => setStep('country')}
              headingRef={headingRef}
            />
          )}
          {step === 'profile' && (
            <ProfileStep
              org={org}
              onDone={declareProfile}
              onBack={() => setStep('entity')}
              initialFunction={functionId}
              headingRef={headingRef}
            />
          )}
          {step === 'willing' && (
            <WillingStep
              org={org}
              initial={channels}
              onDone={declareWilling}
              onBack={() => setStep('profile')}
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
              entityId={entityCompanyId}
              resolved={resolveRoutes(config.routes, market, entityCompanyId)}
              forum={rankSocialRoutes(
                resolveRoutes(config.routes, market, entityCompanyId, 'forum').routes,
                functionId,
                null,
              )}
              social={rankSocialRoutes(
                resolveRoutes(config.routes, market, entityCompanyId, 'social').routes,
                functionId,
                null,
              )}
              highlights={config.highlights}
              coverage={config.coverage ?? {}}
              channels={channels}
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

type ClientFontConfig = Pick<
  ActivateConfig['org'],
  'heading_font' | 'body_font' | 'heading_font_url' | 'body_font_url'
>;

/** Quote a client family name and append the product default as fallback. */
function fontStack(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed ? `'${trimmed.replace(/'/g, '')}', ${fallback}` : fallback;
}

const FONT_FORMATS: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

/**
 * Client typography, resolved per family:
 *   name + uploaded file -> @font-face under that name
 *   name only            -> assumed to be a Google Fonts family, linked
 * Anything missing simply falls through to the product defaults.
 */
function ClientFonts({ fonts }: { fonts?: ClientFontConfig }) {
  if (!fonts) return null;
  const pairs: Array<[string | null, string | null]> = [
    [fonts.heading_font, fonts.heading_font_url],
    [fonts.body_font, fonts.body_font_url],
  ];

  const faces: string[] = [];
  const googleFamilies: string[] = [];
  for (const [name, url] of pairs) {
    const family = name?.trim();
    if (!family) continue;
    if (url) {
      const ext = url.split('.').pop()?.toLowerCase() ?? '';
      const format = FONT_FORMATS[ext];
      faces.push(
        `@font-face{font-family:'${family.replace(/'/g, '')}';` +
          `src:url('${url}')${format ? ` format('${format}')` : ''};` +
          `font-display:swap;}`,
      );
    } else if (!googleFamilies.includes(family)) {
      googleFamilies.push(family);
    }
  }

  const googleHref = googleFamilies.length
    ? `https://fonts.googleapis.com/css2?${googleFamilies
        .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
        .join('&')}&display=swap`
    : null;

  return (
    <>
      {googleHref && <link rel="stylesheet" href={googleHref} />}
      {faces.length > 0 && <style>{faces.join('')}</style>}
    </>
  );
}

function Canvas({
  primary,
  accent,
  fonts,
  children,
}: {
  primary: string;
  accent: string;
  fonts?: ClientFontConfig;
  children: ReactNode;
}) {
  const vars = {
    '--activate-primary': primary,
    '--activate-accent': accent,
    '--activate-on': onColor(primary),
    '--activate-font-heading': fontStack(fonts?.heading_font, "'Geologica', sans-serif"),
    '--activate-font-body': fontStack(
      fonts?.body_font,
      "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
    ),
  } as CSSProperties;
  return (
    <div style={vars} className="act-canvas relative min-h-screen overflow-hidden">
      <ClientFonts fonts={fonts} />
      <style>{activateCss}</style>
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
  // An uploaded logo always wins: logo.dev is only a convenience fallback for
  // orgs whose mark hasn't been supplied yet.
  const src = org.logo_url ?? (org.logo_domain ? logoSrc(org.logo_domain, 160) : null);
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
/**
 * The one PerceptionX mark on the page. The logo carries the wordmark, so the
 * text is just "Powered by" — repeating the name would say it twice. The
 * on-dark variant has a white wordmark, so pick by the canvas ink.
 */
function PoweredBy({ onDark }: { onDark: boolean }) {
  return (
    <span className="act-powered" data-on-dark={onDark}>
      Powered by
      <img
        src={
          onDark
            ? '/logos/PerceptionX-PrimaryLogo-ForOnDark-large.png'
            : '/logos/PerceptionX-PrimaryLogo.png'
        }
        alt="PerceptionX"
        className="act-powered-logo"
      />
    </span>
  );
}

/** Client campaign artwork; hides itself if the URL fails to load. */
function Banner({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={url}
      alt=""
      className="act-banner act-avatar-entry"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * A short welcome before the questions. Lines arrive one at a time; tapping
 * anywhere skips ahead, and reduced-motion shows the whole thing at once.
 */
function IntroStep({
  org,
  onDone,
  headingRef,
}: {
  org: ActivateConfig['org'];
  onDone: () => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const lines = [
    'Hey there 👋',
    `Thanks for joining the conversation about ${org.display_name}.`,
    'Before we start, just a couple of quick details.',
  ];
  const reduced = prefersReducedMotion();
  const [shown, setShown] = useState(reduced ? lines.length : 0);

  useEffect(() => {
    if (reduced || shown >= lines.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 350 : 1100);
    return () => clearTimeout(t);
  }, [shown, reduced, lines.length]);

  const ready = shown >= lines.length;

  return (
    <button className="act-intro-screen" onClick={ready ? onDone : () => setShown(lines.length)}>
      {org.banner_url && <Banner url={org.banner_url} />}
      <CompanyAvatar org={org} size={72} markSize={46} className="act-avatar-entry" />
      <div className="flex flex-col items-center gap-3">
        {lines.map((line, i) =>
          i < shown ? (
            <h1
              key={line}
              ref={i === 0 ? headingRef : undefined}
              tabIndex={i === 0 ? -1 : undefined}
              className={`act-intro-line outline-none ${i === 0 ? 'act-intro-lead' : ''}`}
            >
              {line}
            </h1>
          ) : null,
        )}
      </div>
      <span className="act-intro-cta" data-ready={ready}>
        {ready ? 'Let’s go' : 'Tap to skip'}
        <ArrowRight size={16} aria-hidden />
      </span>
    </button>
  );
}

/**
 * Rendered outside the animated step wrapper on purpose: that wrapper keeps an
 * identity transform after its animation, which would make position:fixed
 * resolve against it instead of the viewport.
 */
function RoutesTopBar({
  org,
  market,
  entityName,
  prefilled,
  onChange,
}: {
  org: ActivateConfig['org'];
  market: string;
  entityName: string | null;
  prefilled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="act-topbar flex w-full items-center justify-between gap-3">
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
  );
}

const WILLING_OPTIONS: Array<{ id: ActivateChannel; label: string; note: string }> = [
  {
    id: 'review',
    label: 'Leave a review about your experience',
    note: 'Glassdoor, Indeed and the local sites where candidates look first',
  },
  {
    id: 'forum',
    label: 'Join a conversation on forums',
    note: 'People are already asking what it’s like to work here',
  },
  { id: 'social', label: 'Post on social media', note: 'On your own account, in your own words' },
];

/**
 * The last question, and the one that shapes the payoff: only the kinds of
 * contribution someone is open to get shown. Skipping shows everything —
 * this narrows the page, it never withholds anything.
 */
function WillingStep({
  org,
  initial,
  onDone,
  onBack,
  headingRef,
}: {
  org: ActivateConfig['org'];
  initial: ActivateChannel[];
  onDone: (picked: ActivateChannel[]) => void;
  onBack: () => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const [picked, setPicked] = useState<ActivateChannel[]>(initial);
  const toggle = (id: ActivateChannel) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <>
      <StepHeader org={org} step={4} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1} className="act-question outline-none">
        What are you up for?
      </h2>
      <p className="act-hint">
        Pick anything you're comfortable with. There's no wrong answer, and you can skip.
      </p>

      <div className="flex w-full flex-col gap-2.5">
        {WILLING_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => toggle(o.id)}
            className="act-willing"
            data-on={picked.includes(o.id)}
            aria-pressed={picked.includes(o.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="act-willing-label">{o.label}</span>
              <span className="act-willing-note">{o.note}</span>
            </span>
            {picked.includes(o.id) && <Check className="h-4 w-4 shrink-0" />}
          </button>
        ))}
      </div>

      <button onClick={() => onDone(picked)} className="act-primary-btn mt-2">
        {picked.length > 0 ? 'Show my places' : 'Show me everything'}
        <ArrowRight size={16} aria-hidden />
      </button>
    </>
  );
}

/** Same top-of-step furniture everywhere: back, progress, mark. */
function StepHeader({
  org,
  step,
  onBack,
}: {
  org: ActivateConfig['org'];
  step: 1 | 2 | 3 | 4;
  onBack?: () => void;
}) {
  return (
    <>
      <div className="flex w-full items-center justify-between">
        {onBack ? (
          <button onClick={onBack} className="act-back">
            <ChevronLeft size={15} aria-hidden /> Back
          </button>
        ) : (
          <span aria-hidden />
        )}
        <StepDots step={step} />
      </div>
      <CompanyAvatar org={org} size={64} markSize={42} className="act-avatar-entry" />
    </>
  );
}

const TOTAL_STEPS = 4;

function StepDots({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span key={i} className="act-dot" data-filled={step >= i + 1} />
        ))}
      </div>
      <span className="act-eyebrow">
        Step {step} of {TOTAL_STEPS}
      </span>
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
      {/* Optional campaign banner. Decorative: the company name is the h1
          immediately below, so it carries no alt text of its own. */}
      {org.banner_url && <Banner url={org.banner_url} />}
      <StepHeader org={org} step={1} />
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

      {/* Nothing listed until they type — the full country list under the
          field was more to scroll past than to choose from. Measured markets
          still sort first among matches. */}
      {q === '' ? (
        <p className="act-search-hint">Start typing to find your country.</p>
      ) : (
        <div className="flex w-full flex-col gap-2" role="listbox" aria-label="Search results">
          {matches.length === 0 && (
            <p className="act-search-hint">No matches — try another spelling.</p>
          )}
          {matches.slice(0, 30).map((code) => (
            <button
              key={code}
              onClick={() => {
                setQuery('');
                onPick(code);
              }}
              className="act-pill-solid"
              role="option"
              aria-selected="false"
            >
              <Flag code={code} size={20} />
              <span className="flex-1 text-left">{countryName(code)}</span>
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
  onPick: (name: string) => void;
  onBack: () => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <>
      <StepHeader org={org} step={2} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1} className="act-question outline-none">
        Which part of {org.display_name}?
      </h2>
      <p className="act-hint">
        It helps us point you at the right pages. Pick "Not sure" and we'll keep it general.
      </p>
      <div className="flex w-full flex-col" style={{ gap: 11 }}>
        {entities.map((e) => (
          <button key={e.name} onClick={() => onPick(e.name)} className="act-entity">
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
  org,
  onDone,
  onBack,
  initialFunction,
  headingRef,
}: {
  org: ActivateConfig['org'];
  onDone: (functionId: string | null) => void;
  onBack: () => void;
  initialFunction: string | null;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const [fn, setFn] = useState<string | null>(initialFunction);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = q
    ? JOB_FUNCTIONS.filter((o) => o.label.toLowerCase().includes(q))
    : JOB_FUNCTIONS;
  // Nobody's job fits a fixed list, so whatever they type is offered back as
  // its own option. Capped to the length the event RPC accepts.
  const custom = query.trim().slice(0, 60);
  const canUseCustom =
    custom.length > 1 && !JOB_FUNCTIONS.some((o) => o.label.toLowerCase() === q);
  const selectedLabel =
    JOB_FUNCTIONS.find((o) => o.id === fn)?.label ?? (fn && fn !== '' ? fn : null);

  return (
    <>
      <StepHeader org={org} step={3} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1} className="act-question outline-none">
        What kind of work do you do?
      </h2>

      <label className="act-search w-full">
        <Search size={17} className="shrink-0 act-search-icon" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or type your own"
          aria-label="Search roles, or type your own"
        />
      </label>

      <div
        className="act-scroll flex w-full flex-col gap-2 overflow-y-auto"
        role="listbox"
        aria-label="Kinds of work"
      >
        {canUseCustom && (
          <button
            onClick={() => setFn(custom)}
            className={fn === custom ? 'act-pill-solid' : 'act-pill-ghost'}
            role="option"
            aria-selected={fn === custom}
          >
            <span className="flex-1 text-left">Use “{custom}”</span>
            {fn === custom && <Check className="h-4 w-4 shrink-0" />}
          </button>
        )}
        {matches.map((o) => (
          <button
            key={o.id}
            onClick={() => setFn(fn === o.id ? null : o.id)}
            className={fn === o.id ? 'act-pill-solid' : 'act-pill-ghost'}
            role="option"
            aria-selected={fn === o.id}
          >
            <span className="flex-1 text-left">{o.label}</span>
            {fn === o.id && <Check className="h-4 w-4 shrink-0" />}
          </button>
        ))}
      </div>

      {/* Not the last step — the willingness question follows, so this can't
          promise the payoff. */}
      <button onClick={() => onDone(fn)} className="act-primary-btn mt-2">
        {selectedLabel ? 'Next' : 'Skip'}
        <ArrowRight size={16} aria-hidden />
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
  entityId,
  resolved,
  forum,
  social,
  highlights,
  coverage,
  channels,
  headingRef,
}: {
  token: string;
  sessionId: string;
  org: ActivateConfig['org'];
  audience: ActivateConfig['audience'];
  market: string;
  entityId: string | null;
  resolved: ReturnType<typeof resolveRoutes>;
  forum: ReturnType<typeof rankSocialRoutes>;
  social: ReturnType<typeof rankSocialRoutes>;
  highlights: ActivateConfig['highlights'];
  coverage: ActivateConfig['coverage'];
  channels: ActivateChannel[];
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  // Shared by all three channel sections.
  const sectionProps = {
    market,
    highlights,
    onOpen: (route: ActivateRoute) =>
      logActivateEvent(token, sessionId, 'platform_click', {
        marketCode: market,
        entityCompanyId: entityId,
        platform: route.platform,
        tier: route.tier,
      }),
  };
  const { routes } = resolved;
  // Share of this market's answers that come from the platforms listed below.
  const coveragePct = coverage[market] ?? null;
  // No pick means they skipped the question, which shows everything.
  const wants = (c: ActivateChannel) => channels.length === 0 || channels.includes(c);

  return (
    <>
      {/* A general heading — "what are my options" is the question a
          recipient actually arrives with. The measurement is evidence for
          the list, so it sits under it in plain text rather than as a
          dashboard number. */}
      <div className="act-rise flex flex-col items-center gap-2 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="act-generic-heading outline-none">
          Your options in {countryInSentence(market)}
        </h2>
        <p className="act-intro">
          These are the places AI pulls from when someone asks what it's like to work at{' '}
          {org.display_name} here
          {coveragePct !== null ? ` — in ${coveragePct}% of answers` : ''}.
        </p>
      </div>

      <p className="act-intro">
        Share your honest thoughts on any of them you're comfortable with — or none at all.
        Whether you say anything, and what you say, is entirely yours.
      </p>

      {wants('review') && (
        <ChannelSection eyebrow="Review sites" routes={routes} {...sectionProps} />
      )}

      {wants('forum') && (
        <ChannelSection eyebrow="Forums" routes={forum.routes} matched={forum.matched} {...sectionProps} />
      )}

      {wants('social') && (
        <ChannelSection eyebrow="Social" routes={social.routes} matched={social.matched} {...sectionProps} />
      )}

      <footer className="mt-2 flex flex-col items-center gap-2.5 text-center">
        <p className="act-honesty">We don't see what you write — or whether you write at all.</p>
        <PoweredBy onDark={onColor(org.primary_color) === '#FFFFFF'} />
      </footer>
    </>
  );
}

function ChannelSection({
  eyebrow,
  routes,
  matched,
  hideFirstRationale = false,
  market,
  highlights,
  onOpen,
}: {
  eyebrow: string;
  routes: ActivateRoute[];
  matched?: Set<string>;
  hideFirstRationale?: boolean;
  market: string;
  highlights: ActivateConfig['highlights'];
  onOpen: (route: ActivateRoute) => void;
}) {
  if (routes.length === 0) return null;
  // Listen-only sources are counted in the headline percentage but never
  // listed: there is nothing for a recipient to do on them.
  const actionable = routes.filter((r) => !r.is_listen_only);
  if (actionable.length === 0) return null;
  return (
    <section className="act-rise-late flex w-full flex-col items-center gap-2.5">
      <p className="act-eyebrow">{eyebrow}</p>
      <div className="flex w-full flex-col gap-2.5">
        {actionable.map((route, i) => (
          <PlatformCard
            key={route.platform}
            route={route}
            matched={matched?.has(route.platform)}
            // The stat block already told the top platform's story — repeating
            // the same sentence on its card reads as a glitch.
            hideRationale={i === 0 && hideFirstRationale}
            highlight={highlightFor(highlights, market, route.platform)}
            localLabel={`${countryName(market)}'s own`}
            onOpen={() => onOpen(route)}
          />
        ))}
      </div>
    </section>
  );
}

function PlatformCard({
  route,
  onOpen,
  hideRationale = false,
  matched = false,
  highlight,
  localLabel = 'Local',
}: {
  route: ActivateRoute;
  onOpen: () => void;
  hideRationale?: boolean;
  /** e.g. "Romania's own" — every market with a local platform reads well. */
  localLabel?: string;
  /** Social affinity match for the declared profile — floats up + gets a chip. */
  matched?: boolean;
  /** The single page AI cites most here, shown as a second row. */
  highlight?: ActivateHighlight;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const domain = PLATFORM_DOMAINS[route.platform];
  const name = platformName(route.platform);
  const subLine = route.rationale_stat ?? route.fit_note;
  // use_direct_link → strip the Referer too: a bare URL alone still announces
  // this page to the platform unless the anchor is noreferrer.
  const rel = route.use_direct_link ? 'noopener noreferrer' : 'noopener';
  return (
    <div
      className="act-card act-rise-late overflow-hidden bg-white"
      data-local={route.is_local || undefined}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center text-left"
        style={{ minHeight: 66, padding: '14px 18px', gap: 13 }}
        aria-expanded={open}
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
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-headline font-semibold" style={{ fontSize: 16.5, letterSpacing: '-.01em', color: '#13274F' }}>
              {name}
            </span>
            {route.is_local && <span className="act-local-chip">{localLabel}</span>}
            {matched && <span className="act-affinity-chip">Your world</span>}
          </span>
          {/* What you'd actually do here leads; the coverage number is
              supporting evidence, not the headline. */}
          {route.action_label && (
            <span
              className="block font-semibold"
              style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--activate-primary)' }}
            >
              {route.action_label}
            </span>
          )}
          {subLine && !hideRationale && (
            <span className="block" style={{ fontSize: 12, lineHeight: 1.4, color: 'rgba(19,39,79,.52)' }}>
              {subLine}
            </span>
          )}
        </span>
        <ChevronDown
          size={17}
          aria-hidden
          className="shrink-0 transition-transform"
          style={{ color: 'rgba(19,39,79,.4)', transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>

      {/* Guidance appears on tap: where to go and what to press. Never what
          to say — the steps stop at "write in your own words". */}
      {open && (
        <div className="act-howto">
          <ol>
            {howToFor(route).map((stepText) => (
              <li key={stepText}>{stepText}</li>
            ))}
          </ol>
          <a
            href={route.write_url ?? route.destination_url}
            target="_blank"
            rel={rel}
            onClick={onOpen}
            className="act-howto-open"
            aria-label={`Open ${name} — opens in a new tab`}
          >
            Open {name}
            <ExternalLink size={15} aria-hidden />
          </a>
        </div>
      )}
      {/* The page AI actually cites most here — the conversation itself,
          rather than a bare platform link. */}
      {highlight && (
        <a
          href={highlight.url}
          target="_blank"
          rel={rel}
          onClick={onOpen}
          className="act-highlight-row"
          aria-label={`${highlight.label} — opens in a new tab`}
        >
          <span className="act-highlight-label">
            {route.channel === 'forum' ? 'Answer this' : 'Most cited'}
          </span>
          <span className="min-w-0 flex-1 truncate">{highlight.label}</span>
          <ArrowRight size={13} aria-hidden className="shrink-0" />
        </a>
      )}
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
        {/* Rendered outside <Canvas>, so the act-* stylesheet isn't mounted
            here — these styles have to be inline. */}
        <span
          className="mt-1 inline-flex items-center gap-2 rounded-full"
          style={{
            padding: '7px 13px',
            background: '#F4F6F7',
            fontSize: 10.5,
            fontWeight: 500,
            letterSpacing: '.06em',
            color: 'rgba(19,39,79,.7)',
          }}
        >
          Powered by
          <img
            src="/logos/PerceptionX-PrimaryLogo.png"
            alt="PerceptionX"
            style={{ height: 13, width: 'auto', display: 'block' }}
          />
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
  /* Brand colour holds the page and the accent rises from the bottom, so a
     dark primary reads near-black with a glow at the foot of the screen. The
     base stays exactly --activate-primary: the ink colour is computed from
     it, so tinting the base would break the contrast guarantee. */
  background:
    radial-gradient(125% 78% at 50% 114%,
      color-mix(in oklab, var(--activate-accent) 78%, var(--activate-primary)), transparent 60%),
    radial-gradient(120% 68% at 50% -16%,
      color-mix(in oklab, var(--activate-accent) 66%, var(--activate-primary)), transparent 62%),
    radial-gradient(90% 55% at 12% 106%,
      color-mix(in oklab, var(--activate-accent) 38%, var(--activate-primary)), transparent 62%),
    var(--activate-primary);
  color: var(--activate-on);
  font-family: var(--activate-font-body);
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
  font-family: var(--activate-font-heading); font-weight: 700;
  font-size: 27px; line-height: 1.1; letter-spacing: -.02em;
}
.act-tagline { font-size: 14px; line-height: 1.5; color: color-mix(in srgb, var(--activate-on) 72%, transparent); }
.act-blurb {
  font-size: 15px; line-height: 1.55; max-width: 300px; text-align: center;
  text-wrap: pretty; color: color-mix(in srgb, var(--activate-on) 88%, transparent);
}
.act-question {
  font-family: var(--activate-font-heading); font-weight: 600;
  font-size: 22px; line-height: 1.2; letter-spacing: -.015em; text-align: center;
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
.act-affinity-chip {
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
.act-search-hint {
  font-size: 13px; text-align: center; padding: 6px 0;
  color: color-mix(in srgb, var(--activate-on) 55%, transparent);
}
@media (min-width: 768px) { .act-scroll { max-height: 320px; } }

/* Entity chips */
.act-entity {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 60px; padding: 0 20px; border-radius: 999px;
  background: #fff; border: none; box-shadow: 0 6px 16px rgba(0,0,0,.14);
  font-family: var(--activate-font-heading); font-weight: 500;
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



.act-generic-heading {
  font-family: var(--activate-font-heading); font-weight: 600;
  font-size: 25px; line-height: 1.2; max-width: 320px;
}
.act-generic-sub { font-size: 14px; color: color-mix(in srgb, var(--activate-on) 68%, transparent); }
.act-intro {
  font-size: 14.5px; line-height: 1.55; max-width: 320px; text-align: center;
  color: color-mix(in srgb, var(--activate-on) 74%, transparent);
}

/* Route cards */
.act-card { border-radius: 24px; box-shadow: 0 8px 20px rgba(0,0,0,.16); }

/* Willingness step */
.act-willing {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 64px; padding: 12px 18px; border-radius: 20px; cursor: pointer;
  background: color-mix(in srgb, var(--activate-on) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--activate-on) 30%, transparent);
  color: var(--activate-on); text-align: left;
  transition: background 180ms, transform 180ms;
}
.act-willing:hover { background: color-mix(in srgb, var(--activate-on) 20%, transparent); }
.act-willing[data-on="true"] {
  background: #fff; border-color: #fff; color: #13274F;
  box-shadow: 0 6px 16px rgba(0,0,0,.14);
}
.act-willing-label {
  display: block; font-family: var(--activate-font-heading);
  font-weight: 600; font-size: 15.5px; line-height: 1.25;
}
.act-willing-note { display: block; font-size: 12px; line-height: 1.4; opacity: .68; margin-top: 3px; }

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
  font-family: var(--activate-font-heading); font-weight: 600; font-size: 16px;
  transition: transform 180ms;
}
.act-primary-btn:hover { transform: translateY(-2px); }
.act-skip {
  background: transparent; border: none; cursor: pointer; min-height: 44px;
  font-size: 14px; font-weight: 600;
  color: color-mix(in srgb, var(--activate-on) 62%, transparent);
  text-decoration: underline; text-underline-offset: 3px;
}

/* Campaign banner. Rounded card so client artwork with its own background
   colour sits cleanly on the brand canvas, whatever its aspect ratio. */
.act-banner {
  width: 100%; max-height: 96px; object-fit: contain;
  border-radius: 18px; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,.18);
  margin-bottom: 2px;
}

.act-intro-screen {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 22px; width: 100%; min-height: 62vh; padding: 0 4px;
  background: transparent; border: none; cursor: pointer; text-align: center;
}
.act-intro-line {
  /* Only the lead line takes the display face — a condensed all-caps brand
     font shouts when it runs a full sentence. */
  font-family: var(--activate-font-body); font-weight: 500;
  font-size: 17px; line-height: 1.45; letter-spacing: 0; max-width: 320px;
  color: color-mix(in srgb, var(--activate-on) 82%, transparent);
  animation: act-rise 460ms cubic-bezier(.2,.8,.2,1) both;
}
.act-intro-lead {
  font-family: var(--activate-font-heading);
  font-weight: 700; font-size: 32px; line-height: 1.15; letter-spacing: -.02em;
  color: var(--activate-on);
}
.act-intro-cta {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 22px;
  border-radius: 999px; font-weight: 600; font-size: 15px;
  background: color-mix(in srgb, var(--activate-on) 12%, transparent);
  color: color-mix(in srgb, var(--activate-on) 62%, transparent);
  transition: background 220ms, color 220ms, transform 220ms;
}
.act-intro-cta[data-ready="true"] {
  background: #fff; color: #13274F; box-shadow: 0 6px 16px rgba(0,0,0,.14);
  font-family: var(--activate-font-heading);
}
@media (prefers-reduced-motion: reduce) { .act-intro-line { animation: none; } }

/* Section headings */
.act-section-heading {
  font-family: var(--activate-font-heading); font-weight: 600;
  font-size: 19px; line-height: 1.2; letter-spacing: -.015em; text-align: center;
}

/* Local platform: badged and visually lifted above the global ones */
.act-card[data-local] {
  box-shadow: 0 10px 26px -6px color-mix(in srgb, var(--activate-accent) 55%, transparent),
              0 8px 20px rgba(0,0,0,.16);
  outline: 2px solid color-mix(in oklab, var(--activate-accent) 65%, #fff);
}
.act-local-chip {
  font-size: 9.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  padding: 5px 8px; border-radius: 999px; white-space: nowrap;
  background: color-mix(in oklab, var(--activate-accent) 22%, #fff);
  color: color-mix(in oklab, var(--activate-accent) 82%, #13274F);
}

.act-listen-only {
  font-size: 12px; line-height: 1.5; max-width: 320px; text-align: center;
  color: color-mix(in srgb, var(--activate-on) 55%, transparent);
}

/* How-to panel */
.act-howto { border-top: 1px solid rgba(19,39,79,.08); padding: 12px 18px 14px; }
.act-howto ol {
  counter-reset: step; display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px;
}
.act-howto li {
  counter-increment: step; position: relative; padding-left: 26px;
  font-size: 12.5px; line-height: 1.45; color: rgba(19,39,79,.72);
}
.act-howto li::before {
  content: counter(step); position: absolute; left: 0; top: 0;
  width: 18px; height: 18px; border-radius: 999px; background: #F4F6F7;
  font-size: 10.5px; font-weight: 700; color: rgba(19,39,79,.55);
  display: flex; align-items: center; justify-content: center;
}
.act-howto-open {
  display: inline-flex; align-items: center; gap: 7px; min-height: 40px;
  padding: 0 16px; border-radius: 999px; font-size: 13.5px; font-weight: 600;
  background: var(--activate-primary); color: var(--activate-on);
}

/* Desktop: identity and context sit in the page corners, not in the column */
@media (min-width: 768px) {
  .act-topbar {
    position: fixed; top: 20px; left: 24px; right: 24px; width: auto; z-index: 5;
  }
}

/* Most-cited page row */
.act-highlight-row {
  display: flex; align-items: center; gap: 8px;
  min-height: 46px; padding: 0 18px;
  border-top: 1px solid rgba(19,39,79,.08);
  font-size: 12.5px; color: rgba(19,39,79,.72);
}
.act-highlight-row:hover { background: #F4F6F7; }
.act-highlight-label {
  font-size: 9.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  color: rgba(19,39,79,.45); white-space: nowrap;
}

/* Theme chips — topic visibility, never sentiment */



/* Footer */
.act-honesty {
  font-size: 12.5px; line-height: 1.5; max-width: 300px;
  color: color-mix(in srgb, var(--activate-on) 66%, transparent);
}
.act-powered {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 13px; border-radius: 999px;
  background: color-mix(in srgb, var(--activate-on) 12%, transparent);
  font-size: 10.5px; font-weight: 500; letter-spacing: .06em;
  color: color-mix(in srgb, var(--activate-on) 70%, transparent);
}
.act-powered[data-on-dark="false"] { background: #F4F6F7; color: rgba(19,39,79,.7); }
.act-powered-logo { height: 13px; width: auto; display: block; }

/* Spinner */
.act-spinner {
  width: 38px; height: 38px; border-radius: 50%;
  border: 2.5px solid color-mix(in srgb, var(--activate-on) 26%, transparent);
  border-top-color: var(--activate-on);
  animation: act-spin 900ms linear infinite;
}
@keyframes act-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .act-step, .act-avatar-entry, .act-rise, .act-rise-late { animation: none; }
  .act-pill-solid:hover, .act-pill-solid:active,
  .act-entity:hover, .act-entity:active { transform: none; }
}
`;
