// ─── px-tools: where the negatives come from ────────────────────────────────
// get_negative_drivers answers the playbook's first question ("which topics
// hold the largest share of the employer's negative opinions, and how much
// of that sits in what people write on review sites") for the latest
// measured quarter and the one before it.
//
// Two reads:
//   * the attribute cube (mcp_get_rollups), complete: negative and positive
//     themes per attribute per quarter, so share of negatives and sentiment
//     match get_attribute_themes and the dashboard;
//   * mcp_get_negative_drivers, sampled: a random sample of the answers that
//     carry negative opinions, each flagged by whether it cites one of the
//     organization's own review-profile pages, joined to its negative
//     themes. The review-profile shares come from this sample and the
//     payload says how many answers it read.
//
// A review-profile page is a citation on a review platform whose profile
// path carries the brand's own slug (derived from the brand name, never a
// hard-coded client): Glassdoor employer pages, Indeed /cmp/<slug>, kununu
// /<country>/<slug>, AmbitionBox, Undelucram, profession.hu, WhereWeWork and
// Computrabajo with the slug in the path, Seek and Jobstreet
// /companies/<slug>, Infojobs Brazil /<slug>, Comparably /companies/<slug>.
// The pages that matched most are returned so the match can be checked.
//
// Sentiment is methodology v2 (positive / (positive + negative), neutral
// excluded) across all four prompt types, aggregated on the canonical
// attribute. Percentages lead; every count sits under sample_size.

import {
  coverageFound, coverageNoData, METHODOLOGY_NOTES, monthToQuarter, pct, pointsDelta,
  labelQuarter, sentimentPct, sortQuarters,
} from './helpers.ts';
import { metaFor, resolveScope, scopeSuffix } from './scope.ts';
import type { ToolContext } from './scope.ts';
import { ATTRIBUTES_V2, attributeName, readRollups } from './executors-insights.ts';

const ATTRIBUTE_ID_SET = new Set(ATTRIBUTES_V2.map(a => a.id));
const CANDIDATE_EXPERIENCE_IDS = ['application-communication', 'candidate-feedback', 'interview-experience', 'onboarding-experience'];
const SAMPLE_PER_MONTH = 2000;

// The brand's own slug tokens, from its name: the full slug ("ford-credit")
// plus its first word when it is distinctive enough ("ford"). A review
// profile counts as the organization's own when its path carries one.
export function brandTokens(brandName: string): string[] {
  const slug = String(brandName || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const first = slug.split('-')[0] || '';
  const tokens = new Set<string>();
  if (slug.length >= 3) tokens.add(slug);
  if (first.length >= 4) tokens.add(first);
  return Array.from(tokens);
}

type Acc = { neg: number; pos: number };
type Sampled = { neg: number; negProfile: number };

const blank = (): Acc => ({ neg: 0, pos: 0 });
const blankSampled = (): Sampled => ({ neg: 0, negProfile: 0 });

export async function getNegativeDrivers(
  ctx: ToolContext,
  companyId: string,
  location: string | undefined,
  quartersBack: number,
  includeSiblings: boolean,
  jobFunction?: string,
): Promise<string> {
  const r = await resolveScope(ctx, companyId, { location, jobFunction, quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const tokens = brandTokens(r.scope.brandName);
  const [rollupsRes, driversRes] = await Promise.all([
    readRollups(ctx, r).then((data: any) => ({ data, error: null as string | null }))
      .catch((err: any) => ({ data: null, error: String(err?.message || err) })),
    ctx.admin.rpc('mcp_get_negative_drivers', {
      p_company_ids: r.scope.companyIds,
      p_brand_tokens: tokens,
      p_buckets: r.buckets,
      p_months: r.months,
      p_job_functions: r.jobFunctions,
      p_sample: SAMPLE_PER_MONTH,
    }),
  ]);
  if (rollupsRes.error) return JSON.stringify({ error: rollupsRes.error });

  // ── Complete figures from the attribute cube ──────────────────────────────
  const cubeRows: any[] = (rollupsRes.data?.attribute_themes || []).filter(
    (row: any) => ATTRIBUTE_ID_SET.has(String(row.attribute_id || '').trim())
  );
  const byAttrQ = new Map<string, Map<string, Acc>>();
  const totalsQ = new Map<string, Acc>();
  for (const row of cubeRows) {
    const id = String(row.attribute_id).trim();
    const q = monthToQuarter(String(row.response_month));
    if (!byAttrQ.has(id)) byAttrQ.set(id, new Map());
    const m = byAttrQ.get(id)!;
    if (!m.has(q)) m.set(q, blank());
    const a = m.get(q)!;
    a.neg += row.negative_themes || 0;
    a.pos += row.positive_themes || 0;
    if (!totalsQ.has(q)) totalsQ.set(q, blank());
    const t = totalsQ.get(q)!;
    t.neg += row.negative_themes || 0;
    t.pos += row.positive_themes || 0;
  }
  const quarters = sortQuarters(totalsQ.keys()).filter(q => (totalsQ.get(q)!.neg + totalsQ.get(q)!.pos) > 0);
  if (!quarters.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No opinionated themes${scopeSuffix(r)} across the measured periods ${r.quarters.join(', ')}.`,
        r.available.length ? { available_markets: r.available } : {}
      ),
      _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment]),
    });
  }

  // ── Sampled review-profile figures ────────────────────────────────────────
  const drivers = driversRes.error ? null : driversRes.data;
  const monthsQ = new Map<string, { pool: number; sampled: number; citing: number; versions: Set<string> }>();
  for (const m of ((drivers?.months as any[]) || [])) {
    const q = monthToQuarter(String(m.response_month));
    if (!monthsQ.has(q)) monthsQ.set(q, { pool: 0, sampled: 0, citing: 0, versions: new Set() });
    const e = monthsQ.get(q)!;
    e.pool += Number(m.answers_with_negatives) || 0;
    e.sampled += Number(m.answers_sampled) || 0;
    e.citing += Number(m.answers_sampled_citing_profile) || 0;
    for (const v of ((m.versions as string[]) || [])) e.versions.add(String(v));
  }
  const sampledAttrQ = new Map<string, Map<string, Sampled>>();
  const sampledTotalsQ = new Map<string, Sampled>();
  for (const row of ((drivers?.rows as any[]) || [])) {
    const id = String(row.attribute_id || '').trim();
    if (!ATTRIBUTE_ID_SET.has(id)) continue;
    const q = monthToQuarter(String(row.response_month));
    if (!sampledAttrQ.has(id)) sampledAttrQ.set(id, new Map());
    const m = sampledAttrQ.get(id)!;
    if (!m.has(q)) m.set(q, blankSampled());
    const s = m.get(q)!;
    s.neg += Number(row.negative_themes) || 0;
    s.negProfile += Number(row.negative_themes_in_profile_answers) || 0;
    if (!sampledTotalsQ.has(q)) sampledTotalsQ.set(q, blankSampled());
    const t = sampledTotalsQ.get(q)!;
    t.neg += Number(row.negative_themes) || 0;
    t.negProfile += Number(row.negative_themes_in_profile_answers) || 0;
  }
  const allVersions = new Set<string>();
  for (const e of monthsQ.values()) for (const v of e.versions) allVersions.add(v);

  const quarterEntry = (q: string, cube: Acc, sampled: Sampled | undefined, totalNeg: number) => ({
    quarter: labelQuarter(q, r.inProgressQuarter),
    share_of_negatives_pct: pct(cube.neg, totalNeg),
    positive_sentiment_pct: sentimentPct(cube.pos, cube.neg),
    negatives_in_review_profile_answers_pct: sampled ? pct(sampled.negProfile, sampled.neg) : null,
    sample_size: {
      negative_themes: cube.neg,
      positive_themes: cube.pos,
      negative_themes_sampled: sampled?.neg ?? 0,
      negative_themes_sampled_in_review_profile_answers: sampled?.negProfile ?? 0,
    },
  });

  const seriesFor = (ids: string[]) => quarters.map(q => {
    const cube = blank();
    const sampled = blankSampled();
    let anySampled = false;
    for (const id of ids) {
      const c = byAttrQ.get(id)?.get(q);
      if (c) { cube.neg += c.neg; cube.pos += c.pos; }
      const s = sampledAttrQ.get(id)?.get(q);
      if (s) { anySampled = true; sampled.neg += s.neg; sampled.negProfile += s.negProfile; }
    }
    return quarterEntry(q, cube, anySampled ? sampled : undefined, totalsQ.get(q)!.neg);
  });

  const withChange = (quarterly: ReturnType<typeof quarterEntry>[]) => {
    const last = quarterly[quarterly.length - 1];
    const prev = quarterly[quarterly.length - 2];
    return {
      share_of_negatives_pct: last.share_of_negatives_pct,
      positive_sentiment_pct: last.positive_sentiment_pct,
      negatives_in_review_profile_answers_pct: last.negatives_in_review_profile_answers_pct,
      ...(prev ? {
        change_vs_previous_period: {
          previous_period: prev.quarter,
          share_of_negatives_points: pointsDelta(last.share_of_negatives_pct, prev.share_of_negatives_pct),
          sentiment_points: pointsDelta(last.positive_sentiment_pct, prev.positive_sentiment_pct),
          review_profile_points: pointsDelta(last.negatives_in_review_profile_answers_pct, prev.negatives_in_review_profile_answers_pct),
        },
      } : {}),
      quarterly,
      sample_size: last.sample_size,
    };
  };

  const attributes = Array.from(byAttrQ.keys()).map(id => ({
    attribute_id: id,
    attribute: attributeName(id),
    ...withChange(seriesFor([id])),
  })).sort((x, y) =>
    ((y.share_of_negatives_pct ?? -1) - (x.share_of_negatives_pct ?? -1))
    || (y.sample_size.negative_themes - x.sample_size.negative_themes));

  const periods = quarters.map(q => {
    const t = totalsQ.get(q)!;
    const s = sampledTotalsQ.get(q);
    const m = monthsQ.get(q);
    return {
      quarter: labelQuarter(q, r.inProgressQuarter),
      share_of_all_negatives_in_review_profile_answers_pct: s ? pct(s.negProfile, s.neg) : null,
      answers_with_negatives_citing_review_profile_pct: m ? pct(m.citing, m.sampled) : null,
      positive_sentiment_pct: sentimentPct(t.pos, t.neg),
      sample_size: {
        negative_themes: t.neg,
        positive_themes: t.pos,
        answers_with_negative_opinions: m?.pool ?? 0,
        answers_sampled: m?.sampled ?? 0,
        answers_sampled_citing_review_profile: m?.citing ?? 0,
        negative_themes_sampled: s?.neg ?? 0,
        negative_themes_sampled_in_review_profile_answers: s?.negProfile ?? 0,
      },
    };
  });

  const answersSampled = periods.reduce((sum, p) => sum + p.sample_size.answers_sampled, 0);
  const reviewProfilePages = ((drivers?.profile_pages as any[]) || [])
    .filter((p: any) => /^https?:\/\//i.test(String(p?.url || '')))
    .map((p: any) => ({
      domain: String(p.domain),
      url: String(p.url),
      cited_in_pct_of_sampled_negative_answers: pct(Number(p.answers_citing) || 0, answersSampled),
      sample_size: { answers_citing: Number(p.answers_citing) || 0 },
    }));

  const candidateExperience = withChange(seriesFor(CANDIDATE_EXPERIENCE_IDS));
  const totals = quarters.reduce((acc, q) => { const t = totalsQ.get(q)!; acc.neg += t.neg; acc.pos += t.pos; return acc; }, blank());

  const notes: string[] = [];
  if (driversRes.error) {
    notes.push('The review-profile shares could not be computed for this scope right now (the attribute shares and sentiment are complete); ask again with a single market (location) to narrow it.');
  }
  // Version strings carry dates, which never reach a payload: the warning
  // names the fact, not the versions.
  if (allVersions.size > 1) {
    notes.push('Themes in these periods were labelled by more than one classifier version; compare attribute ranks across periods rather than points.');
  }

  return JSON.stringify({
    periods,
    attributes,
    candidate_experience_combined: {
      attributes: CANDIDATE_EXPERIENCE_IDS.map(attributeName),
      ...candidateExperience,
    },
    review_profile_pages: reviewProfilePages,
    sample_size: { negative_themes: totals.neg, positive_themes: totals.pos, answers_sampled_for_review_profile_shares: answersSampled },
    _coverage: coverageFound({
      attribute_count: attributes.length,
      periods: quarters.length,
      ...(driversRes.error ? { review_profile_note: notes[0] } : {}),
      ...(allVersions.size > 1 ? { classifier_note: notes[notes.length - 1] } : {}),
    }),
    _meta: metaFor(r, [
      METHODOLOGY_NOTES.sentiment,
      'share_of_negatives_pct = negative themes on the attribute as a % of all negative themes in scope for that quarter (which topics hold the negative opinion). It is complete, from the same cube as the dashboard.',
      `negatives_in_review_profile_answers_pct = of the attribute's negative themes, the % that sit in answers citing one of the organization's own review-profile pages (a review platform page whose path carries the brand's slug: ${tokens.map(t => `"${t}"`).join(', ')}). Computed on a random sample of the answers that carry negative opinions (up to ${SAMPLE_PER_MONTH} per measured month); sample_size states how many. Association, not cause.`,
      'review_profile_pages lists the matched pages AI cited most in the sampled answers, so the match can be checked and the pages linked with the exact url returned.',
      'Check the four candidate experience attributes together (candidate_experience_combined) before splitting them by topic and market.',
    ]),
  });
}
