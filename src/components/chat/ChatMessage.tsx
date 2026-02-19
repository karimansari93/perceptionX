import { cn } from '@/lib/utils';
import { Bot, User } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '@/services/chatService';

interface ChatMessageProps {
  message: ChatMessageType;
}

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
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-[#13274F] text-white'
            : 'bg-gray-100 text-gray-800'
        )}
      >
        {isWaiting ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{statusText || 'Analyzing your data'}</span>
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words chat-message-content">
            {formatMessage(message.content)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatMessage(content: string): React.ReactNode {
  if (!content) return null;

  // Simple markdown-like formatting
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="font-semibold text-base mt-3 mb-1">
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="font-bold text-base mt-4 mb-1">
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h2 key={i} className="font-bold text-lg mt-4 mb-2">
          {line.slice(2)}
        </h2>
      );
    }
    // Bullet points
    else if (line.match(/^[-•*]\s/)) {
      elements.push(
        <div key={i} className="flex gap-2 ml-2">
          <span className="text-gray-400 flex-shrink-0">•</span>
          <span>{formatInlineText(line.slice(2))}</span>
        </div>
      );
    }
    // Numbered lists
    else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 ml-2">
            <span className="text-gray-400 flex-shrink-0 min-w-[1.25rem]">{match[1]}.</span>
            <span>{formatInlineText(match[2])}</span>
          </div>
        );
      }
    }
    // Empty lines
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    }
    // Regular text
    else {
      elements.push(
        <p key={i} className="mb-1">
          {formatInlineText(line)}
        </p>
      );
    }
  }

  return <>{elements}</>;
}

function formatInlineText(text: string): React.ReactNode {
  // Bold text: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
