// Public Activate page at /activate/:token — authenticated by the link token
// alone (no login). The recipient declares country + entity (two taps, no
// inference) and gets the review platforms that feed AI answers about their
// employer in their market. We route; we never script — copy stays
// non-directive throughout. Spec: docs/ACTIVATE_LINK_ROUTER.md
//
// Visual identity derives entirely from two brand tokens (primary/accent) so
// any client gets a branded page with no bespoke design work.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, MapPin, Search } from 'lucide-react';
import { useMetaTags } from '@/hooks/useMetaTags';
import {
  ActivateConfig,
  ActivateRoute,
  COUNTRY_CODES,
  countryInSentence,
  countryName,
  getActivateByToken,
  logActivateEvent,
  marketsWithRoutes,
  resolveRoutes,
} from '@/lib/activate/api';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid'; reason: 'not_found' | 'expired' | 'revoked' | 'error' }
  | { kind: 'ready'; config: ActivateConfig };

type Step = 'market' | 'entity' | 'routes';

const UNSURE = 'unsure';

const PLATFORM_NAMES: Record<string, string> = {
  kununu: 'kununu',
  glassdoor: 'Glassdoor',
  indeed: 'Indeed',
  seek: 'Seek',
};

function platformName(key: string): string {
  return PLATFORM_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Readable foreground for an arbitrary client color (WCAG-ish luminance cut). */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#10151d';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#10151d' : '#ffffff';
}

/** Bold the measured numbers inside a rationale sentence. */
function emphasizeStats(text: string) {
  const parts = text.split(/(\d+(?:\.\d+)?%)/);
  return parts.map((part, i) =>
    /^\d+(?:\.\d+)?%$/.test(part) ? (
      <strong key={i} className="font-bold text-[var(--px-brand)]">{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function Activate() {
  const { token } = useParams<{ token: string }>();
  // One random id per pageview: identifies a pageview, not a person. Never
  // persisted — it's the only thing that ties a click to the declaration
  // before it.
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [step, setStep] = useState<Step>('market');
  const [market, setMarket] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null); // company id or UNSURE
  const [prefilled, setPrefilled] = useState(false);

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
        setLoad({ kind: 'invalid', reason: 'not_found' });
        return;
      }
      const res = await getActivateByToken(token, sessionId);
      if (cancelled) return;
      if (res.error === 'not_found' || res.error === 'expired' || res.error === 'revoked') {
        setLoad({ kind: 'invalid', reason: res.error });
        return;
      }
      if (res.error || !res.config) {
        setLoad({ kind: 'invalid', reason: 'error' });
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

  if (load.kind === 'loading') {
    return (
      <NeutralShell>
        <p className="text-sm text-slate-500" role="status">Opening…</p>
      </NeutralShell>
    );
  }

  if (load.kind === 'invalid') {
    const copy: Record<string, string> = {
      not_found: "This link doesn't seem to exist. Double-check the address you were sent.",
      expired: 'This link has expired. Ask whoever sent it for a fresh one.',
      revoked: 'This link is no longer active. Ask whoever sent it for a fresh one.',
      error: "Something went wrong opening this link. Give it another try in a minute.",
    };
    return (
      <NeutralShell>
        <h1 className="font-headline text-lg font-medium text-slate-800 mb-2">Hm — no luck</h1>
        <p className="text-sm text-slate-500">{copy[load.reason]}</p>
      </NeutralShell>
    );
  }

  const { config } = load;
  const { org } = config;
  const brandVars = {
    '--px-brand': org.primary_color,
    '--px-accent': org.accent_color,
    '--px-brand-fg': textOn(org.primary_color),
    '--px-accent-fg': textOn(org.accent_color),
  } as CSSProperties;

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
    setStep('routes');
  };

  return (
    <div style={brandVars} className="min-h-screen relative overflow-hidden px-bg text-slate-800">
      <style>{activateCss}</style>
      <div className="px-blob px-blob-a" aria-hidden />
      <div className="px-blob px-blob-b" aria-hidden />

      <div className="relative max-w-xl mx-auto px-5 pt-10 pb-16 sm:pt-16">
        <Hero org={org} compact={step === 'routes'} />

        <div key={step} className="px-step mt-8">
          {step === 'market' && (
            <MarketStep
              orgName={org.display_name}
              audience={config.audience}
              blurb={org.blurb}
              pinned={marketsWithRoutes(config.routes)}
              selected={market}
              onSelect={declareMarket}
            />
          )}

          {step === 'entity' && (
            <EntityStep
              orgName={org.display_name}
              audience={config.audience}
              entities={config.entities}
              selected={entityId}
              onSelect={declareEntity}
              onBack={() => setStep('market')}
            />
          )}

          {step === 'routes' && market && (
            <RoutesStep
              token={token!}
              sessionId={sessionId}
              orgName={org.display_name}
              audience={config.audience}
              market={market}
              entityName={
                entityId && entityId !== UNSURE
                  ? config.entities.find((e) => e.id === entityId)?.name ?? null
                  : null
              }
              resolved={resolveRoutes(config.routes, market, entityId === UNSURE ? null : entityId)}
              entityId={entityId === UNSURE ? null : entityId}
              prefilled={prefilled}
              onChange={() => {
                setPrefilled(false);
                setStep('market');
              }}
            />
          )}
        </div>

        <footer className="mt-14 text-center text-xs text-slate-500 space-y-1.5">
          <p>We don't see what you write — or whether you write at all.</p>
          <p className="text-slate-400">Routed by PerceptionX</p>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NeutralShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
        {children}
      </div>
    </div>
  );
}

function Hero({
  org,
  compact,
}: {
  org: ActivateConfig['org'];
  compact: boolean;
}) {
  return (
    <header className="text-center">
      {org.logo_url ? (
        <img
          src={org.logo_url}
          alt={`${org.display_name} logo`}
          className={`mx-auto object-contain transition-all ${compact ? 'h-8' : 'h-12'}`}
        />
      ) : (
        <div
          className={`mx-auto rounded-2xl flex items-center justify-center font-headline font-bold bg-[var(--px-brand)] text-[var(--px-brand-fg)] transition-all ${
            compact ? 'h-10 w-10 text-lg' : 'h-14 w-14 text-2xl'
          }`}
        >
          {org.display_name.charAt(0)}
        </div>
      )}
      <h1
        className={`font-headline font-bold tracking-tight mt-4 transition-all ${
          compact ? 'text-xl' : 'text-2xl sm:text-3xl'
        }`}
      >
        {org.tagline ?? org.display_name}
      </h1>
    </header>
  );
}

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white/85 backdrop-blur rounded-3xl border border-slate-200/80 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.15)] p-5 sm:p-7">
      {children}
    </section>
  );
}

function MarketStep({
  orgName,
  audience,
  blurb,
  pinned,
  selected,
  onSelect,
}: {
  orgName: string;
  audience: ActivateConfig['audience'];
  blurb: string | null;
  pinned: string[];
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q
    ? COUNTRY_CODES.filter((c) => countryName(c).toLowerCase().includes(q) || c.toLowerCase() === q)
    : [];

  return (
    <StepCard>
      <p className="text-sm text-slate-600 leading-relaxed">
        {blurb ??
          `AI assistants are shaping how candidates see ${orgName} — here's where they listen.`}{' '}
        {audience === 'candidate'
          ? 'The places that shape those answers differ by country.'
          : 'Where those answers come from differs by country.'}
      </p>

      <h2 className="font-headline text-lg font-bold mt-5 mb-3">Where are you based?</h2>

      {pinned.length > 0 && !q && (
        <div className="flex flex-wrap gap-2 mb-4">
          {pinned.map((code) => (
            <button
              key={code}
              onClick={() => onSelect(code)}
              className={`px-chip ${selected === code ? 'px-chip-active' : ''}`}
            >
              <MapPin className="h-3.5 w-3.5 opacity-60" />
              {countryName(code)}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any country…"
          aria-label="Search for your country"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--px-brand)] focus:ring-2 focus:ring-[var(--px-brand)]/20"
        />
      </div>

      {q && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
          {matches.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-400">No matches — try another spelling</li>
          )}
          {matches.slice(0, 30).map((code) => (
            <li key={code}>
              <button
                onClick={() => onSelect(code)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between"
              >
                {countryName(code)}
                <span className="text-xs text-slate-300">{code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </StepCard>
  );
}

function EntityStep({
  orgName,
  audience,
  entities,
  selected,
  onSelect,
  onBack,
}: {
  orgName: string;
  audience: ActivateConfig['audience'];
  entities: ActivateConfig['entities'];
  selected: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <StepCard>
      <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1 mb-3">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <h2 className="font-headline text-lg font-bold mb-1">
        {audience === 'candidate'
          ? `Which part of ${orgName} are you interested in?`
          : `Which part of ${orgName} are you in?`}
      </h2>
      <p className="text-sm text-slate-500 mb-4">Some platforms have separate pages per division.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {entities.map((e) => (
          <button
            key={e.id}
            onClick={() => onSelect(e.id)}
            className={`px-entity ${selected === e.id ? 'px-entity-active' : ''}`}
          >
            {e.name}
            {selected === e.id && <Check className="h-4 w-4 shrink-0" />}
          </button>
        ))}
        <button
          onClick={() => onSelect(UNSURE)}
          className={`px-entity text-slate-500 ${selected === UNSURE ? 'px-entity-active' : ''}`}
        >
          Not sure
        </button>
      </div>
    </StepCard>
  );
}

function RoutesStep({
  token,
  sessionId,
  orgName,
  audience,
  market,
  entityName,
  entityId,
  resolved,
  prefilled,
  onChange,
}: {
  token: string;
  sessionId: string;
  orgName: string;
  audience: ActivateConfig['audience'];
  market: string;
  entityName: string | null;
  entityId: string | null;
  resolved: ReturnType<typeof resolveRoutes>;
  prefilled: boolean;
  onChange: () => void;
}) {
  const { tier, routes } = resolved;
  const countryLabel = countryName(market);
  const country = countryInSentence(market);
  const hearAbout =
    audience === 'candidate' ? `candidates hear about ${orgName}` : `candidates hear about life at ${orgName}`;

  return (
    <div className="space-y-4">
      <button
        onClick={onChange}
        className="mx-auto flex items-center gap-1.5 text-xs bg-white/70 border border-slate-200 rounded-full px-3.5 py-1.5 text-slate-600 hover:border-slate-300"
      >
        <MapPin className="h-3 w-3 text-[var(--px-brand)]" />
        {countryLabel}
        {entityName ? ` · ${entityName}` : ''}
        <span className="underline decoration-slate-300 underline-offset-2 ml-1">
          {prefilled ? 'not you? change' : 'change'}
        </span>
      </button>

      <StepCard>
        <h2 className="font-headline text-lg font-bold mb-2">
          {tier === 1 ? `Where AI listens in ${country}` : `Where ${hearAbout}`}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-5">
          {tier === 1 &&
            `This is where ${hearAbout} in ${country} — measured from the AI answers themselves. Whether you share anything, and what, is entirely up to you.`}
          {tier === 2 &&
            `We haven't measured ${country} yet, so no local stats — but these are the platforms that carry the most weight there. Whether you share anything, and what, is entirely up to you.`}
          {tier === 3 &&
            `We haven't measured ${country} yet, so here are the global heavyweights — the platforms AI leans on most everywhere. Whether you share anything, and what, is entirely up to you.`}
        </p>

        <div className="space-y-3">
          {routes.map((route, i) => (
            <PlatformCard
              key={route.platform}
              route={route}
              hero={i === 0 && tier === 1}
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
      </StepCard>
    </div>
  );
}

function PlatformCard({
  route,
  hero,
  onOpen,
}: {
  route: ActivateRoute;
  hero: boolean;
  onOpen: () => void;
}) {
  const href = route.write_url ?? route.destination_url;
  // use_direct_link → strip the Referer too: a bare URL alone still announces
  // this page to the platform unless the anchor is noreferrer.
  const rel = route.use_direct_link ? 'noopener noreferrer' : 'noopener';
  return (
    <a
      href={href}
      target="_blank"
      rel={rel}
      onClick={onOpen}
      className={`px-platform group ${hero ? 'px-platform-hero' : ''}`}
    >
      <div
        className={`rounded-xl flex items-center justify-center font-headline font-bold shrink-0 ${
          hero
            ? 'h-12 w-12 text-xl bg-[var(--px-brand)] text-[var(--px-brand-fg)]'
            : 'h-10 w-10 text-lg bg-[var(--px-accent)]/15 text-[var(--px-brand)]'
        }`}
      >
        {platformName(route.platform).charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`font-headline font-bold ${hero ? 'text-base' : 'text-sm'}`}>
            {platformName(route.platform)}
          </span>
          <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-[var(--px-brand)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </div>
        {route.rationale_stat ? (
          <p className={`text-slate-600 mt-0.5 leading-snug ${hero ? 'text-sm' : 'text-xs'}`}>
            {emphasizeStats(route.rationale_stat)}
          </p>
        ) : (
          <p className="text-xs text-slate-400 mt-0.5">{hostOf(href)} · opens in a new tab</p>
        )}
      </div>
    </a>
  );
}

// Brand-token-driven styling. Tints derive from the two tokens via color-mix;
// solid fallbacks come first for older engines. Motion is decorative only and
// fully disabled under prefers-reduced-motion.
const activateCss = `
.px-bg {
  background: #f8fafc;
  background:
    radial-gradient(1200px 600px at 85% -10%, color-mix(in srgb, var(--px-accent) 14%, transparent), transparent 60%),
    radial-gradient(1000px 700px at -10% 20%, color-mix(in srgb, var(--px-brand) 10%, transparent), transparent 55%),
    #f8fafc;
}
.px-blob {
  position: absolute; border-radius: 9999px; filter: blur(70px); opacity: .35; pointer-events: none;
}
.px-blob-a { width: 340px; height: 340px; top: -120px; right: -80px; background: color-mix(in srgb, var(--px-accent) 45%, white); animation: px-drift 16s ease-in-out infinite alternate; }
.px-blob-b { width: 300px; height: 300px; bottom: -100px; left: -100px; background: color-mix(in srgb, var(--px-brand) 35%, white); animation: px-drift 20s ease-in-out infinite alternate-reverse; }
@keyframes px-drift { from { transform: translate(0, 0) scale(1); } to { transform: translate(30px, 24px) scale(1.08); } }
.px-step { animation: px-rise .35s ease both; }
@keyframes px-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .px-blob, .px-step { animation: none; }
}
.px-chip {
  display: inline-flex; align-items: center; gap: .375rem;
  border-radius: 9999px; border: 1px solid rgb(226 232 240);
  background: white; padding: .5rem .875rem; font-size: .875rem; font-weight: 500;
  transition: border-color .15s, background .15s;
}
.px-chip:hover { border-color: var(--px-brand); }
.px-chip-active { background: var(--px-brand); border-color: var(--px-brand); color: var(--px-brand-fg); }
.px-entity {
  display: flex; align-items: center; justify-content: space-between; gap: .5rem;
  border-radius: 1rem; border: 1px solid rgb(226 232 240); background: white;
  padding: .875rem 1rem; font-size: .875rem; font-weight: 600; text-align: left;
  min-height: 44px; transition: border-color .15s, box-shadow .15s;
}
.px-entity:hover { border-color: var(--px-brand); box-shadow: 0 2px 12px -4px color-mix(in srgb, var(--px-brand) 35%, transparent); }
.px-entity-active { border-color: var(--px-brand); background: color-mix(in srgb, var(--px-brand) 6%, white); }
.px-platform {
  display: flex; align-items: center; gap: .875rem;
  border-radius: 1.25rem; border: 1px solid rgb(226 232 240); background: white;
  padding: .875rem 1rem; transition: border-color .15s, box-shadow .15s, transform .15s;
}
.px-platform:hover { border-color: var(--px-brand); box-shadow: 0 6px 24px -8px color-mix(in srgb, var(--px-brand) 40%, transparent); transform: translateY(-1px); }
.px-platform-hero {
  border-color: color-mix(in srgb, var(--px-brand) 35%, rgb(226 232 240));
  background: linear-gradient(135deg, color-mix(in srgb, var(--px-brand) 5%, white), color-mix(in srgb, var(--px-accent) 7%, white));
  padding: 1.125rem 1.125rem;
}
`;
