import { http, HttpResponse, type HttpHandler } from 'msw';
import * as F from '../fixtures/dashboard';

export const SUPABASE_URL = F.SUPABASE_URL;
export const SUPABASE_HOST = new URL(F.SUPABASE_URL).host;

// Exactly what PostgREST returned during the 2026-09-10 incident: Postgres
// cancelled the statement at the 8 s `authenticated` timeout.
export const TIMEOUT_57014 = {
  code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout',
};

export type FaultFn = (attempt: number) => boolean;
export interface BackendOptions {
  // Per-RPC fault injection: return true for the attempt numbers (1-based)
  // that should fail with HTTP 500 / SQLSTATE 57014.
  faults?: Record<string, FaultFn>;
  // Override the payload of a successful RPC.
  rpc?: Record<string, (body: any) => unknown>;
  // Simulated server time per RPC call (ms) — lets tests observe ordering
  // and concurrency of the cold-load burst. Per-RPC overrides win.
  rpcDelayMs?: number;
  rpcDelayByFn?: Record<string, number>;
}

export interface CallRecord {
  method: string;
  path: string;
  status: number;
  startedAt: number;
  completedAt: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// In-memory Supabase for the dashboard: PostgREST tables + RPCs + GoTrue.
// Every request is logged and RPC attempts are counted per function.
export class MockBackend {
  calls: CallRecord[] = [];
  counters: Record<string, number> = {};
  faults: Record<string, FaultFn>;
  rpcOverrides: Record<string, (body: any) => unknown>;
  // RPC statements in flight right now / the highest that ever was — the
  // "burst" the audit identified is this number.
  inFlight = 0;
  maxInFlight = 0;
  private rpcDelayMs: number;
  private rpcDelayByFn: Record<string, number>;

  constructor(opts: BackendOptions = {}) {
    this.faults = { ...(opts.faults ?? {}) };
    this.rpcOverrides = { ...(opts.rpc ?? {}) };
    this.rpcDelayMs = opts.rpcDelayMs ?? 0;
    this.rpcDelayByFn = { ...(opts.rpcDelayByFn ?? {}) };
  }

  setFault(fn: string, fault: FaultFn | null) {
    if (fault) this.faults[fn] = fault; else delete this.faults[fn];
  }

  rpcCalls(fn: string) {
    return this.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
  }

  private rpcImpl(fn: string, body: any): unknown {
    if (this.rpcOverrides[fn]) return this.rpcOverrides[fn](body);
    switch (fn) {
      case 'get_scope_prompts': return F.prompts;
      case 'get_dashboard_rollups': return F.dashboardRollups;
      case 'get_scope_stats': return F.scopeStats;
      case 'get_location_rollups': return F.locationRollups;
      case 'get_domain_stats': return F.domainStats;
      case 'get_competitor_stats': return F.competitorStats;
      case 'get_company_responses_page': return body && body.p_before_id ? [] : F.responsesPage;
      case 'ai_themes_keyset_page': return [];
      default: return null;
    }
  }

  private tableRows(table: string): unknown[] {
    switch (table) {
      case 'organization_members': return F.organizationMembers;
      case 'profiles': return [F.profile];
      case 'companies': return [F.companyRow];
      // Already dismissed: the What's-new dialog must not overlay the tests.
      case 'announcement_seen': return [{ version: 'seen' }];
      default: return [];
    }
  }

  handlers(): HttpHandler[] {
    const log = (method: string, path: string, status: number) => {
      const now = Date.now();
      this.calls.push({ method, path, status, startedAt: now, completedAt: now });
    };
    return [
      // ---- GoTrue ----
      http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
        log('POST', '/auth/v1/token', 200);
        return HttpResponse.json(F.session);
      }),
      http.get(`${SUPABASE_URL}/auth/v1/user`, () => {
        log('GET', '/auth/v1/user', 200);
        return HttpResponse.json(F.user);
      }),
      http.post(`${SUPABASE_URL}/auth/v1/logout`, () => {
        log('POST', '/auth/v1/logout', 204);
        return new HttpResponse(null, { status: 204 });
      }),
      http.all(`${SUPABASE_URL}/auth/v1/*`, ({ request }) => {
        log(request.method, new URL(request.url).pathname, 200);
        return HttpResponse.json({});
      }),
      // ---- PostgREST RPC ----
      http.post(`${SUPABASE_URL}/rest/v1/rpc/:fn`, async ({ params, request }) => {
        const fn = String(params.fn);
        const path = `/rest/v1/rpc/${fn}`;
        this.counters[fn] = (this.counters[fn] ?? 0) + 1;
        const attempt = this.counters[fn];
        const rec: CallRecord = { method: 'POST', path, status: 0, startedAt: Date.now(), completedAt: 0 };
        this.calls.push(rec);
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
          const delay = this.rpcDelayByFn[fn] ?? this.rpcDelayMs;
          if (delay > 0) await sleep(delay);
          const fault = this.faults[fn];
          if (fault && fault(attempt)) {
            rec.status = 500;
            return HttpResponse.json(TIMEOUT_57014, { status: 500 });
          }
          let body: any = null;
          try { body = await request.json(); } catch { /* no body */ }
          rec.status = 200;
          return HttpResponse.json(this.rpcImpl(fn, body));
        } finally {
          this.inFlight -= 1;
          rec.completedAt = Date.now();
        }
      }),
      // ---- PostgREST tables ----
      http.all(`${SUPABASE_URL}/rest/v1/:table`, ({ params, request }) => {
        const table = String(params.table);
        const path = `/rest/v1/${table}`;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          log(request.method, path, 201);
          return HttpResponse.json([], { status: 201 });
        }
        const rows = this.tableRows(table);
        const wantsObject = (request.headers.get('accept') ?? '').includes('vnd.pgrst.object');
        log('GET', path, 200);
        return HttpResponse.json(wantsObject ? (rows[0] ?? {}) : rows);
      }),
      // ---- Edge functions (not part of the dashboard data path) ----
      http.all(`${SUPABASE_URL}/functions/v1/*`, ({ request }) => {
        log(request.method, new URL(request.url).pathname, 200);
        return HttpResponse.json({});
      }),
    ];
  }
}
