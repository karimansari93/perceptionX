# Design brief — PerceptionX Activate recipient page

Self-contained brief for designing the public page an employee or candidate lands on
when they open an Activate link. No product context beyond this document is needed.

## What the page is

A company sends its people a link. The person who opens it answers two questions —
**where are you based** and **which part of the company are you in** — and the page
shows them the review platforms that actually feed AI answers about their employer
*in their market*, with a measured reason why each one matters. They choose whether
to click through and whether to write anything. The page routes; it never scripts.

It must feel like **the employer's space** — branded, warm, human, a little fun —
not like a survey tool or a corporate compliance page. Think "team page" energy,
not "HR portal" energy. The first client is CSL (global biotech), but the design
must be reusable for any client via tokens (below).

## Audience and context

- Employees and candidates, all levels, all countries. Not tech people.
- Opened from an email, Slack, or WhatsApp message — **mobile-first is mandatory**;
  desktop is the secondary layout.
- One visit, 30–90 seconds. No accounts, no login, no return visits expected.

## The flow (screens/states to design)

1. **Welcome + country** — branded hero (logo or wordmark, display name, tagline,
   one-line blurb), then "Where are you based?" A searchable country selector;
   the client's five measured markets pinned at top, full ISO country list below.
2. **Entity** — "Which part of {company}?" 4–6 big tappable chips plus "Not sure".
   (For CSL: CSL Behring · CSL Vifor · CSL Seqirus · CSL Limited · Not sure.)
3. **Routes (the payoff screen)** — the reason, then the links:
   - *Measured market* (tier 1): a hero stat, e.g. "In Germany, kununu shows up in
     **55.1%** of AI answers about working here." The stat is the emotional peak of
     the page — the one thing that isn't a commodity links list. Then 2–3 platform
     cards in rank order, each opening the platform in a new tab.
   - *Unmeasured market* (tiers 2–3): same layout, no stat — generic copy like
     "These are the platforms AI leans on most for employer answers worldwide."
     Never show another market's number here.
4. **Prefilled arrival** — the sender may pre-answer both questions; the recipient
   lands straight on Routes with a visible, tappable "Based in Germany · CSL Behring
   — change" affordance that reopens the two questions.
5. **Edge states** — loading; link not found / expired / revoked (friendly dead-end,
   no branding leakage beyond a neutral card); market with zero routes (falls back
   to global platforms, so this state only needs the tier-3 copy).

## Data available to each screen

- Branding: `display_name`, `tagline` (short), `blurb` (one sentence), `logo_url`
  (nullable — design a typographic fallback), `primary_color`, `accent_color`.
- Entities: list of `{id, name}`.
- Routes for the declared market: `platform` (kununu, Glassdoor, Indeed, Seek…),
  `destination_url`, optional `write_url`, optional `rationale_stat` (prose, only
  in measured markets), `rank`.
- Audience hint on the link: employee | candidate | alumni (may adjust copy tone,
  e.g. candidates see "where candidates hear about us", not "share your experience").

## Brand token system (hard requirement)

The whole visual identity must derive from **two client colors + neutrals**,
delivered as CSS custom properties (`--activate-primary`, `--activate-accent`).
No hand-tuned per-client artwork. Requirements:

- Gradients, tints, and surfaces computed from the two tokens.
- Text on brand colors must pass WCAG AA — assume arbitrary client colors and
  design the mechanism (e.g. auto light/dark foreground per token).
- Must look intentional with a missing logo and with an ugly primary color.
- Fonts already loaded in the app: **Geologica** (headings), **Plus Jakarta Sans**
  (body). No additional font downloads.

## Tone constraints (non-negotiable, legal/ToS-driven)

- **Non-directive.** Nothing may shape *what* someone writes: no suggested topics,
  no example reviews, no star imagery, no rating iconography, no "5 stars", no
  sentiment words ("help us shine", "spread the love"). Copy in the mock should be
  of the shape: "Here's where candidates hear about life at {company}. If you'd
  like to share your experience — that's entirely up to you."
- No urgency mechanics: no countdowns, no "only takes 2 minutes!", no streaks.
- One honesty line near the footer, verbatim or close: "We don't see what you
  write — or whether you write at all." Plus a small "Routed by PerceptionX".
- Fun through warmth, motion, and color — not through gamification.

## Motion & feel

- Playful is welcome: step transitions, a soft celebratory moment when the routes
  reveal, gentle floating shapes in the hero. Everything must respect
  `prefers-reduced-motion` with a static fallback.
- Tap targets ≥ 44px, keyboard navigable, screen-reader sensible order.

## Technical handoff format

The build is React + Tailwind + shadcn/ui + lucide-react, one route, light mode
only. The most useful deliverable back is: an annotated HTML/CSS (or Tailwind)
mock of the three main screens keyed to the two CSS custom properties above, plus
type scale, spacing, and motion specs. Component-level specs beat full-page PNGs.

## What NOT to design

- No login, no forms beyond the two questions, no free-text input anywhere.
- No share/social buttons, no QR codes, no confetti-on-click-through (the click
  opens a third-party site; we don't celebrate the act of reviewing).
- No dark mode, no desktop-first layouts, no per-client bespoke pages.
