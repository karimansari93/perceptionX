import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink, Lightbulb, Building2, MessageSquare } from "lucide-react";
import LLMLogo from "@/components/LLMLogo";
import { PromptResponse, PromptData } from "@/types/dashboard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { enhanceCitations, getFavicon } from "@/utils/citationUtils";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from 'react-markdown';
import { getLLMDisplayName } from '@/config/llmLogos';
import { supabase } from "@/integrations/supabase/client";

interface ResponseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptText: string;
  responses: PromptResponse[];
  promptsData?: PromptData[];
  showMarkdownCheatSheet?: boolean;
}

export const ResponseDetailsModal = ({ 
  isOpen, 
  onClose, 
  promptText, 
  responses,
  promptsData = [],
  showMarkdownCheatSheet = false
}: ResponseDetailsModalProps) => {
  const [selectedResponse, setSelectedResponse] = useState<PromptResponse | null>(
    responses.length > 0 ? responses[0] : null
  );
  const [summary, setSummary] = useState<string>("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCache, setSummaryCache] = useState<{ [prompt: string]: string }>({});

  // Find the matching PromptData for this promptText
  const promptData = promptsData.find ? promptsData.find(p => p.prompt === promptText) : undefined;
  const sentimentLabel = promptData?.sentimentLabel;
  const visibilityScores = promptData?.visibilityScores;
  const avgVisibility = visibilityScores && visibilityScores.length > 0 ? visibilityScores.reduce((sum, score) => sum + score, 0) / visibilityScores.length : (responses.length > 0 ? responses.reduce((sum, r) => sum + (r.company_mentioned ? 100 : 0), 0) / responses.length : 0);



  // Update selected response when responses change
  useEffect(() => {
    if (responses.length > 0) {
      setSelectedResponse(responses[0]);
    } else {
      setSelectedResponse(null);
    }
  }, [responses]);

  // Compute averages and sources
  const avgSentiment = responses.length > 0 ? responses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / responses.length : 0;
  const avgSentimentLabel = avgSentiment > 0.1 ? "Positive" : avgSentiment < -0.1 ? "Negative" : "Neutral";
  const brandMentionedPct = responses.length > 0 ? Math.round(responses.filter(r => r.company_mentioned).length / responses.length * 100) : 0;

  // Extract real sources (with URLs)
  const allCitations = responses.flatMap(r => enhanceCitations(Array.isArray(r.citations) ? r.citations : (typeof r.citations === 'string' ? (() => { try { return JSON.parse(r.citations); } catch { return []; } })() : [])));
  const realSources = allCitations.filter(c => c.type === 'website' && c.url);
  const uniqueSources = Array.from(new Map(realSources.map(s => [s.url, s])).values()).slice(0, 5); // up to 5 unique sources

  // Fetch summary from OpenAI API when modal opens or responses change
  useEffect(() => {
    if (!isOpen || responses.length === 0) return;

    // Check cache first
    if (summaryCache[promptText]) {
      setSummary(summaryCache[promptText]);
      setLoadingSummary(false);
      setSummaryError(null);
      return;
    }

    setLoadingSummary(true);
    setSummaryError(null);
    // Group by ai_model and pick the latest response for each
    const latestByModel = Object.values(
      responses.reduce((acc, r) => {
        const model = r.ai_model;
        if (!acc[model] || new Date(r.tested_at) > new Date(acc[model].tested_at)) {
          acc[model] = r;
        }
        return acc;
      }, {} as Record<string, typeof responses[0]>)
    );
    // Build the prompt with only the latest response per model
    const prompt = `Summarize the following AI model responses to the question: "${promptText}" in one concise paragraph, highlighting key themes, sentiment, and any notable mentions.\n\nResponses:\n${latestByModel.map(r => r.response_text.slice(0, 1000)).join('\n---\n')}`;
    
    // Get the current session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSummaryError("Authentication required");
        setLoadingSummary(false);
        return;
      }

      fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-openai", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ prompt })
      })
        .then(res => res.json())
        .then(data => {
          if (data.response) {
            setSummary(data.response.trim());
            setSummaryCache(prev => ({ ...prev, [promptText]: data.response.trim() }));
          } else {
            setSummaryError(data.error || "No summary generated.");
          }
        })
        .catch(err => setSummaryError("Failed to fetch summary."))
        .finally(() => setLoadingSummary(false));
    };

    getSession();
  }, [isOpen, promptText, responses, summaryCache]);

  const getSentimentColor = (score: number | null) => {
    if (!score) return "text-gray-500";
    if (score > 0.1) return "text-green-600";
    if (score < -0.1) return "text-red-600";
    return "text-gray-600";
  };

  const getSentimentBadge = (score: number | null, label: string | null) => {
    if (!score) return "No sentiment";
    const percentage = Math.abs(score * 100).toFixed(0);
    return `${percentage}% ${label || 'Neutral'}`;
  };

  const getVisibilityScore = (response: PromptResponse) => {
    return response.company_mentioned ? "100%" : "0%";
  };

  const getBrandPerception = (response: PromptResponse) => {
    return response.company_mentioned ? "Mentioned" : "Not Mentioned";
  };

  const analyzeResponses = () => {
    if (responses.length === 0) return [];

    const insights = [];

    // Analyze sentiment consistency
    const sentimentScores = responses.map(r => r.sentiment_score).filter(Boolean);
    if (sentimentScores.length > 0) {
      const avgSentiment = sentimentScores.reduce((a, b) => a + b!, 0) / sentimentScores.length;
      const sentimentRange = Math.max(...sentimentScores) - Math.min(...sentimentScores);
      
      if (sentimentRange > 0.3) {
        insights.push("High sentiment variation across models - consider standardizing messaging");
      } else if (avgSentiment > 0.1) {
        insights.push("Consistently positive sentiment across all models");
      } else if (avgSentiment < -0.1) {
        insights.push("Consistently negative sentiment across all models - may need attention");
      }
    }

    // Analyze company visibility
    const visibilityScores = responses.map(r => {
      if (!r.company_mentioned || !r.first_mention_position || !r.total_words) return 0;
      return (1 - (r.first_mention_position / r.total_words)) * 100;
    });
    
    const avgVisibility = visibilityScores.reduce((a, b) => a + b, 0) / visibilityScores.length;
    if (avgVisibility < 30) {
      insights.push("Low company visibility in responses - consider improving brand positioning");
    } else if (avgVisibility > 70) {
      insights.push("Strong company visibility across all models");
    }

    // Analyze response consistency
    const responseLengths = responses.map(r => r.response_text.length);
    const avgLength = responseLengths.reduce((a, b) => a + b, 0) / responseLengths.length;
    const lengthVariation = Math.max(...responseLengths) - Math.min(...responseLengths);
    
    if (lengthVariation > avgLength * 0.5) {
      insights.push("High variation in response lengths - consider standardizing content depth");
    }

    // Analyze competitor mentions
    const competitorMentions = responses.filter(r => r.competitor_mentions).length;
    if (competitorMentions > 0) {
      insights.push(`${competitorMentions} models mentioned competitors - review competitive positioning`);
    }

    return insights;
  };

  // Helper to get unique LLMs for the current responses
  function getUniqueLLMs(responses: PromptResponse[]) {
    const models = new Set<string>();
    responses.forEach(r => {
      if (r.ai_model) models.add(r.ai_model);
    });
    return Array.from(models);
  }
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-lg font-semibold mb-2 text-[#13274F]">
                {promptText}
              </DialogTitle>
              <DialogDescription className="text-sm text-[#13274F]">
                Generated {responses.length > 0 ? new Date(responses[0].tested_at).toLocaleDateString() : 'recently'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Show summary card for all responses (including single TalentX responses) */}
        {responses.length === 0 ? (
          // No responses: show prompt info and message
          <div className="mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-[#13274F]">Prompt Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-1">Prompt</div>
                  <div className="text-base text-gray-900 mb-2 font-medium">
                    {promptText}
                  </div>
                </div>
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium mb-2">No responses yet</p>
                  <p className="text-sm">
                    This prompt hasn't been tested yet. Responses will appear here once the prompt is analyzed.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* MODELS, SENTIMENT & VISIBILITY ROW - with labels above values */}
            <div className="flex flex-row gap-8 mt-1 mb-1 w-full">
              {/* Models */}
              <div className="flex flex-col items-start min-w-[120px]">
                <span className="text-xs text-gray-400 font-medium mb-1">Models</span>
                <div className="flex flex-row flex-wrap items-center gap-2">
                  {getUniqueLLMs(responses).length === 0 ? (
                    <span className="text-xs text-gray-400">None</span>
                  ) : (
                    getUniqueLLMs(responses).map(model => (
                      <span key={model} className="inline-flex items-center">
                        <LLMLogo modelName={model} size="sm" className="mr-1" />
                        <span className="text-xs text-gray-700 mr-2">{getLLMDisplayName(model)}</span>
                      </span>
                    ))
                  )}
                </div>
              </div>
              {/* Sentiment */}
              <div className="flex flex-col items-start min-w-[80px]">
                <span className="text-xs text-gray-400 font-medium mb-1">Sentiment</span>
                {(() => {
                  let label = "Normal";
                  if (sentimentLabel && sentimentLabel.toLowerCase() === "positive") {
                    label = "Positive";
                  } else if (sentimentLabel && sentimentLabel.toLowerCase() === "negative") {
                    label = "Negative";
                  } else if (!sentimentLabel && responses.length > 0) {
                    const avgSentiment = responses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / responses.length;
                    if (avgSentiment > 0.1) {
                      label = "Positive";
                    } else if (avgSentiment < -0.1) {
                      label = "Negative";
                    }
                  }
                  return (
                    <span className="text-xs text-gray-700 mr-2">{label}</span>
                  );
                })()}
              </div>
              {/* Visibility */}
              <div className="flex flex-col items-start min-w-[90px]">
                <span className="text-xs text-gray-400 font-medium mb-1">Visibility</span>
                <span className="flex items-center gap-1">
                  <svg width="20" height="20" viewBox="0 0 20 20" className="-ml-1">
                    <circle
                      cx="10"
                      cy="10"
                      r="8"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="2"
                    />
                    <circle
                      cx="10"
                      cy="10"
                      r="8"
                      fill="none"
                      stroke={
                        avgVisibility >= 95 ? '#22c55e' :
                        avgVisibility >= 60 ? '#4ade80' :
                        avgVisibility > 0 ? '#fde047' :
                        '#e5e7eb'
                      }
                      strokeWidth="2"
                      strokeDasharray={2 * Math.PI * 8}
                      strokeDashoffset={2 * Math.PI * 8 * (1 - avgVisibility / 100)}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                    />
                  </svg>
                  <span className="text-xs font-regular text-gray-900">{Math.round(avgVisibility)}%</span>
                </span>
              </div>
            </div>
            <div className="mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-[#13274F]">Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingSummary ? (
                    <div className="w-full">
                      <Skeleton className="h-6 w-3/4 mb-2" />
                      <Skeleton className="h-6 w-5/6 mb-2" />
                      <Skeleton className="h-6 w-2/3 mb-2" />
                      <Skeleton className="h-6 w-1/2 mb-2" />
                    </div>
                  ) : summaryError ? (
                    <div className="text-red-600 text-sm py-2">{summaryError}</div>
                  ) : (
                    <>
                      <div className="text-gray-800 text-base mb-3 whitespace-pre-line">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                      </div>
                      {uniqueSources.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="text-xs text-gray-500">Sources:</span>
                          {uniqueSources.map((src, i) => (
                            <a
                              key={src.url}
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-full text-xs font-medium text-gray-800 transition-colors border border-gray-200"
                            >
                              <img
                                src={getFavicon(src.domain || src.url.replace(/^https?:\/\//, '').split('/')[0])}
                                alt=""
                                className="w-4 h-4 mr-1 rounded"
                                style={{ background: '#fff' }}
                                onError={e => { e.currentTarget.style.display = 'none'; }}
                              />
                              {src.domain || src.url.replace(/^https?:\/\//, '').split('/')[0]}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
          {/* REMOVED: Responses list panel */}

          {/* Right Panel - Selected Response Details */}
          <ScrollArea className="col-span-3 h-full"> {/* Changed to span all columns */}
            {selectedResponse && (
              <div className="space-y-6 pr-4">
                {/* REMOVED: Metrics Row */}
                {/* REMOVED: Workplace Themes */}
                {/* REMOVED: Brand Perception */}
                {/* REMOVED: User Prompt */}
                {/* REMOVED: AI Response */}
              </div>
            )}
          </ScrollArea>
        </div>

        {showMarkdownCheatSheet && (
          <div className="mt-8 p-4 border-t border-gray-200">
            <h2 className="text-lg font-bold mb-2">Markdown Cheat Sheet</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-1">Markdown Syntax</h3>
                <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
{`
# Heading 1
## Heading 2
### Heading 3

*Italic* or _Italic_
**Bold** or __Bold__
***Bold and Italic***

- Item 1
- Item 2
  - Subitem

1. First
2. Second

[OpenAI](https://openai.com)

![Alt text](https://placehold.co/40x40)

> This is a quote.

\`code\`

| Name  | Age |
|-------|-----|
| John  |  30 |
| Alice |  25 |

- [x] Done
- [ ] Not done
`}
                </pre>
              </div>
              <div>
                <h3 className="font-semibold mb-1">Rendered Output</h3>
                <div className="bg-white p-2 rounded border">
                  <ReactMarkdown>
{`
# Heading 1
## Heading 2
### Heading 3

*Italic* or _Italic_
**Bold** or __Bold__
***Bold and Italic***

- Item 1
- Item 2
  - Subitem

1. First
2. Second

[OpenAI](https://openai.com)

![Alt text](https://placehold.co/40x40)

> This is a quote.

| Name  | Age |
|-------|-----|
| John  |  30 |
| Alice |  25 |

- [x] Done
- [ ] Not done
`}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
