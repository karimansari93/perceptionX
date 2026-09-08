import { useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import { getCompetitorFavicon, getFavicon } from '@/utils/citationUtils';
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

const textOf = (children: unknown): string =>
  Array.isArray(children) ? children.map(textOf).join('') : typeof children === 'string' ? children : '';

// ─── Inline decorations ─────────────────────────────────────────────────────

// A linked source: favicon + title, opens the exact returned URL in a new tab.
function SourceLinkInline({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="inline-flex max-w-full items-center gap-1 align-baseline rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[0.9em] leading-tight text-[#13274F] transition-colors hover:border-[#DB5E89]"
    >
      <img src={getFavicon(hostOf(href))} alt="" className="h-3 w-3 flex-shrink-0 rounded-sm object-contain" onError={e => { e.currentTarget.style.display = "none"; }} />
      <span className="truncate max-w-[22rem]">{children}</span>
      <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-400" />
    </a>
  );
}

// A named company (competitor or the brand itself): its logo.dev mark next
// to the name. A bare domain or a named source gets the same treatment with
// the domain's logo.
function LogoChip({ src, label, children }: { src: string; label: string; children: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 align-baseline whitespace-nowrap font-medium text-[#13274F]">
      {src && !broken ? (
        <img src={src} alt="" className="h-[1em] w-[1em] rounded-sm object-contain" onError={() => setBroken(true)} />
      ) : (
        <span className="inline-flex h-[1em] w-[1em] items-center justify-center rounded-sm bg-gray-200 text-[0.6em] text-gray-600">{label.charAt(0)}</span>
      )}
      {children}
    </span>
  );
}
const CompetitorChip = ({ name }: { name: string }) => <LogoChip src={getCompetitorFavicon(name)} label={name}>{name}</LogoChip>;
const DomainChip = ({ domain, children }: { domain: string; children: React.ReactNode }) => <LogoChip src={getFavicon(domain)} label={domain}>{children}</LogoChip>;

// A fenced px-* block → card (or a skeleton while it streams).
function PxBlock({ lang, raw, onAsk }: { lang: string; raw: string; onAsk?: (q: string) => void }) {
  const data = parseBlock(lang, raw);
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
    li: ({ children }) => <li>{children}</li>,
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

// Runs a replacer over the plain-text segments of the markdown only.
function decoratePlain(markdown: string, fn: (seg: string) => string): string {
  return markdown.split(PROTECTED).map((seg, i) => (i % 2 === 1 ? seg : fn(seg))).join('');
}

// Bare domains: glassdoor.com, jobs.netflix.com, en.wikipedia.org, gov.uk.
const DOMAIN_RE = /(^|[^\w/@.-])((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|fyi|dev|edu|gov|uk|de|fr|br|in|jp|ca|au|nl|es|it|se|ch|mx|ar|sg|ie|nz|pl|be|at|dk|no|fi|pt|za|kr|hk|tw|ph|id|my|th|vn|tr|ru|cz|hu|ro|gr|il|ae|sa|cl|pe))(?=$|[^\w/-])/gi;

// Wraps every mention of a company (the competitors the tools named this
// turn, plus the brand itself) in a px-competitor: link, and every bare
// domain or named source in a px-domain: link — each rendered as a logo.dev
// chip, in prose and in table cells alike.
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
  const statusText = message.statusText;

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
            <span>{statusText || 'Reading your data'}</span>
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
            {message.isStreaming && statusText && (
              <div className="text-xs text-gray-500">{statusText}</div>
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
