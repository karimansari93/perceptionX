# Build brief: an Actions tab on the dashboard

Goal: every client user sees the actions PerceptionX set out for them, scoped to the markets they look after, with the same wording as the report, and can take ownership and mark progress. One register (Supabase) feeds the report, the quarterly email, Ask AI and this tab, so they never disagree.

This brief is the task spec for a fresh session. Read it fully before touching code. Audited 2026-10-26.

## 0. Starting point

- Branch off `main`. Netlify builds production from `main`; nothing ships until merged. Edge functions deploy from `main` automatically (`.github/workflows/deploy-edge-functions.yml`), but this brief needs no function change.
- Read first, in this order:
  - `docs/CLIENT_KNOWLEDGE_BASE.md` and `docs/REPORT_KNOWLEDGE_PROMPT.md` (what the register is and how it is loaded)
  - `supabase/migrations/20261014072531_client_knowledge_base.sql` (columns, constraints, RLS, the admin RPC)
  - `supabase/migrations/20261014074000_thermofisher_q3_2026_knowledge.sql` (a complete loaded report, the shape of every field)
  - `supabase/functions/_shared/px-tools/executors-report.ts` (how Ask AI reads and labels the same rows; copy its label maps)
  - `supabase/functions/_shared/digest/payload.ts`, the `filterActions` function (how the email picks actions for a reader's markets; the tab must pick the same ones)
  - `src/pages/Dashboard.tsx` (sections, `SECTION_TITLES`, the skeleton switch, how `reports` is wired)
  - `src/components/AppSidebar.tsx` (`navigationGroups`), `src/App.tsx` (routes `/dashboard/*`)
  - `src/components/dashboard/CustomReports.tsx` (a self-contained section component: `useCompany`, direct Supabase reads, shadcn UI)
  - `src/contexts/CompanyContext.tsx` (`useCompany`: `currentCompany.organization_id`, membership `role`, platform admin "view as organisation")
  - `src/components/dashboard/LocationFilter.tsx`, `src/hooks/useProfileSetup.ts` (`default_location_context`: the user's saved market view)
  - `src/components/admin/OrganizationManagementTab.tsx` (where an admin control for publishing would sit)
- Repo checks a contributor runs: `npm run test` (vitest), `npx tsc --noEmit`, `npm run lint` (ESLint has a pre-existing config crash on this repo; note it, do not fix it here), `npm run build`.

## 1. What exists today

### Tables (project `ofyjvfmcgtntwamkubui`, schema `public`)

`company_actions`, one row per action or watch item:

| Column | Meaning | Values |
|---|---|---|
| `organization_id`, `company_id` | tenancy | |
| `key` | stable id, `<cycle>:<nn>` or `<cycle>:watch-<slug>` | |
| `register` | which list | `act_now` (a numbered action), `watch`, `regional` (legacy), `retired` |
| `editorial_status` | how the report carried it | `new`, `carried`, `overdue`, `retired` |
| `period_label`, `cycle_raised` | the report it was raised in | `Q4 2026`, `2026-10-01` |
| `action_number` | number printed in the report | integer, null for watch items |
| `title` | imperative title | |
| `problem` | the report's "Why" | |
| `ai_says` | what AI says, one sentence | |
| `ai_reads` | where AI reads it | `[{source, market, coverage_pct, url}]` |
| `urls` | exact pages to act on | text[] |
| `recommendation` | the report's "What to do" | |
| `lanes` | `business`, `owned`, `people` | text[] |
| `timing` | `act_now`, `act_next`, `act_later` | |
| `lifts` | what it should move | `[{metric, attribute, market}]` |
| `markets`, `functions` | tracked spellings from `confirmed_prompts.location_context` / `job_function_context`; empty = organisation-wide | text[] |
| `owner_name` | owner as agreed in the report (free text) | |
| `assignee_id`, `assigned_by`, `assigned_at` | in-app owner (a user) | |
| `work_status` | the client owner's own assertion | `open`, `in_progress`, `done` |
| `asserted_done_at/by`, `assertion_note`, `assertion_url` | set when the owner marks done | |
| `tracking_status` | PerceptionX's verdict, admin-set | `open`, `in_progress`, `done`, `stalled`, `escalated`, `retired` |
| `verified_facts` | `[{fact, checked_on}]` | |
| `notes` | success measure, worth, Amplify link, status narrative | free text |
| `work_kind`, `source_name`, `source_domain`, `proof_status` | classification | |
| `published_at` | null = invisible to clients | |

`company_action_checks`, one row per action per cycle: `cycle`, `checked_on`, `status`, `metric_readings` `[{metric, attribute, market, value_pct, metric_status}]`, `verified_facts`, `note`. The first row is the baseline; later rows are the quarterly re-check. This is the progress history.

`client_report_snapshots`, one row per organisation per cycle per report type: `scope`, `headline`, `metric_status`, `breakdowns`, `as_of`, `source_report_name`, `published_at`.

### Access (RLS, already in place)

- Clients can `SELECT` their own organisation's rows only when `published_at IS NOT NULL` (`is_org_member(organization_id)`). Platform admins (`is_admin()`) see everything. There is no client `INSERT`, `UPDATE` or `DELETE` on any of the three tables.
- Client writes go through two SECURITY DEFINER RPCs:
  - `assign_company_action(p_action_id, p_assignee_id)`: a member can claim an unowned action for themselves; an org owner/admin or platform admin can assign anyone in the organisation, or unassign with null.
  - `set_company_action_status(p_action_id, p_status, p_note, p_url)`: `open`, `in_progress`, `done`; only the assignee, an org owner/admin or a platform admin. `done` stores the note and URL as the owner's assertion.
- Admin write: `admin_update_company_action(p_action_id, p_tracking_status, p_owner_name, p_notes)`, platform admins only.
- There is no RPC to publish. Rows are published by the load migration (`published_at = now()`). See section 4.

### Data in the register right now

| Organisation | Rows | Published | Shape |
|---|---|---|---|
| Thermo Fisher Scientific | 4 numbered actions + 2 watch items, cycle `2026-09-01` | yes | the reference shape |
| Ford Motor Company | 17 numbered actions across cycles `2026-04-01`, `2026-07-01`, `2026-10-01`, loaded 2026-10-26; 13 check rows | **no** | see section 4 for fixes before publishing |
| Netflix | 21 rows from July 2026 | yes | legacy: no `action_number`, `register` includes `regional`; show them but expect gaps |

### Who reads it today

- Ask AI: `get_report_actions` in `executors-report.ts`.
- Quarterly email: `filterActions` in `_shared/digest/payload.ts` keeps `published`, `register` not `retired`/`watch`, `action_number` set, `tracking_status` not `done`/`retired`, and markets overlapping the reader's view or empty. The tab's default view should match this, with filters to widen it.
- Nothing in the dashboard yet. There is no existing Actions component to reuse.

## 2. What to build

### 2.1 Navigation

- Sidebar: add `{ title: "Actions", icon: ListChecks, section: "actions", group: "dashboard", route: "/dashboard/actions" }` to the Dashboard group after Themes.
- Route `/dashboard/actions` in `App.tsx` rendering `<Dashboard defaultGroup="dashboard" defaultSection="actions" />`, same wrappers as the other dashboard routes.
- `Dashboard.tsx`: add `actions: "Actions"` to `SECTION_TITLES`, a skeleton case, and a section block that mounts `<ActionsTab />` like `reports` does. Keep the header's location filter active for this section (unlike `reports`) and pass `selectedLocation`, `locationOptions` and the resolved market spellings into the tab.

### 2.2 `src/components/dashboard/ActionsTab.tsx`

Data:
- Read `company_actions` for `currentCompany.organization_id` (RLS returns published rows only), `company_action_checks` for the same organisation, and the latest `client_report_snapshots` row for the "as of" line. Use react-query like the rest of the dashboard; one fetch per organisation, filtered client-side.
- Markets filter: default to the header's selected location (resolve it to tracked spellings the way `filterActions` does: an action matches when any of its `markets` equals a selected market, case-insensitive, or its `markets` is empty). "All markets" shows everything. A user's saved view (`profiles.default_location_context`) is what the header already defaults to, so the market owner lands on their own actions.
- Status filter: Open (default: `tracking_status` in open, in_progress, stalled, escalated), Done, Retired, All. Watch items in their own collapsed group under the actions.
- Order: `timing` (Act now, Act next, Act later, none), then `action_number`.

Card (mirror the report's action card so the client recognises it):
- Header: number badge (`05`), title, timing pill, lanes as small tags, market list (the report shows flags; a plain list is fine).
- "Why": `problem`. "What AI says": `ai_says`. "Where AI reads it": each `ai_reads` entry as `source · market · coverage_pct%` with a link to `url` when present; `urls` as a list of links.
- "What to do": `recommendation`.
- "Owner": `owner_name` and, if set, the assignee's name from `organization_members` joined to `profiles`.
- "Success and worth": the `notes` text as written (it carries "Success by Q1 2027: ..." and "Worth: ..."; render as one paragraph; if the notes contain an Amplify link, render it as a link labelled "Share with employees").
- "Progress": the `company_action_checks` rows for the action, newest first: cycle, status, each `metric_readings` entry as `metric (attribute), market: value_pct%` with "provisional" when `metric_status` says so, and the note.
- Status strip: PerceptionX status (`tracking_status`) read-only; the owner's status (`work_status`) as a control (see 2.3).

Empty state: "No actions have been published for your organisation yet. They appear here after your report is delivered." Never show unpublished rows (RLS prevents it; do not use the service role anywhere in the app).

### 2.3 Ownership and progress (client side)

- "Take ownership" calls `assign_company_action(action.id, auth.uid())` when `assignee_id` is null. Org owners and admins (`useCompany` membership role `owner` or `admin`) get a member picker instead, calling the same RPC with the chosen user id, and can unassign.
- Status control (Open, In progress, Done) calls `set_company_action_status`. Marking Done opens a small dialog for a note and a URL of the published change, which the RPC stores. Only the assignee or an org owner/admin sees the control; everyone else sees the status as text.
- Toast on success and failure, using the RPC's error message (they are written for users).

### 2.4 Admin (platform admins only)

In `OrganizationManagementTab.tsx`, next to the Members table, add an "Actions" panel for the organisation: the full register including unpublished rows, with `admin_update_company_action` for tracking status, owner name and notes, and a Publish button per cycle. Publishing needs a new RPC (section 4). Admins see the client tab too through "view as organisation".

### 2.5 Copy rules (hard)

- Percentages only. Never render raw counts of answers, mentions or prompts, even if a note contains one.
- No em dashes anywhere in UI copy.
- Never name another PerceptionX client. The register is per organisation, so this holds if you never mix organisations.
- Amplify wording stays compliance-safe: "Share with employees", never anything about selecting positive reviews.
- Labels: `act_now` = "Act now", `act_next` = "Act next", `act_later` = "Act later"; lanes `business` = "Business", `owned` = "Owned", `people` = "People"; statuses as in `executors-report.ts` (`in_progress` = "in progress").

## 3. Acceptance

- Sidebar shows Actions; `/dashboard/actions` loads for a Thermo Fisher member and shows 4 actions and 2 watch items; a Netflix member sees the legacy rows without crashes (missing numbers, `regional`).
- Market filter: selecting Germany on Thermo Fisher shows actions 01 and 03 only; "All markets" shows all four.
- A member can take ownership of an unowned action and move it to In progress; a second member cannot change it; an org admin can reassign it.
- Unpublished rows are never visible to a member (verify with a Ford member before Ford is published).
- `npm run test`, `npx tsc --noEmit` and `npm run build` pass. Add vitest coverage for the market matcher and the ordering, and a component test for the empty state.
- Screenshots of the tab at desktop and phone width in the PR.

## 4. Data work that must happen first or alongside (needs Karim's approval, Supabase is read-only otherwise)

1. **Publish RPC.** Add `admin_publish_company_actions(p_organization_id uuid, p_cycle text)` (SECURITY DEFINER, `is_admin()` only) that sets `published_at = now()` where null for that organisation and cycle, and the matching snapshot row. Commit it as a migration. Until it exists, publishing stays in the load file.
2. **Ford rows.** Before publishing Ford:
   - `company_action_checks.cycle` for Ford is stored as `Q4 2026`; Thermo Fisher uses `2026-10-01` style. Standardise on `YYYY-MM-01` (update the 13 Ford check rows) so progress sorts and the email and Ask AI compare like with like.
   - Action numbering: the Q4 2026 report prints "Claim the local review profiles that doubled" as 05; the register has it as `2026-10-01:04`. Confirm the report's numbering and fix `key` and `action_number` so the tab shows the number the client has in the deck.
   - Ford has no `client_report_snapshots` row for Q4 2026; add it for the "as of" line.
   - Several Q2 and Q3 titles carry "original report wording to confirm" in notes; confirm or strip that phrase before publishing, since notes render on the card.
3. **Netflix legacy rows.** Either back-fill `action_number` and `cycle_raised` from the July 2026 report or accept gaps in the UI. Do not delete them.

## 5. Out of scope

- Writing or editing actions from the client UI (actions come from reports only).
- Changing the email or Ask AI. Both already read the register; keep their filter semantics and reuse them.
- The score-band labels (a separate open decision).
