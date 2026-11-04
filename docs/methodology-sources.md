# Sources: platforms, owned pages and coverage

One rule, in `supabase/functions/_shared/source-platforms.ts`. The quarterly
email, the Ask AI and MCP tools (`px-tools/source-lines.ts`) and the dashboard
(`src/utils/sourcePlatforms.ts`, a re-export) all read it. Do not write a
second grouping rule anywhere.

## What counts as one source

- **A platform is one source.** `in.linkedin.com`, `hu.linkedin.com` and
  `linkedin.com` are LinkedIn; `glassdoor.co.in`, `glassdoor.com`,
  `www2.glassdoor.co.in` and `api.glassdoor.com` are Glassdoor; `mx.indeed.com`
  and `in.indeed.com` are Indeed; likewise AmbitionBox and the others in
  `PLATFORMS`. A host folds when its registrable label is a registered
  platform and its suffix is `.com`, one of the platform's own suffixes, or a
  country suffix. Any subdomain folds with it.
- **Every platform the dashboard knows folds** (about 90: review sites, job boards, social). The registry mirrors the dashboard's cards.
- **Other sites fold only by country.** A leading country-code subdomain
  (`de.nytimes.com`) and country or `.com` variants of the same name
  (`bbc.co.uk`, `bbc.com`) become one line. Any other subdomain is kept:
  `support.google.com`, `docs.google.com` and `google.com` stay three lines.
- **Hosts the client owns are never folded.** `careers.ford.com`,
  `india.ford.com`, `ford.com` and `ford.de` stay separate lines.
- To add a platform, add it to `PLATFORMS` (and to the matching list in
  `src/utils/sourceConfig.ts` or `SourcesTab.tsx` if the dashboard shows it
  as a card; `sourcePlatforms.test.ts` fails if the two disagree on a logo
  domain). Short or ambiguous labels go in `hosts` and `HOST_ONLY`.

## What counts as owned

`company_owned_domains.domain` holds one entry per row. It is either:

| Entry | Meaning |
| --- | --- |
| `careers.ford.com` | the host and its subdomains |
| `linkedin.com/company/ford-india` | that page and everything under it, on any LinkedIn country site |
| `linkedin.com/posts/ford-india_` | every post by that page (ends in `_`, `-` or `.`: plain string prefix) |
| `glassdoor.com/*-e152871` | `*` matches any run of characters; the match must end on a non-alphanumeric character, so employer 152871 and not 1528719 |

Matching is on the folded host and the lower-cased path; scheme, `www`,
query, fragment and trailing slash are ignored. A page entry never makes a
whole host owned. A bare platform entry (`linkedin.com`) makes the whole
platform owned, so do not add one.

The same entry is stored once per sibling company (Ford has about 30 company
rows), so the tools read the distinct set. `UNIQUE (company_id, domain)`
already stops repeats within one company.

## How a platform with owned pages is shown

Two lines: **"<Platform>: your pages and posts"** (owned) and **"<Platform>:
other"**. An answer can cite both, so the two lines overlap and their
percentages are never added.

## Coverage

Coverage of a merged or split line is the share of **answers** citing any
matching URL. Never add the percentages or counts of separate domains: one
answer often cites several of them (Ford India, Oct 2026: LinkedIn's hosts
add to about 60% but 49% of answers cite LinkedIn at all).

- A line of one host with no page rule: the domain cube count is exact.
- Any other line: `mcp_get_source_line_coverage` counts distinct answers in
  one company-scoped read (filters identical to `company_domain_stats_mv`, so
  the denominators match). TypeScript decides the grouping and sends the raw
  hosts and path rules; SQL only tests membership.
- If the union cannot be read (scope over about 15k answers, or the RPC
  fails) the tools list each host on its own with a note, never a sum. The
  quarterly email refuses to build instead.
- Citation share (share of links) may be used for source mix, labelled
  "share of links". It adds across a line's hosts but is not cut by page, so a
  split half has none.

## Load

One read per quarter per client for the email (two quarters for the change).
Ford Business Solutions India is about 1.1k answers a quarter. Tools read the
window once per call; scopes over about 15k answers skip it.

## Applying

`20261103090000_mcp_source_line_coverage.sql` is read-only and additive, and
migrations do not deploy from `main`. Apply it before the edge functions that
call it merge: without it the quarterly email build fails by design and the
tools fall back to per-host lines.
