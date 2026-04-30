// Suggest-questions edge function
//
// Generates 4 personalized, data-grounded starter questions for the
// dashboard chat hero. Questions reflect what the caller's organization
// actually has data on — e.g. their real company names, top themes,
// competitors, countries — so the hero never surfaces a suggestion the
// data can't actually answer.
//
// Auth + tenant isolation mirror the chat-with-data function: JWT-verified
// user, membership-verified organizationId, all DB reads scoped to that org.
// The profile passed to Claude contains ONLY the caller's data; the system
// prompt explicitly forbids referencing anything outside it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

interface Profile {
  organization_name: string;
  company_count: number;
  company_names: string[];
  countries: string[];
  total_responses: number;
  top_themes: string[];
  top_competitors: string[];
  top_citation_domains: string[];
  talentx_attributes: string[];
  has_data: boolean;
}

// Static fallback used when the AI call fails or the caller has no data
// yet. Intentionally generic so we never misrepresent what we have.
const FALLBACK_QUESTIONS = [
  "How is our brand perceived across AI models right now?",
  "What themes come up most often in AI responses about us?",
  "Which competitors are AI models mentioning alongside us?",
  "Which sources are AI models citing when they describe us?",
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { organizationId } = await req.json();
    if (!organizationId) throw new Error('organizationId is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase config missing');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // ── Auth ───────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: 'Invalid authentication' }, 401);

    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) return jsonResponse({ error: 'Not a member of this organization' }, 403);

    // ── Build data profile (all reads scoped to this org) ──────────────
    const profile = await buildProfile(supabaseAdmin, organizationId);

    // If the caller has literally no data yet, the AI can't ground
    // questions in anything real. Return fallbacks with a coverage flag
    // so the UI can show a "set up your first tracking run" nudge.
    if (!profile.has_data) {
      return jsonResponse({ questions: FALLBACK_QUESTIONS, has_data: false });
    }

    // ── Call Claude ────────────────────────────────────────────────────
    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) {
      console.warn('CLAUDE_API_KEY missing; returning fallback questions');
      return jsonResponse({ questions: FALLBACK_QUESTIONS, has_data: true, fallback: true });
    }

    const questions = await generateQuestions(claudeApiKey, profile);
    return jsonResponse({ questions, has_data: true });

  } catch (err: any) {
    console.error('suggest-questions error:', err);
    // Always degrade to a usable UI rather than a broken hero. The static
    // fallbacks don't pretend to know about the caller's data.
    return jsonResponse({ questions: FALLBACK_QUESTIONS, has_data: false, fallback: true, error: err.message }, 200);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function buildProfile(supabaseAdmin: any, organizationId: string): Promise<Profile> {
  // 1. Org + companies
  const [orgRes, orgCompRes] = await Promise.all([
    supabaseAdmin.from('organizations').select('name').eq('id', organizationId).single(),
    supabaseAdmin.from('organization_companies').select('company_id').eq('organization_id', organizationId),
  ]);

  const companyIds: string[] = (orgCompRes.data || []).map((r: any) => r.company_id);
  if (!companyIds.length) {
    return {
      organization_name: orgRes.data?.name || 'Your organization',
      company_count: 0,
      company_names: [],
      countries: [],
      total_responses: 0,
      top_themes: [],
      top_competitors: [],
      top_citation_domains: [],
      talentx_attributes: [],
      has_data: false,
    };
  }

  // 2. Parallelize the enrichment reads to keep this snappy (<1s).
  const [
    companiesRes,
    countriesRes,
    responsesRes,
    themesRes,
  ] = await Promise.all([
    supabaseAdmin.from('companies').select('id, name').in('id', companyIds),
    supabaseAdmin.from('user_onboarding').select('company_id, country').in('company_id', companyIds),
    supabaseAdmin.from('prompt_responses').select('detected_competitors, citations').in('company_id', companyIds).limit(500),
    supabaseAdmin.from('ai_themes').select('theme_name, talentx_attribute_name').in('company_id', companyIds).limit(1000),
  ]);

  const companyNames: string[] = (companiesRes.data || []).map((c: any) => c.name).filter(Boolean).slice(0, 5);

  const countrySet = new Set<string>();
  for (const r of (countriesRes.data || [])) {
    if (r.country) countrySet.add(r.country);
  }

  const responses = responsesRes.data || [];
  const totalResponses = responses.length;

  // Top competitors (simple frequency count across detected_competitors field)
  const compCounts = new Map<string, number>();
  for (const r of responses) {
    if (!r.detected_competitors) continue;
    const comps = String(r.detected_competitors).split(',').map((c: string) => c.trim()).filter(Boolean);
    for (const c of comps) compCounts.set(c, (compCounts.get(c) || 0) + 1);
  }
  const topCompetitors = Array.from(compCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  // Top citation domains
  const domainCounts = new Map<string, number>();
  for (const r of responses) {
    if (!r.citations) continue;
    let list: any[] = [];
    try { list = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations; } catch { continue; }
    if (!Array.isArray(list)) continue;
    for (const cit of list) {
      let domain = cit?.domain || cit?.source;
      if (!domain && cit?.url) {
        try { domain = new URL(cit.url).hostname; } catch { continue; }
      }
      if (!domain) continue;
      domain = String(domain).replace(/^www\./, '').toLowerCase();
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }
  }
  const topDomains = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);

  // Top themes + TalentX attributes
  const themeCounts = new Map<string, number>();
  const attrCounts = new Map<string, number>();
  for (const t of (themesRes.data || [])) {
    if (t.theme_name) themeCounts.set(t.theme_name, (themeCounts.get(t.theme_name) || 0) + 1);
    if (t.talentx_attribute_name) attrCounts.set(t.talentx_attribute_name, (attrCounts.get(t.talentx_attribute_name) || 0) + 1);
  }
  const topThemes = Array.from(themeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);
  const topAttributes = Array.from(attrCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([a]) => a);

  return {
    organization_name: orgRes.data?.name || 'Your organization',
    company_count: companyNames.length,
    company_names: companyNames,
    countries: Array.from(countrySet).slice(0, 8),
    total_responses: totalResponses,
    top_themes: topThemes,
    top_competitors: topCompetitors,
    top_citation_domains: topDomains,
    talentx_attributes: topAttributes,
    has_data: totalResponses > 0 || topThemes.length > 0,
  };
}

async function generateQuestions(claudeApiKey: string, profile: Profile): Promise<string[]> {
  const model = Deno.env.get('CLAUDE_MODEL') || 'claude-opus-4-7';

  const systemPrompt = `You generate starter questions for an employer-brand analytics dashboard. The user will see exactly 4 questions as clickable chips that prefill a chat input.

HARD RULES:
1. Generate EXACTLY 4 questions.
2. Each question must be directly answerable from the data profile you are given. Do NOT reference markets, topics, competitors, or themes that aren't in the profile.
3. Vary the angle: one visibility/metrics question, one theme/sentiment question, one competitor question, one source/citation question — when the profile supports all four. If the profile is thin, pick the strongest angles.
4. Each question under 14 words. Conversational, not technical. Phrase from the user's perspective ("How is our...", "What are our...", "Which AI models...").
5. Be specific when the data allows it — reference an actual company, theme, or competitor from the profile by name, not generic placeholders.
6. Never mention other customers or organizations outside this profile.
7. Return ONLY a JSON array of 4 strings. No preamble, no markdown, no keys. Example: ["Question one?", "Question two?", "Question three?", "Question four?"]`;

  const userPrompt = `Here is this organization's data profile. Generate 4 starter questions.

Organization: ${profile.organization_name}
Companies tracked (${profile.company_count}): ${profile.company_names.join(', ') || 'none yet'}
Countries covered: ${profile.countries.join(', ') || 'not specified'}
Total AI responses collected: ${profile.total_responses}
Top themes in responses: ${profile.top_themes.join(', ') || 'none extracted yet'}
Top TalentX attributes: ${profile.talentx_attributes.join(', ') || 'none yet'}
Top competitors mentioned: ${profile.top_competitors.join(', ') || 'none detected'}
Top citation sources: ${profile.top_citation_domains.join(', ') || 'none'}

Return ONLY the JSON array.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Claude error ${res.status}:`, errText);
    return FALLBACK_QUESTIONS;
  }

  const body = await res.json();
  const text: string = body?.content?.[0]?.text?.trim() || '';

  // Parse tolerantly: strip code fences or preamble if the model misbehaves.
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return FALLBACK_QUESTIONS;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed) && parsed.every(q => typeof q === 'string' && q.length > 0)) {
      return parsed.slice(0, 4);
    }
  } catch (e) {
    console.warn('Failed to parse questions JSON:', e);
  }
  return FALLBACK_QUESTIONS;
}
