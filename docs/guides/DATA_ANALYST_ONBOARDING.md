# Data Analyst Onboarding

A practical guide to how PerceptionX collects data, how the edge functions fit
together, and what to do when you need a new one. Read this once end to end,
then come back to it as a reference.

Everything here describes the live system as it is in the repo. If something
you see in Supabase does not match this file, trust the code and flag the
difference to Karim.

---

## 1. What the system actually does

We ask AI assistants (ChatGPT, Perplexity, Google AI Mode, Google AI Overviews,
Gemini, DeepSeek) the kinds of questions a job candidate would ask about an
employer, then store and analyse what they say back.

One "unit of data" is a **response**: one AI model's answer to one prompt, for
one company, at one point in time. Everything on the dashboard (Visibility,
Sentiment, Relevance, sources, themes) is computed from those stored responses.

A company's prompt set is defined by four dimensions:

| Dimension | Example | Stored on the prompt as |
|---|---|---|
| Company | Netflix | `company_id` |
| Market / location | Germany | `location_context` |
| Industry | Streaming | `industry_context` |
| Job function | Engineering | `job_function_context` |

Those four dimensions are **peer data dimensions**, not separate companies.
Netflix in Germany and Netflix in Brazil are the same `companies` row with
different prompts. This matters: if you ever see two company rows for the same
employer in the same organization, that is a bug, not a setup choice.

There are four prompt types:

- **informational** - factual questions about the employer
- **experience** - what employees say about working there
- **competitive** - how the employer compares to others in its industry
- **discovery** - questions that do not name the company at all (used to test
  whether the employer surfaces unprompted)

---

## 2. The moving parts

```
Admin panel (React)
   |
   v
process-company-batch-queue      <- the orchestrator, works through a queue
   |
   |-- phase: setup               creates company + prompts
   |-- phase: llm_collection      collects responses, 2 prompts at a time
   |
   v
collect-company-responses        <- for each prompt, loops over the models
   |
   |--> test-prompt-openai        one function per AI model.
   |--> test-prompt-perplexity    each one takes a prompt, returns
   |--> test-prompt-gemini        text + citations.
   |--> test-prompt-google-ai-mode
   |--> ...
   |
   v
analyze-response                 <- writes the row into prompt_responses
   |
   v
ai-thematic-analysis             <- extracts themes (fire and forget)
   |
   v
Materialized views               <- refreshed by a background tick, not inline
   |
   v
Dashboard
```

Four things worth internalising from that diagram:

1. **Each AI model has its own tiny edge function.** They all do the same job:
   take a prompt, call the provider's API, hand back text and citations.
2. **`collect-company-responses` does not know how any model works.** It just
   calls `test-prompt-<model>` by name. That is why adding a model is easy.
3. **Nothing writes to `prompt_responses` except `analyze-response`.** One
   writer, one place to look when a row is wrong.
4. **Metrics are not recalculated during collection.** Landing responses bumps
   a watermark, and a background tick refreshes the affected materialized views
   within a few minutes. So a dashboard can legitimately lag collection by a
   few minutes. Do not panic, and do not refresh the views by hand.

---

## 3. Collecting data for a new company

This is the job you will do most often. It is all done from the admin panel.

### Step 0: before you start, get these three things

- **Company name**, spelled exactly as the client uses it. This becomes the
  entity we match on in every query afterwards, so a typo here is expensive.
- **Markets** to cover (countries).
- **Industry** and, optionally, **job functions**.

Confirm the scope with Karim before you queue anything. Collection costs real
money per response, and a wrong market list means paying twice.

### Step 1: open the batch tool

Go to `/admin?tab=company-batch` (Admin panel, **Company Batch** tab). You get
a card picker with six actions:

| Action | Use it when |
|---|---|
| **Add new company** | Brand new employer, nothing in the system yet |
| **Expand coverage** | Company exists, you are adding a market, industry or function |
| **Re-collect data** | Company and prompts exist, you want a fresh snapshot |
| **Collect single model** | One model failed or was added later, backfill just that one |
| **Bulk expand** | Several companies at once, each with different functions |
| **Analyze themes** | Responses exist but never got themes extracted |

For a new company, pick **Add new company**.

### Step 2: fill in the configuration

Enter the company name, then add locations, industries and job functions as
chips. The form autosaves after two seconds into `company_batch_configs`, so
you can close the tab and come back.

You also choose the organization: an existing one, or a new one to be created.
The organization is what links the company to the client's users. If the client
needs logins as well as data, follow `docs/guides/CLIENT_SETUP_GUIDE.md` for the
org, user and Pro subscription setup.

### Step 3: generate the queue

**Generate queue** builds one queue row per combination:

```
locations x industries x job functions = number of jobs
```

So 3 markets x 1 industry x 4 job functions = 12 jobs. Duplicates against the
existing queue are skipped automatically, so clicking it twice is safe.

Look at that number before you continue. If it is much bigger than you expected,
you have probably added a job function you did not mean to.

### Step 4: start collection

**Start Collection** invokes `process-company-batch-queue`. You can customise
which prompt types and which models to run before confirming. Defaults are all
four prompt types and all six models.

From here the queue is **self chaining**: each invocation does a small amount of
work, updates the queue row, and kicks off the next invocation. You do not need
to keep the browser open. The panel polls every 10 seconds while jobs are
processing.

### What happens inside each job

**Phase `setup`** (once per job):

1. Inserts a `user_onboarding` row for the job's cell.
2. Resolves the company. If a company with that name already exists in that
   organization, it reuses it. Otherwise it creates one. This is what stops
   twelve jobs creating twelve "Netflix" rows.
3. Generates the prompt set from the templates for that industry, location and
   function.
4. If the location is a non English speaking country, it calls
   `translate-prompts` and uses the translated wording.
5. Inserts the prompts into `confirmed_prompts`, deduplicated against anything
   already there.
6. Links the company to the organization via `organization_companies`.
7. Advances the job to `llm_collection`.

**Phase `llm_collection`** (repeats until done):

Processes **2 prompts per invocation** and advances a cursor (`batch_index`).
Two is deliberate and was measured: bigger chunks do not collect faster, they
just push a single invocation towards the 150 second edge function timeout.
Do not raise it without re running that measurement.

Each chunk calls `collect-company-responses`, which for every prompt and model:

- checks whether a response already exists (and skips if so),
- reuses a sibling company's answer if this is a **discovery** prompt that
  another company in the same org already asked this cycle (discovery prompts
  do not contain a company name, so the question is byte identical and asking
  twice is wasted money),
- otherwise calls `test-prompt-<model>`,
- passes the result to `analyze-response`, which stores it.

**Phase `done`**: the job is marked completed.

### Step 5: verify before you tell anyone it is finished

"Queue says completed" is not the same as "the data is good". Check all four:

```sql
-- 1. One company row, not several.
SELECT c.id, c.name, c.industry, c.created_at
FROM companies c
JOIN organization_companies oc ON oc.company_id = c.id
WHERE c.name = 'Company Name'
  AND length(c.name) >= 3;

-- 2. Prompts exist across every cell you queued.
SELECT location_context, industry_context, job_function_context,
       prompt_type, count(*)
FROM confirmed_prompts
WHERE company_id = 'COMPANY-UUID'
  AND is_active = true
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;

-- 3. Every model actually returned something.
--    A model with a much lower count than the others failed partway.
SELECT ai_model, count(*) AS responses, min(created_at), max(created_at)
FROM prompt_responses
WHERE company_id = 'COMPANY-UUID'
GROUP BY ai_model
ORDER BY responses;

-- 4. Themes were extracted. Responses with zero themes never got analysed.
SELECT count(*) AS responses,
       count(*) FILTER (WHERE t.response_id IS NULL) AS responses_without_themes
FROM prompt_responses pr
LEFT JOIN (SELECT DISTINCT response_id FROM ai_themes) t
       ON t.response_id = pr.id
WHERE pr.company_id = 'COMPANY-UUID';
```

If `responses_without_themes` is more than a handful, run **Analyze themes**
from the Company Batch tab to fill the gap.

Step 3 is the one that catches most problems. Uneven counts across models is
the single most common failure, and comparing models on incomplete collection
produces wrong findings. Gemini in particular has had collection leg failures
before. **Always check collection completeness per model before comparing
models.**

### If the queue gets stuck

The panel has four buttons and a watchdog behind it:

- **Retry failed** resets failed rows to pending.
- **Resume** revives cancelled rows and unsticks rows left in `processing` by a
  worker that died, then re invokes the processor.
- **Cancel** stops pending and processing rows.
- A **pg_cron watchdog runs every minute** and resets stalled jobs on its own.
  After three consecutive resets it gives up on a job and alerts Slack, so it
  cannot loop forever.

So a job sitting in `processing` for a couple of minutes is normal. One sitting
there for twenty minutes with no `batch_index` movement is not.

### Ongoing collection

You do not re queue monthly refreshes by hand. A pg_cron job runs on the **1st
of each month at 02:00 UTC** and, for every org with `auto_refresh_enabled`,
creates a config and queue rows to re collect every active combination. It
passes `skip_if_collected_in_month`, so a prompt is only re run if it has no
response *in that month*. Previously collected months are never touched.

---

## 4. How the edge functions work

Edge functions are small TypeScript files that run on Supabase's servers, in
Deno. They live in `supabase/functions/<function-name>/index.ts`. One folder is
one function, and the folder name is the URL:

```
https://<project>.supabase.co/functions/v1/<function-name>
```

Shared code lives in `supabase/functions/_shared/` (CORS headers, citation
extraction, country lookups, theme analysis, Google SERP helpers).

### The shape every function follows

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  // 1. Browsers send an OPTIONS preflight first. Always answer it.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Read the input.
    const { prompt } = await req.json()

    // 3. Read secrets from the environment, never from the repo.
    const apiKey = Deno.env.get('SOME_API_KEY')
    if (!apiKey) throw new Error('API key not configured')

    // 4. Do the work.

    // 5. Return JSON, always with CORS headers.
    return new Response(JSON.stringify({ response, citations }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    // 6. Errors need CORS headers too, or the browser shows a
    //    misleading CORS error instead of the real one.
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

Four rules that come out of that:

1. **Handle OPTIONS.** Skip it and the browser blocks the call.
2. **CORS headers on every response path, including errors.** Most "CORS
   errors" we have hit were not CORS problems at all, they were a crash or a
   gateway timeout returning a page without headers. See
   `docs/debug/DEBUG_CORS_EDGE_FUNCTIONS.md`.
3. **Secrets come from `Deno.env.get()`.** They are set in the Supabase
   dashboard under Edge Functions, never committed.
4. **Watch the 150 second timeout.** Anything longer has to be chunked and self
   chained, the way `process-company-batch-queue` does it.

### The functions you will touch most

| Function | What it does |
|---|---|
| `process-company-batch-queue` | Orchestrator. Owns the queue and its phases |
| `collect-company-responses` | Runs prompts across models for one company |
| `test-prompt-*` | One per AI model. Prompt in, text and citations out |
| `analyze-response` | The only writer to `prompt_responses`. Detects mentions and competitors, stores citations |
| `ai-thematic-analysis` | Extracts themes from a stored response |
| `translate-prompts` | Localises prompts for non English markets |
| `refresh-company-metrics` | Rebuilds a company's metric views |

### Deploying

```bash
supabase functions deploy <function-name> --project-ref ofyjvfmcgtntwamkubui
```

There is no CI pipeline for edge functions. A deploy is a manual, immediate,
production change. Which means:

- Deploy one function at a time and watch the logs after each one.
- The deployed version and the repo can drift. It has happened before: a fix
  was hotfixed straight into the deployed bundle and only adopted back into the
  repo two weeks later. If a function behaves in a way the source does not
  explain, check the deployed version in the dashboard before debugging the
  code.
- `scripts/deploy-edge-functions.sh` deploys a batch of them, but read it first,
  it is not always current.

### Reading logs

Supabase dashboard, Edge Functions, pick the function, Logs. The functions log
generously and with prefixes (`[BatchQueue]`, `[SharedPrompt]`), so filtering on
a company id or a prompt id usually gets you straight to the problem.

---

## 5. Adding a new function

### The common case: a new AI model

Say a new assistant matters to clients and we want to start measuring it.

**1. Copy the closest existing model function.** `test-prompt-perplexity` is the
simplest one to start from. Name the folder `test-prompt-<model>`. The name has
to match the model id exactly, because `collect-company-responses` builds the
URL as `` `test-prompt-${modelName}` ``.

**2. Honour the contract.** Every model function takes:

```json
{ "prompt": "the question text", "location_context": "Germany or null" }
```

and returns:

```json
{
  "response": "the model's answer as plain text",
  "citations": [
    { "url": "https://...", "domain": "glassdoor.com", "title": "...",
      "type": "website", "confidence": "high" }
  ]
}
```

`location_context` is only used by the Google functions for geo targeting. The
others ignore it. Return `citations: []` if the provider does not give sources,
never omit the key.

**3. Add the API key** as a secret in the Supabase dashboard and read it with
`Deno.env.get()`.

**4. Register the model in the admin UI.** Add it to `ALL_MODELS` in
`src/components/admin/batch/NewCompanyPanel.tsx`, and to the equivalent list in
the other batch panels you want it available in.

**5. Check whether `analyze-response` needs to know about it.** It decides how
to treat citations per model. Look at the `citations:` block in
`collect-company-responses/index.ts` and add your model id if its citations
should be passed through the same way.

**6. Test on one prompt before you queue anything.** Call the function directly,
confirm the shape of the response, then use **Collect single model** on one
company to check a real row lands in `prompt_responses`.

**7. Deploy** `test-prompt-<model>`, then `collect-company-responses` and
`analyze-response` if you changed them.

### A new function that is not a model

Same skeleton, plus three questions:

- **Who calls it?** The frontend (via `supabase.functions.invoke`), another edge
  function (via `fetch`), or pg_cron?
- **Can it finish in 150 seconds?** If not, chunk it with a cursor and self
  chain, following `process-company-batch-queue`.
- **Does it write to the database?** If it writes to `prompt_responses`, stop
  and talk to Karim first. That table has exactly one writer by design.

### If you need a schema change

Never edit an existing migration. Create a new timestamped file in
`supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`. One off
investigation SQL goes in `scripts/`, not in migrations.

---

## 6. Rules that are not negotiable

1. **Supabase is read only for you** unless Karim explicitly says otherwise in
   that conversation. Reads and verification queries, yes. Inserts, updates,
   deletes and schema changes, only on instruction.
2. **Found a data problem? Flag it, do not fix it.** Bad entity matches,
   duplicate companies, redirect wrappers in citations. Describe it to Karim
   rather than patching it inline. An inline fix hides how widespread the
   problem was.
3. **Every figure that reaches a client comes from a query you ran.** Not from
   memory, not from a previous deck, not estimated. Keep the query and its
   result next to the number so it can be re run and so Andy can sign it off.
   Andy signs off anything with a number in it before it goes out.
4. **Client data is confidential per client.** Never use one client's data,
   names or findings in work for another client, or in anything public.
5. **In client facing work, percentages only.** No raw response, prompt or
   mention counts. Source prominence is coverage (percentage of responses),
   never citation share.
6. **Never name competitors to clients**, and never name competitor vendors in
   marketing copy.
7. **Never fabricate or rewrite timestamps.** If a month is missing, it is
   missing, and that is the finding.

---

## 7. First week checklist

- [ ] Access to the Supabase project, the admin panel and the repo
- [ ] Read `docs/guides/CLIENT_SETUP_GUIDE.md` (organizations, users, Pro)
- [ ] Read `docs/DASHBOARD_DATA_ARCHITECTURE.md` (how the dashboard reads data)
- [ ] Skim `supabase/functions/collect-company-responses/index.ts` top to bottom.
      It is 478 lines and it is the clearest single explanation of the pipeline
- [ ] Set up a test company in a non client organization and run one small
      collection (one market, one industry, one model) start to finish
- [ ] Run the four verification queries in section 3 against it
- [ ] Deliberately break something in your test company (cancel mid queue) and
      practise resuming it

---

## 8. Where to look when something is wrong

| Symptom | Start here |
|---|---|
| Queue stuck in `processing` | `company_batch_queue` row, `batch_index` and `error_log`, then the `process-company-batch-queue` logs |
| One model has far fewer responses | That `test-prompt-*` function's logs. Usually a rate limit or an API key |
| Response exists but no themes | `ai-thematic-analysis` logs. It is fire and forget, so failures are silent |
| Dashboard shows nothing for a new company | Wait a few minutes for the metrics tick, then check `docs/debug/WHY_RESPONSES_MISSING_FROM_PROMPTS_TAB.md` |
| Sentiment or relevance blank on a location filter | `docs/debug/DEBUG_SENTIMENT_METRICS.md` |
| "CORS error" in the browser | Almost never CORS. `docs/debug/DEBUG_CORS_EDGE_FUNCTIONS.md` |
| Duplicate company rows | Stop and flag to Karim. Do not merge them yourself |

When you are stuck for more than an hour, ask. Every problem in this list has
been hit before and there is usually someone who remembers the answer faster
than the logs will tell you.
