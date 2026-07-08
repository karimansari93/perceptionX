// Approval → confirmed_prompts (§7 of the onboarding spec).
//
// Deterministic: the same brief always produces the same rows, in the same
// order, with the same text. Idempotency is completed by admin_approve_intake,
// which skips rows whose (company, prompt_text) already exist — so approving
// the same brief twice never duplicates prompts.
//
// Prompt phrasing follows the existing house style already present in
// confirmed_prompts (General category, 4 prompt types per cell).

import {
  ConfirmedPromptRow,
  FunctionScope,
  MarketFunctions,
  OwnedDomainSeed,
  TrackingConfigInput,
  normalizeUrl,
} from './types';
// Methodology v2 (July 2026): onboarding generates the 13-attribute
// candidate-voice matrix, not the retired "General" prompts. Single source of
// truth for the templates. See docs/methodology-v2-prompt-taxonomy.md.
import { ATTRIBUTE_PROMPT_TEMPLATES, getAttributeById } from '../../config/attributes';

type Stage = 'combined' | 'early' | 'experienced';

/**
 * A unit that gets its own prompt set: the company itself, plus every entity
 * flagged track_separately. Each unit carries its own effective functions and
 * markets — a sub-brand can inherit the parent's or define its own.
 */
export interface TrackedUnit {
  name: string;
  functions: string[];
  markets: string[];
  functionScope: FunctionScope;
  marketFunctions: MarketFunctions[];
}

export function trackedUnits(input: TrackingConfigInput): TrackedUnit[] {
  const units: TrackedUnit[] = [
    {
      name: input.company_name.trim(),
      functions: input.job_functions,
      markets: input.markets,
      functionScope: input.function_scope,
      marketFunctions: input.market_functions,
    },
  ];
  for (const e of input.employer_entities) {
    const n = e.name.trim();
    if (!e.track_separately || !n) continue;
    if (units.some((u) => u.name.toLowerCase() === n.toLowerCase())) continue;
    if (e.scope_mode === 'custom') {
      // Sub-brand runs its own roles/markets (uniform across its markets).
      units.push({
        name: n,
        functions: e.job_functions ?? [],
        markets: e.markets ?? [],
        functionScope: 'uniform',
        marketFunctions: [],
      });
    } else {
      // Inherit the parent company's exact configuration.
      units.push({
        name: n,
        functions: input.job_functions,
        markets: input.markets,
        functionScope: input.function_scope,
        marketFunctions: input.market_functions,
      });
    }
  }
  return units;
}

/** Names of every tracked unit (company + tracked-separately sub-brands). */
export function trackedEntities(input: TrackingConfigInput): string[] {
  return trackedUnits(input).map((u) => u.name);
}

function stageFunctionPhrase(fn: string, stage: Stage): string {
  if (stage === 'early') return `early-career ${fn} candidates`;
  if (stage === 'experienced') return `experienced ${fn} hires`;
  return fn;
}

function stageFunctionContext(fn: string, stage: Stage): string {
  if (stage === 'early') return `${fn} (early careers)`;
  if (stage === 'experienced') return `${fn} (experienced)`;
  return fn;
}

/**
 * Bake the (function, market) context into a v2 attribute prompt, in the
 * onboarding house style: append "for {fnPhrase} in {market}" before the
 * trailing "?". Appended UNCONDITIONALLY — the attribute templates only ever
 * contain {companyName}/{industry}, never the function or market, so a
 * substring "already present" guard only mis-fires (e.g. company "Bank of
 * Ireland" contains market "Ireland"; short market "US" is a substring of
 * "industry"), which silently drops the market qualifier and can collapse two
 * markets' prompt_text to identical strings that the approval dedupe then loses.
 * Deterministic. The market suffix is what makes each market's rows distinct.
 */
function appendContext(text: string, fnPhrase: string, market: string): string {
  const trimmed = text.trim();
  const parts: string[] = [];
  if (fnPhrase) parts.push(`for ${fnPhrase}`);
  if (market) parts.push(`in ${market}`);
  if (parts.length === 0) return trimmed;
  const suffix = ` ${parts.join(' ')}`;
  return trimmed.endsWith('?')
    ? trimmed.replace(/\?$/, `${suffix}?`)
    : `${trimmed}${suffix}`;
}

/**
 * The (market × function) cells for one unit. Uniform scope is the full cross
 * product; per-market scope generates only the functions mapped to each market
 * (e.g. Germany gets Engineering + Sales, Spain only Engineering).
 */
function unitPairs(unit: TrackedUnit): { market: string; fn: string }[] {
  if (unit.functionScope === 'per_market' && unit.marketFunctions.length > 0) {
    return unit.markets.flatMap((market) => {
      const entry = unit.marketFunctions.find((x) => x.market === market);
      return (entry?.functions ?? []).map((fn) => ({ market, fn }));
    });
  }
  return unit.markets.flatMap((market) => unit.functions.map((fn) => ({ market, fn })));
}

/** The main company's market–function pairs — used for the demo card. */
export function marketFunctionPairs(
  input: TrackingConfigInput,
): { market: string; fn: string }[] {
  return unitPairs(trackedUnits(input)[0]);
}

/**
 * The core generation loop: one confirmed prompt per
 * (unit × market-function pair × prompt type), doubled into early-careers /
 * experienced variants when the brief asks for a career-stage split. Each unit
 * uses its own functions and markets, so a sub-brand with a narrower footprint
 * generates only its own cells.
 *
 * talent_competitors and industries sharpen context (industry_context column,
 * company.competitors) — they are NOT competitor tracking.
 */
/**
 * The industry a function is benchmarked against: its per-function mapping
 * when the brief competes in several industries (Ford: tech roles →
 * Technology, frontline → Automotive), else the first industry.
 */
export function industryForFunction(input: TrackingConfigInput, fn: string): string | null {
  if (input.industries.length > 1) {
    const mapped = (input.function_industries ?? []).find(
      (x) => x.function.toLowerCase() === fn.toLowerCase(),
    );
    if (mapped?.industry?.trim()) return mapped.industry.trim();
  }
  return input.industries[0]?.trim() || null;
}

export function generateConfirmedPrompts(input: TrackingConfigInput): ConfirmedPromptRow[] {
  const stages: Stage[] =
    input.career_stage_split === 'split' ? ['early', 'experienced'] : ['combined'];

  const rows: ConfirmedPromptRow[] = [];
  for (const unit of trackedUnits(input)) {
    for (const { market, fn } of unitPairs(unit)) {
      const industry = industryForFunction(input, fn);
      // v2 competitive/discovery templates reference {industry}; fall back to a
      // grammatical phrase when the brief has no industry for this function.
      const industryPhrase = industry || 'their industry';
      for (const stage of stages) {
        const fnPhrase = stageFunctionPhrase(fn, stage);
        // 13 attributes × 4 types = 52 prompts per (unit × market-function × stage).
        for (const tmpl of ATTRIBUTE_PROMPT_TEMPLATES) {
          const attribute = getAttributeById(tmpl.attributeId);
          const base = tmpl.prompt
            .replace(/{companyName}/g, unit.name)
            .replace(/{industry}/g, industryPhrase);
          rows.push({
            entity_name: unit.name,
            prompt_text: appendContext(base, fnPhrase, market),
            prompt_type: tmpl.type as ConfirmedPromptRow['prompt_type'],
            prompt_category: attribute?.category || 'Employee Experience',
            prompt_theme: attribute?.name || tmpl.attributeId,
            attribute_id: tmpl.attributeId,
            job_function_context: stageFunctionContext(fn, stage),
            location_context: market,
            industry_context: industry,
          });
        }
      }
    }
  }
  return rows;
}

/**
 * Shared platforms are never owned domains — seeding linkedin.com as "owned"
 * would count every LinkedIn citation as owned-source. Profiles on these hosts
 * stay in the brief (owned_properties / managed_platforms) as report context.
 */
const SHARED_PLATFORM_HOSTS = [
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'glassdoor.com',
  'glassdoor.co.uk',
  'glassdoor.de',
  'indeed.com',
  'kununu.com',
  'comparably.com',
  'medium.com',
];

function isSharedPlatformHost(domain: string): boolean {
  return SHARED_PLATFORM_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`));
}

/**
 * Owned-source seeds for company_owned_domains: career site + owned properties
 * on domains the company actually controls, attached to every tracked entity so
 * owned-source share stays accurate. asset_type follows the existing vocabulary
 * ('careers' for the career site).
 */
export function extractOwnedDomainSeeds(input: TrackingConfigInput): OwnedDomainSeed[] {
  const seeds: OwnedDomainSeed[] = [];
  const entities = trackedEntities(input);
  const push = (url: string, assetType: string, notes: string | null) => {
    const domain = hostnameOf(url);
    if (!domain || isSharedPlatformHost(domain)) return;
    for (const entity of entities) {
      if (!seeds.some((s) => s.entity_name === entity && s.domain === domain)) {
        seeds.push({ entity_name: entity, domain, asset_type: assetType, notes });
      }
    }
  };

  push(input.career_site_url, 'careers', 'From onboarding brief: main careers page');
  for (const p of input.owned_properties) {
    push(p.url, p.type, 'From onboarding brief: owned property');
  }
  return seeds;
}

function hostnameOf(raw: string): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(normalizeUrl(raw));
    return u.hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}
