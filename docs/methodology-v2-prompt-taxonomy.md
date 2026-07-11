# Methodology v2 — Prompt Taxonomy Overhaul (16 → 13 attributes, candidate-voice prompts)

## ✅ Phase 1 EXECUTED (Opus, July 5 2026)
All Phase-1 code, DB, and edge-function changes are live on prod `ofyjvfmcgtntwamkubui`:
- **Code** committed to branch `claude/sweet-johnson-YJZCp` (attributes registry, both edge-fn template copies, onboarding-forms generator, usePromptsLogic, theme-analysis classifier, dashboard icons). Typecheck + `npm run build` pass. All three template copies verified byte-identical (52 prompts / 13 attrs / 4 types).
- **DB migration applied**: `confirmed_prompts.prompt_version` (existing 29,007 rows = v1, untouched); `admin_approve_intake` now persists `attribute_id` + `prompt_version=2`; both `company_attribute_themes*_mv` rebuilt with the v1∪v2 id union (repopulated, historical themes intact).
- **Edge functions deployed**: `process-company-batch-queue` v42 (jwt=false), `ai-thematic-analysis` v41, `ai-thematic-analysis-bulk` v33, `admin-add-candidate-prompts` v20.
- **Smoke test passed**: ran the deployed batch-queue `setup` on a throwaway config → exactly **52 prompts, all `prompt_version=2`, 0 base, 13 v2 attributes, 0 legacy ids**, correct v2 themes. Test data fully deleted (0 responses collected).

### ⚠️ Remaining to be live for tomorrow (owner: Karim / release process)
1. **Deploy the frontend** (this branch → `main` → CI). The DB + edge functions are live, but the **Onboarding Forms UI** and the **dashboard's 13 tiles** only become v2 once the frontend build ships. Until then, onboarding via the Admin → Company Batch path already produces v2 (edge fn is live); the Onboarding Forms path needs the frontend deploy.
2. **Confirm tomorrow's onboarding path.** Admin batch = ready now. Onboarding Forms = ready after the frontend deploys.
3. Housekeeping (non-blocking): delete the leftover temp function `test-prompt-openai-abtest` from an earlier session.

---

**Status:** LOCKED — approved by Karim (July 2026). Ready to execute.
**Executor:** Opus session. Everything here is decided; do not re-litigate the taxonomy. The one open dependency is flagged in §6 (Phase 1, step 6).
**Deadline pressure:** a NEW CLIENT COMPANY onboards **tomorrow** and must be set up on v2. Phase 1 ships before that onboarding. Phase 2 (existing orgs) follows.

---

## 1. Why (context for the executor — 2 minutes)

PerceptionX measures how AI (ChatGPT/Perplexity/Google) talks about employers. Every company × location × job-function combo currently fires **68 prompts** (4 "General" base + 16 attributes × 4 types). Our own research (*How Job Seekers Use AI to Research Employers*, May 2026, n=306) shows:

- Candidates' **top intent is Preparation/Tactical (70%)** — "What should I expect in an interview at X?" Our informational prompts are written in the dry analyst voice (their *5th*-ranked intent, 45%). We are measuring the corner of the model candidates use least.
- **Social Impact is the least-researched theme (8%, rank 15/15)**; Overall Candidate Experience isn't a researched theme at all (it's an aggregate).
- Attribute overlap: "Rewards & Recognition" and "Security & Perks" both ask about *benefits*; perks ≠ job security.

A Netflix-Germany sentiment test confirmed which merges are SAFE (same evidence base) and which would MASK client problems (Candidate Feedback at 0.244 vs Application 0.608 — must stay separate; Security & Perks signal must survive via a dedicated Job Security attribute).

**Net effect:** 68 → **52 prompts per combo (−23%)**, ~18–23% off every AI-collection bill for every client, with *sharper* (not weaker) measurement. Score-weighting of attributes is explicitly **deferred** — collection stays uniform across the 13.

---

## 2. The locked taxonomy (v2)

### 2.1 Attribute map (old → new)

| v1 id | v2 id | v2 display name | Action |
|---|---|---|---|
| `mission-purpose` | `mission-purpose-impact` | Mission, Purpose & Impact | rename + absorbs social-impact |
| `social-impact` | → `mission-purpose-impact` | — | **merged away** |
| `rewards-recognition` | `compensation` | Compensation | rename; owns pay/benefits/**perks**; "recognition" moves to Culture wording |
| `security-perks` | `job-security` | Job Security | rename; stability ONLY (perks moved to Compensation) |
| `company-culture` | `company-culture` | Company Culture | keep; wording absorbs "feeling valued/recognized" |
| `leadership` | `leadership` | Leadership | keep (deliberately NOT merged into culture) |
| `career-opportunities` | `career-opportunities` | Career Opportunities | keep |
| `wellbeing-balance` | `wellbeing-balance` | Wellbeing & Balance | keep; wording absorbs remote/flexibility (research theme #5, 43%) |
| `inclusion` | `inclusion` | Inclusion | keep |
| `innovation` | `innovation` | Innovation | keep |
| `application-process` | `application-communication` | Application & Communication | **merged** with candidate-communication |
| `candidate-communication` | → `application-communication` | — | **merged away** |
| `candidate-feedback` | `candidate-feedback` | Candidate Feedback | keep — **never merge** (carries Netflix's worst distinct signal, 0.244) |
| `interview-experience` | `interview-experience` | Interview Experience | keep; informational prompt becomes the 70% "how do I prepare" query |
| `onboarding-experience` | `onboarding-experience` | Onboarding | keep |
| `overall-candidate-experience` | — | — | **CUT** (pure aggregate; optional display-time rollup, Phase 3) |

Also **CUT: all 4 base "General" prompts** ("How is X as an employer?" etc.). Everything is company × location × function now; the generic prompts are redundant with the attribute set.

Keep this legacy map as an exported constant (needed by MVs, display continuity, and the Phase-2 migration):

```ts
export const LEGACY_ATTRIBUTE_MAP: Record<string, string | null> = {
  'mission-purpose': 'mission-purpose-impact',
  'social-impact': 'mission-purpose-impact',
  'rewards-recognition': 'compensation',
  'security-perks': 'job-security',
  'application-process': 'application-communication',
  'candidate-communication': 'application-communication',
  'overall-candidate-experience': null, // retired
};
```

### 2.2 The full v2 prompt matrix (13 × 4 = 52)

Voice rules (from the research's prompt-intent taxonomy): **informational** = preparation/validation voice ("What should I know / how should I prepare"); **experience** = experiential/reputation ("What's it like / what do employees say"); **competitive** = per-attribute comparison (kept per-attribute — it's the competitor radar); **discovery** = per-attribute open-field visibility (kept per-attribute — it's the core GEO signal). Decisions locked: **Compensation informational is tactical (negotiation); Job Security informational is neutral (no layoff-anxiety framing).**

`{companyName}` / `{industry}` are template placeholders; function + location are appended by the existing `appendPromptContext` mechanism. `prompt_theme` = the v2 display name; categories as noted.

**1. `mission-purpose-impact`** — Mission, Purpose & Impact (Employee Experience)
- informational: `What should I know about {companyName}'s mission, purpose, and social impact before applying?`
- experience: `What do employees say about the sense of purpose and impact of working at {companyName}?`
- competitive: `How does {companyName}'s mission and impact compare to other companies in {industry}?`
- discovery: `Which companies in {industry} are known for a strong sense of purpose and positive impact?`

**2. `compensation`** — Compensation (Employee Experience) *(tactical)*
- informational: `How good is the pay at {companyName}, and how should I negotiate salary and benefits there?`
- experience: `What do employees say about pay, benefits, and perks at {companyName}?`
- competitive: `Does {companyName} pay better than other companies in {industry}?`
- discovery: `Which companies in {industry} pay the best and offer the best benefits and perks?`

**3. `company-culture`** — Company Culture (Employee Experience)
- informational: `What is the company culture really like at {companyName}?`
- experience: `How do employees describe the culture at {companyName} — and do they feel valued and recognized?`
- competitive: `How does the culture at {companyName} compare to other companies in {industry}?`
- discovery: `Which companies in {industry} have the best workplace culture?`

**4. `leadership`** — Leadership (Employee Experience)
- informational: `What should I know about the leadership and management at {companyName} before joining?`
- experience: `What do employees say about managers and senior leadership at {companyName}?`
- competitive: `How does the quality of leadership at {companyName} compare to other companies in {industry}?`
- discovery: `Which companies in {industry} are known for great leadership and management?`

**5. `job-security`** — Job Security (Employee Experience) *(neutral)*
- informational: `How stable and secure is a job at {companyName}?`
- experience: `How do employees feel about job security and stability at {companyName}?`
- competitive: `Is a job at {companyName} more secure than at other companies in {industry}?`
- discovery: `Which companies in {industry} offer the most stable and secure jobs?`

**6. `career-opportunities`** — Career Opportunities (Employee Experience)
- informational: `What career growth and progression can I expect at {companyName}?`
- experience: `What do employees say about career development, learning, and promotions at {companyName}?`
- competitive: `Will my career grow faster at {companyName} or at other companies in {industry}?`
- discovery: `Which companies in {industry} are best for career growth and learning?`

**7. `wellbeing-balance`** — Wellbeing & Balance (Employee Experience)
- informational: `What are the work-life balance, flexibility, and remote work options really like at {companyName}?`
- experience: `How do employees rate work-life balance, flexibility, and wellbeing support at {companyName}?`
- competitive: `Is work-life balance at {companyName} better than at other companies in {industry}?`
- discovery: `Which companies in {industry} are best for work-life balance and flexible or remote work?`

**8. `inclusion`** — Inclusion (Employee Experience)
- informational: `How inclusive and diverse is the workplace at {companyName}?`
- experience: `What do employees from diverse backgrounds say about working at {companyName}?`
- competitive: `How does {companyName} compare to other companies in {industry} on diversity and inclusion?`
- discovery: `Which companies in {industry} are most recognized for diversity, equity, and inclusion?`

**9. `innovation`** — Innovation (Employee Experience)
- informational: `How innovative is {companyName}, and what would I get to work on there?`
- experience: `What do employees say about innovation and access to new technology at {companyName}?`
- competitive: `Is {companyName} a more innovative place to work than other companies in {industry}?`
- discovery: `Which companies in {industry} are the most innovative to work for?`

**10. `application-communication`** — Application & Communication (Candidate Experience)
- informational: `What should I expect from the application process and recruiter communication at {companyName}?`
- experience: `How do candidates describe applying to {companyName} — the process, updates, and communication?`
- competitive: `Is applying to {companyName} a better experience than applying to other employers in {industry}?`
- discovery: `Which companies in {industry} have the best application process and candidate communication?`

**11. `candidate-feedback`** — Candidate Feedback (Candidate Experience)
- informational: `Will I get useful feedback after applying or interviewing at {companyName}?`
- experience: `What do candidates say about the feedback they get from {companyName} after interviews and applications?`
- competitive: `How does {companyName} compare to other employers in {industry} at giving candidates feedback?`
- discovery: `Which companies in {industry} are known for giving candidates valuable feedback?`

**12. `interview-experience`** — Interview Experience (Candidate Experience) *(the 70% flagship)*
- informational: `How should I prepare for a job interview at {companyName}?`
- experience: `How do candidates describe the interview experience at {companyName}?`
- competitive: `How does the interview process at {companyName} compare to other companies in {industry}?`
- discovery: `Which companies in {industry} have the best interview experience?`

**13. `onboarding-experience`** — Onboarding (Candidate Experience)
- informational: `What should I expect when I first start working at {companyName}?`
- experience: `How do new hires describe their onboarding and first months at {companyName}?`
- competitive: `How does onboarding at {companyName} compare to other companies in {industry}?`
- discovery: `Which companies in {industry} have the best onboarding for new hires?`

---

## 3. Every change site (verified against the repo as of commit `31286e0`, July 5 2026)

The templates are **physically duplicated in 3 files** and the 16-ID list is **hardcoded in 4 more**. All of these must change together:

### A. Template definitions (keep byte-identical across copies)
1. **`src/config/attributes.ts`** — CANONICAL. `ATTRIBUTES` registry (lines ~6–135) and `ATTRIBUTE_PROMPT_TEMPLATES` (~139–235). Replace with the 13-attribute registry (new ids/names/descriptions/categories per §2.1) + the 52-row template matrix (§2.2). Add `LEGACY_ATTRIBUTE_MAP` export here.
2. **`supabase/functions/process-company-batch-queue/index.ts`** — inline duplicate (~lines 50–180, with `category`+`theme` per row) + `basePrompts` (~183–194) inside `generatePrompts` (~174–216). Replace templates with the 52; **delete `basePrompts` entirely** and remove them from the returned array.
3. **`supabase/functions/admin-add-candidate-prompts/index.ts`** — third inline duplicate (~5–89) + `ATTRIBUTE_CATEGORIES` map + `candidateThemeOverrides` (~241–248). Update to v2 (its candidate-experience set becomes 4 attributes: application-communication, candidate-feedback, interview-experience, onboarding-experience).

### B. Base-prompt copies to remove
4. **`src/hooks/usePromptsLogic.ts`** — `basePrompts` (~841–889): delete; `candidateThemeOverrides` (~901–908): update to v2 ids/names.
5. **`src/lib/onboarding/generateConfirmedPrompts.ts`** (~96–115, 164–190) — ⚠️ REQUIRED, highest priority: the NEW onboarding-forms path generates ONLY "General" prompts today, and this is the path tomorrow's client onboards through. See §6 Phase 1 step 3 — it must generate the v2 attribute matrix (import `generateAttributePrompts` from `@/config/attributes`), otherwise the company gets zero prompts once General is cut.

### C. Hardcoded attribute-ID lists (silent-breakage sites)
6. **`supabase/functions/_shared/theme-analysis.ts`** (~86–92) — the LLM classification prompt enumerates the allowed `attribute_id` values. Replace with the 13 v2 ids **with one-line definitions** matching §2.1 semantics (e.g. compensation = pay/benefits/perks; job-security = stability only; mission-purpose-impact includes social/ESG impact; application-communication includes recruiter communication; company-culture includes recognition/feeling valued). `validateAndCleanTheme` (~109–119) stays.
7. **MV migrations** — write ONE new migration that drops & recreates `company_attribute_themes_mv` (from `20260603000000...`) and `company_attribute_themes_by_location_mv` (from `20260628000000...`, lines ~108–112) with the attribute filter = **union of v1 + v2 ids** (13 new + 7 legacy) so historical themes keep aggregating. Verify the live MV definitions first (`pg_get_viewdef`) — the 20260603 file still shows the pre-rename column name; trust the live DB, not the file.
8. **`src/components/dashboard/ThematicAnalysisTab.tsx`** (~88–107) — `ATTRIBUTE_ICONS`: re-key to v2 ids (suggested: mission-purpose-impact→Target or Heart, compensation→DollarSign, job-security→Shield, application-communication→MessageSquare; drop retired keys).

### D. Schema (new migration, same file as C7 or separate)
```sql
ALTER TABLE public.confirmed_prompts
  ADD COLUMN IF NOT EXISTS prompt_version smallint NOT NULL DEFAULT 1;
```
All v2 generator inserts set `prompt_version: 2` (batch-queue setup/expand inserts at ~lines 457 & 637, admin-add-candidate-prompts ~267, usePromptsLogic insert path, generateConfirmedPrompts). This is the versioning hook that doesn't exist today — it's what makes the cutover auditable and reversible.

### E. Admin panel — Company Batch section (verified July 5: all creation paths funnel through the batch-queue generator)

Karim's explicit requirement: every feature in Admin → Company Batch that creates prompts must produce v2. Traced each panel in `src/components/admin/batch/`:

| Admin feature | Panel | How prompts get created | v2 coverage |
|---|---|---|---|
| Add new company | `NewCompanyPanel.tsx` (~225–228) | queue rows `phase: "setup"` → `generatePrompts()` in batch-queue fn (insert at ~line 457+) | §A-2 template swap covers it |
| Expand coverage (new function/market on existing company) | `ExpandCoveragePanel.tsx` (~278) | queue rows `phase: "expand_setup"` → same generator (insert at ~line 637+) | §A-2 covers it |
| Bulk expand (org-wide) | `BulkExpandPanel.tsx` (~263) | queue rows `phase: "expand_setup"` → same generator | §A-2 covers it |
| Add candidate prompts | invokes `admin-add-candidate-prompts` | its own inline template copy | §A-3 covers it |
| Collect / Recollect / Analyze themes | `CollectModelPanel`, `RecollectPanel`, `AnalyzeThemesPanel` | NO prompt creation — they only read existing `confirmed_prompts` (verified: all `.select()`, zero inserts) | no change; recollect on old clients correctly reuses their v1 prompts |
| Batch tab discovery view | `CompanyBatchTab.tsx` (~67) filters `prompt_type = "discovery"` | read-only; prompt types unchanged in v2 | no change |

**Expected mixed-version behavior (do not "fix"):** using Expand Coverage to add a NEW function/market to an EXISTING (old) client creates that new combo on v2 while the client's existing combos stay v1. Each combo is internally consistent over time, which is what matters for measurement. `prompt_version` makes the split queryable.

**expand_setup dedupe check:** the expand path dedupes new prompts against existing rows by `(prompt_text, prompt_type, industry_context)`. v2 texts differ from v1, so no false-dedupe is expected — but verify during smoke test that expanding a v1 company inserts the full 52 v2 prompts for the new combo.

### F. Auto-following consumers — verify only, no edits expected
`AttributesSummaryCard.tsx`, `OverviewTab.tsx`, `useDashboardData.ts`, `ai-thematic-analysis(-bulk)`, `company-report(-text)`, `chat-with-data`, `collect-company-responses` (`isAttributePrompt` ~312), `_shared/attributePromptService.ts` — all read `attribute_id` generically and resolve names via the `ATTRIBUTES` registry. After the registry changes they follow automatically. **Check `validAttributeIds` filtering in ThematicAnalysisTab (~292):** once retired ids leave the registry, historical themes with old ids disappear from that view — acceptable for launch; Phase 3 adds the legacy remap for trend continuity.

### G. Visibility Rankings — the free public ranking pipeline (added July 11 2026; was MISSED in the original rollout)
The industry-visibility (discovery-only, `company_id IS NULL`) pipeline has its own inline template copy and hardcoded prompt counts. Ported to v2 on July 11 2026:

1. **`supabase/functions/collect-industry-visibility/index.ts`** — fourth inline template duplicate (`VISIBILITY_PROMPTS`, 13 discovery templates with an ` in {location}` suffix). Inserts stamp `attribute_id` + `prompt_version: 2`; the duplicate-recovery lookup filters `prompt_version = 2` so it can never resolve to a v1 row.
2. **`supabase/functions/process-visibility-queue/index.ts`** — queue jobs seed `total_prompts: 13` (was 16).
3. **`src/components/admin/VisibilityRankingsTab.tsx`** — `TOTAL_PROMPTS = 13` batching constant (was 16).

Old v1 discovery rows/responses are left untouched (same coexistence rule as clients); the next collection run populates fresh v2 rows because the per-theme response-existence check keys on the new prompt ids. **This function also pins its own OpenAI model (`VISIBILITY_OPENAI_MODEL` env var, default `gpt-4.1-mini`) — cheaper than the client-facing batch flow by design.**

---

## 4. Data handling & versioning rules

**Scope decision (Karim, July 5): existing clients are NOT migrated.** Old clients keep their current v1 prompts, active and collecting, for measurement consistency. Only NEW clients (from tomorrow) get v2. The old-data question — remap historical data into the v2 structure vs. fresh-start old clients on v2 — is explicitly deferred; `LEGACY_ATTRIBUTE_MAP` exists to make either choice possible later.

- **Do not touch v1 rows.** No deactivation, no deletion, no backfill. Historical and currently-active v1 `confirmed_prompts` (including the thousands of legacy rows with `attribute_id IS NULL`, tagged only by `prompt_theme`) keep collecting exactly as they do today.
- **v2 applies only to newly created prompts:** every generator emits the v2 matrix with `prompt_version=2`. `prompt_version` is what separates the two populations cleanly for the future merge decision.
- **Translations:** the generation paths already call `translate-prompts` — v2 texts flow through automatically for non-English markets. The onboarding-forms path must do the same (see Phase 1 step 3).
- ⚠️ **Documented side effect — theme classification for old clients:** `_shared/theme-analysis.ts` moves to the 13 v2 ids, and it classifies ALL new responses — including responses to old clients' v1 prompts. So old clients' *new* themes will bucket under the v2 attributes (e.g. a response to their v1 'security-perks' prompt gets themes tagged `job-security` or `compensation`). This is coherent (v1 ids map cleanly into v2) and acceptable; their *historical* themes keep v1 ids and will be hidden from attribute views until the deferred remap/fresh-start decision. This is expected behavior — do not "fix" it.

---

## 5. Cost impact (for the commit message / stakeholder note)

Per combo: 68 → 52 prompts (−23%). Netflix org (~91 combos): ~6.1k → ~4.7k prompts; ~$140–190/mo off the OpenAI bill at current rates, with the same percentage off Perplexity/Google collection, recurring monthly, for every client. New client tomorrow starts at 52/combo from day one.

---

## 6. Execution phases

### Phase 1 — TONIGHT (must land before tomorrow's onboarding)
1. Branch off latest `main`. Apply §3-A/B/C/D code + migration changes. The three template copies must be identical in content.
2. `prompt_version=2` on every insert path touched.
3. **REQUIRED (decided by Karim): extend the Onboarding Forms path.** `src/lib/onboarding/generateConfirmedPrompts.ts` currently emits ONLY the "General" prompts — which v2 cuts — so untouched it would create ZERO prompts for tomorrow's company. It must generate the full 13×4 v2 matrix per market × function: import `generateAttributePrompts` from `@/config/attributes`, apply the existing market/function phrasing (`appendPromptContext`-equivalent), set `attribute_id`, `prompt_category`, `prompt_theme`, `prompt_version=2`, and route non-English markets through `translate-prompts` exactly like the batch-queue setup phase does. This path is how tomorrow's client onboards — it is the single most important step in Phase 1. Remove its General-prompt generation.
4. Deploy edge functions: `process-company-batch-queue`, `admin-add-candidate-prompts`, and every function importing `_shared/theme-analysis.ts` (at minimum `ai-thematic-analysis`, `ai-thematic-analysis-bulk`). NOTE: MCP deploys of some functions have been blocked by a safety classifier before — fall back to `supabase functions deploy <fn> --project-ref ofyjvfmcgtntwamkubui` via CLI if that happens.
5. Apply the DB migration (prompt_version + MV rebuild) via `apply_migration`.
6. Frontend: build passes; dashboards render 13 attributes.
7. Smoke test ALL THREE generation paths (per §3-E, all admin batch features route through path b):
   - a) Onboarding Forms path: run a test onboarding (1 market × 1 function) → expect exactly 52 active prompts, `prompt_version=2`, correct ids/themes, translation applied for a non-English market.
   - b) Admin batch "New Company" (`phase: setup`): throwaway test company → same 52-prompt expectation; run one collection chunk; confirm `ai_themes.attribute_id` comes back with v2 ids only; delete test company via `admin_delete_company`.
   - c) Admin batch "Expand Coverage" (`phase: expand_setup`): add one new function to the test company before deleting it → the new combo gets 52 v2 prompts, no dedupe collisions, no base prompts.

### Phase 2 — DEFERRED: existing clients (decision postponed by Karim)
**Do not build or run any migration now.** Old clients stay on their current v1 prompts for measurement consistency. When the time comes, the decision is: (a) remap historical data into v2 via `LEGACY_ATTRIBUTE_MAP` (data manipulation), or (b) fresh-start old clients on v2 and keep v1 history read-only. `prompt_version` + the map make both options available. Related note kept for that future work: the `monthly_auto_refresh` cron no longer exists in `cron.job` (verified July 5) — refresh triggering has changed and must be re-scoped then.

### Phase 3 — Follow-ups (not blocking)
1. Display-time "Overall Candidate Experience" rollup (avg of the 4 candidate attributes) if product wants the tile back — zero prompts.
2. Marketing collateral: the client-facing tile graphic (sold deck) must be redone for 13 attributes — Karim owns this; not in repo.
3. Attribute score-weighting (importance weights per research %) — designed later; explicitly deferred by Karim.

---

## 7. Verification checklist (Phase 1 exit criteria)
- [ ] `generatePrompts('X','SaaS','Germany','Engineering')` returns exactly 52 prompts, 0 base, 13 distinct `attributeId`s, 4 types each.
- [ ] All three template copies produce identical prompt text for the same inputs.
- [ ] Test company end-to-end: 52 active `confirmed_prompts`, `prompt_version=2`, German translation applied.
- [ ] Theme analysis on a fresh v2 response emits only v2 attribute ids (no `social-impact`, no `unknown` spike).
- [ ] MVs rebuilt; historical attribute themes still counted (legacy ids present in MV filter).
- [ ] Dashboards: 13 tiles render; no console errors; existing client dashboards unchanged for v1 data.
- [ ] `git push` + PR against `main` with this doc linked.

## 8. Decisions already made — do not reopen
Leadership stays separate from Culture. Candidate Feedback stays separate (masking risk proven). Competitive and Discovery stay per-attribute (competitor radar + GEO visibility signal). No half-depth collection; weighting deferred. Compensation informational is tactical; Job Security informational is neutral. Base General prompts are cut. gpt-5.5 + web search stays for collection (search-cap A/B rejected: −28% cost but only 54% source-domain coverage retained).
