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
  expires_at, revoked_at

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
token. The event-insert RPC checks revoked/expired inside the function and
rate-caps per session and per link. Admin access via `is_admin()` RLS.

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

## Related infrastructure

`url_recency_cache` feeds the Relevance measurement Activate will be judged on;
its refresh path is fragile — the rescore job silently no-ops when
`organization_source_urls_mv` is stale, and that MV's refresh has been broken
since creation (unique index on `md5(url)` breaks `REFRESH CONCURRENTLY`). Fix
migration lives on branch `claude/csl-org-missing-list-ds7v4u`, not yet applied
to production. **Deploy it before Activate depends on recency signals.**
