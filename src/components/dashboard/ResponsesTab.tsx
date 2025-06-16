import { useState } from "react";
import LLMLogo from "@/components/LLMLogo";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { getLLMDisplayName } from '@/config/llmLogos';

interface ResponsesTabProps {
  responses: any[];
  parseCitations: (citations: any) => any[];
}

const PROMPT_CATEGORIES = [
  { label: "All", value: "all" },
  { label: "Sentiment", value: "sentiment" },
  { label: "Visibility", value: "visibility" },
  { label: "Competitive", value: "competitive" },
];

export const ResponsesTab = ({ responses }: ResponsesTabProps) => {
  const [expandedRows, setExpandedRows] = useState<{ [key: string]: boolean }>({});
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [selectedResponse, setSelectedResponse] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const truncateText = (text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const getSentimentColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'text-gray-600';
    if (sentimentScore > 0.1) return 'text-green-600';
    if (sentimentScore < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getSentimentBgColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'bg-gray-100';
    if (sentimentScore > 0.1) return 'bg-green-100';
    if (sentimentScore < -0.1) return 'bg-red-100';
    return 'bg-gray-100';
  };

  const handleExpand = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredResponses = responses.filter(r => {
    const categoryMatch = categoryFilter === "all" || r.confirmed_prompts?.prompt_type === categoryFilter;
    const sentiment = r.sentiment_label ? r.sentiment_label.toLowerCase() : 'normal';
    const sentimentMatch = sentimentFilter === "all" ||
      (sentimentFilter === "positive" && sentiment === "positive") ||
      (sentimentFilter === "normal" && (sentiment === "neutral" || sentiment === "normal")) ||
      (sentimentFilter === "negative" && sentiment === "negative");
    return categoryMatch && sentimentMatch;
  });

  const handleRowClick = (response: any) => {
    setSelectedResponse(response);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedResponse(null);
  };

  return (
    <div className="overflow-x-auto">
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="category-filter" className="text-sm font-medium text-gray-700">Filter by prompt type:</label>
        <select
          id="category-filter"
          className="border rounded px-2 py-1 text-sm"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          {PROMPT_CATEGORIES.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <label htmlFor="sentiment-filter" className="text-sm font-medium text-gray-700 ml-4">Filter by sentiment:</label>
        <select
          id="sentiment-filter"
          className="border rounded px-2 py-1 text-sm"
          value={sentimentFilter}
          onChange={e => setSentimentFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="positive">Positive</option>
          <option value="normal">Normal</option>
          <option value="negative">Negative</option>
        </select>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Response</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sentiment</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Visibility</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mentioned</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-40">Competitors</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Answered</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {filteredResponses.map((response: any) => (
            <tr
              key={response.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => handleRowClick(response)}
            >
              <td className="px-4 py-2 max-w-xs">
                <div className="truncate whitespace-nowrap max-w-[300px]">
                  {response.response_text}
                </div>
              </td>
              <td className="px-4 py-2">
                <div className="inline-flex items-center bg-gray-100/80 px-2 py-1 rounded-lg w-fit">
                  <LLMLogo modelName={response.ai_model} size="sm" className="mr-1" />
                  <span className="text-sm text-gray-700">{getLLMDisplayName(response.ai_model)}</span>
                </div>
              </td>
              <td className="px-4 py-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getSentimentBgColor(response.sentiment_score)} ${getSentimentColor(response.sentiment_score)}`}>
                  {response.sentiment_label === 'neutral' ? 'Normal' : response.sentiment_label ? response.sentiment_label.charAt(0).toUpperCase() + response.sentiment_label.slice(1) : 'No sentiment'}
                </span>
              </td>
              <td className="px-4 py-2">
                {typeof response.visibility_score === 'number' ? (
                  <div className="flex items-center gap-2">
                    <svg width="28" height="28" viewBox="0 0 36 36" className="-ml-1">
                      <circle
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        stroke="#e5e7eb" // Tailwind gray-200
                        strokeWidth="4"
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        stroke={
                          response.visibility_score >= 95 ? '#22c55e' : // green-500
                          response.visibility_score >= 60 ? '#4ade80' : // green-400
                          response.visibility_score > 0 ? '#fde047' : // yellow-300
                          '#e5e7eb' // gray-200
                        }
                        strokeWidth="4"
                        strokeDasharray={2 * Math.PI * 16}
                        strokeDashoffset={2 * Math.PI * 16 * (1 - response.visibility_score / 100)}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                      />
                    </svg>
                    <span className="text-sm font-regular text-gray-900">{Math.round(response.visibility_score)}%</span>
                  </div>
                ) : (
                  '-' 
                )}
              </td>
              <td className="px-4 py-2">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${response.company_mentioned ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}`}
                >
                  {response.company_mentioned ? 'Yes' : 'No'}
                </span>
              </td>
              <td className="px-4 py-2 w-20">
                <div className="truncate max-w-sm overflow-hidden">
                  {(() => {
                    const competitorsRaw = typeof response.detected_competitors === 'string' ? response.detected_competitors.trim() : '';
                    // Treat as empty if it contains 'no competitors', 'no competitors or alternatives', 'none', or is not a comma-separated list (case-insensitive)
                    const isNoCompetitors = /no competitors|no competitors or alternatives|none|no specific company|no specific competitors|not mentioned|n\/a|not applicable|glassdoor|indeed|linkedin|monster|careerbuilder|ziprecruiter/i.test(competitorsRaw);
                    // Only allow valid comma-separated company names (letters, numbers, spaces, dashes, dots, ampersands)
                    const validCompanyPattern = /^[A-Za-z0-9 .&\-,'/]+(,[A-Za-z0-9 .&\-,'/]+)*$/;
                    if (
                      competitorsRaw &&
                      !isNoCompetitors &&
                      validCompanyPattern.test(competitorsRaw)
                    ) {
                      // Split, trim, and filter out excluded sources
                      const excluded = [
                        'glassdoor', 'indeed', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
                        'trustpilot', 'g2', 'capterra', 'reuters', 'bloomberg', 'twitter', 'facebook',
                        'crunchbase', 'pitchbook', 'gartner', 'forrester'
                      ];
                      const competitors = Array.from(new Set(
                        competitorsRaw.split(',')
                          .map((c: string) => c.trim())
                          .filter(Boolean)
                          .filter((c: string) => !excluded.includes(c.toLowerCase()))
                      ));
                      if (competitors.length === 0) {
                        return null;
                      }
                      const maxToShow = 1;
                      const extraCount = competitors.length - maxToShow;
                      return (
                        <div className="flex flex-nowrap gap-2">
                          {competitors.slice(0, maxToShow).map((name: string, idx: number) => (
                            <span key={idx} className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">{name}</span>
                          ))}
                          {extraCount > 0 && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">+{extraCount} more</span>
                          )}
                        </div>
                      );
                    } else {
                      return null;
                    }
                  })()}
                </div>
              </td>
              <td className="px-4 py-2">{response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}</td>
            </tr>
          ))}
          {filteredResponses.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center py-8 text-gray-500">
                No responses collected yet. Start monitoring to see AI responses here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {selectedResponse && (
        <ResponseDetailsModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          promptText={selectedResponse.confirmed_prompts?.prompt_text || ''}
          responses={[selectedResponse]}
        />
      )}
    </div>
  );
};
