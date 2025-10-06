import { useState } from "react";
import LLMLogo from "@/components/LLMLogo";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { getLLMDisplayName } from '@/config/llmLogos';
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSubscription } from "@/hooks/useSubscription";

interface ResponsesTabProps {
  responses: any[];
  parseCitations: (citations: any) => any[];
  companyName?: string;
}

const PROMPT_CATEGORIES = [
  { label: "All Prompts", value: "all" },
  { label: "Sentiment", value: "sentiment" },
  { label: "Visibility", value: "visibility" },
  { label: "Competitive", value: "competitive" },
];

export const ResponsesTab = ({ responses, companyName = 'your company' }: ResponsesTabProps) => {
  const { isPro } = useSubscription();
  const [expandedRows, setExpandedRows] = useState<{ [key: string]: boolean }>({});
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [selectedResponse, setSelectedResponse] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const isMobile = useIsMobile();

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
    <div className="space-y-4">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Responses</h2>
        <p className="text-gray-600">
          Review individual AI responses about {companyName}, analyze sentiment patterns, and track performance across different prompts.
        </p>
      </div>

      {/* Filters - Only show for Pro users */}
      {isPro && (
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
          <Select
            value={categoryFilter}
            onValueChange={setCategoryFilter}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Prompts" />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_CATEGORIES.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select
            value={sentimentFilter}
            onValueChange={setSentimentFilter}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Sentiments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sentiments</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {filteredResponses.length > 0 ? (
        isMobile ? (
          // Mobile-friendly card layout
          <div className="space-y-4">
            {filteredResponses.map((response: any) => (
              <Card
                key={response.id}
                className="cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleRowClick(response)}
              >
                <CardContent className="p-4">
                  {/* Response text */}
                  <div className="mb-3">
                    <p className="text-sm text-gray-900 leading-relaxed">
                      {truncateText(response.response_text, 200)}
                    </p>
                  </div>
                  
                                     {/* Metrics grid */}
                   <div className="grid grid-cols-2 gap-3 text-xs">
                     <div className="flex items-center gap-2">
                       {!isMobile && <span className="text-gray-500">Model:</span>}
                       <div className="inline-flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
                         <LLMLogo modelName={response.ai_model} size="sm" className="mr-1" />
                         <span className="text-xs text-gray-700">{getLLMDisplayName(response.ai_model)}</span>
                       </div>
                     </div>
                     <div className="flex items-center gap-2">
                       {!isMobile && <span className="text-gray-500">Sentiment:</span>}
                       <Badge className={`text-xs ${getSentimentBgColor(response.sentiment_score)} ${getSentimentColor(response.sentiment_score)}`}>
                         {response.sentiment_label === 'neutral' ? 'Normal' : response.sentiment_label ? response.sentiment_label.charAt(0).toUpperCase() + response.sentiment_label.slice(1) : 'No sentiment'}
                       </Badge>
                     </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Visibility:</span>
                      {typeof response.visibility_score === 'number' ? (
                        <div className="flex items-center gap-1">
                          <svg width="16" height="16" viewBox="0 0 36 36">
                            <circle
                              cx="18"
                              cy="18"
                              r="16"
                              fill="none"
                              stroke="#e5e7eb"
                              strokeWidth="4"
                            />
                            <circle
                              cx="18"
                              cy="18"
                              r="16"
                              fill="none"
                              stroke={
                                response.visibility_score >= 95 ? '#22c55e' :
                                response.visibility_score >= 60 ? '#4ade80' :
                                response.visibility_score > 0 ? '#fde047' :
                                '#e5e7eb'
                              }
                              strokeWidth="4"
                              strokeDasharray={2 * Math.PI * 16}
                              strokeDashoffset={2 * Math.PI * 16 * (1 - response.visibility_score / 100)}
                              strokeLinecap="round"
                              style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                            />
                          </svg>
                          <span className="text-xs font-medium text-[#13274F]">{Math.round(response.visibility_score)}%</span>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Mentioned:</span>
                      <Badge className={response.company_mentioned ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}>
                        {response.company_mentioned ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                  </div>
                  
                  {/* Competitors and Date - full width */}
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Competitors:</span>
                        {(() => {
                          if (response.competitor_mentions) {
                            const mentions = Array.isArray(response.competitor_mentions) 
                              ? response.competitor_mentions 
                              : JSON.parse(response.competitor_mentions as string || '[]');
                            
                            if (mentions.length === 0) {
                              return <span className="text-xs text-gray-400">None</span>;
                            }
                            
                            const excluded = [
                              'glassdoor', 'indeed', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
                              'trustpilot', 'g2', 'capterra', 'reuters', 'bloomberg', 'twitter', 'facebook',
                              'crunchbase', 'pitchbook', 'gartner', 'forrester'
                            ];
                            
                            const competitors = mentions
                              .map((mention: any) => mention.name?.trim())
                              .filter(Boolean)
                              .filter((name: string) => !excluded.includes(name.toLowerCase()));
                            
                            if (competitors.length === 0) {
                              return <span className="text-xs text-gray-400">None</span>;
                            }
                            
                            const maxToShow = 1;
                            const extraCount = competitors.length - maxToShow;
                            return (
                              <div className="flex flex-wrap gap-1">
                                {competitors.slice(0, maxToShow).map((name: string, idx: number) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">{name}</Badge>
                                ))}
                                {extraCount > 0 && (
                                  <Badge variant="secondary" className="text-xs">+{extraCount} more</Badge>
                                )}
                              </div>
                            );
                          }
                          return <span className="text-xs text-gray-400">None</span>;
                        })()}
                      </div>
                      <div className="text-xs text-gray-500">
                        {response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          // Desktop table layout
          <div className="overflow-x-auto">
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
                      <div className="truncate whitespace-nowrap max-w-[300px] text-[#13274F]">
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
                              stroke="#e5e7eb"
                              strokeWidth="4"
                            />
                            <circle
                              cx="18"
                              cy="18"
                              r="16"
                              fill="none"
                              stroke={
                                response.visibility_score >= 95 ? '#22c55e' :
                                response.visibility_score >= 60 ? '#4ade80' :
                                response.visibility_score > 0 ? '#fde047' :
                                '#e5e7eb'
                              }
                              strokeWidth="4"
                              strokeDasharray={2 * Math.PI * 16}
                              strokeDashoffset={2 * Math.PI * 16 * (1 - response.visibility_score / 100)}
                              strokeLinecap="round"
                              style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                            />
                          </svg>
                          <span className="text-sm font-regular text-[#13274F]">{Math.round(response.visibility_score)}%</span>
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
                          if (response.competitor_mentions) {
                            const mentions = Array.isArray(response.competitor_mentions) 
                              ? response.competitor_mentions 
                              : JSON.parse(response.competitor_mentions as string || '[]');
                            
                            if (mentions.length === 0) {
                              return null;
                            }
                            
                            const excluded = [
                              'glassdoor', 'indeed', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
                              'trustpilot', 'g2', 'capterra', 'reuters', 'bloomberg', 'twitter', 'facebook',
                              'crunchbase', 'pitchbook', 'gartner', 'forrester'
                            ];
                            
                            const competitors = mentions
                              .map((mention: any) => mention.name?.trim())
                              .filter(Boolean)
                              .filter((name: string) => !excluded.includes(name.toLowerCase()));
                            
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
                          }
                          return null;
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-[#13274F]">{response.answered ? response.answered : (response.tested_at ? new Date(response.tested_at).toLocaleDateString() : '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="text-center py-8 text-gray-500">
          No responses collected yet. Start monitoring to see AI responses here.
        </div>
      )}

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
