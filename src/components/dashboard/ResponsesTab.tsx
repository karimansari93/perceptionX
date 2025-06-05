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

  const filteredResponses = categoryFilter === "all"
    ? responses
    : responses.filter(r => r.confirmed_prompts?.prompt_type === categoryFilter);

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
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Response</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sentiment</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Visibility</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mentioned</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Competitors</th>
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
                  {response.sentiment_label === 'neutral' ? 'normal' : response.sentiment_label || 'No sentiment'}
                </span>
              </td>
              <td className="px-4 py-2">
                {response.confirmed_prompts?.prompt_type === 'visibility'
                  ? (response.company_mentioned ? '100%' : '0%')
                  : '-'}
              </td>
              <td className="px-4 py-2">{response.mentioned ? 'Yes' : 'No'}</td>
              <td className="px-4 py-2">{response.competitors ? 'Yes' : 'No'}</td>
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
