// Client onboarding: the structured project brief.
//
// TrackingConfigInput is the stable contract between the onboarding flow, the admin
// review screen, and the confirmed_prompts generator. Every field is captured
// typed and normalized (canonical countries + function labels) so prompt
// generation is a direct mapping, never a re-parse of free text.

export interface EmployerEntity {
  name: string;
  /** Divisions reported separately get their own prompt set. */
  track_separately: boolean;
  /**
   * A tracked-separately sub-brand can inherit the parent company's functions
   * and markets ('inherit', the default) or define its own ('custom') — a
   * credit arm may hire only in Finance across two markets while the parent
   * spans ten. Ignored when track_separately is false.
   */
  scope_mode?: 'inherit' | 'custom';
  /** Only when scope_mode === 'custom'. Uniform across the sub-brand's markets. */
  job_functions?: string[];
  /** Only when scope_mode === 'custom'. */
  markets?: string[];
}

export type OwnedPropertyType =
  | 'linkedin'
  | 'instagram'
  | 'microsite'
  | 'grad_program'
  | 'other';

export interface OwnedProperty {
  type: OwnedPropertyType;
  url: string;
}

export interface ReportRecipient {
  name: string;
  role: string;
  email: string;
  is_primary: boolean;
}

export type CareerStageSplit = 'combined' | 'split';

/**
 * Whether every market shares the same job functions ('uniform') or each
 * market has its own subset ('per_market'). Per-market mappings live in
 * market_functions and drive the prompt matrix directly.
 */
export type FunctionScope = 'uniform' | 'per_market';

export interface MarketFunctions {
  market: string;
  functions: string[];
}

/**
 * Which industry a function is benchmarked against when the company competes
 * in more than one — e.g. Ford's tech roles against Technology, frontline
 * roles against Automotive. Functions without an entry fall back to the first
 * industry.
 */
export interface FunctionIndustry {
  function: string;
  industry: string;
}

export interface TrackingConfigInput {
  /** From the invite — read-only to the client. */
  company_name: string;
  /** From the invite — read-only to the client. */
  contact_email: string;
  employer_entities: EmployerEntity[];
  job_functions: string[];
  markets: string[];
  function_scope: FunctionScope;
  /** Only meaningful when function_scope === 'per_market'. */
  market_functions: MarketFunctions[];
  /**
   * Context only — NOT a tracking config input. Used to tune how we prompt the
   * AI models (stored as company context); we do not track named competitors
   * as a feature.
   */
  talent_competitors: string[];
  industries: string[];
  /** Only meaningful when industries has more than one entry. */
  function_industries: FunctionIndustry[];
  career_site_url: string;
  owned_properties: OwnedProperty[];
  managed_platforms: string[];
  career_stage_split: CareerStageSplit;
  ta_priorities: string[];
  leadership_objective: string;
  focus_questions: string;
  known_context: string;
  report_recipients: ReportRecipient[];
  additional_notes: string;
  meta?: {
    invite_token?: string;
    completed_at?: string;
    /** Resume pointer (screen id) while the brief is a draft. */
    step?: string | number;
  };
}

/** Alias: the onboarding payload IS the tracking config input. */
export type OnboardingPayload = TrackingConfigInput;

/** Shape consumed by admin_approve_intake — maps onto confirmed_prompts. */
export interface ConfirmedPromptRow {
  entity_name: string;
  prompt_text: string;
  prompt_type: 'discovery' | 'experience' | 'competitive' | 'informational';
  prompt_category: string;
  prompt_theme: string;
  job_function_context: string;
  location_context: string;
  industry_context: string | null;
}

export interface OwnedDomainSeed {
  entity_name: string;
  domain: string;
  asset_type: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Canonical option lists
// ---------------------------------------------------------------------------

export const CANONICAL_JOB_FUNCTIONS = [
  'Product',
  'Engineering',
  'Marketing',
  'Sales',
  'Finance',
  'Data & Analytics',
  'Design',
  'Operations',
  'HR',
  'Legal',
  'Customer Support',
] as const;

export const MANAGED_PLATFORM_OPTIONS = [
  'Glassdoor',
  'Comparably',
  'Indeed',
  'kununu',
] as const;

/** US states — searchable as markets for US-only companies. */
export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'Washington, D.C.', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const;

export const OWNED_PROPERTY_TYPES: { value: OwnedPropertyType; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'microsite', label: 'Microsite' },
  { value: 'grad_program', label: 'Grad program' },
  { value: 'other', label: 'Other' },
];

/**
 * Normalize a free-text function label onto the canonical list when it
 * case-insensitively matches (incl. a few common aliases); otherwise keep the
 * trimmed custom label.
 */
export function normalizeJobFunction(raw: string): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  const lower = t.toLowerCase();
  const aliases: Record<string, string> = {
    'human resources': 'HR',
    'people': 'HR',
    'people & culture': 'HR',
    'data': 'Data & Analytics',
    'analytics': 'Data & Analytics',
    'data and analytics': 'Data & Analytics',
    'customer service': 'Customer Support',
    'support': 'Customer Support',
    'eng': 'Engineering',
    'software engineering': 'Engineering',
  };
  if (aliases[lower]) return aliases[lower];
  const canon = CANONICAL_JOB_FUNCTIONS.find((f) => f.toLowerCase() === lower);
  return canon ?? t;
}

export function emptyOnboardingPayload(companyName: string, contactEmail: string): OnboardingPayload {
  return {
    company_name: companyName,
    contact_email: contactEmail,
    employer_entities: [],
    job_functions: [],
    markets: [],
    function_scope: 'uniform',
    market_functions: [],
    talent_competitors: [],
    industries: [],
    function_industries: [],
    career_site_url: '',
    owned_properties: [],
    managed_platforms: [],
    career_stage_split: 'combined',
    ta_priorities: [],
    leadership_objective: '',
    focus_questions: '',
    known_context: '',
    report_recipients: [],
    additional_notes: '',
  };
}

/** Required-to-submit gating (§4). Returns human-readable problems. */
export function validateForSubmit(p: OnboardingPayload): string[] {
  const problems: string[] = [];
  if (p.job_functions.length < 1) problems.push('Pick at least one job function.');
  if (p.markets.length < 1) problems.push('Pick at least one market.');
  if (p.function_scope === 'per_market') {
    for (const m of p.markets) {
      const entry = p.market_functions.find((x) => x.market === m);
      if (!entry || entry.functions.length < 1) {
        problems.push(`Pick at least one function for ${m}.`);
      }
    }
  }
  // Sub-brands with a custom scope must have at least one function and market.
  for (const e of p.employer_entities) {
    if (e.track_separately && e.scope_mode === 'custom') {
      if ((e.job_functions?.length ?? 0) < 1)
        problems.push(`Pick at least one function for ${e.name}.`);
      if ((e.markets?.length ?? 0) < 1) problems.push(`Pick at least one market for ${e.name}.`);
    }
  }
  if (!isValidUrl(p.career_site_url)) problems.push('Add a valid career site URL.');
  const primaries = p.report_recipients.filter((r) => r.is_primary);
  if (primaries.length !== 1) problems.push('Mark exactly one report recipient as primary.');
  return problems;
}

export function isValidUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
