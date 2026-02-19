import { TrendingUp, Users, Globe, Target } from 'lucide-react';

interface ChatWelcomeProps {
  onSuggestionClick: (suggestion: string) => void;
  companyName?: string;
}

const suggestions = [
  {
    icon: Globe,
    text: 'How is our brand perceived across all locations?',
  },
  {
    icon: TrendingUp,
    text: 'Compare sentiment scores across our companies',
  },
  {
    icon: Target,
    text: 'Which location has the strongest AI visibility?',
  },
  {
    icon: Users,
    text: 'What are our biggest perception gaps vs competitors?',
  },
];

export function ChatWelcome({ onSuggestionClick, companyName }: ChatWelcomeProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <img
        alt="PerceptionX"
        className="h-14 w-14 object-contain mb-6 rounded-full"
        src="/logos/PinkBadge.png"
      />

      <h2 className="text-xl font-semibold text-gray-900 mb-2">What's on your mind?</h2>
      <p className="text-sm text-gray-500 text-center max-w-sm mb-4">
        Ask questions about how AI models perceive{' '}
        {companyName ? <span className="font-medium text-gray-700">{companyName}</span> : 'your organization'}
        . I have access to all your companies and locations.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-start gap-3 text-left p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors group"
          >
            <suggestion.icon className="h-5 w-5 text-gray-400 group-hover:text-[#13274F] flex-shrink-0 mt-0.5" />
            <span className="text-sm text-gray-600 group-hover:text-gray-900 leading-snug">
              {suggestion.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
