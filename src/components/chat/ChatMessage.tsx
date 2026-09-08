import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import { Favicon } from '@/components/ui/favicon';
import { getCompetitorFavicon } from '@/utils/citationUtils';
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
      <Favicon domain={hostOf(href)} size="sm" className="flex-shrink-0 rounded-sm" />
      <span className="truncate max-w-[22rem]">{children}</span>
      <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-400" />
    </a>
  );
}

// A named competitor: its logo next to the name.
function CompetitorChip({ name }: { name: string }) {
  const [broken, setBroken] = useState(false);
  const src = getCompetitorFavicon(name);
  return (
    <span className="inline-flex items-center gap-1 align-baseline font-medium text-[#13274F]">
      {src && !broken ? (
        <img src={src} alt="" className="h-[1em] w-[1em] rounded-sm object-contain" onError={() => setBroken(true)} />
      ) : (
        <span className="inline-flex h-[1em] w-[1em] items-center justify-center rounded-sm bg-gray-200 text-[0.6em] text-gray-600">{name.charAt(0)}</span>
      )}
      {name}
    </span>
  );
}

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

// Wraps every mention of a competitor the tools named this turn in a
// `px-competitor:` link (rendered as a logo chip). Skips code, existing
// links and URLs so nothing already linked is touched.
function decorateCompetitors(markdown: string, competitors: string[] | undefined): string {
  const names = (competitors ?? []).map(n => n.trim()).filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  if (!names.length) return markdown;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mention = new RegExp(`(^|[^\\w/@.-])(${escaped.join('|')})(?=$|[^\\w/.-])`, 'g');
  const protectedRe = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+)/g;
  return markdown
    .split(protectedRe)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(mention, (_m, pre, name) => `${pre}[${name}](${COMPETITOR_SCHEME}${encodeURIComponent(name)})`)))
    .join('');
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
  const decorated = useMemo(
    () => (isUser || message.isStreaming ? body : decorateCompetitors(body, message.competitors)),
    [isUser, message.isStreaming, body, message.competitors]
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
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
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
