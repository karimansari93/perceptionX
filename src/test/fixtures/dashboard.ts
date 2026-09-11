// Deterministic backend fixtures for the dashboard reliability tests. Shapes
// mirror the RPC return contracts in supabase/migrations/20260811090000,
// 20260825080000, 20260825120000, 20260825160000, 20260825200000 and the
// PostgREST reads in src/contexts/CompanyContext.tsx / src/hooks/useProfileSetup.ts.
// Ported from docs/audits/data-reliability-2026-09-11/repro/fixtures.cjs.

export const SUPABASE_URL = 'https://pxtest.supabase.local';
// supabase-js derives the session storage key from the URL's first host label.
export const STORAGE_KEY = 'sb-pxtest-auth-token';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const ORG_ID = '22222222-2222-4222-8222-222222222222';
export const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-11T10:00:00Z');

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const expiresAt = Math.floor(NOW.getTime() / 1000) + 10 * 365 * 86400;
const accessToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
  sub: USER_ID, role: 'authenticated', aud: 'authenticated', email: 'repro@example.com',
  exp: expiresAt, iat: expiresAt - 86400,
})}.repro`;

export const user = {
  id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'repro@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', last_sign_in_at: NOW.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {
    full_name: 'Repro User',
    default_location_context: 'United States',
    default_company_id: COMPANY_ID,
    default_company_name: 'Acme',
  },
  identities: [], is_anonymous: false,
};
export const session = {
  access_token: accessToken, refresh_token: 'repro-refresh', token_type: 'bearer',
  expires_in: 10 * 365 * 86400, expires_at: expiresAt, user,
};

const company = {
  id: COMPANY_ID, name: 'Acme', industry: 'Technology', country: 'US', company_size: null,
  competitors: [], settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  created_by: null, company_industries: [],
};
export const organizationMembers = [{
  organization_id: ORG_ID, role: 'member', is_default: true,
  organizations: { id: ORG_ID, name: 'Acme Org', organization_companies: [{ companies: company }] },
}];
export const profile = {
  full_name: 'Repro User', default_location_context: 'United States', default_company_id: COMPANY_ID,
  onboarding_completed_at: '2026-01-02T00:00:00Z',
};
export const companyRow = {
  id: COMPANY_ID, name: 'Acme', data_collection_status: 'completed', data_collection_progress: null, onboarding_id: null,
};

export const prompts = ([
  ['p1', 'What is it like to work at Acme?', 'experience', 'Engineering'],
  ['p2', 'How does Acme support career growth?', 'experience', 'Engineering'],
  ['p3', 'How is work-life balance at Acme?', 'experience', 'Sales'],
  ['p4', 'Compare Acme and Globex as employers', 'competitive', 'Engineering'],
  ['p5', 'Is Acme better than Globex for engineers?', 'competitive', 'Engineering'],
  ['p6', 'Best tech companies to work for in the US', 'discovery', 'Engineering'],
] as const).map(([id, text, type, fn]) => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${id.slice(1)}`, user_id: USER_ID, prompt_text: text, company_id: COMPANY_ID,
  prompt_category: 'General', prompt_theme: 'Company Culture', prompt_type: type, industry_context: 'Technology',
  job_function_context: fn, location_context: 'United States', attribute_id: null,
}));

const months = ['2026-07-01', '2026-08-01'];
const loc = (l: string | null) => (l ? { location_context: l } : {});
const sentimentRows = (l: string | null) => months.map((m, i) => ({
  ...loc(l), response_month: m, job_function_context: 'Engineering',
  total_themes: 120, positive_themes: 80 + i * 4, negative_themes: 20 - i * 4, neutral_themes: 20, avg_sentiment_score: 0.3,
}));
const relevanceRows = (l: string | null) => months.map((m) => ({
  ...loc(l), response_month: m, job_function_context: 'Engineering',
  total_citations: 200, valid_citations: 150, relevance_score: 62.5,
}));
const attributeRows = (l: string | null) => months.flatMap((m) => [
  { ...loc(l), attribute_id: 'company-culture', response_month: m, job_function_context: 'Engineering', total_themes: 50, positive_themes: 35, negative_themes: 10, neutral_themes: 5, avg_sentiment_score: 0.4, response_count: 20 },
  { ...loc(l), attribute_id: 'career-opportunities', response_month: m, job_function_context: 'Engineering', total_themes: 30, positive_themes: 12, negative_themes: 14, neutral_themes: 4, avg_sentiment_score: -0.1, response_count: 15 },
]);
const topSources = (l: string | null) => [
  { ...loc(l), domain: 'glassdoor.com', citation_count: 40 },
  { ...loc(l), domain: 'linkedin.com', citation_count: 30 },
];
const competitors = (l: string | null) => [{ ...loc(l), competitor_name: 'Globex', mention_count: 12 }];
const llmRankings = (l: string | null) => [
  { ...loc(l), ai_model: 'openai', mentions: 30 },
  { ...loc(l), ai_model: 'perplexity', mentions: 25 },
];
const visibility = months.map((m) => ({
  company_id: COMPANY_ID, location_context: 'United States', response_month: m, job_function_context: 'Engineering',
  total_responses: 60, mentioned_responses: 42,
}));

export const dashboardRollups = {
  sentiment: sentimentRows(null), relevance: relevanceRows(null), top_sources: topSources(null),
  competitors: competitors(null), llm_rankings: llmRankings(null), attribute_themes: attributeRows(null),
  visibility, location_buckets: ['United States'],
};
export const locationRollups = {
  sentiment: sentimentRows('United States'), relevance: relevanceRows('United States'),
  top_sources: topSources('United States'), competitors: competitors('United States'),
  llm_rankings: llmRankings('United States'), attribute_themes: attributeRows('United States'),
};
// Same shape with a GENUINE 0% sentiment (every polarized theme negative) and
// a genuine 0 relevance score — the "real zero must still render as 0%" case.
export const locationRollupsRealZero = {
  ...locationRollups,
  sentiment: locationRollups.sentiment.map((r) => ({ ...r, positive_themes: 0, negative_themes: 100, neutral_themes: 20, total_themes: 120 })),
  relevance: locationRollups.relevance.map((r) => ({ ...r, relevance_score: 0 })),
};
export const scopeStats = {
  scope: months.map((m) => ({ company_id: COMPANY_ID, response_month: m, job_function_context: 'Engineering', location_context: 'United States', total_responses: 60, mentioned_responses: 42, total_citations: 200, distinct_domains: 12, distinct_models: 2, positive_themes: 80, negative_themes: 20, neutral_themes: 20 })),
  daily: [['2026-07-15', '2026-07-01'], ['2026-08-14', '2026-08-01']].map(([d, m]) => ({ company_id: COMPANY_ID, tested_day: d, response_month: m, job_function_context: 'Engineering', location_context: 'United States', total_responses: 60, mentioned_responses: 42, total_citations: 200, distinct_prompt_models: 12, positive_themes: 80, negative_themes: 20 })),
  prompt_types: months.flatMap((m) => ['experience', 'competitive', 'discovery'].map((t) => ({ company_id: COMPANY_ID, response_month: m, job_function_context: 'Engineering', location_context: 'United States', prompt_type: t, total_responses: 20, mentioned_responses: 14 }))),
  llm: months.flatMap((m) => ['openai', 'perplexity'].map((a) => ({ company_id: COMPANY_ID, response_month: m, job_function_context: 'Engineering', location_context: 'United States', ai_model: a, total_responses: 30, mentions: 21 }))),
};
export const domainStats = {
  rows: months.flatMap((m) => [
    { domain: 'glassdoor.com', response_month: m, job_function_context: 'Engineering', responses_citing: 30, mentioned_responses_citing: 25, citation_count: 40 },
    { domain: 'linkedin.com', response_month: m, job_function_context: 'Engineering', responses_citing: 20, mentioned_responses_citing: 15, citation_count: 30 },
  ]),
  domain_total: 2,
};
export const competitorStats = {
  rows: months.map((m) => ({ competitor_name: 'Globex', response_month: m, job_function_context: 'Engineering', location_context: 'United States', prompt_type: 'competitive', responses_mentioning: 10, co_mentions: 6 })),
  competitor_total: 1,
};

export const responsesPage = prompts.flatMap((p, i) => ['openai', 'perplexity'].map((model, j) => ({
  id: `bbbbbbbb-0000-4000-8000-0000000000${String(i * 2 + j).padStart(2, '0')}`, confirmed_prompt_id: p.id, company_id: COMPANY_ID, ai_model: model,
  tested_at: `2026-08-1${(i % 5) + 1}T10:0${j}:00Z`, created_at: `2026-08-1${(i % 5) + 1}T10:0${j}:00Z`, updated_at: `2026-08-1${(i % 5) + 1}T10:0${j}:00Z`,
  response_month: '2026-08-01', company_mentioned: (i + j) % 3 !== 0, detected_competitors: p.prompt_type === 'competitive' ? 'Globex' : null,
  citations: [{ url: 'https://www.glassdoor.com/Reviews/Acme', domain: 'glassdoor.com' }, { url: 'https://www.linkedin.com/company/acme', domain: 'linkedin.com' }],
  for_index: false, index_period: null, sentiment_total_themes: 5, sentiment_positive_themes: 3, sentiment_negative_themes: 1, sentiment_ratio: 0.75,
})));

// Headline values the fixtures above resolve to on the Overview scorecard.
export const EXPECTED = { sentiment: '82%', visibility: '70%', relevance: '63%', eps: '75' } as const;
export const EXPECTED_REAL_ZERO = { sentiment: '0%', visibility: '70%', relevance: '0%', eps: '21' } as const;
