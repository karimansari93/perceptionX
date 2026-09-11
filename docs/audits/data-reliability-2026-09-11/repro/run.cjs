// Login-vs-refresh reproduction against a fully mocked Supabase backend.
//
// Scenario A ("first load"): every RPC answers normally except
//   get_location_rollups, which answers exactly like production did on
//   2026-09-10 13:44 UTC: HTTP 500 {"code":"57014","message":"canceling
//   statement due to statement timeout"} for the first N attempts.
// Scenario B ("refresh"): the same tab reloads; the backend is healthy.
// Scenario C ("stream fails"): get_company_responses_page answers 500 for
//   every attempt of the first load; then the Prompts tab is inspected.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const F = require('./fixtures.cjs');

const BASE = process.env.APP_URL || 'http://localhost:8080';
const OUT = process.env.OUT_DIR || __dirname;
const TIMEOUT_BODY = JSON.stringify({ code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' });

function makeBackend(faults) {
  const calls = [];
  const counters = {};
  const rpcTable = {
    get_scope_prompts: () => F.prompts,
    get_dashboard_rollups: () => F.dashboardRollups,
    get_scope_stats: () => F.scopeStats,
    get_location_rollups: () => F.locationRollups,
    get_domain_stats: () => F.domainStats,
    get_competitor_stats: () => F.competitorStats,
    get_company_responses_page: (body) => (body && body.p_before_id ? [] : F.responsesPage),
  };
  return {
    calls,
    async handle(route) {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();
      const accept = req.headers()['accept'] || '';
      const wantsObject = accept.includes('vnd.pgrst.object');
      const rec = { t: Date.now(), method, path: url.pathname, status: 200 };
      calls.push(rec);
      const json = (status, body) => { rec.status = status; return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); };
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname.endsWith('/user')) return json(200, F.user);
        if (url.pathname.endsWith('/token')) return json(200, F.session);
        return json(200, {});
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.split('/').pop();
        counters[fn] = (counters[fn] || 0) + 1;
        const fault = faults[fn];
        if (fault && fault(counters[fn])) { rec.fault = true; return json(500, JSON.parse(TIMEOUT_BODY)); }
        const impl = rpcTable[fn];
        let body = null; try { body = req.postDataJSON(); } catch {}
        return json(200, impl ? impl(body) : null);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.replace('/rest/v1/', '');
        if (table === 'organization_members') return json(200, F.organizationMembers);
        if (table === 'profiles') return json(200, wantsObject ? F.profile : [F.profile]);
        if (table === 'companies') return json(200, wantsObject ? F.companyRow : [F.companyRow]);
        // Mark the What's-new announcement as seen so its dialog never overlays the page.
        if (table === 'announcement_seen') return json(200, wantsObject ? { version: 'seen' } : [{ version: 'seen' }]);
        return json(200, wantsObject ? {} : []);
      }
      return route.continue();
    },
  };
}

async function seedSession(context) {
  await context.addInitScript(([key, value]) => {
    try { window.localStorage.setItem(key, value); } catch {}
  }, [`sb-${F.PROJECT_REF}-auth-token`, JSON.stringify(F.session)]);
}

async function readScorecard(page) {
  const text = await page.evaluate(() => document.body.innerText);
  const grab = (label) => { const m = text.match(new RegExp(label + '[^0-9%]{0,12}(\\d+)%')); return m ? Number(m[1]) : null; };
  return {
    sentiment: grab('Sentiment'), visibility: grab('Visibility'), relevance: grab('Relevance'),
    eps: (() => { const m = text.match(/EPS[^0-9]{0,40}(\d+)/); return m ? Number(m[1]) : null; })(),
    themesEmpty: /No attribute mentions found yet/.test(text),
    sourcesEmpty: /No sources found yet/.test(text),
    competitorsEmpty: /No competitor mentions found yet/.test(text),
    connectionIssue: /Connection Issue/.test(text),
    skeletons: await page.locator('[aria-busy="true"]').count(),
  };
}

async function waitForScorecard(page, ms = 30000) {
  await page.waitForFunction(() => /Breakdown/.test(document.body.innerText), null, { timeout: ms });
  // Wait until the scorecard skeleton is gone (values rendered) or timeout.
  await page.waitForFunction(() => /Sentiment[^0-9%]{0,12}\d+%/.test(document.body.innerText), null, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();
  const results = {};
  const consoleErrors = [];

  // ---------- Scenario A + B ----------
  {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await seedSession(context);
    const faults = { get_location_rollups: (n) => n <= 2 }; // first attempt + the single TanStack retry
    const backend = makeBackend(faults);
    await context.route(/\/(rest|auth)\/v1\//, (route) => backend.handle(route));
    await context.route(/functions\/v1\//, (route) => route.abort());
    await context.route(/^https?:\/\/[^/]*(hotjar|googletagmanager|google-analytics|logo\.dev|gstatic|googleapis|cal\.com|gpteng)/, (route) => route.abort());
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[A/B] ' + m.text().slice(0, 300)); });
    const t0 = Date.now();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await waitForScorecard(page);
    results.A_first_load = { ...(await readScorecard(page)), ms: Date.now() - t0, requests: backend.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => `${c.path.split('/').pop()}:${c.status}`) };
    await page.screenshot({ path: path.join(OUT, 'A_first_load.png'), fullPage: false });
    backend.calls.length = 0;
    const t1 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForScorecard(page);
    results.B_refresh = { ...(await readScorecard(page)), ms: Date.now() - t1, requests: backend.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => `${c.path.split('/').pop()}:${c.status}`) };
    await page.screenshot({ path: path.join(OUT, 'B_refresh.png'), fullPage: false });
    await context.close();
  }

  // ---------- Scenario C ----------
  {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await seedSession(context);
    const faults = { get_company_responses_page: () => true };
    const backend = makeBackend(faults);
    await context.route(/\/(rest|auth)\/v1\//, (route) => backend.handle(route));
    await context.route(/functions\/v1\//, (route) => route.abort());
    await context.route(/^https?:\/\/[^/]*(hotjar|googletagmanager|google-analytics|logo\.dev|gstatic|googleapis|cal\.com|gpteng)/, (route) => route.abort());
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[C] ' + m.text().slice(0, 300)); });
    const t0 = Date.now();
    await page.goto(`${BASE}/monitor`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /Prompts|Breakdown|Connection Issue/.test(document.body.innerText), null, { timeout: 60000 });
    // Give the page retries (0 / 2.5s / 6s backoff ×2 query-level attempts) time to exhaust.
    await page.waitForTimeout(45000);
    const text = await page.evaluate(() => document.body.innerText);
    results.C_stream_failure = {
      ms: Date.now() - t0,
      pageRpcAttempts: backend.calls.filter(c => c.path.endsWith('get_company_responses_page')).length,
      skeletons: await page.locator('[aria-busy="true"]').count(),
      promptsRendered: /No prompts tracked yet|responses/.test(text),
      connectionIssue: /Connection Issue/.test(text),
      headerResponses: (() => { const m = text.match(/(\d+)\s+responses/); return m ? Number(m[1]) : null; })(),
      visibleTextSample: text.replace(/\s+/g, ' ').slice(0, 600),
    };
    await page.screenshot({ path: path.join(OUT, 'C_stream_failure.png'), fullPage: false });
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors: consoleErrors.slice(0, 30) }, null, 2));
  console.log(JSON.stringify({ results, consoleErrors: consoleErrors.slice(0, 15) }, null, 2));
})().catch((e) => { console.error('REPRO FAILED', e); process.exit(1); });
