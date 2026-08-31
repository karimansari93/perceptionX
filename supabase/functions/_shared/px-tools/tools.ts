// ─── px-tools: tool definitions ─────────────────────────────────────────────
// One registry serving both surfaces:
//   * chat-with-data passes `input_schema` to the Anthropic Messages API
//   * mcp-server maps them to MCP tools/list entries (name/title/inputSchema)
// Descriptions are written for a HOST model that has never seen our system
// prompt (the MCP case): each carries its own usage guidance and caveats.
// `progressLabel` renders the streaming status line in the in-app chat and
// doubles as the MCP `title`.

export interface PxToolDef {
  name: string;
  progressLabel: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const companyIdProp = { type: 'string', description: 'The company UUID (from list_companies)' };
const locationProp = {
  type: 'string',
  description: "Optional market/location filter, e.g. 'India', 'Germany', 'Japan'. Matched against the organization's tracked markets; if the market isn't tracked, the tool says so and lists what is.",
};
const monthsBackProp = { type: 'number', description: 'How many calendar months back to include (default 6, max 24)' };
const includeSiblingsProp = {
  type: 'boolean',
  description: 'Aggregate the brand scope — this company plus same-name market profiles in the organization (default true; matches the dashboard). Set false to isolate this one profile.',
};

export const PX_TOOLS: PxToolDef[] = [
  {
    name: 'list_companies',
    progressLabel: 'Looking up companies',
    description: "List all companies/market profiles in the user's organization. Always call this first if you don't already know the company IDs. Returns id, name, country, industries, and total_responses for each.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_company_overview',
    progressLabel: 'Loading company overview',
    description: 'Get a comprehensive snapshot for a company: EPS score, sentiment breakdown, visibility %, relevance score, top themes, top competitors, and top citation sources — all in one call. Use this as your default first tool when a user asks about a specific company.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] },
  },
  {
    name: 'get_company_metrics',
    progressLabel: 'Fetching metrics',
    description: 'Get just the KPI metrics for a company: EPS, sentiment score/label, visibility %, relevance score, total responses. EPS = 50% sentiment + 30% visibility + 20% relevance.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] },
  },
  {
    name: 'get_responses',
    progressLabel: 'Reading AI responses',
    description: "Get actual AI response texts for a company. Essential for qualitative questions like 'what do AI models say about X', 'how is the culture described', 'what are the negatives'. Returns the full response text, which AI model wrote it, sentiment, and the prompt asked. Filter by prompt_type for focused analysis.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        limit: { type: 'number', description: 'Max responses to return (default 15, max 50)' },
        prompt_type: { type: 'string', description: "Optional filter: 'informational' (basic facts), 'experience' (culture/work experience), 'competitive' (vs competitors), 'discovery' (would you recommend). Leave empty for all types." },
        ai_model: { type: 'string', description: "Optional filter by AI model: 'gpt-4', 'perplexity', 'google-ai-overviews', etc." },
        sentiment_filter: { type: 'string', description: "Optional filter: 'positive', 'negative', 'neutral'" },
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_themes',
    progressLabel: 'Analyzing themes',
    description: "Get recurring themes extracted from AI responses for a company. Each theme has a sentiment score and mention count. Themes represent what AI models consistently talk about (e.g. 'work-life balance', 'innovation', 'compensation'). Also returns employer brand attribute coverage. For location-specific theme questions prefer get_attribute_themes.",
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] },
  },
  {
    name: 'get_attribute_breakdown',
    progressLabel: 'Analyzing attributes',
    description: 'Get detailed employer brand attribute scores for a company. Attributes are the employer brand pillars (Culture, Leadership, Compensation, Career Growth, etc.) and shows how AI models perceive each one. Use this for deep-dive employer brand analysis. For a location-filtered view use get_attribute_themes instead.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] },
  },
  {
    name: 'get_competitors',
    progressLabel: 'Checking competitors',
    description: 'Get competitor mention analysis for a single company profile — which competitors are brought up by AI models and how often. For a location- or attribute-filtered view across the whole brand, prefer get_competitor_landscape.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] },
  },
  {
    name: 'get_citations',
    progressLabel: 'Reviewing citations',
    description: "Get citation sources (websites/domains) that AI models reference when discussing this company. Returns domain, count, share %, and which AI models cited it. Set include_snippets=true to also get the actual page titles and snippets from each citation — use this when the user asks HOW a source is being used (e.g. 'how does Glassdoor appear in responses?'). Do NOT call get_responses alongside this for citation questions. For location-filtered or gap/opportunity source questions prefer get_sources.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        include_snippets: { type: 'boolean', description: 'Set to true to include page titles and text snippets from each citation.' },
        domain_filter: { type: 'string', description: "Optional: filter to citations from a specific domain (e.g. 'glassdoor.com')." },
      },
      required: ['company_id'],
    },
  },
  {
    name: 'compare_companies',
    progressLabel: 'Comparing companies',
    description: 'Compare key metrics (EPS, sentiment, visibility, relevance) side by side for 2–10 companies. Best for comparing markets, subsidiaries, or brands within the organization.',
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
    progressLabel: 'Analyzing by AI model',
    description: 'Break down how different AI models (ChatGPT, Perplexity, Google AI Overviews, …) each perceive a company differently. Useful for understanding which AI platforms are most or least favorable.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] },
  },
  {
    name: 'search_responses',
    progressLabel: 'Searching responses',
    description: 'Full-text search through AI response texts for a company to find responses that mention specific topics, keywords, or themes. Use this when the user asks about a very specific topic.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        keyword: { type: 'string', description: 'The keyword or phrase to search for in response texts' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['company_id', 'keyword'],
    },
  },

  // ── Insight tools (location/attribute aware; read the dashboard cubes) ────
  {
    name: 'get_attribute_themes',
    progressLabel: 'Analyzing themes by market',
    description: "THE tool for questions like 'what's our culture like in India?' or 'how is our compensation perceived in Germany?'. Returns employer-brand attribute sentiment (positive/negative theme counts + ratio) filtered by market/location, with a monthly trend, and — when a single attribute is requested — real example themes with quote snippets and which AI platform said them. Numbers match the PerceptionX dashboard. Attribute ids: mission-purpose-impact, compensation, company-culture, leadership, job-security, career-opportunities, wellbeing-balance, inclusion, innovation, application-communication, candidate-feedback, interview-experience, onboarding-experience. Every result carries _meta.data_as_of (rollup freshness) and the exact market spellings matched — quote both when precision matters.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        attribute_id: { type: 'string', description: "Optional single attribute to focus on (id or display name, e.g. 'company-culture' or 'Compensation'). When set, real example themes/quotes are included." },
        location: locationProp,
        months_back: monthsBackProp,
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_visibility',
    progressLabel: 'Measuring visibility',
    description: "Visibility = % of AI responses that mention the company by name. Filter by market/location and get a monthly trend; set by_model=true to split by AI platform (ChatGPT, Perplexity, Google AI Overviews, …). Use for 'how visible are we in Japan?', 'is our visibility improving?', 'which AI platform mentions us least?'. Numbers match the dashboard rollups.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        location: locationProp,
        months_back: monthsBackProp,
        by_model: { type: 'boolean', description: 'Also split visibility by AI platform (default false)' },
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_sources',
    progressLabel: 'Searching your sources',
    description: "Which websites AI models cite when answering about the company, filtered by market/location — with the ANSWER GAP measure: responses that cited the domain while the company was NOT mentioned. Set gap_only=true to rank by that gap — the outreach-opportunity list ('sources answering candidate questions in your space without you'). Domains are canonicalized (glassdoor.de/.ie/.com collapse to one). Use for 'which sources matter in Germany?', 'where should we be mentioned but aren't?'.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        location: locationProp,
        months_back: monthsBackProp,
        gap_only: { type: 'boolean', description: 'Rank by answer gap (cited while company absent) instead of overall citation volume (default false)' },
        limit: { type: 'number', description: 'Max domains to return (default 25, max 100)' },
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_competitor_landscape',
    progressLabel: 'Mapping the competitor landscape',
    description: "Competitors named by AI models across the brand scope, filtered by market/location, with per-prompt-type context and co-mention counts. Optionally pass attribute_id (e.g. 'compensation') to get the attribute lens: share-of-voice on prompts about that attribute ('who gets named when pay comes up') plus early competitor-sentiment themes where available. IMPORTANT: share-of-voice is who gets NAMED, not who is rated better — say so when answering 'who is our top competitor for X'. Names are canonicalized; job boards and the company itself are excluded.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        location: locationProp,
        attribute_id: { type: 'string', description: "Optional attribute lens (id or display name, e.g. 'compensation')." },
        months_back: monthsBackProp,
        limit: { type: 'number', description: 'Max competitors to return (default 15, max 50)' },
        include_siblings: includeSiblingsProp,
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_trends',
    progressLabel: 'Charting the trend',
    description: "Monthly time series for one metric — 'visibility' (% of responses mentioning the company), 'sentiment' (positive/(positive+negative) theme ratio), or 'citations' (citation volume) — optionally filtered by market/location. Returns the series plus first→last change. Use for 'is our sentiment in Germany improving?', 'visibility trend this year'.",
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        metric: { type: 'string', description: "'visibility' | 'sentiment' | 'citations' (default 'visibility')" },
        location: locationProp,
        months_back: { type: 'number', description: 'How many calendar months back (default 12, max 24)' },
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

// MCP tools/list shape.
export const mcpTools = PX_TOOLS.map(t => ({
  name: t.name,
  title: t.progressLabel,
  description: t.description,
  inputSchema: t.input_schema,
}));

export const toolLabels: Record<string, string> = Object.fromEntries(
  PX_TOOLS.map(t => [t.name, t.progressLabel])
);
