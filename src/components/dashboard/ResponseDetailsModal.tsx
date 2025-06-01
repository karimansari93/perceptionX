import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink, X, Lightbulb, Building2 } from "lucide-react";
import LLMLogo from "@/components/LLMLogo";
import { PromptResponse } from "@/types/dashboard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { enhanceCitations } from "@/utils/citationUtils";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from 'react-markdown';

interface ResponseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptText: string;
  responses: PromptResponse[];
  showMarkdownCheatSheet?: boolean;
}

export const ResponseDetailsModal = ({ 
  isOpen, 
  onClose, 
  promptText, 
  responses,
  showMarkdownCheatSheet = false
}: ResponseDetailsModalProps) => {
  const [selectedResponse, setSelectedResponse] = useState<PromptResponse | null>(
    responses.length > 0 ? responses[0] : null
  );
  const [summary, setSummary] = useState<string>("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCache, setSummaryCache] = useState<{ [prompt: string]: string }>({});

  // Add debugging and validation
  useEffect(() => {
    if (isOpen) {
      console.log('Modal opened with:');
      console.log('Prompt Text:', promptText);
      console.log('Responses:', responses);
      console.log('Responses count:', responses.length);
      
      // Validate that all responses match the prompt text
      const mismatchedResponses = responses.filter(r => 
        r.confirmed_prompts?.prompt_text !== promptText
      );
      
      if (mismatchedResponses.length > 0) {
        console.error('MISMATCH DETECTED! These responses do not match the prompt:');
        mismatchedResponses.forEach(r => {
          console.error('Response ID:', r.id);
          console.error('Response prompt text:', r.confirmed_prompts?.prompt_text);
          console.error('Expected prompt text:', promptText);
        });
      } else {
        console.log('✅ All responses correctly match the prompt text');
      }
    }
  }, [isOpen, promptText, responses]);

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
  const avgVisibility = responses.length > 0 ? responses.reduce((sum, r) => sum + (r.company_mentioned ? 100 : 0), 0) / responses.length : 0;
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
    fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-lg font-semibold mb-2">
                {promptText}
              </DialogTitle>
              <p className="text-sm text-gray-500">
                Generated {responses.length > 0 ? new Date(responses[0].tested_at).toLocaleDateString() : 'recently'}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Show summary card only if multiple responses (prompt view), otherwise show just the response details */}
        {responses.length > 1 ? (
          <div className="mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Summary</CardTitle>
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
                  <div className="text-gray-800 text-base mb-3 whitespace-pre-line">
                    <ReactMarkdown>{summary}</ReactMarkdown>
                  </div>
                )}
                <div className="flex flex-wrap gap-4 items-center mt-2">
                  <Badge variant="outline">Avg. Sentiment: <span className="ml-1 font-semibold">{Math.round(avgSentiment * 100)}% {avgSentimentLabel}</span></Badge>
                  <Badge variant="outline">Avg. Visibility: <span className="ml-1 font-semibold">{Math.round(avgVisibility)}%</span></Badge>
                  <Badge variant="outline">Brand Mentioned: <span className="ml-1 font-semibold">{brandMentionedPct}%</span></Badge>
                  {/* Workplace Themes Row */}
                  {selectedResponse && selectedResponse.workplace_themes && selectedResponse.workplace_themes.length > 0 && (
                    <div className="flex flex-wrap gap-2 w-full mb-2">
                      <span className="text-xs text-gray-500 mr-2">Workplace Themes:</span>
                      {selectedResponse.workplace_themes
                        .filter(theme => theme.confidence === 'high' || theme.confidence === 'medium')
                        .map((theme, idx) => (
                          <span
                            key={idx}
                            className={`px-2 py-1 rounded text-xs font-medium
                              ${theme.sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                                theme.sentiment === 'neutral' ? 'bg-orange-100 text-orange-800' :
                                'bg-red-100 text-red-800'}
                            `}
                          >
                            {theme.name}
                          </span>
                      ))}
                    </div>
                  )}
                  {uniqueSources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-500">Sources:</span>
                      {uniqueSources.map((src, i) => (
                        <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline text-xs font-medium hover:text-blue-900">
                          {src.domain || src.url.replace(/^https?:\/\//, '').split('/')[0]}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          // Single response: show prompt, model, sentiment, and full response
          <div className="mb-6">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center gap-4">
                <div className="flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
                  <LLMLogo modelName={selectedResponse?.ai_model} size="sm" className="mr-1" />
                  <span className="text-sm text-gray-700">{selectedResponse?.ai_model}</span>
                </div>
                <Badge variant="outline" className="capitalize">
                  {selectedResponse?.sentiment_label || 'No sentiment'}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-1">Prompt</div>
                  <div className="text-base text-gray-900 mb-2 font-medium">
                    {selectedResponse?.confirmed_prompts?.prompt_text}
                  </div>
                </div>
                <div className="mb-2">
                  <div className="text-xs text-gray-500 mb-1">AI Response</div>
                  <div className="text-gray-800 whitespace-pre-line max-h-72 overflow-auto rounded border border-gray-100 p-2 bg-gray-50">
                    {selectedResponse?.response_text && (
                      <ReactMarkdown>{selectedResponse.response_text}</ReactMarkdown>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
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
