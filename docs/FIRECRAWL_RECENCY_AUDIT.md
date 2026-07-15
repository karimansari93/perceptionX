# Firecrawl / Recency Pipeline Audit

**Date:** 2026-07-15
**Scope:** How we spend Firecrawl credits getting publication dates ("recency") for cited URLs, why the 100k/month budget drains fast, and what to change. Written to be executed as a work plan (each recommendation has file references and an expected impact).

---

## 1. TL;DR

The pipeline design is already good — URL-pattern matching, evergreen detection, YouTube/Reddit APIs, plain-fetch meta parsing, and gpt-4.1-nano extraction all run **before** Firecrawl, and results are cached permanently in `url_recency_cache`. Firecrawl only sees the residue.

The budget drains anyway because of **how** that residue is scraped, not how much of it there is:

1. **We never set the `proxy` parameter, so Firecrawl defaults to `proxy: "auto"`** — every scrape that fails on basic proxies is silently retried on "enhanced" proxies at **5 credits instead of 1**. Our residue is dominated by exactly the domains that fail basic proxies (Instagram, Facebook, TikTok, Glassdoor, Google). Confirmed against Firecrawl docs: auto is the default, enhanced bills 5 credits, and Firecrawl's own cache (`maxAge`) does **not** discount credits.
2. **~60% of what we send to Firecrawl comes back with no date at all** (`not-found`). In the last 30 days that's ~6,500 URLs scraped — likely at the 5-credit enhanced rate since they're bot-walled — for zero information. That alone is plausibly **~30k credits/month burned on failures**.
3. **Backfill/rescore jobs amplify this.** On 2026-07-14 a single rescore job wrote 22k cache rows in one day, 5,313 of them `not-found`. `timeout`/`rate-limit` outcomes are deliberately not cached, so the rescore tick re-pulls and re-scrapes the same unresolvable URLs every tick until the stall guard trips (up to 5 ticks × 200 URLs per job).
4. **~11% of the cache is duplicate URLs differing only by query string** (18,888 excess rows, utm/fbclid/etc.), each one a separate scrape when it fell through to Firecrawl.

**Verdict on switching providers: don't.** Firecrawl now contributes only ~2–10% of successfully extracted dates while consuming essentially the whole scraping budget. The fix is not a cheaper scraper — it's sending Firecrawl far fewer URLs and never paying 5x for known-hopeless ones. After the changes below, expected Firecrawl usage is **under 10k credits/month**, at which point you can downgrade off the 100k plan entirely.

---

## 2. How the pipeline works today

### 2.1 The extraction waterfall (`supabase/functions/extract-recency-scores/index.ts`)

Per batch of citations, in order, each tier only seeing what the previous tiers couldn't resolve:

| Tier | Method | Cost | Cache methods written |
|---|---|---|---|
| 0 | `url_recency_cache` lookup (permanent, keyed on exact URL) | free | `cache-hit` (not persisted) |
| 1a | Date regex on the URL itself | free | `url-pattern` |
| 1b | Evergreen detection (homepages, careers/ATS/job boards, PDFs, social profiles) → score 100 | free | `evergreen` |
| 1c | YouTube Data API (batched 50 IDs/call) | free (quota) | `youtube-api` |
| 1d | Reddit OAuth `.json` endpoint | free | `reddit-api` |
| 2 | Plain `fetch()` + meta-tag / JSON-LD / `<time>` parsing | free | `meta-tag`, `json-ld`, `time-tag` |
| 3 | gpt-4.1-nano on the Tier-2 HTML | ~$0.0005/URL | `openai-html` |
| 4 | **Firecrawl** `/v2/batch/scrape`, `formats: ['markdown']`, then free metadata parse, then gpt-4.1-nano on the markdown | **1–5 credits/URL** | `firecrawl-metadata`, `openai-html`, `not-found` |

Prior optimizations already in place (visible in code comments): dropped Firecrawl's JSON extraction (was billing 25–290 credits/page), switched to markdown-only batch scrape, skip PDFs (billed per PDF page), evergreen-skip ATS/job domains.

### 2.2 Callers

- `src/lib/utils.ts:239` — fire-and-forget after each stored prompt response (skipped during onboarding batching).
- `src/hooks/usePromptsLogic.ts:601` — one batched call at end of onboarding.
- `supabase/functions/process-recency-rescore-tick/index.ts:119` — cron-driven (`recency-rescore-tick`, every minute + self-chaining) backfill worker; pulls URLs with `extraction_method IS NULL` from `v_organization_url_status` / `v_company_url_status`, 50/batch, ≤4 batches/tick.
- `src/components/admin/RecencyCoverageTab.tsx:483` and `CompanyRecencyTestTab.tsx:95` — admin spot-checks.
- `supabase/functions/analyze-website-gaps/index.ts:37` — unrelated feature, single scrape per invocation, still on the **deprecated v0 API**.
- `supabase/functions/extract-recency-scores/index-fixed.ts` — **dead code**, not deployed (`scripts/deploy-edge-functions.sh` deploys `extract-recency-scores` only).

### 2.3 Production numbers (queried 2026-07-15)

Cache: **175,930 rows total; 27,340 added in the last 7 days** (a 2026-07-14 rescore job accounts for 22k in one day).

Last 30 days, new cache rows by method:

| Method | Rows (30d) | Firecrawl involved? |
|---|---|---|
| evergreen | 7,528 | no |
| **not-found** | **6,506** | **yes — scraped, got nothing** |
| meta-tag | 3,973 | no |
| json-ld | 3,793 | no |
| openai-html | 3,210 | partly (Tier 3 free-fetch and Tier 4 Firecrawl-markdown share this label — see Rec 7) |
| url-pattern | 2,382 | no |
| youtube-api | 1,437 | no |
| firecrawl-metadata | 794 | yes |
| reddit-api | 700 | no |
| evergreen-domain / social-post / time-tag / owned-asset | ~1,275 | no |

So Firecrawl scraped roughly **7,300–10,500 unique URLs in 30 days** (not-found + firecrawl-metadata + some share of openai-html), and produced a confirmed date for at most ~4,000 of them — while the free tiers produced ~20,000. **Firecrawl's hit rate on what we send it is ≤40%, and its unambiguous wins (`firecrawl-metadata`) are 2.5% of all resolved URLs.**

Top `not-found` domains (30d) — i.e., where failed scrapes concentrate:

| Domain | not-found rows | Note |
|---|---|---|
| instagram.com | 1,232 | login-walled; date unobtainable |
| facebook.com | 548 | login-walled |
| google.com | 249 | search/maps results — no publish date exists |
| tiktok.com | 194 | bot-walled |
| glassdoor.* (all TLDs) | ~260 | paths that slip past the evergreen regex |
| linkedin, quora, indeed, comparably, levels.fyi, ambitionbox, ziprecruiter, scribd, studocu, help.netflix.com… | ~450 | bot-walled or inherently dateless |

These domains fail basic proxies → `proxy: "auto"` retries them on enhanced at 5 credits → they *still* fail. This is the core waste loop.

### 2.4 Credit math (estimate)

- ~6,500 not-found scrapes/month × ~5 credits (auto→enhanced) ≈ **32k credits**
- ~800 metadata + up to ~3,200 markdown-path scrapes × 1–5 credits ≈ **4–15k credits**
- Uncached `timeout`/`rate-limit` URLs re-scraped across rescore ticks (up to 1,000 re-pulls per stalled job), plus any `bypassCache: true` backfill re-runs ≈ **unmeasured, potentially large**
- Firecrawl's `maxAge` cache does **not** reduce billing (confirmed in docs), so repeat scrapes of the same URL always bill full price.

That comfortably explains a 100k budget feeling "wasted quickly" despite the good tiering.

---

## 3. Should we leave Firecrawl?

**No — demote it instead.** Reasoning:

- The expensive part of this workload isn't the vendor, it's **paying anything at all for URLs that can never yield a date** (social login walls, search result pages) and **paying 5x via proxy escalation**. Any vendor (ScraperAPI, ScrapingBee, Zyte) bills the same shape: cheap base requests, 5–25x for premium/stealth proxies, and identical failure modes on Instagram/Facebook/TikTok. Switching moves the bill, not the waste.
- Self-hosting Firecrawl (it's open source) is possible but buys nothing at this volume — after the fixes below the residual is a few thousand scrapes/month, which doesn't justify running proxy infrastructure.
- What Firecrawl uniquely provides over our free Tier 2 fetch is JS rendering + proxy rotation. Post-fix, that's worth keeping as a **last-resort tier on a small plan** (Hobby 5k credits/$16, or Standard's lowest tier), not 100k credits.

**Decision rule to make this concrete:** after Recs 1–4 have run for a month, check actual usage (Rec 7 gives you the dashboard). If Firecrawl resolves <500 dates/month, drop to the smallest plan; if <100, remove Tier 4 entirely and accept `not-found` for the residue — the recency coverage impact is already under 3% of resolved URLs.

---

## 4. Recommendations (prioritized, with expected impact)

### Rec 1 — Force `proxy: "basic"` on the batch scrape ⚡ one line, biggest win

`supabase/functions/extract-recency-scores/index.ts:661` — add `proxy: 'basic'` to the `/v2/batch/scrape` body. Sites that need enhanced proxies are precisely the ones that return no date anyway; paying 5 credits to fail is strictly worse than paying 1 credit to fail.

**Impact: est. 20–35k credits/month.** Risk: a small set of borderline sites that succeeded only via enhanced proxies become not-found — acceptable, and Rec 7 will show if it matters.

### Rec 2 — Data-driven domain deny-list for Tier 4

Never send Firecrawl a domain with a proven ~0% success rate. Two parts:

1. **Static skip in code** (fast follow, in the Step-4a loop next to `isEvergreenUrl`): `instagram.com`, `facebook.com`, `tiktok.com`, `google.com` (search/maps paths), `scribd.com`, `studocu.com` → cache immediately as `social-post` (score null) or `not-found`, no scrape. Also extend evergreen: `help.*`/`support.*` subdomains, and audit remaining glassdoor path variants that slip past the regex at `index.ts:889`.
2. **Dynamic deny-list** (the durable version): a small view/table over `url_recency_cache` — domains with ≥20 Firecrawl attempts and <5% date success get skipped for 90 days. Check it in Step 4a. This self-maintains as AI models start citing new dateless sources.

**Impact: est. 40–60% fewer Firecrawl scrapes** (the top-10 not-found domains alone are ~45% of failures).

### Rec 3 — Stop re-scraping `timeout` / `rate-limit-hit` URLs

Today these outcomes are intentionally left uncached (`index.ts:357`) so the rescore tick retries them — every retry is a fresh billed scrape. Instead, cache them **with** the method and have the rescore views (`v_organization_url_status`, `v_company_url_status`) exclude rows where `last_checked_at > now() - interval '7 days'`. That preserves "retry eventually" while capping spend at one attempt per URL per week. Also make `bypassCache: true` backfills skip URLs whose cached method is `not-found`/`social-post` unless explicitly forced — re-scoring a known failure through the new pipeline is fine once, not on every backfill.

**Impact: kills the unbounded retry loop; makes backfill cost predictable.**

### Rec 4 — Normalize URLs before cache lookup and scrape

18,888 cache rows (~11%) are query-string variants of the same base URL. Add a normalizer applied at every entry point (`extract-recency-scores` intake is the single choke point): strip `utm_*`, `fbclid`, `gclid`, `ref`, `#fragments` (incl. `#:~:text=`), lowercase host, drop trailing slash — while whitelisting meaningful params (`v=` on YouTube). One-time migration: dedupe existing cache rows onto normalized URLs.

**Impact: ~10% fewer scrapes + smaller cache + better cache-hit rate for analytics joins.**

### Rec 5 — Concurrency guard on duplicate in-flight URLs

The per-response trigger (`utils.ts:239`), the onboarding batch (`usePromptsLogic.ts:601`), and the cron tick can all be in flight simultaneously; cache rows are written only at the end of a run, so overlapping batches can scrape the same URL twice. Cheap fix: upsert a `pending` marker row (or use an advisory lock keyed on URL hash) when a URL enters Tier 4, and have other runs treat `pending` newer than ~3 minutes as cache-hit-in-progress.

**Impact: small but free; removes double-billing during onboarding bursts.**

### Rec 6 — Observability: log actual credit spend

We currently have zero visibility into credits — that's why the burn is a feeling, not a number. The `/v2/batch/scrape/{id}` status response includes a `creditsUsed` field: record it (plus URL count, org/job id, timestamp) into a `firecrawl_usage` table on every batch completion, and surface a monthly running total in the admin Recency panel (`RecencyCoverageTab`). Add a soft monthly budget: when usage crosses a threshold (e.g. 20k), skip Tier 4 and cache as `timeout` (retryable per Rec 3) instead of silently draining the plan.

**Impact: turns every future pricing decision into a query.**

### Rec 7 — Split the `openai-html` label

`openai-html` is written by both Tier 3 (free plain-fetch HTML) and Tier 4 (paid Firecrawl markdown) — this audit couldn't attribute ~3,200 rows/month because of it. Add `firecrawl-markdown-llm` (or similar) as a distinct method for the Tier-4 path (constraint update needed in a migration; last precedent: `20260511100000_add_youtube_reddit_extraction_methods.sql`).

**Impact: makes Firecrawl's true contribution measurable — this is the number that decides whether to cancel the plan.**

### Rec 8 — Housekeeping

- Delete `supabase/functions/extract-recency-scores/index-fixed.ts` (dead, confusing).
- Migrate `analyze-website-gaps/index.ts:37` off the deprecated `v0/scrape` endpoint to v2 (its spend is negligible — one scrape per run — but v0 will eventually be shut off).
- The evergreen "PDF → score 100" shortcut (`index.ts:862`) saves real money but silently marks PDFs as maximally recent; consider `recency_score: null` + a dedicated `pdf-skipped` method instead so metrics aren't skewed. (Cost-neutral; data-quality call.)

---

## 5. Expected end state

| | Today (est.) | After Recs 1–4 |
|---|---|---|
| URLs sent to Firecrawl / month | ~8–12k (plus retries) | ~1–3k |
| Credits per failed scrape | up to 5 | 1 |
| Credits / month | approaching 100k | **< 10k** |
| Firecrawl plan | 100k tier | Hobby/small tier, or none |

Suggested execution order for Opus: **1 → 3 → 2(static) → 6 → 4 → 7 → 2(dynamic) → 5 → 8.** Rec 1 is a one-line change worth shipping today; Recs 3 and 2-static are each an afternoon; everything else is incremental.
