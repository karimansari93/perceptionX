// One rule for what counts as "a source" and what counts as "owned".
//
// Every surface that groups cited sources reads this file: the quarterly
// email (digest/payload.ts), the Ask AI and MCP tools (px-tools/), and the
// dashboard Sources tab (src/utils/sourcePlatforms.ts re-exports it). Do not
// write a second grouping rule anywhere else.
//
// PLATFORM GROUPING
//   A platform (LinkedIn, Glassdoor, Indeed, AmbitionBox, ...) is one source
//   however many hosts it is cited under: in.linkedin.com, linkedin.com,
//   glassdoor.co.in, glassdoor.com, www2.glassdoor.co.in, mx.indeed.com all
//   fold into one. A host folds when its registrable label is a registered
//   platform AND its suffix is .com, one of the platform's own extra
//   suffixes, or a country suffix (.in, .co.uk, .com.au, ...). Any subdomain
//   of a platform folds with it.
//   Everything else stays as its own host, so a client's own domains
//   (careers.ford.com, india.ford.com) never merge with each other or with
//   anything else. New platforms are added to PLATFORMS below.
//
// OWNERSHIP
//   An owned entry (company_owned_domains.domain) is either
//     - a whole host:  "careers.ford.com" (the host and its subdomains), or
//     - a page prefix: "linkedin.com/company/ford-india",
//                      "linkedin.com/posts/ford-india_".
//   Page prefixes are matched on the platform's folded host, so one entry
//   covers in.linkedin.com, hu.linkedin.com and linkedin.com. A prefix that
//   ends in "_", "-" or "." is a raw string prefix (post slugs); any other
//   prefix matches on a path-segment boundary, so ".../company/ford-india"
//   does not claim ".../company/ford-india-foo". A "*" matches any run of
//   characters (also across "/"); the entry matches from the start of the
//   path and must end on a non-alphanumeric character, so
//   "glassdoor.com/*-e152871" is every page of Glassdoor employer 152871
//   (reviews, interviews, culture: the ID sits at the end of the slug) but
//   not employer 1528719.
//
// COVERAGE
//   Coverage of a merged or split line is the share of ANSWERS that cite any
//   matching URL: a union of answers, computed in SQL
//   (mcp_get_source_line_coverage). Never add the percentages or counts of
//   member domains: one answer often cites several of them.
//
// Pure TypeScript, no imports: it runs in Deno (edge functions) and Vite.

export interface PlatformDef {
  /** Stable key, also the registrable label ("linkedin"). */
  key: string;
  /** Name shown to people. */
  name: string;
  /** Canonical host: logo lookups and the merged line's domain. */
  domain: string;
  /** Extra generic suffixes besides .com ("org" for wikipedia.org). */
  suffixes?: string[];
  /** Hosts that belong to the platform but do not follow the label rule. */
  hosts?: string[];
}

export const PLATFORMS: PlatformDef[] = [
  { key: 'linkedin', name: 'LinkedIn', domain: 'linkedin.com', hosts: ['lnkd.in'] },
  { key: 'glassdoor', name: 'Glassdoor', domain: 'glassdoor.com' },
  { key: 'indeed', name: 'Indeed', domain: 'indeed.com' },
  { key: 'ambitionbox', name: 'AmbitionBox', domain: 'ambitionbox.com' },
  { key: 'naukri', name: 'Naukri', domain: 'naukri.com' },
  { key: 'monster', name: 'Monster', domain: 'monster.com' },
  { key: 'ziprecruiter', name: 'ZipRecruiter', domain: 'ziprecruiter.com' },
  { key: 'simplyhired', name: 'SimplyHired', domain: 'simplyhired.com' },
  { key: 'careerbuilder', name: 'CareerBuilder', domain: 'careerbuilder.com' },
  { key: 'jobstreet', name: 'JobStreet', domain: 'jobstreet.com' },
  { key: 'seek', name: 'Seek', domain: 'seek.com.au' },
  { key: 'stepstone', name: 'StepStone', domain: 'stepstone.de' },
  { key: 'xing', name: 'XING', domain: 'xing.com' },
  { key: 'kununu', name: 'Kununu', domain: 'kununu.com' },
  { key: 'payscale', name: 'PayScale', domain: 'payscale.com' },
  { key: 'comparably', name: 'Comparably', domain: 'comparably.com' },
  { key: 'teamblind', name: 'Blind', domain: 'teamblind.com' },
  { key: 'levels', name: 'Levels.fyi', domain: 'levels.fyi', hosts: ['levels.fyi'] },
  { key: 'builtin', name: 'Built In', domain: 'builtin.com' },
  { key: 'greatplacetowork', name: 'Great Place to Work', domain: 'greatplacetowork.com' },
  { key: 'reddit', name: 'Reddit', domain: 'reddit.com', hosts: ['redd.it'] },
  { key: 'quora', name: 'Quora', domain: 'quora.com' },
  { key: 'medium', name: 'Medium', domain: 'medium.com' },
  { key: 'youtube', name: 'YouTube', domain: 'youtube.com', hosts: ['youtu.be'] },
  { key: 'facebook', name: 'Facebook', domain: 'facebook.com', hosts: ['fb.com', 'fb.me'] },
  { key: 'instagram', name: 'Instagram', domain: 'instagram.com' },
  { key: 'tiktok', name: 'TikTok', domain: 'tiktok.com' },
  // "x" is too short to match by label ("x.co" is a link shortener).
  { key: 'x', name: 'X', domain: 'x.com', hosts: ['x.com', 'twitter.com', 't.co'] },
  { key: 'wikipedia', name: 'Wikipedia', domain: 'wikipedia.org', suffixes: ['org'] },
];

// Keys that only fold through their explicit hosts, never by label.
const HOST_ONLY = new Set(['x', 'levels']);

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
const COUNTRY_SUFFIX = /^(?:(?:co|com|org|net|ac|gov|edu)\.)?[a-z]{2}$/;

const BY_LABEL = new Map<string, PlatformDef>();
const BY_HOST = new Map<string, PlatformDef>();
const BY_KEY = new Map<string, PlatformDef>();
for (const p of PLATFORMS) {
  BY_KEY.set(p.key, p);
  if (!HOST_ONLY.has(p.key)) BY_LABEL.set(p.key, p);
  for (const h of p.hosts || []) BY_HOST.set(h, p);
}

/**
 * Lower-case host without scheme, port, leading "www." or trailing dot. That
 * is exactly how the citation cubes spell a domain, so a host returned here
 * can be matched against cube rows as is ("www2.glassdoor.co.in" stays).
 */
export function normalizeHost(input: string): string {
  let h = String(input || '').trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  return h.replace(/^www\./, '');
}

function splitSuffix(host: string): { label: string; suffix: string } | null {
  const parts = host.split('.');
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  if (parts.length >= 3 && /^[a-z]{2}$/.test(last) && SECOND_LEVEL.has(prev)) {
    return { label: parts[parts.length - 3], suffix: `${prev}.${last}` };
  }
  return { label: prev, suffix: last };
}

/** The registered platform a host belongs to, or null. */
export function platformOfHost(input: string): PlatformDef | null {
  const host = normalizeHost(input);
  if (!host) return null;
  for (const [h, p] of BY_HOST) if (host === h || host.endsWith(`.${h}`)) return p;
  const s = splitSuffix(host);
  if (!s) return null;
  const p = BY_LABEL.get(s.label);
  if (!p) return null;
  if (s.suffix === 'com' || (p.suffixes || []).includes(s.suffix) || COUNTRY_SUFFIX.test(s.suffix)) return p;
  return null;
}

export interface SourceIdentity {
  /** Group key: the platform key, or the host itself. */
  key: string;
  /** Name shown to people: the platform's name, or the host. */
  name: string;
  /** Canonical host (the platform's, or the host itself). */
  domain: string;
  platform: boolean;
}

/** One source per platform; any other host is its own source. */
export function sourceIdentity(input: string): SourceIdentity {
  const p = platformOfHost(input);
  if (p) return { key: p.key, name: p.name, domain: p.domain, platform: true };
  const host = normalizeHost(input);
  return { key: host, name: host, domain: host, platform: false };
}

/** The host a source is grouped under: "in.linkedin.com" → "linkedin.com". */
export const canonicalHost = (input: string): string => sourceIdentity(input).domain;

/** Pretty name for a source host (platform name, else the host). */
export const sourceDisplayName = (input: string): string => sourceIdentity(input).name;

// ─── URLs ───────────────────────────────────────────────────────────────────

export interface NormalizedUrl {
  /** Grouped host: platform hosts fold to the platform's canonical host. */
  host: string;
  /** Lower-cased path without query, hash or trailing slash ("" for the root). */
  path: string;
}

/** Case, scheme, www, country subdomain, query, hash and trailing slash dropped. */
export function normalizeSourceUrl(input: string): NormalizedUrl | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const noScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = noScheme.search(/[/?#]/);
  const hostPart = slash === -1 ? noScheme : noScheme.slice(0, slash);
  const host = normalizeHost(hostPart);
  if (!host || !host.includes('.')) return null;
  const rest = slash === -1 ? '' : noScheme.slice(slash);
  const path = rest.replace(/[?#].*$/, '').toLowerCase().replace(/\/+$/, '');
  return { host: canonicalHost(host), path: path.startsWith('/') ? path : '' };
}

// ─── Owned entries ──────────────────────────────────────────────────────────

export type OwnedEntry =
  | { kind: 'domain'; host: string }
  | { kind: 'page'; host: string; path: string };

export interface PathRule {
  prefix: string;
  /**
   * "raw": plain string prefix. "segment": ends on a path-segment boundary.
   * "wild": the prefix holds "*"; `regex` is the same rule as one pattern
   * that JavaScript and PostgreSQL both read.
   */
  mode: 'raw' | 'segment' | 'wild';
  regex?: string;
}

/** Parse one company_owned_domains.domain value. */
export function parseOwnedEntry(raw: string): OwnedEntry | null {
  const n = normalizeSourceUrl(raw);
  if (!n) return null;
  if (!n.path) {
    // A bare host keeps its own spelling unless it is a platform's.
    return { kind: 'domain', host: platformOfHost(n.host) ? n.host : normalizeHost(raw) };
  }
  return { kind: 'page', host: n.host, path: n.path };
}

export function parseOwnedEntries(raw: Iterable<string>): OwnedEntry[] {
  const seen = new Set<string>();
  const out: OwnedEntry[] = [];
  for (const r of raw) {
    const e = parseOwnedEntry(r);
    if (!e) continue;
    const k = e.kind === 'domain' ? e.host : `${e.host}${e.path}`;
    if (seen.has(k)) continue; // the same entry on many sibling companies is one entry
    seen.add(k);
    out.push(e);
  }
  return out;
}

const wildRegex = (prefix: string): string =>
  `^${prefix.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}(?![a-z0-9])`;

export const pathRule = (prefix: string): PathRule =>
  prefix.includes('*')
    ? { prefix, mode: 'wild', regex: wildRegex(prefix) }
    : { prefix, mode: /[_\-.]$/.test(prefix) ? 'raw' : 'segment' };

export function pathMatches(path: string, rule: PathRule): boolean {
  if (rule.mode === 'wild') return new RegExp(rule.regex || wildRegex(rule.prefix)).test(path);
  if (path === rule.prefix) return true;
  return rule.mode === 'raw' ? path.startsWith(rule.prefix) : path.startsWith(`${rule.prefix}/`);
}

const hostWithin = (host: string, owner: string) => host === owner || host.endsWith(`.${owner}`);

/** Is a whole host owned? Page entries never make a whole host owned. */
export function isOwnedHost(domain: string, owned: OwnedEntry[]): boolean {
  const host = normalizeHost(domain);
  const folded = canonicalHost(host);
  return owned.some(e => e.kind === 'domain' && (hostWithin(host, e.host) || hostWithin(folded, e.host)));
}

/** Is one cited URL owned? Whole-host entries and page prefixes both count. */
export function isOwnedUrl(url: string, owned: OwnedEntry[]): boolean {
  const n = normalizeSourceUrl(url);
  if (!n) return false;
  if (isOwnedHost(n.host, owned)) return true;
  return owned.some(e => e.kind === 'page' && e.host === n.host && pathMatches(n.path, pathRule(e.path)));
}

// ─── Source lines ───────────────────────────────────────────────────────────

/** One row of a source list: a platform, a split half of one, or a single host. */
export interface SourceLine {
  key: string;
  name: string;
  /** Canonical host: logo and click-through. */
  domain: string;
  owned: boolean;
  /** Hosts folded into the line, as cited. */
  members: string[];
  /** Owned half of a split platform: only these pages. */
  include: PathRule[] | null;
  /** "Other" half of a split platform: everything except these pages. */
  exclude: PathRule[] | null;
  /** Needs a union-of-answers read: several hosts, or a page rule. */
  needsUnion: boolean;
}

export const OWNED_PAGES_SUFFIX = 'your pages and posts';
export const OTHER_PAGES_SUFFIX = 'other';

/**
 * Group the hosts cited in a scope into source lines.
 *  - a platform is one line;
 *  - a platform (or any host) the client owns pages on becomes two:
 *    "<Name>: your pages and posts" (owned) and "<Name>: other";
 *  - any other host is its own line, owned when a whole-host entry covers it.
 */
export function buildSourceLines(hosts: Iterable<string>, owned: OwnedEntry[]): SourceLine[] {
  const groups = new Map<string, { id: SourceIdentity; members: Set<string> }>();
  for (const h of hosts) {
    const host = normalizeHost(h);
    if (!host) continue;
    const id = sourceIdentity(host);
    const g = groups.get(id.key) || { id, members: new Set<string>() };
    g.members.add(host);
    groups.set(id.key, g);
  }

  const lines: SourceLine[] = [];
  for (const g of groups.values()) {
    const members = Array.from(g.members).sort();
    const pageRules = owned
      .filter((e): e is Extract<OwnedEntry, { kind: 'page' }> => e.kind === 'page' && sourceIdentity(e.host).key === g.id.key)
      .map(e => pathRule(e.path));
    const wholeOwned = members.every(m => isOwnedHost(m, owned));

    if (!g.id.platform && !pageRules.length) {
      lines.push({
        key: g.id.key, name: g.id.name, domain: g.id.domain, owned: wholeOwned,
        members, include: null, exclude: null, needsUnion: false,
      });
    } else if (!pageRules.length || wholeOwned) {
      lines.push({
        key: g.id.key, name: g.id.name, domain: g.id.domain, owned: wholeOwned,
        members, include: null, exclude: null, needsUnion: members.length > 1,
      });
    } else {
      lines.push({
        key: `${g.id.key}:owned`, name: `${g.id.name}: ${OWNED_PAGES_SUFFIX}`, domain: g.id.domain, owned: true,
        members, include: pageRules, exclude: null, needsUnion: true,
      });
      lines.push({
        key: `${g.id.key}:other`, name: `${g.id.name}: ${OTHER_PAGES_SUFFIX}`, domain: g.id.domain, owned: false,
        members, include: null, exclude: pageRules, needsUnion: true,
      });
    }
  }
  return lines;
}

/** The argument shape mcp_get_source_line_coverage reads for one line. */
export function lineCoverageSpec(line: SourceLine) {
  return { key: line.key, domains: line.members, include: line.include, exclude: line.exclude };
}
