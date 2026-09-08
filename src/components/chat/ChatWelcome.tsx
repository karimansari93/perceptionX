import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ChatWelcomeProps {
  onSuggestionClick: (suggestion: string) => void;
  greeting: string;
  companyName?: string;
  questions: string[];
  questionsLoading?: boolean;
  /** Step one: the scope pickers (company, markets, functions). */
  scopePickers?: ReactNode;
  scopeSummary?: string;
}

// Welcome screen for a new chat: the greeting, then step one — choose the
// markets and job functions to ask about (several of each are fine) — then
// four starter questions built on the server from the organization's own
// data (see supabase/functions/chat-with-data/starters.ts).
export function ChatWelcome({ onSuggestionClick, greeting, companyName, questions, questionsLoading, scopePickers, scopeSummary }: ChatWelcomeProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
      <img
        alt="PerceptionX"
        className="h-14 w-14 object-contain mb-5 rounded-full"
        src="/logos/PinkBadge.png"
      />

      <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">{greeting}</h2>
      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
        Ask about how AI platforms describe{' '}
        {companyName ? <span className="font-medium text-gray-700">{companyName}</span> : 'your organisation'}
        {' '}to candidates — visibility, sentiment, themes, sources and competitors.
      </p>

      {scopePickers && (
        <div className="w-full max-w-xl rounded-2xl border border-[#13274F]/15 bg-[#13274F]/[0.03] px-5 py-4 mb-6">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#13274F] text-white text-[11px] font-semibold">1</span>
            <span className="text-sm font-semibold text-gray-900">Which markets and job functions?</span>
            <span className="text-xs text-gray-500">Pick as many as you like, or leave "All".</span>
          </div>
          {scopePickers}
          {scopeSummary && <div className="mt-3 text-xs text-gray-500">Asking about: <span className="text-gray-700">{scopeSummary}</span></div>}
        </div>
      )}

      <div className="w-full max-w-xl">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#13274F] text-white text-[11px] font-semibold">2</span>
          <span className="text-sm font-semibold text-gray-900">Ask a question</span>
          <span className="text-xs text-gray-500">or start from one of these.</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
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
    </div>
  );
}
