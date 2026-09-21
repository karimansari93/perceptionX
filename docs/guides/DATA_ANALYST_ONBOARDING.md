# Data Analyst Onboarding

How PerceptionX works, from asking an AI assistant a question to putting a
number in front of a client. Read sections 1 to 4 end to end before you touch
anything. Sections 5 onwards are reference you will come back to.

Everything here describes the live system as it is in the repo. If something
you see in Supabase does not match this file, trust the code and flag the
difference to Karim.

---

## 1. What the business actually does

Candidates increasingly ask an AI assistant about an employer before they
apply. They ask ChatGPT what it is like to work at a company, whether the pay
is good, whether people stay. The assistant answers with confidence, and that
answer shapes whether someone applies. Nobody was measuring those answers.

That is what we sell. We measure how AI assistants describe an employer to
candidates, across three metrics: **Visibility**, **Sentiment** and
**Relevance**. Clients use it to find out where they are invisible, where they
are described badly, and which sources the AI is leaning on when it answers.

Everything in this repo exists to produce those three numbers defensibly, and
to show the evidence behind them.

---

## 2. The whole journey, end to end

There are five stages. Most of your work will be in stages 1 and 5, but you
cannot do either well without understanding 2, 3 and 4.

```
   1. COLLECT            2. ANALYSE           3. AGGREGATE
   ask the models        label what           roll up into
   the questions         came back            metrics
        |                     |                    |
        v                     v                    v
   prompt_responses  -->  ai_themes         -->  materialized
   (raw answers +         (themes +              views
    citations)            sentiment)             (the 3 metrics)
                          company_mentioned
                          detected_competitors
                          url_recency_cache
                                                      |
                                                      v
                                          4. SURFACE      5. REPORT
                                          dashboard,      decks, briefs,
                                          in-app chat,    client emails
                                          MCP server      (you + Karim + Andy)
                                          public Index
```

### Stage 1: Collect

We write a set of questions (prompts) for an employer, then ask each AI model
each question and store the answer verbatim.

A **prompt** is one question, scoped to four dimensions: company, market,
industry and job function. A **response** is one model's answer to one prompt
at one point in time. Responses are the atom of everything else.

Prompts come in four types, and the type matters because it changes what the
response can tell us:

| Type | What it asks | What it is good for |
|---|---|---|
| `informational` | Factual questions about the employer | Does the model know the company at all |
| `experience` | What employees say about working there | Sentiment about day to day reality |
| `competitive` | How the employer compares to others in its industry | Sentiment and relative standing |
| `discovery` | A question that never names the company | Whether the employer surfaces unprompted |

Discovery is the one people misread. It deliberately does not mention the
client. "What are the best streaming companies to work for in Germany?" If the
client does not appear in the answer, that is the finding.

Responses land in `prompt_responses`. That table holds the raw answer text and
the citations the model gave, and nothing is ever recomputed from a summary.
Everything downstream can be rebuilt from it.

### Stage 2: Analyse

Raw text is not measurable. Three things get extracted from every response:

**Was the company mentioned?** `analyze-response` sets the
`company_mentioned` boolean and records `detected_competitors`. This one field
is the entire basis of Visibility.

**What was said, and was it positive?** `ai-thematic-analysis` reads the
response and emits rows into `ai_themes`: one row per theme found, each with a
`sentiment` label (positive, negative or neutral), a canonical attribute
(`attribute_name` / `talentx_attribute_name`), keywords and the snippet of
text it came from. This is the basis of Sentiment, and of all theme reporting.

Theme extraction is **fire and forget**. `analyze-response` triggers it and
does not wait. So a failure is silent, and a response can exist with no themes
attached. This is why "Analyze themes" is a button in the admin panel, and why
checking for theme gaps is part of your verification routine.

**How fresh are the sources it cited?** `extract-recency-scores` takes every
cited URL, works out its publication date (URL patterns, page metadata,
Firecrawl, YouTube and Reddit APIs), and caches a recency score in
`url_recency_cache`. This is the basis of Relevance.

### Stage 3: Aggregate

The three metrics are computed in materialized views, not at read time. A
dashboard query reads a pre-computed rollup.

Two things you must know about this layer:

**Metrics do not update instantly.** Landing responses bumps a watermark, and
a background tick refreshes the affected views within a few minutes. A
dashboard lagging a finished collection by a few minutes is normal. Do not
refresh the views by hand to chase it.

**Three models are excluded from every client-facing number.** As of the July
2026 methodology change, `claude`, `gemini` and `deepseek` are filtered out of
every rollup. Their rows stay in `prompt_responses` and `ai_themes` as the
audit trail for numbers we published before that change. So a raw count from
`prompt_responses` will not match the dashboard, and that is correct, not a
bug. If you query the base tables directly for a client figure, you have to
apply the same filter yourself.

### Stage 4: Surface

The same rollups feed four surfaces: the client dashboard (Overview, Prompts,
Sources, Thematic Analysis, Competitors tabs), the in-app chat, the MCP server
that lets a client point their own AI assistant at their data, and the public
Index. The public Index is built only from responses flagged `for_index`, and
it uses its own tables (`rankings_overview`, `rankings_historical`,
`company_search_index`). **Never touch those for client work**, and never use
them as a source for a client figure.

### Stage 5: Report

This is where a number stops being data and becomes a claim to a client. The
workflow is fixed, and it is not optional:

1. **Pre-flight verification.** Run the SQL, in its own conversation, and
   verify every single figure the report will use.
2. **Agree the copy in chat** before anything is built.
3. **Build** separately, pasting in the verified figures. Never recompute from
   memory.
4. **Karim** does the final visual review.
5. **Andy signs off anything containing a number** before it reaches a client.

Keep the query and its result next to every figure so anyone can re run it.
That is the whole point: a client can ask "where does 62% come from" and the
answer is a query, not a recollection.

---

## 3. The three metrics, precisely

Get these exactly right. A plausible-sounding wrong definition is the most
expensive mistake available to you, because nobody catches it until a client
does.

### Visibility

> Of the responses in scope, what share mentioned the company?

```
visibility = mentioned_responses / total_responses
```

From `company_mentioned` on `prompt_responses`, rolled up in
`company_visibility_by_location_mv`. Excludes the three filtered models, and
excludes the "overall candidate experience" attribute.

It answers: does the AI know this employer exists, and bring them up.

### Sentiment

> Of the polarised things said, what share were positive?

```
sentiment = positive_themes / (positive_themes + negative_themes)
```

From the **text labels** in `ai_themes.sentiment`, rolled up in
`company_sentiment_scores_mv`. Three traps:

- **Neutral themes are excluded from the score.** They are still counted in the
  composition columns, so `positive / total` gives a different, wrong number.
- **`avg_sentiment_score` is internal only.** It exists on the rollups for
  prioritisation. It never appears in a dashboard, report or the Index.
- The live rollups pool themes from **all prompt types**. A prompt type filter
  you may see in older notes was removed in prod.

### Relevance

> How fresh are the sources the AI leaned on?

The average recency score of the cited URLs, over responses where the company
was mentioned and citations exist. Recency is a step function of publication
age:

| Published within | Score |
|---|---|
| 30 days | 100 |
| 3 months | 90 |
| 6 months | 80 |
| 1 year | 70 |
| 2 years | 50 |
| 3 years | 30 |
| 5 years | 20 |
| 10 years | 10 |
| older | 0 |

Alongside it, `citation_coverage_percentage` is the share of cited URLs we
could actually date. A low coverage percentage means the relevance score rests
on a thin sample, and you should say so rather than quoting the score flat.

Relevance is the metric clients find least intuitive. The pitch is: if the AI
is answering about your employer brand using a 2019 Glassdoor thread, that is a
fixable problem, and it is invisible without this measurement.

### Themes and sources

Not headline metrics, but most of what makes a report interesting.

**Themes** aggregate on `talentx_attribute_name`, the canonical cluster. Never
aggregate on `theme_name`, which is near free text and will fragment the same
idea across a dozen labels.

**Sources** come from `canonical_citations`, the verified citation layer.
Source prominence is always **coverage**, the percentage of responses a source
appeared in. It is never citation share. Owned versus third-party is decided
by matching against `company_owned_domains` in application logic, not with
`LIKE` patterns in ad hoc SQL.

---

## 4. Where the data lives

| Table or view | What is in it |
|---|---|
| `companies` | One row per employer. Identity is name plus organization |
| `organizations`, `organization_companies` | Client accounts, and which companies they own |
| `confirmed_prompts` | The configured questions, with their four dimensions |
| `prompt_responses` | One row per model answer. The raw record everything rebuilds from |
| `ai_themes` | Themes extracted per response, with sentiment labels |
| `canonical_citations` | The verified citation layer. Use this for sources |
| `company_owned_domains` | Which domains an employer owns |
| `url_recency_cache` | Publication date and recency score per cited URL |
| `company_*_mv` | The rollups the dashboard reads |
| `company_batch_configs`, `company_batch_queue` | Collection jobs and their state |
| `rankings_overview`, `rankings_historical`, `company_search_index` | Public Index only. Not for client work |

A company's identity is **name plus organization, and nothing else**. Market,
industry and job function are peer data dimensions that live on the prompts.
Netflix in Germany and Netflix in Brazil are one `companies` row with different
prompts. If you ever see two rows for the same employer in one organization,
that is a bug. Flag it, do not merge them yourself.

---

## 5. How the collection machinery fits together

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
```

Three things worth internalising:

1. **Each AI model has its own small edge function.** They all do the same job:
   take a prompt, call the provider's API, hand back text and citations.
2. **`collect-company-responses` does not know how any model works.** It calls
   `test-prompt-<model>` by name. That is why adding a model is easy.
3. **Nothing writes to `prompt_responses` except `analyze-response`.** One
   writer, one place to look when a row is wrong.

---

## 6. Collecting data for a new company

This is the job you will do most often. It is all done from the admin panel.

### Step 0: before you start

Get the **company name** spelled exactly as the client uses it (it becomes the
entity we match on in every query afterwards, so a typo here is expensive), the
**markets**, the **industry**, and optionally the **job functions**.

Confirm the scope with Karim before you queue anything. Collection costs real
money per response, and a wrong market list means paying twice.

### Step 1: open the batch tool

Go to `/admin?tab=company-batch`. You get six actions:

| Action | Use it when |
|---|---|
| **Add new company** | Brand new employer, nothing in the system yet |
| **Expand coverage** | Company exists, you are adding a market, industry or function |
| **Re-collect data** | Company and prompts exist, you want a fresh snapshot |
| **Collect single model** | One model failed or was added later, backfill just that one |
| **Bulk expand** | Several companies at once, each with different functions |
| **Analyze themes** | Responses exist but never got themes extracted |

For a new company, pick **Add new company**.

### Step 2: configure

Enter the company name, then add locations, industries and job functions as
chips. The form autosaves after two seconds into `company_batch_configs`, so
you can close the tab and come back.

You also choose the organization: an existing one, or a new one to be created.
The organization is what links the company to the client's users. If the client
needs logins as well as data, follow `docs/guides/CLIENT_SETUP_GUIDE.md`.

### Step 3: generate the queue

**Generate queue** builds one queue row per combination:

```
locations x industries x job functions = number of jobs
```

3 markets x 1 industry x 4 job functions = 12 jobs. Duplicates are skipped, so
clicking twice is safe. Look at that number before continuing. If it is much
bigger than you expected, you have added a job function you did not mean to.

### Step 4: start collection

**Start Collection** invokes `process-company-batch-queue`. You can customise
prompt types and models first. Defaults are all four types and all six models.

From here the queue is **self chaining**: each invocation does a little work,
updates the queue row, and kicks off the next one. You do not need to keep the
browser open. The panel polls every 10 seconds while jobs are processing.

**Phase `setup`** (once per job) inserts an onboarding row, resolves or creates
the company (reusing an existing one in that organization, which is what stops
twelve jobs creating twelve "Netflix" rows), generates the prompt set,
translates it if the market is not English speaking, inserts the prompts, and
links the company to the organization.

**Phase `llm_collection`** processes **2 prompts per invocation** and advances a
cursor. Two is deliberate and was measured: bigger chunks do not collect
faster, they just push a single invocation towards the 150 second edge function
timeout. Do not raise it without re running that measurement.

Each chunk calls `collect-company-responses`, which for every prompt and model
skips anything already collected, reuses a sibling company's answer if this is
a discovery prompt another company in the same org already asked this cycle
(discovery prompts contain no company name, so the question is byte identical
and asking twice is wasted money), otherwise calls `test-prompt-<model>`, then
passes the result to `analyze-response`.

### Step 5: verify before telling anyone it is finished

"Queue says completed" is not "the data is good". Check all four.

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

-- 4. Themes were extracted. Responses with none never got analysed.
SELECT count(*) AS responses,
       count(*) FILTER (WHERE t.response_id IS NULL) AS responses_without_themes
FROM prompt_responses pr
LEFT JOIN (SELECT DISTINCT response_id FROM ai_themes) t
       ON t.response_id = pr.id
WHERE pr.company_id = 'COMPANY-UUID';
```

Query 3 catches most problems. Uneven counts across models is the single most
common failure, and comparing models on incomplete collection produces wrong
findings. Gemini in particular has had collection leg failures before.
**Always check completeness per model before comparing models.**

If query 4 shows more than a handful without themes, run **Analyze themes**.

### If the queue gets stuck

**Retry failed** resets failed rows to pending. **Resume** revives cancelled
rows and unsticks rows left in `processing` by a worker that died. **Cancel**
stops pending and processing rows. Behind them, a **pg_cron watchdog runs every
minute** and resets stalled jobs on its own, giving up after three consecutive
resets and alerting Slack so it cannot loop forever.

A job in `processing` for a couple of minutes is normal. One sitting there for
twenty minutes with no `batch_index` movement is not.

### Ongoing collection

You do not re queue monthly refreshes by hand. A pg_cron job runs on the **1st
of each month at 02:00 UTC** and, for every org with `auto_refresh_enabled`,
queues a re collection of every active combination. It passes
`skip_if_collected_in_month`, so a prompt is only re run if it has no response
*in that month*. Previously collected months are never touched.

---

## 7. How the edge functions work

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

Four rules follow from that:

1. **Handle OPTIONS.** Skip it and the browser blocks the call.
2. **CORS headers on every response path, including errors.** Most "CORS
   errors" we have hit were not CORS problems, they were a crash or a gateway
   timeout returning a page without headers. See
   `docs/debug/DEBUG_CORS_EDGE_FUNCTIONS.md`.
3. **Secrets come from `Deno.env.get()`**, set in the Supabase dashboard, never
   committed.
4. **Watch the 150 second timeout.** Anything longer must be chunked and self
   chained, the way `process-company-batch-queue` does it.

### The functions you will touch most

| Function | What it does |
|---|---|
| `process-company-batch-queue` | Orchestrator. Owns the queue and its phases |
| `collect-company-responses` | Runs prompts across models for one company |
| `test-prompt-*` | One per AI model. Prompt in, text and citations out |
| `analyze-response` | The only writer to `prompt_responses`. Detects mentions and competitors, stores citations |
| `ai-thematic-analysis` | Extracts themes from a stored response |
| `extract-recency-scores` | Dates cited URLs, feeding Relevance |
| `translate-prompts` | Localises prompts for non English markets |
| `refresh-company-metrics` | Rebuilds a company's metric views |
| `company-report`, `company-report-text` | Generate client report data |

### Deploying

```bash
supabase functions deploy <function-name> --project-ref ofyjvfmcgtntwamkubui
```

There is no CI pipeline for edge functions. A deploy is a manual, immediate,
production change. Which means:

- Deploy one function at a time and watch the logs after each one.
- The deployed version and the repo can drift. It has happened: a fix was
  hotfixed straight into a deployed bundle and only adopted back into the repo
  two weeks later. If a function behaves in a way the source does not explain,
  check the deployed version in the dashboard before debugging the code.
- `scripts/deploy-edge-functions.sh` deploys a batch, but read it first, it is
  not always current.

### Reading logs

Supabase dashboard, Edge Functions, pick the function, Logs. The functions log
generously and with prefixes (`[BatchQueue]`, `[SharedPrompt]`), so filtering
on a company id or prompt id usually gets you to the problem.

---

## 8. Adding a new function

### The common case: a new AI model

**1. Copy the closest existing function.** `test-prompt-perplexity` is the
simplest to start from. Name the folder `test-prompt-<model>`. The name must
match the model id exactly, because `collect-company-responses` builds the URL
as `` `test-prompt-${modelName}` ``.

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

`location_context` is only used by the Google functions for geo targeting; the
others ignore it. Return `citations: []` if the provider gives no sources,
never omit the key.

**3. Add the API key** as a secret in the Supabase dashboard, read via
`Deno.env.get()`.

**4. Register the model in the admin UI.** Add it to `ALL_MODELS` in
`src/components/admin/batch/NewCompanyPanel.tsx`, and the equivalent lists in
the other batch panels.

**5. Check whether `analyze-response` needs to know about it.** It treats
citations differently per model. See the `citations:` block in
`collect-company-responses/index.ts`.

**6. Decide whether it belongs in client-facing metrics.** This is the step
people forget. The rollups currently exclude `claude`, `gemini` and `deepseek`
by name. A new model is included by default, which means it will silently move
every client's numbers the moment it starts collecting. **Talk to Karim before
a new model reaches a client-facing rollup.**

**7. Test on one prompt first.** Call the function directly, check the response
shape, then use **Collect single model** on one company and confirm a real row
lands in `prompt_responses`.

**8. Deploy** `test-prompt-<model>`, then `collect-company-responses` and
`analyze-response` if you changed them.

### A function that is not a model

Same skeleton, plus three questions:

- **Who calls it?** The frontend (`supabase.functions.invoke`), another edge
  function (`fetch`), or pg_cron?
- **Can it finish in 150 seconds?** If not, chunk it with a cursor and self
  chain, following `process-company-batch-queue`.
- **Does it write to the database?** If it writes to `prompt_responses`, stop
  and talk to Karim. That table has exactly one writer by design.

### Schema changes

Never edit an existing migration. Create a new timestamped file in
`supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`. One off
investigation SQL goes in `scripts/`, not in migrations.

---

## 9. Rules that are not negotiable

1. **Supabase is read only for you** unless Karim explicitly says otherwise in
   that conversation. Reads and verification, yes. Inserts, updates, deletes
   and schema changes, only on instruction.
2. **Found a data problem? Flag it, do not fix it.** Bad entity matches,
   duplicate companies, redirect wrappers in citations. Describe it to Karim
   rather than patching it inline. An inline fix hides how widespread it was.
3. **Every figure that reaches a client comes from a query you ran.** Not from
   memory, not from a previous deck, not estimated. Keep the query next to the
   number. Andy signs off anything with a number before it goes out.
4. **Client data is confidential per client.** Never use one client's data,
   names or findings in work for another client, or anywhere public.
5. **Percentages only in client work.** No raw response, prompt or mention
   counts. Source prominence is coverage, never citation share.
6. **Never name competitors to clients**, and never name competitor vendors in
   marketing copy.
7. **Never fabricate or rewrite timestamps.** If a month is missing, it is
   missing, and that is the finding.
8. **Respect methodology breaks.** Where the methodology changed between
   cycles, only rank comparisons are valid across the break, not absolute
   scores. A sentiment movement that coincides with a methodology change is not
   reputation movement, and must never be presented as one.

---

## 10. First week checklist

- [ ] Access to the Supabase project, the admin panel and the repo
- [ ] Read `docs/guides/CLIENT_SETUP_GUIDE.md` (organizations, users, Pro)
- [ ] Read `docs/DASHBOARD_DATA_ARCHITECTURE.md` (how the dashboard reads data)
- [ ] Skim `supabase/functions/collect-company-responses/index.ts` top to
      bottom. It is 478 lines and the clearest single explanation of the pipeline
- [ ] Open a client dashboard and, for one number on it, trace it all the way
      back to the responses behind it. Do this before you produce any figure
      yourself
- [ ] Set up a test company in a non client organization and run one small
      collection (one market, one industry, one model) end to end
- [ ] Run the four verification queries in section 6 against it
- [ ] Deliberately break it (cancel mid queue) and practise resuming

---

## 11. Where to look when something is wrong

| Symptom | Start here |
|---|---|
| Queue stuck in `processing` | `company_batch_queue` row, `batch_index` and `error_log`, then the `process-company-batch-queue` logs |
| One model has far fewer responses | That `test-prompt-*` function's logs. Usually a rate limit or an API key |
| Response exists but no themes | `ai-thematic-analysis` logs. Fire and forget, so failures are silent |
| Dashboard shows nothing for a new company | Wait a few minutes for the metrics tick, then `docs/debug/WHY_RESPONSES_MISSING_FROM_PROMPTS_TAB.md` |
| Sentiment or relevance blank on a location filter | `docs/debug/DEBUG_SENTIMENT_METRICS.md` |
| My SQL count does not match the dashboard | Almost always the excluded models. Apply the filter |
| "CORS error" in the browser | Almost never CORS. `docs/debug/DEBUG_CORS_EDGE_FUNCTIONS.md` |
| Duplicate company rows | Stop and flag to Karim. Do not merge them yourself |

When you are stuck for more than an hour, ask. Every problem in this list has
been hit before, and someone usually remembers the answer faster than the logs
will tell you.
