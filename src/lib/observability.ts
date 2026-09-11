import * as Sentry from '@sentry/react';

// Error reporting for the dashboard data path.
//
// Why this exists: docs/audits/DATA_RELIABILITY_AUDIT_2026-09-11.md (P1-4).
// Production had no signal for a failed dashboard request — `logger` is a
// no-op outside dev and the production build strips console.* — so the
// question "why did this user see no sentiment at 10:42?" could only be
// answered by reading the PostgREST log by timestamp, without knowing the
// user, company or scope.
//
// What is captured for every dashboard query that ends in error (after the
// query-level retry): query family, RPC name, HTTP status, PostgREST /
// SQLSTATE error code, elapsed time of the failing attempt, user id,
// organization id, company id, scope key and location key.
//
// What is deliberately NOT captured: response or request bodies, prompt or
// response text, e-mail addresses or names, auth tokens or API keys. Sentry
// is initialised with sendDefaultPii off, and the user object carries only
// the id.
//
// Transport: Sentry when VITE_SENTRY_DSN is set at build time; otherwise the
// same structured record is kept in an in-memory ring buffer (readable from
// the browser console as window.__pxDashboardErrors) so support can still
// inspect a session without an error-tracking account.

export interface DashboardQueryError {
  at: string;
  family: string;
  rpc: string | null;
  http_status: number | null;
  pg_code: string | null;
  message: string;
  elapsed_ms: number | null;
  user_id: string | null;
  organization_id: string | null;
  company_id: string | null;
  scope_key: string | null;
  location_key: string | null;
}

export interface RpcAttempt {
  rpc: string;
  status: number | null;
  code: string | null;
  elapsedMs: number;
  ok: boolean;
}

interface ObservabilityContext {
  userId: string | null;
  organizationId: string | null;
  companyId: string | null;
  scopeKey: string | null;
  locationKey: string | null;
}

const RING_BUFFER_SIZE = 50;
const MESSAGE_MAX_CHARS = 200;
// A successful RPC slower than this leaves a breadcrumb: the audit showed
// calls sitting at 7 s in "healthy" hours, one second under the 8 s cliff.
export const SLOW_RPC_MS = 5000;

const context: ObservabilityContext = {
  userId: null,
  organizationId: null,
  companyId: null,
  scopeKey: null,
  locationKey: null,
};
const recent: DashboardQueryError[] = [];
let sentryEnabled = false;

export interface InitOptions {
  dsn?: string;
  environment?: string;
}

// Call once at app start. No-op without a DSN.
export const initObservability = (options: InitOptions = {}): boolean => {
  const dsn = options.dsn ?? (import.meta.env.VITE_SENTRY_DSN as string | undefined);
  if (!dsn) {
    sentryEnabled = false;
    return false;
  }
  Sentry.init({
    dsn,
    environment: options.environment ?? (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      // Belt and braces: an id is all we ever want to know about a person.
      if (event.user) event.user = { id: event.user.id };
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
      }
      return event;
    },
  });
  sentryEnabled = true;
  return true;
};

export const isObservabilityEnabled = () => sentryEnabled;

export const setObservabilityUser = (userId: string | null | undefined) => {
  context.userId = userId ?? null;
  if (sentryEnabled) Sentry.setUser(userId ? { id: userId } : null);
};

export const setObservabilityContext = (patch: Partial<Omit<ObservabilityContext, 'userId'>>) => {
  Object.assign(context, patch);
  if (sentryEnabled) {
    Sentry.setTags({
      organization_id: context.organizationId ?? undefined,
      company_id: context.companyId ?? undefined,
      location_key: context.locationKey ?? undefined,
    });
    // The scope key (sorted sibling company ids) can exceed Sentry's tag
    // length; it lives in a context block instead.
    Sentry.setContext('dashboard_scope', { scope_key: context.scopeKey });
  }
};

export const getObservabilityContext = (): Readonly<ObservabilityContext> => ({ ...context });

// Maps a dashboard query key (src/hooks/dashboard/dashboardQueries.ts) to the
// family name and the RPC behind it. Returns null for non-dashboard keys.
export const describeQueryKey = (
  key: readonly unknown[] | undefined,
): { family: string; rpc: string | null; scopeKey: string | null; locationKey: string | null } | null => {
  if (!Array.isArray(key) || key[0] !== 'dashboard' || key[1] !== 'scope') return null;
  const scopeKey = typeof key[2] === 'string' ? key[2] : null;
  const kind = typeof key[3] === 'string' ? key[3] : 'unknown';
  const family = kind === 'responses' && typeof key[4] === 'string' ? `responses_${key[4]}` : kind;
  const locationKey =
    (kind === 'location' || kind === 'domains' || kind === 'competitors') && typeof key[4] === 'string'
      ? key[4]
      : null;
  const rpcByFamily: Record<string, string> = {
    prompts: 'get_scope_prompts',
    rollups: 'get_dashboard_rollups',
    stats: 'get_scope_stats',
    location: 'get_location_rollups',
    domains: 'get_domain_stats',
    competitors: 'get_competitor_stats',
    responses_first: 'get_company_responses_page',
    responses_full: 'get_company_responses_page',
  };
  return { family, rpc: rpcByFamily[family] ?? null, scopeKey, locationKey };
};

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const stringOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

// Per-attempt breadcrumb from the RPC helper: every failed attempt (the
// query-level retry produces two per family) and any slow success.
export const recordRpcAttempt = (attempt: RpcAttempt) => {
  if (!sentryEnabled) return;
  Sentry.addBreadcrumb({
    category: 'dashboard.rpc',
    level: attempt.ok ? 'info' : 'warning',
    message: attempt.ok ? `slow ${attempt.rpc}` : `failed ${attempt.rpc}`,
    data: { rpc: attempt.rpc, http_status: attempt.status, pg_code: attempt.code, elapsed_ms: attempt.elapsedMs },
  });
};

// QueryCache.onError hook (src/App.tsx): fires once per query after its
// retries are exhausted. Non-dashboard queries are ignored here.
export const reportDashboardQueryError = (error: unknown, queryKey: readonly unknown[] | undefined): DashboardQueryError | null => {
  const desc = describeQueryKey(queryKey);
  if (!desc) return null;
  const e = (error ?? {}) as Record<string, unknown>;
  const entry: DashboardQueryError = {
    at: new Date().toISOString(),
    family: desc.family,
    rpc: stringOrNull(e.rpc) ?? desc.rpc,
    http_status: numberOrNull(e.status),
    pg_code: stringOrNull(e.code),
    message: String((e.message as string | undefined) ?? error ?? 'unknown error').slice(0, MESSAGE_MAX_CHARS),
    elapsed_ms: numberOrNull(e.elapsedMs),
    user_id: context.userId,
    organization_id: context.organizationId,
    company_id: context.companyId,
    scope_key: desc.scopeKey ?? context.scopeKey,
    location_key: desc.locationKey ?? context.locationKey,
  };
  recent.push(entry);
  if (recent.length > RING_BUFFER_SIZE) recent.splice(0, recent.length - RING_BUFFER_SIZE);

  if (sentryEnabled) {
    const exception = error instanceof Error ? error : new Error(entry.message);
    Sentry.captureException(exception, {
      tags: {
        area: 'dashboard',
        family: entry.family,
        rpc: entry.rpc ?? 'unknown',
        http_status: entry.http_status === null ? 'none' : String(entry.http_status),
        pg_code: entry.pg_code ?? 'none',
        organization_id: entry.organization_id ?? undefined,
        company_id: entry.company_id ?? undefined,
        location_key: entry.location_key ?? undefined,
      },
      contexts: { dashboard_query: { ...entry } },
      // One issue per (family, failure code), not one per user or per scope.
      fingerprint: ['dashboard-query', entry.family, entry.pg_code ?? String(entry.http_status ?? 'unknown')],
    });
  }
  return entry;
};

// React error boundary hook (src/App.tsx).
export const reportRenderError = (error: Error, componentStack: string | undefined) => {
  if (!sentryEnabled) return;
  Sentry.captureException(error, { contexts: { react: { componentStack } } });
};

export const getRecentDashboardErrors = (): readonly DashboardQueryError[] => recent.slice();
export const clearRecentDashboardErrors = () => { recent.length = 0; };

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__pxDashboardErrors', {
    configurable: true,
    enumerable: false,
    get: () => recent.slice(),
  });
}
