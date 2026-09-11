// Post-fix verification of the audit scenarios against the mocked backend.
// Same fixtures/backend as run.cjs; asserts the reliability rules instead of
// just recording what rendered.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const F = require('./fixtures.cjs');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8080';
const OUT = process.env.OUT_DIR || __dirname;
const TIMEOUT_BODY = { code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' };

function makeBackend(faults, overrides = {}) {
  const calls = [];
  const counters = {};
  const rpcTable = {
    get_scope_prompts: () => F.prompts,
    get_dashboard_rollups: () => overrides.dashboardRollups || F.dashboardRollups,
    get_scope_stats: () => F.scopeStats,
    get_location_rollups: () => overrides.locationRollups || F.locationRollups,
    get_domain_stats: () => F.domainStats,
    get_competitor_stats: () => F.competitorStats,
    get_company_responses_page: (body) => (body && body.p_before_id ? [] : F.responsesPage),
  };
  return {
    calls, counters,
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
        if (fault && fault(counters[fn])) { rec.fault = true; return json(500, TIMEOUT_BODY); }
        const impl = rpcTable[fn];
        let body = null; try { body = req.postDataJSON(); } catch {}
        return json(200, impl ? impl(body) : null);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.replace('/rest/v1/', '');
        if (table === 'organization_members') return json(200, F.organizationMembers);
        if (table === 'profiles') return json(200, wantsObject ? F.profile : [F.profile]);
        if (table === 'companies') return json(200, wantsObject ? F.companyRow : [F.companyRow]);
        // The What's-new announcement modal opens when this row is missing; its
        // backdrop would intercept the Retry click in the scenarios below.
        if (table === 'announcement_seen') return json(200, wantsObject ? { version: 'seen' } : [{ version: 'seen' }]);
        return json(200, wantsObject ? {} : []);
      }
      return route.continue();
    },
  };
}

async function newPage(browser, faults, overrides) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await context.addInitScript(([key, value]) => { try { window.localStorage.setItem(key, value); } catch {} }, [`sb-${F.PROJECT_REF}-auth-token`, JSON.stringify(F.session)]);
  const backend = makeBackend(faults, overrides);
  await context.route(/\/(rest|auth)\/v1\//, (route) => backend.handle(route));
  await context.route(/functions\/v1\//, (route) => route.abort());
  await context.route(/^https?:\/\/[^/]*(hotjar|googletagmanager|google-analytics|logo\.dev|gstatic|googleapis|cal\.com|gpteng)/, (route) => route.abort());
  const page = await context.newPage();
  return { context, page, backend };
}

async function readScorecard(page) {
  return page.evaluate(() => {
    const read = (name) => {
      const el = document.querySelector(`[data-metric="${name}"]`);
      if (!el) return { present: false };
      return { present: true, text: el.textContent.trim(), unavailable: el.getAttribute('data-unavailable') === 'true' };
    };
    const text = document.body.innerText;
    return {
      eps: read('eps'), sentiment: read('sentiment'), visibility: read('visibility'), relevance: read('relevance'),
      themesEmptyCopy: /No attribute mentions found yet/.test(text),
      themesError: /Couldn't load themes\./.test(text),
      locationError: /Couldn't load this location's metrics\./.test(text),
      alerts: document.querySelectorAll('[role="alert"]').length,
      retryButtons: [...document.querySelectorAll('button')].filter(b => /retry/i.test(b.textContent)).length,
      busy: document.querySelectorAll('[aria-busy="true"]').length,
      connectionIssue: /Connection Issue/.test(text),
    };
  });
}

async function waitForScorecard(page, ms = 30000) {
  await page.waitForFunction(() => document.querySelector('[data-metric="eps"]') !== null, null, { timeout: ms });
  await page.waitForTimeout(1200);
}

const assert = (cond, msg, failures) => { if (!cond) failures.push(msg); };

(async () => {
  const browser = await chromium.launch();
  const results = {};
  const failures = [];

  // ---------- Scenario 1: location rollups 500 ×2, everything else OK ----------
  {
    const { context, page, backend } = await newPage(browser, { get_location_rollups: (n) => n <= 2 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await waitForScorecard(page);
    const s = await readScorecard(page);
    results.s1_location_fail = { ...s, requests: backend.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => `${c.path.split('/').pop()}:${c.status}`) };
    assert(s.sentiment.unavailable && s.sentiment.text === '—', 'S1: sentiment must render as unavailable (—), not a percentage', failures);
    assert(s.relevance.unavailable && s.relevance.text === '—', 'S1: relevance must render as unavailable (—)', failures);
    assert(s.visibility.present && !s.visibility.unavailable && s.visibility.text === '70%', 'S1: visibility (separate successful call) must still render 70%', failures);
    assert(s.eps.unavailable && s.eps.text === '—', 'S1: EPS must not be calculated from missing inputs', failures);
    assert(!s.themesEmptyCopy, 'S1: Themes must not show the legitimate-empty copy', failures);
    assert(s.themesError, 'S1: Themes must show "Couldn\'t load themes."', failures);
    assert(s.locationError && s.retryButtons > 0, 'S1: an error + Retry state must be visible', failures);
    await page.screenshot({ path: path.join(OUT, 'fixed_S1_location_fail.png') });

    // ---------- Scenario 2: Retry → success, no browser refresh ----------
    const retry = page.locator('button', { hasText: /retry/i }).first();
    await retry.click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-metric="sentiment"]');
      return el && el.getAttribute('data-unavailable') !== 'true';
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const s2 = await readScorecard(page);
    results.s2_retry_recovers = { ...s2, locationRollupsCalls: backend.counters.get_location_rollups };
    assert(s2.sentiment.text === '82%', `S2: after retry sentiment must be 82% (got ${s2.sentiment.text})`, failures);
    assert(s2.relevance.text === '63%', `S2: after retry relevance must be 63% (got ${s2.relevance.text})`, failures);
    assert(s2.eps.text === '75', `S2: after retry EPS must be 75 (got ${s2.eps.text})`, failures);
    assert(!s2.themesError && !s2.locationError, 'S2: error states must clear after a successful retry', failures);
    assert(backend.counters.get_location_rollups === 3, `S2: retry must issue exactly one more location request (got ${backend.counters.get_location_rollups})`, failures);
    await page.screenshot({ path: path.join(OUT, 'fixed_S2_after_retry.png') });
    await context.close();
  }

  // ---------- Scenario 3: genuine zeros render as 0% ----------
  {
    const zeroSentiment = (loc) => F.locationRollups.sentiment.map(r => ({ ...r, positive_themes: 0, negative_themes: 100, neutral_themes: 20, total_themes: 120 }));
    const zeroRelevance = F.locationRollups.relevance.map(r => ({ ...r, relevance_score: 0 }));
    const overrides = { locationRollups: { ...F.locationRollups, sentiment: zeroSentiment(), relevance: zeroRelevance } };
    const { context, page } = await newPage(browser, {}, overrides);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await waitForScorecard(page);
    const s = await readScorecard(page);
    results.s3_real_zero = s;
    assert(s.sentiment.text === '0%' && !s.sentiment.unavailable, `S3: a real 0 sentiment must render as 0% (got ${s.sentiment.text})`, failures);
    assert(s.relevance.text === '0%' && !s.relevance.unavailable, `S3: a real 0 relevance must render as 0% (got ${s.relevance.text})`, failures);
    assert(s.eps.text === '21' && !s.eps.unavailable, `S3: EPS with real zeros must be 21 (0.3×70) (got ${s.eps.text})`, failures);
    assert(s.alerts === 0, 'S3: no error state for legitimate zeros', failures);
    await page.screenshot({ path: path.join(OUT, 'fixed_S3_real_zero.png') });
    await context.close();
  }

  // ---------- Scenario 4: response stream permanently fails ----------
  {
    const { context, page, backend } = await newPage(browser, { get_company_responses_page: () => true });
    const t0 = Date.now();
    await page.goto(`${BASE}/monitor`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /Couldn't load responses\./.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    const busy = await page.locator('[aria-busy="true"]').count();
    const retryButtons = await page.locator('button', { hasText: /retry/i }).count();
    results.s4_stream_fail = { ms: Date.now() - t0, pageAttempts: backend.counters.get_company_responses_page, busy, retryButtons, errorShown: /Couldn't load responses\./.test(text) };
    assert(busy === 0, 'S4: no skeleton may remain once the stream has failed', failures);
    assert(/Couldn't load responses\./.test(text), 'S4: an explicit stream error must be shown', failures);
    assert(retryButtons > 0, 'S4: Retry must be available', failures);
    await page.screenshot({ path: path.join(OUT, 'fixed_S4_stream_fail_prompts.png') });
    // Headline metrics that succeeded remain visible on the Overview.
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await waitForScorecard(page);
    const s = await readScorecard(page);
    results.s4_overview = s;
    assert(s.sentiment.text === '82%' && s.visibility.text === '70%' && s.relevance.text === '63%', `S4: headline metrics must remain visible (got ${s.sentiment.text}/${s.visibility.text}/${s.relevance.text})`, failures);
    await page.screenshot({ path: path.join(OUT, 'fixed_S4_stream_fail_overview.png') });
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results-fixed.json'), JSON.stringify({ results, failures }, null, 2));
  console.log(JSON.stringify({ results, failures }, null, 2));
  if (failures.length) { console.error(`\n${failures.length} assertion(s) failed`); process.exit(1); }
  console.log('\nALL SCENARIOS PASSED');
})().catch((e) => { console.error('REPRO FAILED', e); process.exit(1); });
