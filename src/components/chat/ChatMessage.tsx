import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { ExternalLink, User } from 'lucide-react';
import { Favicon } from '@/components/ui/favicon';
import { getCompetitorFavicon } from '@/utils/citationUtils';
import type { ChatMessage as ChatMessageType } from '@/services/chatService';
import { ScopeChips } from './ChatScopeBar';
import { BlockSkeleton, ContextPills, ContributionBars, PX_BLOCK, SourceChips, StatTiles, deltaClass, isDeltaText, parseBlock } from './AnswerBlocks';

// A fenced px-* block: render it as a card (or a skeleton while it streams).
function PxBlock({ lang, raw }: { lang: string; raw: string }) {
  const data = parseBlock(lang, raw);
  if (data === null) return <BlockSkeleton />;
  if (lang === 'context') return <ContextPills data={data} />;
  if (lang === 'stats') return <StatTiles data={data} />;
  return <ContributionBars data={data} />;
}

const textOf = (children: unknown): string =>
  Array.isArray(children) ? children.map(textOf).join('') : typeof children === 'string' ? children : '';

interface ChatMessageProps {
  message: ChatMessageType;
}

const isHttpUrl = (href: unknown): href is string => typeof href === 'string' && /^https?:\/\//i.test(href);
const COMPETITOR_SCHEME = 'px-competitor:';

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

// ─── Inline decorations ─────────────────────────────────────────────────────

// A linked source: favicon + title as a badge that opens the exact returned
// URL in a new tab.
function SourceBadge({ href, children }: { href: string; children: React.ReactNode }) {
  const host = hostOf(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="inline-flex items-center gap-1 align-baseline rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[0.92em] leading-tight text-[#13274F] hover:border-[#13274F]/40 hover:bg-[#13274F]/5 transition-colors max-w-full"
    >
      <Favicon domain={host} size="sm" className="flex-shrink-0 rounded-sm" />
      <span className="truncate max-w-[22rem]">{children}</span>
      <ExternalLink className="h-3 w-3 text-gray-400 flex-shrink-0" />
    </a>
  );
}

// A named competitor: its logo next to the name.
function CompetitorChip({ name }: { name: string }) {
  const [broken, setBroken] = useState(false);
  const src = getCompetitorFavicon(name);
  return (
    <span className="inline-flex items-center gap-1 align-baseline font-medium text-gray-900">
      {src && !broken ? (
        <img src={src} alt="" className="h-[1em] w-[1em] rounded-sm object-contain" onError={() => setBroken(true)} />
      ) : (
        <span className="inline-flex h-[1em] w-[1em] items-center justify-center rounded-sm bg-gray-200 text-[0.6em] text-gray-600">{name.charAt(0)}</span>
      )}
      {name}
    </span>
  );
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (typeof href === 'string' && href.startsWith(COMPETITOR_SCHEME)) {
      return <CompetitorChip name={decodeURIComponent(href.slice(COMPETITOR_SCHEME.length))} />;
    }
    // Links open the exact URL the analyst wrote (the rulebook restricts
    // these to pages the tools returned); anything not http(s) is plain text.
    return isHttpUrl(href) ? <SourceBadge href={href}>{children}</SourceBadge> : <span>{children}</span>;
  },
  p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h2 className="font-semibold text-[15px] text-gray-900 mt-4 mb-2 first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="font-semibold text-[15px] text-gray-900 mt-4 mb-2 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold text-sm text-gray-900 mt-3 mb-1.5">{children}</h4>,
  h4: ({ children }) => <h5 className="font-semibold text-sm text-gray-800 mt-2 mb-1">{children}</h5>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2.5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2.5 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[#0DBCBA]/60 pl-3 my-2 text-gray-600 italic">{children}</blockquote>
  ),
  code: ({ children, className }) => {
    const px = className?.match(PX_BLOCK);
    if (px) return <PxBlock lang={px[1]} raw={textOf(children)} />;
    return className ? (
      <code className="block bg-white rounded-md border border-gray-200 p-2 text-xs font-mono overflow-x-auto my-2">{children}</code>
    ) : (
      <code className="bg-white rounded border border-gray-200 px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
    );
  },
  // px-* blocks are cards, not preformatted text.
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cls = (child as any)?.props?.className;
    if (typeof cls === 'string' && PX_BLOCK.test(cls)) return <>{children}</>;
    return <pre className="my-2">{children}</pre>;
  },
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
  th: ({ children }) => <th className="text-left font-semibold text-gray-700 px-3 py-2 border-b border-gray-200 whitespace-nowrap">{children}</th>,
  td: ({ children }) => {
    const text = textOf(children);
    const delta = isDeltaText(text);
    return <td className={cn('px-3 py-2 border-b border-gray-100 align-top', delta && 'text-right tabular-nums', delta && deltaClass(text))}>{children}</td>;
  },
};

// Wraps every mention of a competitor the tools named this turn in a
// `px-competitor:` link (rendered as a logo chip). Skips code, existing
// links and URLs so nothing already linked is touched.
function decorateCompetitors(markdown: string, competitors: string[] | undefined): string {
  const names = (competitors ?? []).map(n => n.trim()).filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  if (!names.length) return markdown;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mention = new RegExp(`(^|[^\\w/@.-])(${escaped.join('|')})(?=$|[^\\w/.-])`, 'g');
  // Segments to leave alone: fenced code, inline code, links, bare URLs.
  const protectedRe = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+)/g;
  return markdown
    .split(protectedRe)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(mention, (_m, pre, name) => `${pre}[${name}](${COMPETITOR_SCHEME}${encodeURIComponent(name)})`)))
    .join('');
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isWaiting = message.isStreaming && !message.content;
  const statusText = message.statusText;
  const decorated = useMemo(
    () => (isUser || message.isStreaming ? message.content : decorateCompetitors(message.content, message.competitors)),
    [isUser, message.isStreaming, message.content, message.competitors]
  );

  return (
    <div className={cn('flex gap-3 py-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-pink-100 text-pink-600' : 'bg-white border border-gray-200'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <img alt="" src="/logos/PinkBadge.png" className="h-5 w-5 rounded-full" />}
      </div>

      <div
        className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser ? 'max-w-[80%] bg-[#13274F] text-white' : 'max-w-[88%] bg-gray-50 border border-gray-100 text-gray-800'
        )}
      >
        {isWaiting ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{statusText || 'Analyzing your data'}</span>
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : isUser ? (
          <>
            {message.scope && <ScopeChips scope={message.scope} />}
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </>
        ) : (
          <>
            <div className="break-words chat-message-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {decorated}
              </ReactMarkdown>
            </div>
            {message.isStreaming && statusText && (
              <div className="mt-2 text-xs text-gray-500">{statusText}</div>
            )}
            {!message.isStreaming && message.sources && message.sources.length > 0 && (
              <SourceChips sources={message.sources} content={message.content} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
