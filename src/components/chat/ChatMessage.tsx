import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { Bot, ExternalLink, User } from 'lucide-react';
import { Favicon } from '@/components/ui/favicon';
import type { ChatMessage as ChatMessageType, SourceLink } from '@/services/chatService';

interface ChatMessageProps {
  message: ChatMessageType;
}

const isHttpUrl = (href: unknown): href is string => typeof href === 'string' && /^https?:\/\//i.test(href);

// Markdown → elements. Links open the exact URL the analyst wrote (which the
// rulebook restricts to the pages the tools returned) in a new tab; any
// non-http(s) href is rendered as plain text so nothing else is clickable.
const markdownComponents: Components = {
  a: ({ href, children }) =>
    isHttpUrl(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#13274F] underline decoration-[#13274F]/40 underline-offset-2 hover:decoration-[#13274F] break-words"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h2 className="font-bold text-base mt-3 mb-1.5">{children}</h2>,
  h2: ({ children }) => <h3 className="font-bold text-base mt-3 mb-1.5">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold text-sm mt-3 mb-1">{children}</h4>,
  h4: ({ children }) => <h5 className="font-semibold text-sm mt-2 mb-1">{children}</h5>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 pl-3 my-2 text-gray-600 italic">{children}</blockquote>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className="block bg-white/70 rounded-md p-2 text-xs font-mono overflow-x-auto my-2">{children}</code>
    ) : (
      <code className="bg-white/70 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
    ),
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 -mx-1">
      <table className="min-w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/60">{children}</thead>,
  th: ({ children }) => <th className="text-left font-semibold px-2 py-1.5 border-b border-gray-200 whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1.5 border-b border-gray-100 align-top">{children}</td>,
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isWaiting = message.isStreaming && !message.content;
  const statusText = message.statusText;

  return (
    <div className={cn('flex gap-3 py-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-pink-100 text-pink-600' : 'bg-gray-100 text-gray-600'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser ? 'bg-[#13274F] text-white' : 'bg-gray-100 text-gray-800'
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
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <>
            <div className="break-words chat-message-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
            {message.isStreaming && statusText && (
              <div className="mt-2 text-xs text-gray-500">{statusText}</div>
            )}
            {!message.isStreaming && message.sources && message.sources.length > 0 && (
              <SourcesFooter sources={message.sources} content={message.content} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SOURCES_PREVIEW = 5;

// Compact "Sources" footer built from the pages the tools returned for this
// turn. Pages the answer actually linked come first; the rest sit behind a
// "show all" toggle so a long source list never crowds the answer.
function SourcesFooter({ sources, content }: { sources: SourceLink[]; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(() => {
    const linked = sources.filter(s => content.includes(s.url));
    const rest = sources.filter(s => !content.includes(s.url));
    return [...linked, ...rest];
  }, [sources, content]);
  const visible = expanded ? ordered : ordered.slice(0, SOURCES_PREVIEW);
  const hidden = ordered.length - visible.length;

  return (
    <div className="mt-3 pt-3 border-t border-gray-200/80">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Sources</div>
      <ul className="space-y-1">
        {visible.map((s) => (
          <li key={s.url} className="flex items-start gap-2 min-w-0">
            <Favicon domain={s.domain} size="sm" className="mt-[3px] flex-shrink-0 rounded-sm" />
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.url}
              className="group inline-flex items-baseline gap-1 min-w-0 text-xs text-gray-700 hover:text-[#13274F]"
            >
              <span className="truncate max-w-[26rem]">{s.title || s.url}</span>
              <span className="text-gray-400 flex-shrink-0">· {s.domain}</span>
              <ExternalLink className="h-3 w-3 text-gray-400 group-hover:text-[#13274F] flex-shrink-0 self-center" />
            </a>
          </li>
        ))}
      </ul>
      {(hidden > 0 || expanded) && ordered.length > SOURCES_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1.5 text-xs text-gray-500 hover:text-[#13274F] underline underline-offset-2"
        >
          {expanded ? 'Show fewer' : `Show all ${ordered.length} pages`}
        </button>
      )}
    </div>
  );
}
