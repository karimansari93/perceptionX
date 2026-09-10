import { Children, createContext, isValidElement, useContext, useMemo, useRef } from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { Favicon } from '@/components/ui/favicon';
import { competitorDomain } from '@/utils/citationUtils';
import type { ChatMessage as ChatMessageType } from '@/services/chatService';
import { ScopeChips } from './ChatScopeBar';
import {
  BlockSkeleton, ContributionBars, FollowUps, PX_BLOCK, SourcePills, StatTiles,
  deltaClass, extractContext, isDeltaText, parseBlock,
} from './AnswerBlocks';

interface ChatMessageProps {
  message: ChatMessageType;
  onAsk?: (question: string) => void;
}

const isHttpUrl = (href: unknown): href is string => typeof href === 'string' && /^https?:\/\//i.test(href);
const COMPETITOR_SCHEME = 'px-competitor:';
const DOMAIN_SCHEME = 'px-domain:';
// react-markdown drops unknown URL schemes; let ours through so the chips render.
const urlTransform = (url: string) => (url.startsWith(COMPETITOR_SCHEME) || url.startsWith(DOMAIN_SCHEME) ? url : defaultUrlTransform(url));

// Sources the analyst names in words rather than as domains. Anything else
// gets a logo when it appears as a domain (glassdoor.com) or is one of the
// domains behind this answer.
const SOURCE_NAMES: Record<string, string> = {
  glassdoor: 'glassdoor.com', indeed: 'indeed.com', reddit: 'reddit.com', linkedin: 'linkedin.com',
  comparably: 'comparably.com', blind: 'teamblind.com', 'levels.fyi': 'levels.fyi', wikipedia: 'en.wikipedia.org',
  youtube: 'youtube.com', instagram: 'instagram.com', facebook: 'facebook.com', tiktok: 'tiktok.com',
  'built in': 'builtin.com', builtin: 'builtin.com', 'great place to work': 'greatplacetowork.com',
  ambitionbox: 'ambitionbox.com', kununu: 'kununu.com', quora: 'quora.com', 'the muse': 'themuse.com',
  fishbowl: 'fishbowlapp.com', 'hacker news': 'news.ycombinator.com', forbes: 'forbes.com',
  'business insider': 'businessinsider.com', bloomberg: 'bloomberg.com', reuters: 'reuters.com',
};

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

// The short name a citation pill shows for a host: a known brand's own
// spelling, else the registrable label capitalised ("careers.ford.com" →
// "Ford", "reviews.canadastop100.com" → "Canadastop100").
const SITE_LABELS: Record<string, string> = {
  glassdoor: 'Glassdoor', indeed: 'Indeed', linkedin: 'LinkedIn', reddit: 'Reddit', youtube: 'YouTube', tiktok: 'TikTok',
  instagram: 'Instagram', facebook: 'Facebook', teamblind: 'Blind', kununu: 'Kununu', comparably: 'Comparably',
  ambitionbox: 'AmbitionBox', greatplacetowork: 'Great Place To Work', builtin: 'Built In', wikipedia: 'Wikipedia',
  levels: 'Levels.fyi', ycombinator: 'Hacker News', quora: 'Quora', themuse: 'The Muse', fishbowlapp: 'Fishbowl',
  prosple: 'Prosple', seek: 'SEEK', canadastop100: "Canada's Top 100", tagesschau: 'Tagesschau', gov: 'GOV.UK',
  forbes: 'Forbes', bloomberg: 'Bloomberg', reuters: 'Reuters', businessinsider: 'Business Insider', ft: 'FT',
  nytimes: 'NYT', theguardian: 'The Guardian', bbc: 'BBC', cnbc: 'CNBC', wsj: 'WSJ', medium: 'Medium', github: 'GitHub',
};
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
export function siteLabel(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return host;
  // Registrable label: the part before the TLD, skipping a second-level
  // suffix such as ".com.br" or ".co.uk".
  let idx = parts.length - 2;
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[idx]) && parts[parts.length - 1].length === 2) idx -= 1;
  const label = parts[idx];
  if (SITE_LABELS[label]) return SITE_LABELS[label];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const textOf = (children: unknown): string =>
  Array.isArray(children) ? children.map(textOf).join('') : typeof children === 'string' ? children : '';

// ─── Inline decorations ─────────────────────────────────────────────────────

// A list item that is nothing but a link ("which pages…?" answers) shows
// the citation in full — title and URL — instead of a pill.
const FullCitation = createContext(false);

// A citation: a small pill with the site's favicon and name, after the
// sentence it supports; hovering shows the page title and URL. In a link
// list it shows the full title with the URL underneath. Either way it
// opens the exact returned URL in a new tab.
function SourceLinkInline({ href, children }: { href: string; children: React.ReactNode }) {
  const host = hostOf(href);
  const label = siteLabel(host);
  const title = textOf(children).trim();
  const hasTitle = !!title && title !== href;
  if (useContext(FullCitation)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="group inline-flex max-w-full flex-col gap-0.5 no-underline">
        <span className="inline-flex items-center gap-1.5 text-[14.5px] text-[#13274F] group-hover:underline">
          <Favicon domain={host} size="sm" className="flex-shrink-0 rounded-sm" />
          <span>{hasTitle ? title : label}</span>
        </span>
        <span className="truncate pl-[18px] text-[12px] text-gray-400">{href}</span>
      </a>
    );
  }
  return (
    <HoverCardPrimitive.Root openDelay={150} closeDelay={80}>
      <HoverCardPrimitive.Trigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-0.5 inline-flex h-[19px] max-w-full items-center gap-1 rounded-full bg-gray-100 px-1.5 align-[2px] text-[11px] font-medium leading-none text-gray-600 no-underline transition-colors hover:bg-gray-200 hover:text-[#13274F]"
        >
          <Favicon domain={host} size="sm" className="flex-shrink-0 rounded-sm" />
          <span className="truncate">{label}</span>
        </a>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-[320px] rounded-xl border border-gray-200 bg-white p-3 shadow-[0_12px_32px_rgba(19,39,79,.14)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <Favicon domain={host} size="sm" className="flex-shrink-0 rounded-sm" />
            <span>{label}</span>
          </div>
          {hasTitle && <div className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-snug text-[#13274F]">{title}</div>}
          <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1.5 block truncate text-[11.5px] text-gray-400 hover:text-[#13274F] hover:underline">{href}</a>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

// True when a list item holds a single link and nothing else worth a word
// (whitespace, a trailing full stop): the analyst is listing pages.
function isLinkOnlyItem(children: React.ReactNode): boolean {
  const kids = Children.toArray(children).filter(c => !(typeof c === 'string' && c.trim().replace(/[.,;:]/g, '') === ''));
  if (kids.length !== 1) return false;
  const only = kids[0];
  return isValidElement(only) && typeof (only.props as any)?.href === 'string' && /^https?:\/\//i.test((only.props as any).href);
}

// A named company (competitor or the brand itself): its logo.dev mark next
// to the name. A bare domain or a named source gets the same treatment with
// the domain's logo.
function LogoChip({ domain, label, children }: { domain: string; label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 align-baseline whitespace-nowrap font-medium text-[#13274F]">
      {domain ? (
        <Favicon domain={domain} size="sm" className="flex-shrink-0 rounded-sm" />
      ) : (
        <span className="inline-flex h-[1em] w-[1em] items-center justify-center rounded-sm bg-gray-200 text-[0.6em] text-gray-600">{label.charAt(0)}</span>
      )}
      {children}
    </span>
  );
}
const CompetitorChip = ({ name }: { name: string }) => <LogoChip domain={competitorDomain(name)} label={name}>{name}</LogoChip>;
const DomainChip = ({ domain, children }: { domain: string; children: React.ReactNode }) => <LogoChip domain={domain} label={domain}>{children}</LogoChip>;

// A fenced px-* block → card. While the block streams, its JSON parses on
// some chunks and not on others; the card keeps the last parse that worked
// instead of blinking to a skeleton, which only shows before the first one.
function PxBlock({ lang, raw, onAsk }: { lang: string; raw: string; onAsk?: (q: string) => void }) {
  const parsed = parseBlock(lang, raw);
  const lastGood = useRef<unknown>(null);
  if (parsed !== null) lastGood.current = parsed;
  const data = parsed ?? lastGood.current;
  if (data === null) return <BlockSkeleton />;
  if (lang === 'stats') return <StatTiles data={data} />;
  if (lang === 'bars') return <ContributionBars data={data} />;
  if (lang === 'followups') return <FollowUps data={data} onAsk={onAsk} />;
  return null; // px-context is lifted into the SCOPE row
}

function buildComponents(onAsk?: (q: string) => void): Components {
  return {
    a: ({ href, children }) => {
      if (typeof href === 'string' && href.startsWith(COMPETITOR_SCHEME)) {
        return <CompetitorChip name={decodeURIComponent(href.slice(COMPETITOR_SCHEME.length))} />;
      }
      if (typeof href === 'string' && href.startsWith(DOMAIN_SCHEME)) {
        return <DomainChip domain={decodeURIComponent(href.slice(DOMAIN_SCHEME.length))}>{children}</DomainChip>;
      }
      return isHttpUrl(href) ? <SourceLinkInline href={href}>{children}</SourceLinkInline> : <span>{children}</span>;
    },
    p: ({ children }) => <p className="text-[15px] leading-[1.65] text-[#13274F] [text-wrap:pretty]">{children}</p>,
    h1: ({ children }) => <h2 className="font-headline text-base font-semibold tracking-[-0.01em] text-[#13274F]">{children}</h2>,
    h2: ({ children }) => <h3 className="font-headline text-base font-semibold tracking-[-0.01em] text-[#13274F]">{children}</h3>,
    h3: ({ children }) => <h4 className="text-sm font-semibold text-[#13274F]">{children}</h4>,
    h4: ({ children }) => <h5 className="text-sm font-semibold text-[#13274F]">{children}</h5>,
    ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-[14.5px] leading-[1.6] text-[#13274F]">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-[14.5px] leading-[1.6] text-[#13274F]">{children}</ol>,
    li: ({ children }) => (
      isLinkOnlyItem(children)
        ? <li className="list-none -ml-5"><FullCitation.Provider value={true}>{children}</FullCitation.Provider></li>
        : <li>{children}</li>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    blockquote: ({ children }) => <blockquote className="border-l-2 border-[#0DBCBA]/60 pl-3 text-gray-600 italic">{children}</blockquote>,
    code: ({ children, className }) => {
      const px = className?.match(PX_BLOCK);
      if (px) return <PxBlock lang={px[1]} raw={textOf(children)} onAsk={onAsk} />;
      return className ? (
        <code className="block overflow-x-auto rounded-xl border border-gray-200 bg-white p-3 text-xs font-mono">{children}</code>
      ) : (
        <code className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
      );
    },
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      const cls = (child as any)?.props?.className;
      if (typeof cls === 'string' && PX_BLOCK.test(cls)) return <>{children}</>;
      return <pre>{children}</pre>;
    },
    hr: () => <hr className="border-gray-200" />,
    // e. Comparison table
    table: ({ children }) => (
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
    th: ({ children }) => {
      const t = textOf(children);
      const versus = /^vs\b/i.test(t.trim());
      return <th data-versus={versus ? 'true' : undefined} className={cn('border-b border-gray-200 px-[14px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-500 whitespace-nowrap', versus && 'text-right')}>{children}</th>;
    },
    tr: ({ children }) => <tr className="border-b border-gray-100 last:border-b-0">{children}</tr>,
    td: ({ children }) => {
      const text = textOf(children);
      const delta = isDeltaText(text);
      return <td className={cn('px-[14px] py-[11px] align-top text-[#13274F]', delta && 'text-right tabular-nums')} data-delta={delta ? 'true' : undefined}>{delta ? <span className="px-delta">{children}</span> : children}</td>;
    },
  };
}

// Code, existing links and URLs: never touched by the decorators below.
const PROTECTED = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+)/g;
const escapeRe = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');

// Runs a replacer over the plain-text segments of table rows only: logos
// belong in comparison tables, where a mark next to each name reads as a
// column; in running prose they interrupt the sentence, and linked sources
// already carry their favicon badge there.
const TABLE_ROW = /^\s*\|/;
function decoratePlain(markdown: string, fn: (seg: string) => string): string {
  return markdown
    .split('\n')
    .map(line => (TABLE_ROW.test(line) ? line.split(PROTECTED).map((seg, i) => (i % 2 === 1 ? seg : fn(seg))).join('') : line))
    .join('\n');
}

// Bare domains: glassdoor.com, jobs.netflix.com, en.wikipedia.org, gov.uk.
const DOMAIN_RE = /(^|[^\w/@.-])((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|fyi|dev|edu|gov|uk|de|fr|br|in|jp|ca|au|nl|es|it|se|ch|mx|ar|sg|ie|nz|pl|be|at|dk|no|fi|pt|za|kr|hk|tw|ph|id|my|th|vn|tr|ru|cz|hu|ro|gr|il|ae|sa|cl|pe))(?=$|[^\w/-])/gi;

// In table cells, wraps every mention of a company (the competitors the
// tools named this turn, plus the brand itself) in a px-competitor: link,
// and every bare domain or named source in a px-domain: link — each
// rendered as a logo.dev chip.
export function decorateEntities(markdown: string, competitors: string[] | undefined, brand: string | null | undefined, sourceDomains: string[]): string {
  let out = markdown;

  const names = [...(competitors ?? []), ...(brand ? [brand] : [])]
    .map(n => n.trim()).filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  if (names.length) {
    const mention = new RegExp('(^|[^\\w/@.-])(' + names.map(escapeRe).join('|') + ')(?=$|[^\\w/.-])', 'g');
    out = decoratePlain(out, seg => seg.replace(mention, (_m, pre, name) => pre + '[' + name + '](' + COMPETITOR_SCHEME + encodeURIComponent(name) + ')'));
  }

  out = decoratePlain(out, seg => seg.replace(DOMAIN_RE, (_m, pre, dom) => pre + '[' + dom + '](' + DOMAIN_SCHEME + encodeURIComponent(dom.toLowerCase()) + ')'));

  // Named sources: the well-known ones, plus the domains behind this answer by their first label.
  const named = new Map<string, string>(Object.entries(SOURCE_NAMES));
  for (const d of sourceDomains) {
    const host = d.replace(/^www\./, '');
    const label = host.split('.')[0];
    if (label.length >= 4 && !named.has(label)) named.set(label, host);
  }
  const keys = Array.from(named.keys()).sort((a, b) => b.length - a.length);
  if (keys.length) {
    const nameRe = new RegExp('(^|[^\\w/@.-])(' + keys.map(escapeRe).join('|') + ')(?=$|[^\\w/.-])', 'gi');
    out = decoratePlain(out, seg => seg.replace(nameRe, (m, pre, name) => {
      const dom = named.get(name.toLowerCase());
      return dom ? pre + '[' + name + '](' + DOMAIN_SCHEME + encodeURIComponent(dom) + ')' : m;
    }));
  }
  return out;
}

// Colours delta cells after render: red/green by sign, or the semantic
// competitor colouring when the column header starts with "vs".
function colourDeltas(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll('table').forEach(table => {
    const heads = Array.from(table.querySelectorAll('th')).map(th => th.dataset.versus === 'true');
    table.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        const cell = td as HTMLElement;
        if (cell.dataset.delta !== 'true') return;
        const span = cell.querySelector('.px-delta') as HTMLElement | null;
        if (!span) return;
        span.className = 'px-delta ' + deltaClass(span.textContent || '', !!heads[i]);
      });
    });
  });
}

export function ChatMessage({ message, onAsk }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isWaiting = message.isStreaming && !message.content;
  const working = !!message.isStreaming && !!message.statusText;

  const { body, context } = useMemo(() => (isUser ? { body: message.content, context: null } : extractContext(message.content)), [isUser, message.content]);
  const sourceDomains = useMemo(() => Array.from(new Set((message.sources ?? []).map(s => s.domain).filter(Boolean))), [message.sources]);
  const decorated = useMemo(
    () => (isUser || message.isStreaming ? body : decorateEntities(body, message.competitors, message.scope?.company, sourceDomains)),
    [isUser, message.isStreaming, body, message.competitors, message.scope?.company, sourceDomains]
  );
  const components = useMemo(() => buildComponents(onAsk), [onAsk]);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-[#f4f4f5] px-4 py-3 text-[14.5px] text-[#13274F]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <img alt="" src="/logos/PinkBadge.png" className="mt-0.5 h-[26px] w-[26px] flex-none object-contain" />
      <div className="flex min-w-0 flex-1 flex-col gap-4" ref={colourDeltas}>
        {/* a. Scope row */}
        {message.scope && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#DB5E89]">Scope</span>
            <ScopeChips scope={message.scope} period={context?.period ?? null} answers={context?.answers ?? null} />
          </div>
        )}

        {isWaiting ? (
          <div className="flex items-center gap-2 text-[13px] text-gray-500">
            <span>Thinking</span>
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <>
            <div className="chat-message-content flex flex-col gap-4 break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
                {decorated}
              </ReactMarkdown>
            </div>
            {working && (
              <div className="text-xs text-gray-500">Thinking…</div>
            )}
            {!message.isStreaming && message.sources && message.sources.length > 0 && (
              <SourcePills sources={message.sources} content={message.content} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
