import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatWelcomeProps {
  onSuggestionClick: (suggestion: string) => void;
  greeting: string;
  companyName?: string;
  questions: string[];
  questionsLoading?: boolean;
}

// Welcome screen: the greeting plus four starter questions built on the
// server from the organization's own data (markets, top attribute, top
// source, job functions) — see supabase/functions/chat-with-data/starters.ts.
export function ChatWelcome({ onSuggestionClick, greeting, companyName, questions, questionsLoading }: ChatWelcomeProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <img
        alt="PerceptionX"
        className="h-14 w-14 object-contain mb-6 rounded-full"
        src="/logos/PinkBadge.png"
      />

      <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">{greeting}</h2>
      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
        Ask about how AI platforms describe{' '}
        {companyName ? <span className="font-medium text-gray-700">{companyName}</span> : 'your organisation'}
        {' '}to candidates — visibility, sentiment, themes, sources and competitors, by market and job function.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
        {questions.map((question, i) => (
          <button
            key={`${i}-${question}`}
            onClick={() => onSuggestionClick(question)}
            className={cn(
              'flex items-start justify-between gap-3 text-left p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors group',
              questionsLoading && 'animate-pulse'
            )}
          >
            <span className="text-sm text-gray-600 group-hover:text-gray-900 leading-snug">{question}</span>
            <ArrowUpRight className="h-4 w-4 text-gray-300 group-hover:text-[#13274F] flex-shrink-0 mt-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
