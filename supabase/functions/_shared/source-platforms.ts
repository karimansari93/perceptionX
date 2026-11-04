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
//   Sites that are not registered fold only by country: a leading
//   country-code subdomain (de.example.com) and country or .com variants of
//   the same name (example.de, example.co.uk, example.com) become one line.
//   Hosts a client owns are never folded, and other subdomains are never
//   dropped, so careers.ford.com, india.ford.com and ford.com stay separate
//   lines. New platforms are added to PLATFORMS below.
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
  /** Stable key. */
  key: string;
  /** Name shown to people. */
  name: string;
  /** Canonical host: logo lookups and the merged line's domain. */
  domain: string;
  /** Registrable labels that are this platform under .com or any country suffix. */
  labels: string[];
  /** Hosts (and their subdomains) that belong to the platform whatever their label. */
  hosts: string[];
  /** Extra generic suffixes besides .com ("org" for wikipedia.org). */
  suffixes?: string[];
}

// Mirrors the dashboard's employer-review and social platform cards
// (src/utils/sourceConfig.ts, SourcesTab.tsx); sourcePlatforms.test.ts fails
// if the two disagree on a name's logo domain. A bare token there is a label
// here; a dotted token is a host.
export const PLATFORMS: PlatformDef[] = [
  { key: 'glassdoor', name: 'Glassdoor', domain: 'glassdoor.com', labels: ['glassdoor'], hosts: ['glassdoor.com'] },
  { key: 'indeed', name: 'Indeed', domain: 'indeed.com', labels: ['indeed'], hosts: ['indeed.com'] },
  { key: 'ambitionbox', name: 'AmbitionBox', domain: 'ambitionbox.com', labels: ['ambitionbox'], hosts: ['ambitionbox.com'] },
  { key: 'kununu', name: 'Kununu', domain: 'kununu.com', labels: ['kununu'], hosts: ['kununu.com'] },
  { key: 'comparably', name: 'Comparably', domain: 'comparably.com', labels: ['comparably'], hosts: ['comparably.com'] },
  { key: 'blind', name: 'Blind', domain: 'teamblind.com', labels: ['teamblind'], hosts: ['teamblind.com'] },
  { key: 'fishbowl', name: 'Fishbowl', domain: 'fishbowlapp.com', labels: ['fishbowlapp'], hosts: ['fishbowlapp.com'] },
  { key: 'levelsfyi', name: 'Levels.fyi', domain: 'levels.fyi', labels: [], hosts: ['levels.fyi'] },
  { key: 'themuse', name: 'The Muse', domain: 'themuse.com', labels: ['themuse'], hosts: ['themuse.com'] },
  { key: 'seek', name: 'Seek', domain: 'seek.com.au', labels: ['seek'], hosts: ['seek.com.au'] },
  { key: 'greatplacetowork', name: 'Great Place to Work', domain: 'greatplacetowork.com', labels: ['greatplacetowork', 'gptw'], hosts: ['greatplacetowork.com'] },
  { key: 'builtin', name: 'Built In', domain: 'builtin.com', labels: ['builtin'], hosts: ['builtin.com'] },
  { key: 'vault', name: 'Vault', domain: 'vault.com', labels: [], hosts: ['vault.com'] },
  { key: 'fairygodboss', name: 'FairyGodBoss', domain: 'fairygodboss.com', labels: ['fairygodboss'], hosts: ['fairygodboss.com'] },
  { key: 'careerbliss', name: 'CareerBliss', domain: 'careerbliss.com', labels: ['careerbliss'], hosts: ['careerbliss.com'] },
  { key: 'inhersight', name: 'InHerSight', domain: 'inhersight.com', labels: ['inhersight'], hosts: ['inhersight.com'] },
  { key: 'jobcase', name: 'JobCase', domain: 'jobcase.com', labels: ['jobcase'], hosts: ['jobcase.com'] },
  { key: 'wayup', name: 'WayUp', domain: 'wayup.com', labels: ['wayup'], hosts: ['wayup.com'] },
  { key: 'zippia', name: 'Zippia', domain: 'zippia.com', labels: ['zippia'], hosts: ['zippia.com'] },
  { key: 'ziprecruiter', name: 'ZipRecruiter', domain: 'ziprecruiter.com', labels: ['ziprecruiter'], hosts: ['ziprecruiter.com'] },
  { key: 'monster', name: 'Monster', domain: 'monster.com', labels: [], hosts: ['monster.com'] },
  { key: 'careerbuilder', name: 'CareerBuilder', domain: 'careerbuilder.com', labels: ['careerbuilder'], hosts: ['careerbuilder.com'] },
  { key: 'simplyhired', name: 'SimplyHired', domain: 'simplyhired.com', labels: ['simplyhired'], hosts: ['simplyhired.com'] },
  { key: 'dice', name: 'Dice', domain: 'dice.com', labels: [], hosts: ['dice.com'] },
  { key: 'naukri', name: 'Naukri', domain: 'naukri.com', labels: ['naukri', 'naukrigulf'], hosts: ['naukri.com'] },
  { key: 'jobstreet', name: 'JobStreet', domain: 'jobstreet.com', labels: ['jobstreet'], hosts: ['jobstreet.com'] },
  { key: 'stepstone', name: 'StepStone', domain: 'stepstone.de', labels: ['stepstone'], hosts: ['stepstone.de'] },
  { key: 'welcometothejungle', name: 'Welcome to the Jungle', domain: 'welcometothejungle.com', labels: ['welcometothejungle'], hosts: ['welcometothejungle.com'] },
  { key: 'thejobcrowd', name: 'The Job Crowd', domain: 'thejobcrowd.com', labels: ['thejobcrowd'], hosts: ['thejobcrowd.com'] },
  { key: 'ratemyemployer', name: 'Rate My Employer', domain: 'ratemyemployer.com', labels: ['ratemyemployer'], hosts: ['ratemyemployer.com'] },
  { key: 'openwork', name: 'OpenWork', domain: 'openwork.jp', labels: [], hosts: ['en-hyouban.com', 'openwork.jp'] },
  { key: 'jobtalk', name: 'JobTalk', domain: 'jobtalk.jp', labels: ['jobtalk'], hosts: ['jobtalk.jp'] },
  { key: 'syukatsukaigi', name: 'Syukatsu Kaigi', domain: 'syukatsu-kaigi.jp', labels: [], hosts: ['syukatsu-kaigi.jp'] },
  { key: 'onecareer', name: 'ONE CAREER', domain: 'onecareer.jp', labels: ['onecareer'], hosts: ['onecareer.jp'] },
  { key: 'jobplanet', name: 'JobPlanet', domain: 'jobplanet.co.kr', labels: ['jobplanet'], hosts: ['jobplanet.co.kr'] },
  { key: 'jobkorea', name: 'JobKorea', domain: 'jobkorea.co.kr', labels: ['jobkorea'], hosts: ['jobkorea.co.kr'] },
  { key: 'goworkpl', name: 'GoWork.pl', domain: 'gowork.pl', labels: ['gowork'], hosts: ['gowork.pl'] },
  { key: 'undelucram', name: 'Undelucram', domain: 'undelucram.ro', labels: ['undelucram'], hosts: ['undelucram.ro'] },
  { key: 'professionhu', name: 'Profession.hu', domain: 'profession.hu', labels: [], hosts: ['profession.hu'] },
  { key: 'wherewework', name: 'Where We Work', domain: 'wherewework.hu', labels: ['wherewework'], hosts: ['wherewework.hu'] },
  { key: 'choosemycompany', name: 'ChooseMyCompany', domain: 'choosemycompany.com', labels: ['choosemycompany'], hosts: ['choosemycompany.com'] },
  { key: 'infojobs', name: 'InfoJobs', domain: 'infojobs.com.br', labels: ['infojobs'], hosts: ['infojobs.com.br'] },
  { key: 'mercotalento', name: 'Merco Talento', domain: 'merco.info', labels: [], hosts: ['merco.info'] },
  { key: 'computrabajo', name: 'Computrabajo', domain: 'computrabajo.com', labels: ['computrabajo'], hosts: ['computrabajo.com'] },
  { key: 'bumeran', name: 'Bumeran', domain: 'bumeran.com', labels: ['bumeran'], hosts: ['bumeran.com'] },
  { key: 'elempleo', name: 'elempleo', domain: 'elempleo.com', labels: ['elempleo'], hosts: ['elempleo.com'] },
  { key: 'occmundial', name: 'OCC Mundial', domain: 'occ.com.mx', labels: [], hosts: ['occ.com.mx'] },
  { key: 'catho', name: 'Catho', domain: 'catho.com.br', labels: [], hosts: ['catho.com.br'] },
  { key: 'vagas', name: 'Vagas', domain: 'vagas.com.br', labels: [], hosts: ['vagas.com.br'] },
  { key: 'workventure', name: 'WorkVenture', domain: 'workventure.com', labels: ['workventure'], hosts: ['workventure.com'] },
  { key: 'jobsdb', name: 'JobsDB', domain: 'jobsdb.com', labels: ['jobsdb'], hosts: ['jobsdb.com'] },
  { key: 'shine', name: 'Shine', domain: 'shine.com', labels: [], hosts: ['shine.com'] },
  { key: 'foundit', name: 'Foundit', domain: 'foundit.in', labels: [], hosts: ['foundit.in'] },
  { key: 'bayt', name: 'Bayt', domain: 'bayt.com', labels: [], hosts: ['bayt.com'] },
  { key: 'gulftalent', name: 'GulfTalent', domain: 'gulftalent.com', labels: [], hosts: ['gulftalent.com'] },
  { key: 'payscale', name: 'Payscale', domain: 'payscale.com', labels: ['payscale'], hosts: ['payscale.com'] },
  { key: 'salarycom', name: 'Salary.com', domain: 'salary.com', labels: [], hosts: ['salary.com'] },
  { key: 'repvue', name: 'RepVue', domain: 'repvue.com', labels: ['repvue'], hosts: ['repvue.com'] },
  { key: 'taro', name: 'Taro', domain: 'jointaro.com', labels: ['jointaro'], hosts: ['jointaro.com'] },
  { key: 'canadastop100employers', name: "Canada's Top 100 Employers", domain: 'canadastop100.com', labels: ['canadastop100'], hosts: ['canadastop100.com'] },
  { key: 'topemployersinstitute', name: 'Top Employers Institute', domain: 'top-employers.com', labels: [], hosts: ['top-employers.com'] },
  { key: 'topworkplaces', name: 'Top Workplaces', domain: 'topworkplaces.com', labels: [], hosts: ['topworkplaces.com'] },
  { key: 'arbeitgeberranking', name: 'Arbeitgeber-Ranking', domain: 'arbeitgeber-ranking.de', labels: [], hosts: ['arbeitgeber-ranking.de'] },
  { key: 'work180', name: 'WORK180', domain: 'work180.com', labels: ['work180'], hosts: ['work180.com'] },
  { key: 'handshake', name: 'Handshake', domain: 'joinhandshake.com', labels: ['joinhandshake'], hosts: ['joinhandshake.com'] },
  { key: 'totaljobs', name: 'Totaljobs', domain: 'totaljobs.com', labels: ['totaljobs'], hosts: ['totaljobs.com'] },
  { key: 'reed', name: 'Reed', domain: 'reed.co.uk', labels: [], hosts: ['reed.co.uk'] },
  { key: 'jobsch', name: 'Jobs.ch', domain: 'jobs.ch', labels: [], hosts: ['jobs.ch'] },
  { key: 'linkedin', name: 'LinkedIn', domain: 'linkedin.com', labels: ['linkedin'], hosts: ['linkedin.com'] },
  { key: 'reddit', name: 'Reddit', domain: 'reddit.com', labels: ['reddit'], hosts: ['reddit.com'] },
  { key: 'youtube', name: 'YouTube', domain: 'youtube.com', labels: ['youtube'], hosts: ['youtu.be', 'youtube.com'] },
  { key: 'x', name: 'X (Twitter)', domain: 'x.com', labels: ['twitter'], hosts: ['x.com'] },
  { key: 'facebook', name: 'Facebook', domain: 'facebook.com', labels: ['facebook'], hosts: ['facebook.com', 'fb.com'] },
  { key: 'instagram', name: 'Instagram', domain: 'instagram.com', labels: ['instagram'], hosts: ['instagram.com'] },
  { key: 'tiktok', name: 'TikTok', domain: 'tiktok.com', labels: ['tiktok'], hosts: ['tiktok.com'] },
  { key: 'quora', name: 'Quora', domain: 'quora.com', labels: ['quora'], hosts: ['quora.com'] },
  { key: 'medium', name: 'Medium', domain: 'medium.com', labels: [], hosts: ['medium.com'] },
  { key: 'threads', name: 'Threads', domain: 'threads.net', labels: ['threads'], hosts: ['threads.net'] },
  { key: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', labels: ['pinterest'], hosts: ['pinterest.com'] },
  { key: 'discord', name: 'Discord', domain: 'discord.com', labels: ['discord'], hosts: ['discord.com'] },
  { key: 'snapchat', name: 'Snapchat', domain: 'snapchat.com', labels: ['snapchat'], hosts: ['snapchat.com'] },
  { key: 'bluesky', name: 'Bluesky', domain: 'bsky.app', labels: ['bluesky'], hosts: ['bsky.app'] },
  { key: 'tumblr', name: 'Tumblr', domain: 'tumblr.com', labels: ['tumblr'], hosts: ['tumblr.com'] },
  { key: 'mastodon', name: 'Mastodon', domain: 'mastodon.social', labels: ['mastodon'], hosts: ['mastodon.social'] },
  { key: 'xing', name: 'XING', domain: 'xing.com', labels: ['xing'], hosts: ['xing.com'] },
  { key: 'wikipedia', name: 'Wikipedia', domain: 'wikipedia.org', labels: ['wikipedia'], hosts: ['wikipedia.org'], suffixes: ['org'] },
];

// Short links and aliases that belong to a platform above.
const EXTRA_HOSTS: Record<string, string[]> = {
  linkedin: ['lnkd.in'], reddit: ['redd.it'], youtube: ['youtu.be'], facebook: ['fb.me', 'fb.com'], x: ['t.co', 'twitter.com'],
};

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
const COUNTRY_SUFFIX = /^(?:(?:co|com|org|net|ac|gov|edu)\.)?[a-z]{2}$/;

const BY_LABEL = new Map<string, PlatformDef>();
const BY_HOST = new Map<string, PlatformDef>();
const BY_KEY = new Map<string, PlatformDef>();
for (const p of PLATFORMS) {
  BY_KEY.set(p.key, p);
  for (const l of p.labels) if (!BY_LABEL.has(l)) BY_LABEL.set(l, p);
  for (const h of [...p.hosts, ...(EXTRA_HOSTS[p.key] || [])]) if (!BY_HOST.has(h)) BY_HOST.set(h, p);
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


// ─── Generic country folding (hosts that are not registered platforms) ──────

// ISO 3166 country codes used as subdomains and as suffixes. Codes that are
// also common words or products ("my", "id", "me", "to", "ai", "tv", "io"...)
// are left out of the subdomain rule: my.example.com is an account area.
const COUNTRY_CODES = new Set((
  'ad ae af ag al am ao ar at au az ba bb bd be bf bg bh bi bj bn bo br bs bt bw by bz ca cd cg ch ci cl cm cn co cr cu cv cy cz ' +
  'de dj dk dm dz ec ee eg er es et fi fj fr ga gb ge gh gm gn gr gt gy hk hn hr ht hu ie il in iq ir it jm jo jp ke kg kh kr kw kz ' +
  'la lb lk lr ls lt lu lv ly ma md mg mk ml mm mn mt mu mv mw mx mz na ng ni nl no np nz om pa pe pg ph pk pl pt py qa ro rs ru rw ' +
  'sa sb sc se sg si sk sl sn sv sy tg th tj tn tr tt tw tz ua ug uk us uy uz ve vn ye za zm zw'
).split(' '));

function countrySubdomainStripped(host: string): string {
  const parts = host.split('.');
  if (parts.length >= 3) {
    const first = parts[0];
    if (COUNTRY_CODES.has(first)) {
      const rest = parts.slice(1).join('.');
      if (splitSuffix(rest)) return rest;
    }
  }
  return host;
}

/** The name before the suffix, when the suffix is .com or a country suffix; null otherwise. */
function genericBase(host: string): { base: string; stripped: string; suffix: string } | null {
  const stripped = countrySubdomainStripped(host);
  const parts = stripped.split('.');
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  let suffixLen = 1;
  if (parts.length >= 3 && /^[a-z]{2}$/.test(last) && SECOND_LEVEL.has(prev)) suffixLen = 2;
  const suffix = parts.slice(parts.length - suffixLen).join('.');
  if (parts.length - suffixLen < 1) return null;
  if (suffix !== 'com' && !(COUNTRY_SUFFIX.test(suffix) && (suffixLen === 2 || COUNTRY_CODES.has(suffix)))) return null;
  return { base: parts.slice(0, parts.length - suffixLen).join('.'), stripped, suffix };
}

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
  const generic = new Map<string, { hosts: Set<string>; stripped: Set<string> }>();
  for (const h of hosts) {
    const host = normalizeHost(h);
    if (!host) continue;
    const id = sourceIdentity(host);
    if (!id.platform && !isOwnedHost(host, owned)) {
      // Not a registered platform and not the client's own: fold country
      // subdomains and country variants of the same name.
      const g = genericBase(host);
      if (g) {
        const e = generic.get(g.base) || { hosts: new Set<string>(), stripped: new Set<string>() };
        e.hosts.add(host);
        e.stripped.add(g.stripped);
        generic.set(g.base, e);
        continue;
      }
    }
    const g = groups.get(id.key) || { id, members: new Set<string>() };
    g.members.add(host);
    groups.set(id.key, g);
  }
  for (const [base, e] of generic) {
    if (e.hosts.size === 1) {
      const host = Array.from(e.hosts)[0];
      groups.set(host, { id: { key: host, name: host, domain: host, platform: false }, members: new Set([host]) });
      continue;
    }
    // One line for the family: its .com host when cited, else the shortest.
    const stripped = Array.from(e.stripped).sort((a, b) => a.length - b.length);
    const domain = stripped.find(x => x.endsWith('.com')) || stripped[0];
    groups.set(`family:${base}`, { id: { key: `family:${base}`, name: domain, domain, platform: false }, members: e.hosts });
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
        members, include: null, exclude: null, needsUnion: members.length > 1,
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
