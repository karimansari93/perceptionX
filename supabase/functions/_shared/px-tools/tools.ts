// ─── px-tools: tool definitions ─────────────────────────────────────────────
// One registry serving both surfaces:
//   * chat-with-data passes `input_schema` to the Anthropic Messages API
//   * mcp-server maps them to MCP tools/list entries (name/title/inputSchema/
//     annotations)
// Descriptions are written for a HOST model that has never seen our system
// prompt (the MCP case): each carries its own usage guidance and caveats.
// Presentation rules baked in: periods are MEASURED quarters (collection
// waves — an unlisted calendar quarter is not a gap), percentages lead and
// raw counts sit under sample_size, change is in percentage points vs the
// previous measured period, and copy says what's included — the tracked AI
// platforms — never what's excluded.
// `progressLabel` renders the streaming status line in the in-app chat and
// doubles as the MCP `title`.
//
// ChatGPT plugin-guideline compliance: every tool is a side-effect-free read
// of the caller's own organization data, so all carry
// readOnlyHint/idempotentHint = true and openWorldHint/destructiveHint =
// false. No tool requests conversation context or location beyond the
// explicit market filter the user asked about.

export interface PxToolDef {
  name: string;
  progressLabel: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// All px-tools are read-only, idempotent, closed-world (they touch nothing
// outside the caller's own PerceptionX organization data).
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const companyIdProp = { type: 'string', description: 'The company UUID (from list_companies)' };
const locationProp = {
  type: 'string',
  description: "Optional market filter, e.g. 'India', 'Germany', 'Japan'. Matched against the organization's tracked markets; if the market isn't tracked, the tool says so and lists what is.",
};
const jobFunctionProp = {
  type: 'string',
  description: "Optional job-function filter, e.g. 'Finance', 'Manufacturing', 'Human Resources', 'engineering'. Matched against the organization's tracked job functions (common shorthand like 'HR' resolves); if the function isn't tracked, the tool says so and lists what is. Without it, figures span every job function.",
};
const quartersBackProp = (dflt: number) => ({
  type: 'number',
  description: `How many of the most recent MEASURED quarters to include (default ${dflt}, max 8). Data is collected in waves, so this counts quarters that have data — never calendar quarters — and every returned period is complete.`,
});
const includeSiblingsProp = {
  type: 'boolean',
  description: 'Aggregate the brand scope — this company plus same-name market profiles in the organization (default true; matches the dashboard). Set false to isolate this one profile.',
};

const PERIOD_SHARE_NOTE = 'Results carry _meta.periods (every measured quarter in the window) and lead with percentages; raw counts are under sample_size and are context only.';

export const PX_TOOLS: PxToolDef[] = [
  {
    name: 'list_companies',
    progressLabel: 'Looking up companies',
    description: "List all companies/market profiles in the user's organization. Always call this first if you don't already know the company IDs. Returns id, name, country, industries, latest_period (the profile's most recent measured quarter), measured_periods (how many quarters have data) and total_responses (a size cue for choosing a profile). Same-name profiles are one brand measured per market; the other tools aggregate them like the dashboard.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_company_overview',
    progressLabel: 'Loading company overview',
    description: `The dashboard's default view in one call: for the LATEST measured quarter of the brand scope — EPS, positive-sentiment %, visibility %, relevance, and change in points vs the previous measured period — plus the top attributes by % of answers discussing them, top themes, top competitors and top sources (each as % of answers). Use this as your default first tool when a user asks how a company is doing. For history use get_trends; for a market use the market-aware tools. ${PERIOD_SHARE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, include_siblings: includeSiblingsProp },
      required: ['company_id'],
    },
  },
  {
    name: 'get_company_metrics',
    progressLabel: 'Fetching metrics',
    description: 'Just the scorecard for the latest measured quarter: EPS, positive-sentiment %, visibility %, relevance, change in points vs the previous measured period, and sample sizes. EPS = 50% sentiment + 30% visibility + 20% relevance. Numbers match the dashboard (brand scope by default).',
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, include_siblings: includeSiblingsProp },
      required: ['company_id'],
    },
  },
  {
    name: 'get_responses',
    progressLabel: 'Reading AI responses',
    description: "Get actual AI answer texts for one company profile, newest first. Essential for qualitative questions like 'what do AI platforms say about X', 'how is the culture described', 'what are the negatives'. Returns the answer text, which AI platform wrote it, sentiment, the prompt asked and the period. Filter by prompt_type for focused analysis.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        limit: { type: 'number', description: 'Max responses to return (default 15, max 50)' },
        prompt_type: { type: 'string', description: "Optional filter: 'informational' (basic facts), 'experience' (culture/work experience), 'competitive' (vs competitors), 'discovery' (would you recommend). Leave empty for all types." },
        ai_model: { type: 'string', description: "Optional filter by AI platform, e.g. 'openai' (ChatGPT), 'perplexity', 'google-ai-overviews', 'google-ai-mode'." },
        sentiment_filter: { type: 'string', description: "Optional filter: 'positive', 'negative', 'neutral'" },
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_themes',
    progressLabel: 'Analyzing themes',
    description: `Recurring themes extracted from AI answers in the latest measured quarter(s): each theme with the % of answers mentioning it, its positive-sentiment %, the attributes it belongs to and which AI platforms raised it — plus an attribute summary (% of answers discussing each attribute, sentiment %, change vs the previous measured period). For a market-specific view prefer get_attribute_themes. ${PERIOD_SHARE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, quarters_back: quartersBackProp(1), include_siblings: includeSiblingsProp },
      required: ['company_id'],
    },
  },
  {
    name: 'get_attribute_breakdown',
    progressLabel: 'Analyzing attributes',
    description: `Employer brand attribute scorecard (Culture, Leadership, Compensation, Career Opportunities, Wellbeing & Balance, …) for the latest measured quarter(s): % of answers discussing each attribute, positive-sentiment %, share of all themes, change in points vs the previous measured period, and the top themes behind each. Use for deep-dive employer brand analysis. For a market-filtered view or example quotes use get_attribute_themes. ${PERIOD_SHARE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, quarters_back: quartersBackProp(1), include_siblings: includeSiblingsProp },
      required: ['company_id'],
    },
  },
  {
    name: 'get_competitors',
    progressLabel: 'Checking competitors',
    description: `Competitors AI platforms bring up when answering about the company, in the latest measured quarter(s): % of answers naming each competitor and % naming them alongside the company. Brand scope by default. For a market or attribute lens ('who is our top competitor for pay?') use get_competitor_landscape. ${PERIOD_SHARE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, quarters_back: quartersBackProp(1), include_siblings: includeSiblingsProp },
      required: ['company_id'],
    },
  },
  {
    name: 'get_citations',
    progressLabel: 'Reviewing citations',
    description: `Websites/domains AI platforms cite when discussing the company, in the latest measured quarter(s): % of answers citing each domain, its share of all citations, the answer gap (% of answers citing it while the company was absent), and top_pages — the most-cited page URLs on that domain with their titles, for linking. Use domain_filter to drill into one source's pages (e.g. 'glassdoor.com' → which Glassdoor pages AI cites and how often). Use for 'how does Glassdoor appear in answers?', 'give me links to the pages AI cites about us'. Do NOT call get_responses alongside this for citation questions. For market-filtered or gap/opportunity ranking use get_sources. ${PERIOD_SHARE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        domain_filter: { type: 'string', description: "Optional: filter to citations from a specific domain (e.g. 'glassdoor.com')." },
        quarters_back: quartersBackProp(1),
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'compare_companies',
    progressLabel: 'Comparing companies',
    description: 'Compare scorecards (EPS, sentiment %, visibility %, relevance) side by side for 2–10 individual profiles — markets, subsidiaries, or brands within the organization. Each profile is reported at ITS OWN latest measured period and labeled with it; the coverage note says when periods differ.',
    input_schema: {
      type: 'object',
      properties: {
        company_ids: { type: 'array', items: { type: 'string' }, description: 'Array of company UUIDs to compare (2–10)' },
      },
      required: ['company_ids'],
    },
  },
  {
    name: 'get_model_breakdown',
    progressLabel: 'Analyzing by AI platform',
    description: `How each tracked AI platform (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode) perceives the company in the latest measured quarter(s): visibility % and positive-sentiment % per platform. Useful for 'which platform mentions us least / is least favorable'. ${PERIOD_SHARE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, quarters_back: quartersBackProp(1), include_siblings: includeSiblingsProp },
      required: ['company_id'],
    },
  },
  {
    name: 'search_responses',
    progressLabel: 'Searching responses',
    description: 'Full-text search through AI answer texts for one company profile to find answers that mention specific topics, keywords, or themes (newest first). Use this when the user asks about a very specific topic.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        keyword: { type: 'string', description: 'The keyword or phrase to search for in answer texts' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['company_id', 'keyword'],
    },
  },

  // ── Insight tools (market/attribute aware; read the dashboard cubes) ──────
  {
    name: 'get_attribute_themes',
    progressLabel: 'Analyzing themes by market',
    description: "Use for questions like 'what's our culture like in India?', 'how is our compensation perceived in Germany?', 'how does AI describe us for finance roles?' or 'why did wellbeing change?'. Filter by market (location) and/or job function (job_function); set by_job_function=true to see which functions hear an attribute most. Returns, per employer-brand attribute and per measured quarter: the % of answers discussing the attribute, its positive-sentiment %, its share of all themes, and the change in points vs the previous measured period. When a single attribute is requested it also returns real example themes with quote snippets and which AI platform said them, plus the sources cited in the answers that discuss that attribute (% of those answers citing each domain, with top_pages — the most-cited page URLs to link — association, not cause). Numbers match the PerceptionX dashboard. Attribute ids: mission-purpose-impact, compensation, company-culture, leadership, job-security, career-opportunities, wellbeing-balance, inclusion, innovation, application-communication, candidate-feedback, interview-experience, onboarding-experience (common aliases like 'pay', 'culture' or 'work-life balance' also resolve). " + PERIOD_SHARE_NOTE + ' Quote _meta.period_range and the matched market spellings when precision matters.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        attribute_id: { type: 'string', description: "Optional single attribute to focus on (id, display name, or common alias, e.g. 'company-culture', 'Compensation', 'pay'). When set, real example themes/quotes and the sources in those answers are included." },
        by_job_function: { type: 'boolean', description: 'Split each attribute by job function — which functions hear it most and how positive (default false). Combine with attribute_id for one attribute.' },
        location: locationProp,
        job_function: jobFunctionProp,
        quarters_back: quartersBackProp(4),
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_visibility',
    progressLabel: 'Measuring visibility',
    description: "Visibility = % of AI answers that mention the company by name. Filter by market and/or job function and get the series by measured quarter with the change in points vs the previous measured period; set by_model=true to split by AI platform (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode) or by_job_function=true to split by job function. Use for 'how visible are we in Japan?', 'is our visibility improving?', 'which AI platform mentions us least?', 'which job functions see us least?'. Numbers match the dashboard rollups. " + PERIOD_SHARE_NOTE,
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        location: locationProp,
        job_function: jobFunctionProp,
        quarters_back: quartersBackProp(4),
        by_model: { type: 'boolean', description: 'Also split visibility by AI platform (default false)' },
        by_job_function: { type: 'boolean', description: 'Also split visibility by job function (default false)' },
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_sources',
    progressLabel: 'Searching your sources',
    description: "Which websites AI platforms cite when answering about the company, filtered by market and/or job function — led by the % of answers citing each domain, with the ANSWER GAP: % of answers that cited the domain while the company was NOT mentioned. Set gap_only=true to rank by that gap — the outreach-opportunity list ('sources answering candidate questions in your space without you'). Domains are canonicalized (glassdoor.de/.ie/.com collapse to one). Every source carries top_pages — its most-cited page URLs with titles — so answers can link the exact pages. Use for 'which sources matter in Germany?', 'where should we be mentioned but aren't?', 'link me the pages AI cites'. " + PERIOD_SHARE_NOTE,
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        location: locationProp,
        job_function: jobFunctionProp,
        quarters_back: quartersBackProp(4),
        gap_only: { type: 'boolean', description: 'Rank by answer gap (cited while company absent) instead of overall citation share (default false)' },
        limit: { type: 'number', description: 'Max domains to return (default 25, max 100)' },
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_competitor_landscape',
    progressLabel: 'Mapping the competitor landscape',
    description: "Competitors named by AI platforms across the brand scope, filtered by market and/or job function: % of answers naming each competitor and % naming them alongside the company, with per-prompt-type context. Optionally pass attribute_id (e.g. 'compensation' or the alias 'pay') to get the attribute lens: share-of-voice on prompts about that attribute ('who gets named when pay comes up') plus early competitor-sentiment themes where available. IMPORTANT: share-of-voice is who gets NAMED, not who is rated better — say so when answering 'who is our top competitor for X'. Names are canonicalized; job boards and the company itself are excluded from competitor lists. " + PERIOD_SHARE_NOTE,
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        location: locationProp,
        job_function: jobFunctionProp,
        attribute_id: { type: 'string', description: "Optional attribute lens (id, display name, or alias, e.g. 'compensation', 'pay')." },
        quarters_back: quartersBackProp(4),
        limit: { type: 'number', description: 'Max competitors to return (default 15, max 50)' },
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_trends',
    progressLabel: 'Charting the trend',
    description: "Series by measured quarter for one metric — 'visibility' (% of answers mentioning the company), 'sentiment' (positive-sentiment %), or 'citations' (citations per answer) — optionally filtered by market and/or job function. Returns the series plus change in points vs the previous measured period and since the first. Every listed period is a complete collection wave; a period is marked '(in progress)' only while its wave is still being collected. Use for 'is our sentiment in Germany improving?', 'visibility trend this year'. " + PERIOD_SHARE_NOTE,
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        metric: { type: 'string', description: "'visibility' | 'sentiment' | 'citations' (default 'visibility')" },
        location: locationProp,
        job_function: jobFunctionProp,
        quarters_back: quartersBackProp(4),
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
];

// Anthropic Messages API shape (chat-with-data).
export const anthropicTools = PX_TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

// MCP tools/list shape. Annotations mark every tool read-only/idempotent/
// closed-world per the MCP spec and ChatGPT plugin guidelines.
export const mcpTools = PX_TOOLS.map(t => ({
  name: t.name,
  title: t.progressLabel,
  description: t.description,
  inputSchema: t.input_schema,
  annotations: { title: t.progressLabel, ...READ_ONLY_ANNOTATIONS },
}));

export const toolLabels: Record<string, string> = Object.fromEntries(
  PX_TOOLS.map(t => [t.name, t.progressLabel])
);
