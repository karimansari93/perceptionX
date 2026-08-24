# PerceptionX Activate — Link Router

## What this is

A shareable link an EB or talent team sends to employees and candidates. The
recipient says where they're based, and the page shows where AI learns about
their employer *in their market*, linking to the platforms that actually feed
those answers. They choose whether to write anything and what to say. We route;
we never script.

The page is a **client-branded space** — warm, energetic, culture-forward —
driven entirely by a two-color token system plus optional logo, so any client
gets a branded page with zero bespoke design work. See
`docs/activate-design-brief.md` for the full design contract.

## Why it exists (the measurement case)

From the CSL Q3 2026 baseline, verified in Supabase project `ofyjvfmcgtntwamkubui`:

Candidate questions split into four types (`confirmed_prompts.prompt_type`), and
sentiment varies enormously by type:

| Type | Visibility | Sentiment |
|---|---|---|
| discovery | 6.1% | 86.8% |
| competitive | 95.1% | 63.6% |
| informational | 92.9% | 70.8% |
| **experience** | **90.0%** | **48.6%** |

Experience questions — "what's it like to work at CSL" — are where sentiment
collapses. Roughly half the negative themes in every major attribute come from
that one type.

Source agency by prompt type (people-influenced = review platforms where
employees and candidates write the content; client-influenced = owned sites,
managed profiles, directories, rankings):

| Type | People-influenced | Client-influenced |
|---|---|---|
| experience | 90.6–93.1% | 75.7–87.1% |
| informational | 63.9–74.3% | 89.2–95.1% |
| competitive | 62.6–74.3% | 82.1–86.1% |
| discovery | 36.6–63.3% | 65.8–82.7% |

**Experience is the only question type where people-generated content outweighs
client-influenced content — and it's the worst-scoring type.** Nothing the
client's team publishes moves that number. Only their people can.

Portfolio-wide, people-influenced sources appear in 71.0% of answers; 10.8% of
answers cite people-generated sources and no client voice at all.

## Scope boundary

**Activate routes people-influenced sources only.** Client-influenced work —
claiming profiles, directory fixes, ranking links, certifications — stays in the
recommendations register. Two separate products; don't blur them.

The `source_agency_rules` classification table (page-type-level people/client/
editorial tagging) belongs to the *measurement* side and is **not part of this
build** — the router never consults it at runtime because routes are hand-curated.
It ships with the cohort-measurement phase.

## How the recipient is routed

Self-declared, two taps, no inference:

1. **Where are you based?** Country selector (searchable, full ISO list, the
   client's measured markets pinned on top).
2. **Which part of {company}?** The org's entities plus "Not sure".

No IP geolocation, no fingerprinting, no silent profiling. The sender may
pre-fill either field when generating the link; the recipient can always
override, and the declared value is what routes. "Not sure" falls back to the
market's entity-agnostic routes.

Declared values are stored on events — where recipients actually are is useful
signal in its own right.

## Routing tiers

Resolved in order for the declared country:

1. **Measured market** — verified destination URLs plus a measured
   `rationale_stat` to display.
2. **Known-platform fallback** — country we don't measure but where dominant
   platforms are known (seeded: Canada, Ireland). Routes shown, generic copy,
   **never another market's statistic**.
3. **Global default** — **Glassdoor and Indeed only.** LinkedIn is dropped: a
   LinkedIn company page is a managed profile — client-influenced by our own
   classification — and there is no review for a recipient to write there.
   Tier 3 rows carry `market_code = NULL` (that's the convention; enforced by a
   check constraint).

Tier 1 markets today: Germany, Switzerland, United Kingdom, United States,
Australia.

Resolution rule: if the declared market has any active rows (tier 1 or 2), use
them; otherwise use the org's tier-3 rows. Within a market, an entity-specific
row beats the entity-agnostic row for the same platform.

## Schema

Naming rule: **"org" is the client, "entity" is the division.** The earlier
draft overloaded `company_id` for both; that's resolved as follows —
`org_id → organizations`, `entity_company_id / declared_entity_id → companies`
(the four CSL entities are `companies` rows under the CSL organization).

```sql
activate_routes
  id, org_id                  -- the client organization; all routes are org-scoped
  entity_company_id null      -- entity-specific; NULL = entity-agnostic for that market
  market_code text null       -- ISO 3166-1 alpha-2; NULL ⇔ tier 3 (check-enforced)
  tier smallint               -- 1 measured | 2 known fallback | 3 global default
  platform, destination_url   -- the resolved page, not the domain
  write_url null              -- where a person actually posts; resolve manually, never construct
  rationale_stat null         -- measured prose; only allowed on tier 1 (check-enforced)
  rank, active, use_direct_link

activate_links
  id, org_id, token, label, created_by
  audience null               -- 'employee' | 'candidate' | 'alumni'
  prefill_market_code null, prefill_entity_company_id null
  expires_at null             -- optional hard stop; NULL (the default) = never expires
  revoked_at null             -- the off switch, reversible: cleared = live again

activate_link_events
  id, link_id
  session_id uuid             -- random client-generated UUID per pageview (see below)
  event_type                  -- 'open' | 'market_declared' | 'entity_declared' | 'platform_click'
  declared_market_code null, declared_entity_id null
  platform null, tier null, occurred_at

activate_branding
  org_id pk, display_name, tagline, blurb, logo_url null
  logo_domain null            -- logo.dev lookup domain; initials fallback
  primary_color, accent_color -- the two tokens the whole page derives from

activate_org_settings
  org_id pk
  consent_confirmed_at null   -- the consent gate; see below
  consent_confirmed_by, consent_note

activate_market_map
  org_id, market_code, location_context   -- ISO code ↔ confirmed_prompts.location_context
```

**Session identity.** One link goes to a whole cohort, so `link_id` alone cannot
connect a `platform_click` to the `market_declared` that preceded it — and that
funnel is the core thing this product can measure. Every pageview mints a random
client-side UUID (`crypto.randomUUID()`), stamped on every event. It identifies
a pageview, not a person: never persisted client-side, no cookie, no
fingerprint. All within-visit analysis joins on it.

**Market normalisation.** Routes are keyed on ISO country codes, never on raw
`location_context` strings. `activate_market_map` holds the explicit per-org
mapping for cohort analytics joins. (CSL's `location_context` values are already
clean — the map is five rows — but the indirection is what makes this
multi-client.)

**Curate `activate_routes` manually. Never auto-generate from citation counts** —
"most cited" and "best place for this person to post" are different questions.

**Access model.** Same pattern as conversational intake: the `anon` role has no
table access; recipients go through SECURITY DEFINER RPCs gated on the link
token. Both token RPCs resolve a link with the same predicate — not revoked,
and not past an expiry if it has one — so a link switched off goes dead for
reads and writes together, and the event-insert RPC rate-caps per session and
per link on top. Admin access via `is_admin()` RLS.

**Links do not expire; they are switched off.** A cohort link goes into an
onboarding pack, an email footer or a poster, where a 90-day timer nobody is
tracking kills every copy at once and the only repair is a new token. So a link
stays live until an admin flips it off — `revoked_at` set — and flipping it back
on revives every copy already in circulation. `expires_at` survives for a
genuinely time-boxed campaign (`p_expires_days` on the create RPC) and is NULL
otherwise.

## Consent gate

**No link is mintable for an org until client consent is recorded.** The
create-link RPC refuses (`consent_required`) while
`activate_org_settings.consent_confirmed_at` is NULL; an admin records consent
explicitly (who/when/note). CSL is seeded *unconfirmed* — the Andy → Elise
conversation has to happen before the first real link exists. The build and the
DACH internal review can proceed in parallel with that.

## Verified routing seed data

Market → platform priority (base: % of that market's answers citing the source):

- Germany: kununu 55.1 · Glassdoor 19.4 · Indeed 17.7
- Switzerland: kununu 47.0 · Glassdoor 19.3
- United Kingdom: Glassdoor 53.7 · Indeed 47.4
- United States: Indeed 51.2 · Glassdoor 48.0
- Australia: Glassdoor 44.7 · Seek 34.5 · Indeed 30.9

Market determines the platform mix; function does not (Glassdoor leads eight of
ten job functions in a narrow 35.0–41.6% band, while kununu swings from 55.1% in
Germany to absent in UK/US/AU). **Key routing on market × entity. Function never
selects a platform.**

Verified cited destination URLs (these appear in the citation data):

- kununu.com/de/csl-behring-deutschland *(most-cited German profile)*
- kununu.com/ch/csl-behring1-schweiz
- kununu.com/de/vifor · kununu.com/ch/vifor-pharma-group · kununu.com/ch/csl-vifor1
- au.seek.com/companies/csl-limited-436233 · au.seek.com/companies/csl-seqirus-814864
- indeed.com/cmp/csl
- Glassdoor CSL profile, employer ID E27527

**Resolve `write_url` manually per platform** — write-a-review endpoints differ
from profile URLs and must not be constructed by pattern. All seeded as NULL
until each is resolved by hand; the page falls back to `destination_url`.

**DE/CH ship dark** (`active = false`), for two stacked reasons:

1. kununu citations fragment across at least six CSL-family profiles and the
   most-cited German profile is not the one CSL listed at intake. Routing
   reviewers into an unclaimed profile achieves nothing — **and when
   consolidation lands, the route should point at the profile CSL wants weight
   to accrue on (the canonical one), not the currently-most-cited one.** Citation
   data says where AI looks today, not where we want it looking in a year; this
   is the sharpest instance of the no-auto-generation rule.
2. The client's works-council/GDPR review (their outreach, not this build).
   Routes flip on when CSL confirms.

Honest launch math: with DE/CH dark, day-one live value is UK/US/AU — the three
markets where the platform mix is most generic. The markets where the measured
rationale is strongest (kununu 55.1%) are the gated ones. **kununu profile
consolidation is the critical path to this product's best demo**, not a side
quest. Set client expectations accordingly.

## Page behaviour

Lead with the reason, then the links. A links page is a commodity; the measured
rationale is not. A German CSL Behring employee sees that kununu appears in
55.1% of AI answers about their employer in their market — that's why they
click, and it only exists because we measured it. Tier 2/3 recipients see the
platforms with generic copy and no statistic.

Copy stays non-directive throughout: "here's where candidates learn about our
culture — whether and what to share is entirely up to you." No sentiment
framing, no suggested content, no examples, no rating prompts, no star imagery,
no urgency mechanics. The page carries one honesty line: *"We don't see what you
write — or whether you write at all."*

**The tab is the client's too.** Title is the client's display name and the
favicon is their mark (logo.dev on `logo_domain`, falling back to an uploaded
`logo_url`) — a recipient who parks the tab for a day should see their employer
there, not a vendor they've never heard of. Both are restored when the page
unmounts, so the rest of the app keeps its own identity.

## The link preview is the first screen

Nobody arrives at an Activate link by typing it. It gets forwarded into a
WhatsApp thread, pasted into a Teams channel, dropped in an email footer — and
the unfurled card is what a recipient judges before deciding whether to tap. It
is part of the page, not metadata about it.

Until 2026-08-24 that card was the dashboard's: `/activate/*` fell through the
SPA rewrite to `index.html`, so crawlers were served *"PerceptionX Dashboard —
Enterprise AI Employer Reputation Management. Sign in to see how AI is answering
questions about your employer brand"* over a screenshot of our product. An
employee got an unfamiliar vendor's login page from their own HR team. The
client-branded `useMetaTags` call on the page never helped: WhatsApp, Slack,
LinkedIn and iMessage do not execute JavaScript.

Three layers, each a fallback for the one above:

| Layer | What it does | When it's what you see |
|---|---|---|
| `netlify/edge-functions/activate-og.ts` + `activate-meta.ts` | Per-token copy and a card drawn in the client's colours with their mark | Normal case |
| `dist/activate.html` (built in `vite.config.ts`, routed in `public/_redirects`) | Unbranded Activate copy + the baked card in `public/logos/activate-og.png` | Unknown or switched-off token, Supabase unreachable, no edge functions |
| `useMetaTags` in `src/pages/Activate.tsx` | Same copy again, client-side | Browsers and JS-executing crawlers |

**The conversation is the subject, not the mechanism.** *"Join the online
conversation about <Client>"* / *"See where people are already talking about
working at <Client>, and where your experience would count."* The conversation
is happening with or without the recipient — that is both true and the only
honest reason to tap. Naming AI in the headline puts our machinery at the centre
of a page that belongs to the client; it earns its place in the description, as
the payoff. This is also the register the clients write in themselves: Netflix's
own `blurb` reads *"Join the conversation online and help us build our employer
brand."*

The preview stays as non-directive as the page: it says where the conversation
is, never that the recipient should join it or what to say if they do.

**The card is the client's, down to the eyebrow.** Canvas is their
`primary_color`, highlight their `accent_color`, mark their logo in the same
white disc the welcome screen uses, and the line above the headline is their own
`tagline`. Taglines that won't sit on one line (CSL's is a 130-character mission
statement) are dropped rather than truncated — the card is fine without one, and
no truncation of a sentence that long reads as anything but broken.

Nothing on the card is ours: no mark, no wordmark, no eyebrow. The unfurl prints
`app.perceptionx.ai` under it either way, so provenance costs nothing, and an
employee opening a link from their own employer should see their employer.

Two constraints that are easy to get wrong:

- **Previews read through `activate_preview_by_token`, never
  `activate_get_by_token`.** The latter stamps an `open` event. An unfurl is not
  somebody opening a link, and every WhatsApp forward would otherwise land at
  the top of the funnel as a phantom open — the same trap `intake_preview_by_token`
  exists to avoid on the onboarding side.
- **Activate URLs are `noindex, nofollow`.** They carry a link token; a token in
  a search result is a link nobody chose to hand out. `robots.txt` still allows
  the preview crawlers, which respect a `Disallow` and would otherwise render
  nothing at all.

Regenerate the baked fallback card with
`node scripts/build-activate-og-fallback.mjs` (see the header for its two
ad-hoc deps).

## Tracking and platform risk

Two separate leaks, two separate controls — the earlier "tracked redirect vs
direct link" framing conflated them:

- **Click attribution is captured client-side on our page** (the
  `platform_click` event fires before the platform opens), so it exists for
  *every* platform regardless of destination URL shape. There is no redirect
  service and no attribution loss.
- **What the platform sees** is (a) tracking params on the URL and (b) the
  `Referer` header — and a bare URL still sends the Referer unless the anchor
  carries `rel="noreferrer"`. `use_direct_link = true` therefore means: bare
  `destination_url`, no appended params, **and `rel="noreferrer"` on the
  anchor**. Set for Glassdoor and Indeed, the two platforms that monitor review
  surges from a single referrer. Other platforms keep normal referrer behaviour.

## Funnel metrics — declaration is the top

`open` events are soft: corporate mail security (Outlook SafeLinks etc.)
prefetches URLs, so opens are bot-inflated and we have forsworn the
fingerprinting that would filter them. The reported funnel starts at
`market_declared` (a bot doesn't tap a country) and runs
declared → entity → platform_click, joined on `session_id`. Opens are shown as
context, clearly labelled approximate.

## Sender view and recipient privacy

The sender-side activity view shows the funnel per link — with a **k-anonymity
floor: below 5 distinct declared sessions, a link shows totals only; market /
entity / platform breakdowns are suppressed** (enforced in the stats RPC, not
the UI). Rationale: nothing stops a sender minting one labelled link per
employee, at which point events become individual compliance monitoring —
exactly what a works council will probe. The floor plus cohort-level labels
("DE plasma ops", not "Anna M.") keeps the view aggregate by construction.
Encourage whole-cohort sends in the UI copy.

## Attribution — honest about the gap

We measure link opens, declarations, and platform clicks. We cannot measure
whether a review was written; no platform calls back. Don't build per-click
attribution or promise it. Measure at cohort level against the Q3 2026
baseline: experience-prompt sentiment against 48.6%, the five drag attributes
against their composition shares (Company Culture 19.2%, Leadership 16.4%, Job
Security 13.9%, Wellbeing & Balance 12.2%, Career Opportunities 12.0%), kununu
surfacing rate in DE/CH, and Relevance per affected market.

**Add a platform-side denominator:** at launch, snapshot the review count on
each destination profile (cheap periodic manual/scripted count). Cohort claims
then rest on platform-side volume + our citation and sentiment data, not
citations alone.

## Hard constraints

Solicitation must be neutral and uncompensated. No incentives, no scripting, no
targeting only satisfied employees. Platform-ToS matter, but more fundamentally:
PerceptionX's product *is* the measurement of this corpus. A corpus we've biased
is a measurement we can't sell. Design against selection bias deliberately —
encourage whole-cohort sends; flag usage patterns that look hand-picked.

**DACH:** the works-council/GDPR constraint applies to the client's outreach,
not this build. DE/CH routes ship behind `active = false`; the client decides
who receives a link.

## MVP scope

In: link generation with optional pre-fill behind the consent gate, two-tap
self-declaration, tiered routing, branded landing page with per-market
rationale, session-keyed open/declare/click events, sender-side funnel view
with the k-anonymity floor.

Out: automated route generation, per-review attribution, employee identity
verification, Reddit routing (pending strategy), `source_agency_rules` (moves
to the measurement phase), anything touching client-influenced sources, a
branding self-service editor (branding is seeded per org for now).

## Demo-stage extensions (2026-08-11 — ideation build)

The product is in ideation; demos are screen-share only for the next few
months, and the consent gate blocks any real link minting. Four extensions
were added for demo richness, with their integrity lines drawn explicitly:

- **Social channel.** Routes carry `channel: review | social`. Review routing
  stays market × entity only (measured: function does not move the review
  mix). The social section shows where AI reads the *public conversation*
  (LinkedIn, Reddit, Instagram, TikTok), ranked — never filtered — by the
  recipient's optional declared function + seniority (`audience_functions` /
  `audience_seniority` on the route; a "Your world" chip marks matches).
  Reddit's inclusion here is demo-only; the review-mechanic exclusion stands
  and real-distribution strategy stays open.
- **Theme visibility.** `activate_market_themes` (seeded portfolio-wide with
  the five drag attributes) renders as chips: "these themes carry the most
  weight in how AI describes working here." **Topic visibility, never
  sentiment direction** — pointing at where AI's weight sits is measurement;
  "show these topics some love" would be the scripting this product bans.
  Flag for the compliance/works-council review before real distribution.
- **Optional profile step.** A third, skippable step gathers declared job
  function + seniority (`profile_declared` events). Signal + social ranking
  only. This makes the flow three steps — a deliberate deviation from the
  two-step design handoff.
- **DEMO MODE: DE/CH routes are active** so screens can show the kununu
  story (55.1%). Re-gate (`active = false`) before anything real — kununu
  consolidation and the client review remain prerequisites for those markets.

Admin → Activate also gained a per-org **branding editor** (display name,
tagline, blurb, logo domain, both color tokens) — the page's entire design
surface, live on every open link at save.

## Second client: Ford Motor Company (2026-08-13)

Seeded from the 2026-07-01 cycle (24,990 responses, 18 markets). 47 tier-1
review routes + 2 tier-3 global review fallbacks + 5 social routes, and
per-market theme weights for all 18 markets.

**Ford broke an assumption in the entity model.** CSL has one `companies` row
per division, measured across many markets. Ford has 18 rows literally named
"Ford" (one per country) plus real divisions (Ford Credit ×9, Ford Business
Solutions, Ford Design, Ford Energy, Lincoln ×2) — a raw entity list rendered
"Ford" eighteen times. `activate_get_by_token` now dedupes entities by **name**
and attaches a `{market_code: company_id}` map, so the picker shows six named
entities and only those present in the declared market (Germany → Ford, Ford
Credit; India → Ford, Ford Business Solutions; unmapped market → all, as a
fallback). Route matching and events use the market-specific company id, so
single-id route resolution is unchanged for both orgs.

That map is derived from `confirmed_prompts.location_context` through
`activate_market_map` — **never from `companies.country`**, which holds
`'Switzerland'` for all four CSL rows (HQ, not market, and not an ISO code).

**Regional routing is the headline.** Market determines the platform mix far
more sharply than for CSL:

| Market | Top people-influenced sources |
|---|---|
| Germany | **kununu 50.0%** · Glassdoor 21.9 · Indeed 15.1 |
| India | Glassdoor 36.9 · **AmbitionBox 34.4%** · Indeed 20.3 |
| Romania | Glassdoor 24.8 · **undelucram.ro 21.9%** · Indeed 16.4 |
| Australia | Glassdoor 29.4 · Indeed 29.0 · **Seek 25.1%** |
| Hungary | Glassdoor 26.4 · Indeed 18.7 · **profession.hu 9.8%** |
| Brazil | Glassdoor 31.2 · Indeed 18.6 · **InfoJobs 9.9%** |
| United States | Glassdoor 31.3 · Indeed 29.6 · Comparably 13.4 |
| United Kingdom | Glassdoor 42.5 · Indeed 29.0 |

Destination URLs come from URLs that actually appear in the citation data,
which surfaced **market-specific Glassdoor employer ids** worth preserving:
Ford Motor Company `E263` (global), Ford Motor Co of Canada `E8205`, Ford Motor
Company UK `E152869`, Ford India `E152871`, Ford Argentina `E3123922`, and Ford
Credit `E7223` — the last driving four genuine entity-specific routes (DE, ES,
FR, GB), so a Ford Credit recipient lands on their own reviews rather than the
parent's. A few locale URLs are pattern-derived from a verified employer id on
a verified domain; spot-check before real distribution.

Deliberate exclusions, per the no-auto-generation rule:
- **Computrabajo** (LatAm, 1.6–6.6%) — cited pages are dealer listings and job
  ads, not Ford review pages.
- **AmbitionBox outside India** (1–4% in AR/BE/FR/ES/VE) and Comparably below
  ~13% — cross-market citation noise, not real local platforms.

Unlike CSL, Ford's German kununu presence is **consolidated** on a single
profile (`kununu.com/de/ford-werke`), so DE ships active rather than gated on
profile consolidation. Consent is seeded **pending** — no link is mintable.

## Page structure: three sections, three acts (2026-08-13)

The recipient page splits routes into three channels, each led by what the
person would actually be doing rather than by our taxonomy:

| Channel | Section | Platforms |
|---|---|---|
| `review` | "Tell candidates what it's actually like" | Glassdoor, Indeed, kununu, AmbitionBox, undelucram.ro, profession.hu, InfoJobs, Seek, Comparably |
| `forum` | "Join the conversation" | Reddit, Quora, Blind |
| `social` | "Show what the work actually looks like" | LinkedIn, YouTube, Instagram, Facebook, TikTok |

**Every measured platform is shown, not a top three** — "go where you're
comfortable". Rows are generated from measured coverage above a 3% floor, with
curation encoded as rules (home-market restriction, Computrabajo exclusion)
rather than applied as a ranking.

**Ordering: the market's own platform first, then by measured coverage.**
`is_local` marks it, badges it ("Romania's own") and sorts it to the top. The
rationale is that a review on the local platform is read by people actually
looking at this employer in that country and is not diluted across every
market the way a Glassdoor review is. This is a curation decision — in Hungary
and Brazil it puts a ~10% platform above a ~30% one, which is the intended
trade-off, but worth revisiting per market.

**Affinity badges, never reorders.** A declared function/seniority marks
matching rows "your world"; it does not promote them over a louder platform
and never hides anything.

**`activate_route_highlights`** carries the specific pages AI cites most, shown
as a "Most cited" row on the card — the conversation itself rather than a bare
platform link. Labels are hand-written from descriptive URL slugs; pages whose
content can't be verified from the URL are not seeded. Notably, one r/Ford
thread ("What's it like working at Ford") is the top-cited social page in the
US, UK *and* India.

**Social was previously hardcoded and identical for every client — that was
wrong.** Ford's measured data shows YouTube is the loudest social source in 10
of 18 markets (Brazil 44.0%, Peru 37.1%, Colombia 33.2%) and it was absent
entirely, while TikTok and Blind, which shipped globally, never clear 12.4%
and 2.3%. CSL still has the old global social list and needs the same
measured treatment.

### Copy: written for the recipient, not the buyer

"24.8% of AI answers cite Glassdoor" is a stat for the EB team; an employee has
no reason to care. The stat block now leads with the consequence —
*"Ask AI what it's like to work here → 21.9% → of the answer for Romania is
built from Undelucram.ro"* — and the intro names who is actually asking:
"Whoever asks next — a friend, a candidate, someone's kid deciding where to
apply — gets a picture assembled from these pages."

Section headings stay action-led but **never steer sentiment**: "Show what the
work actually looks like", not "showcase what you're most proud of". The
non-directive constraint is about what someone writes, and positive framing
crosses it.

## Related infrastructure

`url_recency_cache` feeds the Relevance measurement Activate will be judged on;
its refresh path is fragile — the rescore job silently no-ops when
`organization_source_urls_mv` is stale, and that MV's refresh has been broken
since creation (unique index on `md5(url)` breaks `REFRESH CONCURRENTLY`). Fix
migration lives on branch `claude/csl-org-missing-list-ds7v4u`, not yet applied
to production. **Deploy it before Activate depends on recency signals.**
