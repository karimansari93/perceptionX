// Data access for Activate (link router).
//
// Recipient side (tokenized, unauthenticated): everything goes through
// SECURITY DEFINER RPCs — the anon role has no direct access to the activate
// tables, so a link token is the only key that opens exactly one link's config.
//
// Admin side: direct table reads/writes under the is_admin() RLS policies,
// plus RPCs where server-side enforcement matters (link minting behind the
// consent gate, stats behind the k-anonymity floor).
//
// The new tables/functions aren't in the generated Database types yet, hence
// the localized casts in here — keep them in this file only.

import { supabase } from '@/integrations/supabase/client';

export type ActivateAudience = 'employee' | 'candidate' | 'alumni';

export interface ActivateOrgBranding {
  display_name: string;
  tagline: string | null;
  blurb: string | null;
  logo_url: string | null;
  /** Company domain for the logo.dev lookup; initials fallback when absent. */
  logo_domain: string | null;
  /** Optional campaign banner above the avatar on the welcome screen. */
  banner_url: string | null;
  /** Client typography. Name + file -> @font-face; name alone -> Google Fonts. */
  heading_font: string | null;
  body_font: string | null;
  heading_font_url: string | null;
  body_font_url: string | null;
  primary_color: string;
  accent_color: string;
}

export interface ActivateEntity {
  /** Representative company id; used when no market-specific row applies. */
  id: string;
  name: string;
  /**
   * market_code -> company_id. Orgs whose companies are keyed by brand × market
   * (Ford: 18 rows named "Ford", one per country) collapse to one named entity
   * carrying this map; orgs keyed by division (CSL) map many markets to the
   * same id. Empty means "no measured markets mapped" -> show everywhere.
   */
  markets?: Record<string, string>;
}

/** Entities present in the declared market; falls back to all if none match. */
export function entitiesForMarket(
  entities: ActivateEntity[],
  marketCode: string,
): ActivateEntity[] {
  const inMarket = entities.filter(
    (e) => !e.markets || Object.keys(e.markets).length === 0 || marketCode in e.markets,
  );
  return inMarket.length > 0 ? inMarket : entities;
}

/** The company row that represents this entity in the declared market. */
export function entityCompanyIdFor(entity: ActivateEntity, marketCode: string): string {
  return entity.markets?.[marketCode] ?? entity.id;
}

/** Find the named entity that owns a given company id (any market). */
export function entityOwningCompanyId(
  entities: ActivateEntity[],
  companyId: string,
): ActivateEntity | undefined {
  return entities.find(
    (e) => e.id === companyId || Object.values(e.markets ?? {}).includes(companyId),
  );
}

/**
 * Three different acts, so three sections on the page:
 *  review — write about your own experience where candidates check first
 *  forum  — join a conversation already happening
 *  social — post to your own audience
 */
export type ActivateChannel = 'review' | 'forum' | 'social';

export interface ActivateRoute {
  market_code: string | null;
  tier: 1 | 2 | 3;
  /** 'review' = the measured tiered mechanic; 'social' = public conversation. */
  channel: ActivateChannel;
  platform: string;
  destination_url: string;
  write_url: string | null;
  rationale_stat: string | null;
  /** Card sub-line for social rows (never a market statistic). */
  fit_note: string | null;
  /** This market's own platform (kununu in DE, undelucram.ro in RO...). */
  is_local: boolean;
  /** What the recipient would actually do here ("Write a review"). */
  action_label: string | null;
  /** Loud, but no appropriate act for an employee — shown as context only. */
  is_listen_only: boolean;
  /** Affinity for ranking the social section; null = everyone. */
  audience_functions: string[] | null;
  audience_seniority: string[] | null;
  rank: number;
  use_direct_link: boolean;
  entity_company_id: string | null;
}

/** The specific page AI cites most for a platform in a market. */
export interface ActivateHighlight {
  market_code: string | null;
  platform: string;
  url: string;
  label: string;
  citations: number | null;
  rank: number;
}

export interface ActivateTheme {
  market_code: string | null;
  theme: string;
  detail: string | null;
  rank: number;
}

export interface ActivateConfig {
  org: ActivateOrgBranding;
  audience: ActivateAudience | null;
  prefill_market_code: string | null;
  prefill_entity_company_id: string | null;
  entities: ActivateEntity[];
  /** The client's own job functions, commonest first. */
  job_functions: string[];
  /** market_code -> % of that market's answers citing the listed platforms. */
  coverage: Record<string, number>;
  routes: ActivateRoute[];
  highlights: ActivateHighlight[];
  themes: ActivateTheme[];
}

/** Most-cited page for a platform in this market, if we have one. */
export function highlightFor(
  highlights: ActivateHighlight[],
  marketCode: string,
  platform: string,
): ActivateHighlight | undefined {
  return highlights.find((h) => h.platform === platform && h.market_code === marketCode);
}

/**
 * Every bad token — unknown, revoked, or expired — comes back as 'not_found'.
 * The RPC used to tell those apart, which let anyone holding a candidate token
 * confirm it had once been real. Don't reintroduce a distinction here: the
 * dead-link screen is the same either way, so there's nothing to gain from it.
 */
export type ActivateTokenError = 'not_found' | string;

const rpc = (name: string, args: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.rpc as any)(name, args);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string) => supabase.from(name as any) as any;

export function activateLinkFor(token: string): string {
  return `${window.location.origin}/activate/${token}`;
}

// ---------------------------------------------------------------------------
// Recipient (token) side
// ---------------------------------------------------------------------------

export async function getActivateByToken(
  token: string,
  sessionId: string,
): Promise<{ config?: ActivateConfig; error?: ActivateTokenError }> {
  const { data, error } = await rpc('activate_get_by_token', {
    p_token: token,
    p_session_id: sessionId,
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error as ActivateTokenError };
  return { config: data as ActivateConfig };
}

export type ActivateEventType =
  | 'market_declared'
  | 'entity_declared'
  | 'profile_declared'
  | 'platform_click';

/** Fire-and-forget: event loss must never block the recipient's flow. */
export function logActivateEvent(
  token: string,
  sessionId: string,
  eventType: ActivateEventType,
  fields: {
    marketCode?: string | null;
    entityCompanyId?: string | null;
    platform?: string | null;
    tier?: number | null;
    functionId?: string | null;
    seniorityId?: string | null;
    channels?: ActivateChannel[] | null;
  } = {},
): void {
  void rpc('activate_log_event', {
    p_token: token,
    p_session_id: sessionId,
    p_event_type: eventType,
    p_market_code: fields.marketCode ?? null,
    p_entity_company_id: fields.entityCompanyId ?? null,
    p_platform: fields.platform ?? null,
    p_tier: fields.tier ?? null,
    p_function: fields.functionId ?? null,
    p_seniority: fields.seniorityId ?? null,
    p_channels: fields.channels?.length ? fields.channels : null,
  }).then(
    () => undefined,
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Routing resolution (pure)
// ---------------------------------------------------------------------------

export interface ResolvedRoutes {
  /** 1 measured (has rationale) | 2 known fallback | 3 global default */
  tier: 1 | 2 | 3;
  routes: ActivateRoute[];
}

/**
 * Resolve the route list for a declared market + entity, within one channel.
 * Market rows (tier 1/2) win over the tier-3 global rows; within a market, an
 * entity-specific row beats the entity-agnostic row for the same platform.
 * Entity rows for *other* entities never show.
 */
export function resolveRoutes(
  all: ActivateRoute[],
  marketCode: string,
  entityCompanyId: string | null,
  channel: ActivateChannel = 'review',
): ResolvedRoutes {
  const inChannel = all.filter((r) => r.channel === channel);
  const pool = inChannel.filter((r) => r.market_code === marketCode);
  const effective = pool.length > 0 ? pool : inChannel.filter((r) => r.market_code === null);

  const byPlatform = new Map<string, ActivateRoute>();
  for (const route of effective) {
    if (route.entity_company_id && route.entity_company_id !== entityCompanyId) continue;
    const current = byPlatform.get(route.platform);
    const routeIsEntitySpecific = route.entity_company_id !== null;
    const currentIsEntitySpecific = current?.entity_company_id != null;
    if (!current || (routeIsEntitySpecific && !currentIsEntitySpecific)) {
      byPlatform.set(route.platform, route);
    }
  }

  const routes = [...byPlatform.values()].sort((a, b) => a.rank - b.rank);
  return { tier: routes[0]?.tier ?? 3, routes };
}

/** Markets that have their own (active) rows — pinned atop the country picker. */
export function marketsWithRoutes(all: ActivateRoute[]): string[] {
  return [...new Set(all.map((r) => r.market_code).filter((c): c is string => c !== null))].sort();
}

/** Measured (tier 1) markets only — the pills that carry the "Measured" chip. */
export function measuredMarketCodes(all: ActivateRoute[]): string[] {
  return [
    ...new Set(
      all
        .filter((r) => r.tier === 1 && r.market_code !== null)
        .map((r) => r.market_code as string),
    ),
    // Sorted by the name the recipient actually reads, not the ISO code.
  ].sort((a, b) => countryName(a).localeCompare(countryName(b)));
}

/** First percentage in a rationale sentence, for the count-up stat block. */
export function parseStatPct(text: string | null): number | null {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(text ?? '');
  return m ? parseFloat(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Optional profile declaration (function + seniority)
//
// Review routing NEVER keys on these — the baseline measured that function
// does not move the review-platform mix. They rank the social section only
// (where a person actually has a voice is demographic) and are stored as
// declared signal on events.
// ---------------------------------------------------------------------------

export interface ProfileOption {
  id: string;
  label: string;
}

/**
 * Fallback only. The step prefers the client's own functions (from
 * confirmed_prompts.job_function_context, returned by the token RPC) so a
 * Netflix recipient sees "Content & Production" and "Pipeline Engineering"
 * rather than a generic taxonomy. This list covers orgs that have none.
 */
export const JOB_FUNCTIONS: ProfileOption[] = [
  { id: 'engineering-tech', label: 'Engineering & Tech' },
  { id: 'data-analytics', label: 'Data & Analytics' },
  { id: 'product', label: 'Product' },
  { id: 'design-creative', label: 'Design & Creative' },
  { id: 'content-production', label: 'Content & Production' },
  { id: 'science-rd', label: 'Science & R&D' },
  { id: 'manufacturing-ops', label: 'Manufacturing & Operations' },
  { id: 'supply-chain', label: 'Supply Chain & Logistics' },
  { id: 'quality-regulatory', label: 'Quality & Regulatory' },
  { id: 'healthcare-medical', label: 'Medical & Healthcare' },
  { id: 'commercial-sales', label: 'Sales & Business Development' },
  { id: 'marketing-comms', label: 'Marketing & Communications' },
  { id: 'customer-support', label: 'Customer Support' },
  { id: 'finance', label: 'Finance' },
  { id: 'legal', label: 'Legal' },
  { id: 'people-hr', label: 'People & HR' },
  { id: 'corporate-functions', label: 'Corporate functions' },
];

export const SENIORITIES: ProfileOption[] = [
  { id: 'early-career', label: 'Early career' },
  { id: 'mid-level', label: 'Mid-level' },
  { id: 'senior', label: 'Senior' },
  { id: 'executive', label: 'Executive' },
];

/**
 * Flag which routes match the declared profile, without reordering them.
 *
 * Order is a curation decision made upstream — the market's own platform
 * first, then the rest by measured coverage — so affinity only badges a row
 * ("your world"); it never promotes one platform over a louder one, and it
 * never hides anything. Everyone sees every route.
 */
/**
 * Client function labels are free-form, so map them onto the coarse tags the
 * routes carry. Keeps the "your world" badge working without seeding an
 * affinity list per client.
 */
export function affinityTagFor(label: string | null): string | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/engineer|technolog|software|technical|pipeline|developer|data|analytic|product/.test(l)) {
    return 'engineering-tech';
  }
  if (/manufactur|plant|operation|supply|production|quality/.test(l)) return 'manufacturing-ops';
  return null;
}

export function rankSocialRoutes(
  routes: ActivateRoute[],
  functionId: string | null,
  seniorityId: string | null,
): { routes: ActivateRoute[]; matched: Set<string> } {
  const matched = new Set(
    routes
      .filter(
        (r) =>
          (functionId && r.audience_functions?.includes(functionId)) ||
          (seniorityId && r.audience_seniority?.includes(seniorityId)),
      )
      .map((r) => r.platform),
  );
  return { routes: [...routes].sort((a, b) => a.rank - b.rank), matched };
}

// ---------------------------------------------------------------------------
// Countries — ISO 3166-1 alpha-2, labelled via Intl at the call site
// ---------------------------------------------------------------------------

export const COUNTRY_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BM','BN','BO','BR','BS','BT','BW','BY','BZ',
  'CA','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GT','GU','GW','GY',
  'HK','HN','HR','HT','HU','ID','IE','IL','IM','IN','IQ','IR','IS','IT','JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS',
  'LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ',
  'MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP',
  'NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PR','PS','PT','PW','PY','QA',
  'RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SI','SK','SL','SM','SN','SO','SR',
  'SS','ST','SV','SX','SY','SZ','TC','TD','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT',
  'TV','TW','TZ','UA','UG','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE',
  'YT','ZA','ZM','ZW',
] as const;

const regionNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

// Countries whose English names take a definite article mid-sentence
// ("in the United States", but "in Germany").
const THE_COUNTRIES = new Set([
  'US', 'GB', 'AE', 'NL', 'PH', 'DO', 'BS', 'GM', 'MV', 'MH', 'SB', 'KM',
  'CF', 'CD', 'CG', 'KY', 'TC', 'VG', 'VI', 'FO', 'CK', 'MP', 'FK',
]);

/** Country name as it reads inside a sentence: "the United States", "Japan". */
export function countryInSentence(code: string): string {
  return (THE_COUNTRIES.has(code) ? 'the ' : '') + countryName(code);
}

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------

export interface ActivateLink {
  id: string;
  org_id: string;
  token: string;
  label: string;
  audience: ActivateAudience | null;
  prefill_market_code: string | null;
  prefill_entity_company_id: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ActivateOrgSettings {
  org_id: string;
  consent_confirmed_at: string | null;
  /** The PerceptionX admin who recorded it — not the person who agreed. */
  consent_confirmed_by: string | null;
  consent_note: string | null;
  /**
   * Version of docs/ACTIVATE_ACCEPTABLE_USE.md the client was shown. Null means
   * consent predates the terms, which the mint gate treats as unconsented —
   * agreement to words nobody saw isn't agreement.
   */
  terms_version: string | null;
  /** The named person at the client who actually agreed. */
  client_contact_name: string | null;
  client_contact_email: string | null;
}

/** Terms currently in force; orgs on an older version are behind the gate. */
export const ACTIVATE_TERMS_VERSION = '2026-08-v1';

export interface ActivateAdminRoute extends ActivateRoute {
  id: string;
  org_id: string;
  active: boolean;
}

export interface ActivateLinkStats {
  link_id: string;
  open_sessions: number;
  declared_sessions: number;
  click_sessions: number;
  clicks_total: number;
  /** True below the k-anonymity floor — breakdowns are withheld server-side. */
  suppressed: boolean;
  markets: Record<string, number> | null;
  platforms: Record<string, number> | null;
}

export async function createActivateLink(params: {
  orgId: string;
  label: string;
  audience?: ActivateAudience | null;
  prefillMarketCode?: string | null;
  prefillEntityCompanyId?: string | null;
  expiresDays?: number;
}): Promise<ActivateLink> {
  const { data, error } = await rpc('admin_create_activate_link', {
    p_org_id: params.orgId,
    p_label: params.label,
    p_audience: params.audience ?? null,
    p_prefill_market_code: params.prefillMarketCode ?? null,
    p_prefill_entity_company_id: params.prefillEntityCompanyId ?? null,
    p_expires_days: params.expiresDays ?? 90,
  });
  if (error) throw error;
  return data as ActivateLink;
}

export async function listActivateLinks(orgId: string): Promise<ActivateLink[]> {
  const { data, error } = await table('activate_links')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ActivateLink[];
}

export async function revokeActivateLink(linkId: string): Promise<void> {
  const { error } = await table('activate_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
    .is('revoked_at', null);
  if (error) throw error;
}

export interface ActivateBrandingRow {
  org_id: string;
  display_name: string;
  tagline: string | null;
  blurb: string | null;
  logo_url: string | null;
  logo_domain: string | null;
  banner_url: string | null;
  heading_font: string | null;
  body_font: string | null;
  heading_font_url: string | null;
  body_font_url: string | null;
  primary_color: string;
  accent_color: string;
}

export const ACTIVATE_ASSET_BUCKET = 'activate-branding';
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/**
 * Upload a branding asset and return its public URL. Files are namespaced by
 * org and stamped, so replacing an asset never collides with a cached copy of
 * the old one. Admin-only by storage policy.
 */
export type ActivateAssetKind = 'logo' | 'banner' | 'heading-font' | 'body-font';

const FONT_EXTENSIONS = ['woff2', 'woff', 'ttf', 'otf'];

export async function uploadActivateAsset(
  orgId: string,
  kind: ActivateAssetKind,
  file: File,
): Promise<string> {
  const isFont = kind.endsWith('font');
  const ext0 = (file.name.split('.').pop() || '').toLowerCase();
  if (isFont) {
    if (!FONT_EXTENSIONS.includes(ext0)) {
      throw new Error('Please choose a font file (WOFF2, WOFF, TTF or OTF).');
    }
  } else if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (PNG, JPG, SVG, WebP or GIF).');
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw new Error('Image must be 2 MB or smaller.');
  }
  const ext = (ext0 || 'png').replace(/[^a-z0-9]/g, '');
  const path = `${orgId}/${kind}-${Date.now()}.${ext}`;
  // Browsers often report an empty type for font files; set it explicitly so
  // the bucket's mime allow-list and the served Content-Type are correct.
  const contentType = isFont
    ? { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }[ext] ??
      'application/octet-stream'
    : file.type;

  const { error } = await supabase.storage
    .from(ACTIVATE_ASSET_BUCKET)
    .upload(path, file, { cacheControl: '31536000', upsert: false, contentType });
  if (error) throw error;

  const { data } = supabase.storage.from(ACTIVATE_ASSET_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function getActivateBranding(orgId: string): Promise<ActivateBrandingRow | null> {
  const { data, error } = await table('activate_branding')
    .select(
      'org_id, display_name, tagline, blurb, logo_url, logo_domain, banner_url, heading_font, body_font, heading_font_url, body_font_url, primary_color, accent_color',
    )
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as ActivateBrandingRow) ?? null;
}

export async function saveActivateBranding(row: ActivateBrandingRow): Promise<void> {
  const { error } = await table('activate_branding').upsert({
    ...row,
    tagline: row.tagline || null,
    blurb: row.blurb || null,
    logo_url: row.logo_url || null,
    logo_domain: row.logo_domain || null,
    banner_url: row.banner_url || null,
    heading_font: row.heading_font || null,
    body_font: row.body_font || null,
    heading_font_url: row.heading_font_url || null,
    body_font_url: row.body_font_url || null,
  });
  if (error) throw error;
}

export async function getActivateOrgSettings(orgId: string): Promise<ActivateOrgSettings | null> {
  const { data, error } = await table('activate_org_settings')
    .select(
      'org_id, consent_confirmed_at, consent_confirmed_by, consent_note, ' +
        'terms_version, client_contact_name, client_contact_email',
    )
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as ActivateOrgSettings) ?? null;
}

/**
 * Records a named person at the client accepting a specific version of the
 * acceptable-use terms. Goes through the RPC rather than a table upsert so the
 * append-only history row and the current-state row are written together — the
 * history is the point, and a client-side upsert could only ever write one.
 */
export async function recordActivateConsent(
  orgId: string,
  contact: { name: string; email?: string; note?: string },
): Promise<void> {
  const { data, error } = await rpc('admin_record_activate_consent', {
    p_org_id: orgId,
    p_client_contact_name: contact.name,
    p_client_contact_email: contact.email?.trim() || null,
    p_note: contact.note?.trim() || null,
    p_terms_version: ACTIVATE_TERMS_VERSION,
  });
  if (error) throw error;
  if (!data) throw new Error('consent not recorded');
}

/** True when the org's recorded acceptance is against the terms in force. */
export function consentIsCurrent(settings: ActivateOrgSettings | null): boolean {
  return (
    Boolean(settings?.consent_confirmed_at) &&
    settings?.terms_version === ACTIVATE_TERMS_VERSION
  );
}

export async function listActivateRoutes(orgId: string): Promise<ActivateAdminRoute[]> {
  const { data, error } = await table('activate_routes')
    .select('*')
    .eq('org_id', orgId)
    .order('market_code', { ascending: true, nullsFirst: false })
    .order('rank', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ActivateAdminRoute[];
}

export async function getActivateLinkStats(orgId: string): Promise<ActivateLinkStats[]> {
  const { data, error } = await rpc('admin_activate_link_stats', { p_org_id: orgId });
  if (error) throw error;
  return (data ?? []) as ActivateLinkStats[];
}
