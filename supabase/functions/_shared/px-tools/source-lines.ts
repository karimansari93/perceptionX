// Source lines for every server-side surface (email, Ask AI, MCP tools).
//
// The grouping and ownership rules live in ../source-platforms.ts. This file
// turns cube rows into lines with correct coverage:
//   - a line of ONE host with no page rule: the domain cube's count is exact;
//   - a merged platform, or a platform split into "your pages and posts" and
//     "other": coverage is a union of answers, read from
//     mcp_get_source_line_coverage. Percentages of member hosts are NEVER
//     added, because one answer often cites several of them.
//
// If the union cannot be read (scope too large for the 20 s service-role
// budget, or the RPC is not applied yet) the tools fall back to one honest
// line per host, flagged in a note. The email (strict) refuses to build.

import {
  buildSourceLines, isOwnedHost, lineCoverageSpec, normalizeHost, normalizeSourceUrl, parseOwnedEntries, pathMatches,
} from '../source-platforms.ts';
import type { OwnedEntry, SourceLine } from '../source-platforms.ts';
import { pageEntry } from './helpers.ts';
import type { ResolvedScope, ToolContext } from './scope.ts';

/** Above this many answers in scope, skip the union read (see the migration). */
export const MAX_UNION_SCOPE_ANSWERS = 15000;
/** At most this many union lines per read: the largest by upper bound. */
export const MAX_UNION_LINES = 24;

export interface DomainStatRow {
  domain: string;
  responses_citing?: number;
  mentioned_responses_citing?: number;
  citation_count?: number;
}

export interface LineCount {
  citing: number;
  mentioned: number;
  /** Links to the line's hosts. Null on a split half: links are not cut by page. */
  citations: number | null;
}

export const UNION_UNAVAILABLE_NOTE =
  'Source lines could not be merged across country sites for this scope right now, so each site is listed on its own; ' +
  'do not add their percentages together because answers overlap.';

/** The owned entries (whole hosts and page prefixes) of a brand scope. */
export async function readOwnedEntries(ctx: ToolContext, companyIds: string[]): Promise<{ entries: OwnedEntry[]; error: string | null }> {
  const { data, error } = await ctx.admin.from('company_owned_domains').select('domain').in('company_id', companyIds);
  if (error) return { entries: [], error: error.message };
  return { entries: parseOwnedEntries(((data || []) as any[]).map(d => String(d.domain))), error: null };
}

/** Per-host totals across the rows given (months and locations add: an answer sits in one of each). */
export function sumByHost(rows: DomainStatRow[]): Map<string, { citing: number; mentioned: number; citations: number }> {
  const out = new Map<string, { citing: number; mentioned: number; citations: number }>();
  for (const row of rows) {
    const host = normalizeHost(String(row.domain));
    if (!host) continue;
    const e = out.get(host) || { citing: 0, mentioned: 0, citations: 0 };
    e.citing += row.responses_citing || 0;
    e.mentioned += row.mentioned_responses_citing || 0;
    e.citations += row.citation_count || 0;
    out.set(host, e);
  }
  return out;
}

/** One honest line per host, for when a union cannot be read. */
export function ungroupLine(line: SourceLine, owned: OwnedEntry[]): SourceLine[] {
  return line.members.map(host => ({
    key: host, name: host, domain: host, owned: isOwnedHost(host, owned), partlyOwned: false,
    members: [host], include: null, exclude: null, needsUnion: false,
  }));
}

export interface LineCountsOptions {
  /** The months this read covers (a quarter for the email, the window for tools). */
  months: string[];
  lines: SourceLine[];
  /** Domain-cube rows for exactly these months. */
  domainRows: DomainStatRow[];
  owned: OwnedEntry[];
  /** Answers in the scope for these months (the scope cube's total). */
  answersInScope: number;
  /** Skip union lines that cannot reach this many answers. */
  minAnswers?: number;
  /** Throw instead of falling back when a union cannot be read. */
  strict?: boolean;
}

export interface LineCounts {
  lines: SourceLine[];
  counts: Map<string, LineCount>;
  note: string | null;
}

export async function readLineCounts(ctx: ToolContext, r: ResolvedScope, opts: LineCountsOptions): Promise<LineCounts> {
  const byHost = sumByHost(opts.domainRows);
  const counts = new Map<string, LineCount>();
  const exactLines: SourceLine[] = [];
  const unionLines: Array<{ line: SourceLine; upper: number }> = [];

  for (const line of opts.lines) {
    const members = line.members.map(m => byHost.get(m)).filter((m): m is NonNullable<typeof m> => !!m);
    const upper = members.reduce((s, m) => s + m.citing, 0);
    if (!line.needsUnion) {
      const m = members[0];
      if (m) counts.set(line.key, { citing: m.citing, mentioned: m.mentioned, citations: m.citations });
      exactLines.push(line);
    } else if (upper > 0 && upper >= (opts.minAnswers || 0)) {
      unionLines.push({ line, upper });
    }
  }
  unionLines.sort((a, b) => b.upper - a.upper);
  const wanted = unionLines.slice(0, MAX_UNION_LINES);
  if (!wanted.length) return { lines: exactLines, counts, note: null };

  const fallback = (why: string): LineCounts => {
    if (opts.strict) throw new Error(`Source lines could not be merged: ${why}`);
    const lines = [...exactLines];
    for (const { line } of wanted) {
      for (const one of ungroupLine(line, opts.owned)) {
        const m = byHost.get(one.key);
        if (!m) continue;
        counts.set(one.key, { citing: m.citing, mentioned: m.mentioned, citations: m.citations });
        lines.push(one);
      }
    }
    return { lines, counts, note: UNION_UNAVAILABLE_NOTE };
  };

  if (opts.answersInScope > MAX_UNION_SCOPE_ANSWERS) return fallback('scope too large for a union read');

  const { data, error } = await ctx.admin.rpc('mcp_get_source_line_coverage', {
    p_company_ids: r.scope.companyIds,
    p_months: opts.months,
    p_lines: wanted.map(w => lineCoverageSpec(w.line)),
    p_buckets: r.buckets,
    p_job_functions: r.jobFunctions,
  });
  if (error) return fallback(error.message);

  const byKey = new Map<string, any>(((data?.lines || []) as any[]).map(l => [String(l.key), l]));
  const lines = [...exactLines];
  for (const { line, upper } of wanted) {
    const got = byKey.get(line.key);
    if (!got) return fallback(`no result for ${line.key}`);
    const citing = Number(got.responses_citing) || 0;
    // A union can never exceed the sum of its members. If it does, the
    // inputs disagree; refuse rather than show a wrong figure.
    if (citing > upper) return fallback(`union for ${line.key} exceeds its members`);
    const wholeHosts = !line.include && !line.exclude;
    const links = wholeHosts
      ? line.members.reduce((s, m) => s + (byHost.get(m)?.citations || 0), 0)
      : null;
    counts.set(line.key, { citing, mentioned: Number(got.mentioned_responses_citing) || 0, citations: links });
    lines.push(line);
  }
  return { lines, counts, note: null };
}

// ─── For the Ask AI and MCP tools ───────────────────────────────────────────

export interface ToolSourceLine {
  line: SourceLine;
  citing: number;
  mentioned: number;
  citations: number | null;
}

export const OWNED_UNAVAILABLE_NOTE =
  'The client\'s own sites and pages could not be read right now, so no source is marked as owned.';

/**
 * Every source line for a tool's window: platforms merged, owned pages split
 * out, coverage exact. `domainRows` are mcp_get_domain_stats rows for
 * r.months; `answers` is the window's answer total (the scope cube's).
 */
export async function readToolSourceLines(
  ctx: ToolContext,
  r: ResolvedScope,
  domainRows: DomainStatRow[],
  answers: number,
): Promise<{ rows: ToolSourceLine[]; notes: string[] }> {
  const notes: string[] = [];
  const ownedRead = await readOwnedEntries(ctx, r.scope.companyIds);
  if (ownedRead.error) notes.push(OWNED_UNAVAILABLE_NOTE);
  const owned = ownedRead.entries;
  const lines = buildSourceLines(domainRows.map(d => d.domain), owned);
  const read = await readLineCounts(ctx, r, { months: r.months, lines, domainRows, owned, answersInScope: answers });
  if (read.note) notes.push(read.note);
  const rows = read.lines
    .map(line => {
      const c = read.counts.get(line.key);
      return c ? { line, citing: c.citing, mentioned: c.mentioned, citations: c.citations } : null;
    })
    .filter((x): x is ToolSourceLine => !!x)
    .sort((a, b) => b.citing - a.citing || a.line.key.localeCompare(b.line.key));
  return { rows, notes };
}

/**
 * The most-cited pages of a source line, merged across its hosts and cut to
 * the line's page rules (a split half only shows its own pages).
 * `pageRows` are mcp_get_cited_pages rows.
 */
export function pagesForLine(line: SourceLine, pageRows: any[], denominator: number, shareKey: string, max = 3): Record<string, unknown>[] {
  const members = new Set(line.members);
  const picked = (pageRows || [])
    .filter(row => members.has(normalizeHost(String(row?.domain || ''))))
    .filter(row => {
      if (!line.include && !line.exclude) return true;
      const n = normalizeSourceUrl(String(row?.url || ''));
      if (!n) return false;
      const hit = (rules: NonNullable<SourceLine['include']>) => rules.some(rule => pathMatches(n.path, rule));
      return line.include ? hit(line.include) : !hit(line.exclude!);
    })
    .sort((a, b) => (Number(b?.answers_citing) || 0) - (Number(a?.answers_citing) || 0));
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of picked) {
    const url = String(row.url);
    if (seen.has(url)) continue;
    seen.add(url);
    const entry = pageEntry(row, denominator, shareKey);
    if (entry) out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

/** Methodology lines every tool that lists sources attaches to its payload. */
export const SOURCE_LINE_NOTES = [
  'One platform is one source: country sites such as in.linkedin.com, linkedin.com, glassdoor.co.in and glassdoor.com are folded together. The client\'s own domains (for example careers.ford.com) stay separate.',
  'Coverage of a merged line is the share of answers citing any of its sites, counted once per answer. Never add the percentages of separate lines: answers overlap.',
  'A platform the client owns pages on appears as two lines, "<Platform>: your pages and posts" (ownership: owned) and "<Platform>: other" (ownership: partly_owned, because the client also owns pages on that platform). An answer can cite both, so the two lines overlap.',
];

/** The tri-state tools report: owned, partly_owned (the client owns some pages on the platform) or third_party. */
export const ownershipOf = (line: Pick<SourceLine, 'owned' | 'partlyOwned'>): 'owned' | 'partly_owned' | 'third_party' =>
  line.owned ? 'owned' : line.partlyOwned ? 'partly_owned' : 'third_party';
