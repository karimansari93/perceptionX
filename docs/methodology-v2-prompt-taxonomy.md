# Methodology v2 — Prompt Taxonomy Overhaul (16 → 13 attributes, candidate-voice prompts)

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
5. **`src/lib/onboarding/generateConfirmedPrompts.ts`** (~96–115, 164–190) — ⚠️ the NEW onboarding-forms path generates ONLY "General" prompts today. See §6 Phase 1 step 6 — this path must generate the v2 attribute matrix instead (import `generateAttributePrompts` from `@/config/attributes`), otherwise a company onboarded through it gets zero prompts once General is cut.

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

### E. Auto-following consumers — verify only, no edits expected
`AttributesSummaryCard.tsx`, `OverviewTab.tsx`, `useDashboardData.ts`, `ai-thematic-analysis(-bulk)`, `company-report(-text)`, `chat-with-data`, `collect-company-responses` (`isAttributePrompt` ~312), `_shared/attributePromptService.ts` — all read `attribute_id` generically and resolve names via the `ATTRIBUTES` registry. After the registry changes they follow automatically. **Check `validAttributeIds` filtering in ThematicAnalysisTab (~292):** once retired ids leave the registry, historical themes with old ids disappear from that view — acceptable for launch; Phase 3 adds the legacy remap for trend continuity.

---

## 4. Data handling & versioning rules

- **Never delete v1 rows.** Historical `confirmed_prompts` (v1) and their `prompt_responses`/`ai_themes` stay untouched for comparability.
- **Cutover per company = deactivate + insert:** set `is_active=false` on v1 attribute/base prompts; insert the v2 set (translated) with `prompt_version=2`. Collection scopes on `is_active=true`, so the next refresh collects v2 only.
- ⚠️ **Legacy NULL-id prompts:** thousands of older active prompts have `attribute_id IS NULL` and are identifiable only by `prompt_theme` (e.g. 'Rewards & Recognition', 'Social Impact') / `prompt_category='General'`. The Phase-2 deactivation must match on `attribute_id IN (v1 ids) OR (attribute_id IS NULL AND prompt_theme IN (v1 theme names)) OR (attribute_id IS NULL AND prompt_category='General' AND prompt_theme='General')` — scoped per company. Do NOT deactivate NULL-id rows by that rule alone without the per-company scope.
- **Translations:** the setup/expand paths already call `translate-prompts` — v2 texts flow through automatically for non-English markets. The Phase-2 migration must reuse that path (generate → translate → dedupe-insert), not raw-insert English.

---

## 5. Cost impact (for the commit message / stakeholder note)

Per combo: 68 → 52 prompts (−23%). Netflix org (~91 combos): ~6.1k → ~4.7k prompts; ~$140–190/mo off the OpenAI bill at current rates, with the same percentage off Perplexity/Google collection, recurring monthly, for every client. New client tomorrow starts at 52/combo from day one.

---

## 6. Execution phases

### Phase 1 — TONIGHT (must land before tomorrow's onboarding)
1. Branch off latest `main`. Apply §3-A/B/C/D code + migration changes. The three template copies must be identical in content.
2. `prompt_version=2` on every insert path touched.
3. Deploy edge functions: `process-company-batch-queue`, `admin-add-candidate-prompts`, and every function importing `_shared/theme-analysis.ts` (at minimum `ai-thematic-analysis`, `ai-thematic-analysis-bulk`). NOTE: MCP deploys of some functions have been blocked by a safety classifier before — fall back to `supabase functions deploy <fn> --project-ref ofyjvfmcgtntwamkubui` via CLI if that happens.
4. Apply the DB migration (prompt_version + MV rebuild) via `apply_migration`.
5. Frontend: build passes; dashboards render 13 attributes.
6. ⚠️ **OPEN DEPENDENCY — resolve with Karim before onboarding:** which path onboards tomorrow's company?
   - *Admin Company Setup / batch queue* → covered by steps 1–4.
   - *New Onboarding Forms flow* (`generateConfirmedPrompts.ts`) → that path currently emits ONLY General prompts, which v2 cuts. It must be extended to emit the 13×4 matrix (per-market translation included) before the company runs, or the company must be onboarded via the admin path instead. Ask Karim which; default to onboarding via the admin path if uncertain.
7. Smoke test: create a throwaway test company (1 location × 1 function) → expect exactly 52 active prompts, all `prompt_version=2`, correct ids/themes; run one collection chunk; confirm `ai_themes.attribute_id` comes back with v2 ids only; delete test company via `admin_delete_company`.

### Phase 2 — Existing orgs (this week, BEFORE the next org refresh)
1. Build `migrate-prompts-v2` admin edge function (service-role): per organization → per company × location × function combo: generate v2 set → translate → dedupe-insert (`prompt_version=2`) → deactivate v1 per §4 matching rules. **Dry-run mode first** (returns counts per org, writes nothing).
2. Order: dry-run all orgs → migrate one small org → verify dashboards → migrate Netflix → rest.
3. NOTE: the `monthly_auto_refresh` cron no longer exists in `cron.job` (verified July 5). Find out how refreshes are currently triggered (manual admin runs?) and ensure no refresh fires for an org mid-migration.

### Phase 3 — Follow-ups (not blocking)
1. Display-time "Overall Candidate Experience" rollup (avg of the 4 candidate attributes) if product wants the tile back — zero prompts.
2. Legacy trend continuity: apply `LEGACY_ATTRIBUTE_MAP` when reading historical `ai_themes` so old data appears under v2 tiles.
3. Marketing collateral: the client-facing tile graphic (sold deck) must be redone for 13 attributes — Karim owns this; not in repo.
4. Attribute score-weighting (importance weights per research %) — designed later; explicitly deferred by Karim.

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
