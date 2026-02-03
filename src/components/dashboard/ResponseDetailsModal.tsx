import { useState, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink, Lightbulb, Building2, MessageSquare, RefreshCw, Languages } from "lucide-react";
import LLMLogo from "@/components/LLMLogo";
import { PromptResponse, PromptData } from "@/types/dashboard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { enhanceCitations, getFavicon } from "@/utils/citationUtils";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from 'react-markdown';
import { getLLMDisplayName } from '@/config/llmLogos';
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { RefreshProgress } from "@/hooks/useRefreshPrompts";

interface ResponseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptText: string;
  responses: PromptResponse[];
  promptsData?: PromptData[];
  showMarkdownCheatSheet?: boolean;
  companyName?: string;
  onRefreshPrompt?: (promptIds: string[], companyName: string) => Promise<void>;
  isRefreshing?: boolean;
  refreshProgress?: RefreshProgress | null;
}

export const ResponseDetailsModal = ({ 
  isOpen, 
  onClose, 
  promptText, 
  responses,
  promptsData = [],
  showMarkdownCheatSheet = false,
  companyName,
  onRefreshPrompt,
  isRefreshing = false,
  refreshProgress = null
}: ResponseDetailsModalProps) => {
  const [selectedResponse, setSelectedResponse] = useState<PromptResponse | null>(
    responses.length > 0 ? responses[0] : null
  );
  const [summary, setSummary] = useState<string>("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCache, setSummaryCache] = useState<{ [prompt: string]: string }>({});
  const [isRefreshingPrompt, setIsRefreshingPrompt] = useState(false);
  const [translatedSummary, setTranslatedSummary] = useState<string>("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isNonEnglish, setIsNonEnglish] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchingPromptRef = useRef<string | null>(null);
  const previousResponsesKeyRef = useRef<string>("");
  const previousPromptTextRef = useRef<string>("");

  // Find the matching PromptData for this promptText
  const promptData = promptsData.find ? promptsData.find(p => p.prompt === promptText) : undefined;
  const sentimentLabel = promptData?.sentimentLabel;
  const visibilityScores = promptData?.visibilityScores;
  const avgVisibility = visibilityScores && visibilityScores.length > 0 ? visibilityScores.reduce((sum, score) => sum + score, 0) / visibilityScores.length : (responses.length > 0 ? responses.reduce((sum, r) => sum + (r.company_mentioned ? 100 : 0), 0) / responses.length : 0);
  
  // Extract competitors from promptData or aggregate from responses
  const getCompetitors = () => {
    // First try to get from promptData
    if (promptData?.detectedCompetitors) {
      return promptData.detectedCompetitors
        .split(',')
        .map((comp: string) => comp.trim())
        .filter((comp: string) => comp.length > 0);
    }
    
    // Otherwise aggregate from responses
    const competitorSet = new Set<string>();
    responses.forEach(response => {
      if (response.detected_competitors) {
        const competitors = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0);
        competitors.forEach(comp => competitorSet.add(comp));
      }
    });
    
    return Array.from(competitorSet);
  };
  
  const competitors = getCompetitors();



  // Update selected response when responses change
  useEffect(() => {
    if (responses.length > 0) {
      setSelectedResponse(responses[0]);
    } else {
      setSelectedResponse(null);
    }
  }, [responses]);

  // Compute averages and sources - use AI-based sentiment from promptData if available
  const avgSentiment = promptData?.avgSentiment ?? 0; // No fallback to removed sentiment_score
  const avgSentimentLabel = promptData?.sentimentLabel ?? (avgSentiment > 0.1 ? "Positive" : avgSentiment < -0.1 ? "Negative" : "Neutral");
  const brandMentionedPct = responses.length > 0 ? Math.round(responses.filter(r => r.company_mentioned).length / responses.length * 100) : 0;

  // Extract real sources (with URLs)
  const allCitations = responses.flatMap(r => enhanceCitations(Array.isArray(r.citations) ? r.citations : (typeof r.citations === 'string' ? (() => { try { return JSON.parse(r.citations); } catch { return []; } })() : [])));
  const realSources = allCitations.filter(c => c.type === 'website' && c.url);
  const uniqueSources = Array.from(new Map(realSources.map(s => [s.url, s])).values()).slice(0, 5); // up to 5 unique sources

  // Fetch summary from OpenAI API when modal opens or responses change
  useEffect(() => {
    if (!isOpen || responses.length === 0) {
      // Cancel any in-flight requests when modal closes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      fetchingPromptRef.current = null;
      previousResponsesKeyRef.current = "";
      previousPromptTextRef.current = "";
      setSummary("");
      setLoadingSummary(false);
      return;
    }

    // Reset tracking when prompt text changes (new prompt selected)
    if (previousPromptTextRef.current !== promptText) {
      previousPromptTextRef.current = promptText;
      previousResponsesKeyRef.current = "";
    }

    // Create a stable key from responses content (calculated inside effect to avoid dependency issues)
    const responsesContentKey = responses.length === 0 ? "" : responses
      .map(r => {
        if (r.id && r.tested_at) {
          return `${r.id}-${r.tested_at}`;
        }
        // Fallback: use first 100 chars of response text as identifier
        return r.response_text?.slice(0, 100) || 'unknown';
      })
      .sort()
      .join('|');
    
    const responsesKey = promptText && responsesContentKey ? `${promptText}::${responsesContentKey}` : "";

    // Check cache first - if we have a cached summary, use it
    if (summaryCache[promptText]) {
      setSummary(summaryCache[promptText]);
      setLoadingSummary(false);
      setSummaryError(null);
      fetchingPromptRef.current = null;
      // Still update the tracking ref so we don't re-check unnecessarily
      if (responsesKey !== "") {
        previousResponsesKeyRef.current = responsesKey;
      }
      return;
    }

    // Only proceed if responses actually changed (not just array reference)
    // Allow fetch if key is empty (initial state) or if key changed
    if (responsesKey !== "" && previousResponsesKeyRef.current === responsesKey) {
      return;
    }
    
    // Update the tracking ref
    if (responsesKey !== "") {
      previousResponsesKeyRef.current = responsesKey;
    }

    // Prevent multiple simultaneous requests for the same prompt
    if (fetchingPromptRef.current === promptText) {
      return;
    }

    // Cancel any previous in-flight request for a different prompt
    if (abortControllerRef.current && fetchingPromptRef.current !== promptText) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    fetchingPromptRef.current = promptText;

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
      // Capture promptText at the start to have a stable reference
      const currentPromptText = promptText;
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setSummaryError("Authentication required");
          setLoadingSummary(false);
          if (fetchingPromptRef.current === currentPromptText) {
            fetchingPromptRef.current = null;
            abortControllerRef.current = null;
          }
          return;
        }

        const response = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-openai", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ prompt }),
          signal: abortController.signal
        });

        // Check if request was aborted
        if (abortController.signal.aborted) {
          if (fetchingPromptRef.current === currentPromptText) {
            setLoadingSummary(false);
          }
          return;
        }

        const data = await response.json();
        
        // Check again if request was aborted after async operation
        if (abortController.signal.aborted) {
          if (fetchingPromptRef.current === currentPromptText) {
            setLoadingSummary(false);
          }
          return;
        }

        // Only update if this is still the current prompt
        if (fetchingPromptRef.current === currentPromptText) {
          if (data.response) {
            const trimmedResponse = data.response.trim();
            setSummary(trimmedResponse);
            setSummaryCache(prev => ({ ...prev, [currentPromptText]: trimmedResponse }));
          } else {
            setSummaryError(data.error || "No summary generated.");
          }
        }
      } catch (err: any) {
        // Don't set error if request was aborted, but still clear loading state
        if (err.name === 'AbortError') {
          // Clear loading state if this was our request (even if aborted)
          if (fetchingPromptRef.current === currentPromptText) {
            setLoadingSummary(false);
          }
          return;
        }
        // Only set error if this is still the current prompt
        if (fetchingPromptRef.current === currentPromptText) {
          setSummaryError("Failed to fetch summary.");
        }
      } finally {
        // Always clear loading state and refs if this was our request
        if (fetchingPromptRef.current === currentPromptText) {
          setLoadingSummary(false);
          fetchingPromptRef.current = null;
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
          }
        }
      }
    };

    getSession();

    // Cleanup: cancel request only if prompt changes or modal closes
    return () => {
      // This cleanup runs when dependencies change or component unmounts
      // Only cancel if we're still fetching the same prompt (meaning dependencies changed)
      if (fetchingPromptRef.current === promptText) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        fetchingPromptRef.current = null;
      }
    };
  }, [isOpen, promptText, responses, summaryCache]); // Include responses but use content-based key check inside effect

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

    // Analyze sentiment consistency - use AI-based sentiment if available
    const useAIBasedSentiment = promptData?.avgSentiment !== undefined;
    const sentimentScores = useAIBasedSentiment 
      ? [promptData!.avgSentiment] // Use single AI-based sentiment score
      : []; // No fallback to removed sentiment_score
    
    if (sentimentScores.length > 0) {
      const avgSentiment = useAIBasedSentiment 
        ? promptData!.avgSentiment 
        : 0; // No fallback calculation
      
      if (useAIBasedSentiment) {
        // AI-based sentiment analysis insights
        if (avgSentiment > 0.1) {
          insights.push("AI thematic analysis shows consistently positive sentiment across responses");
        } else if (avgSentiment < -0.1) {
          insights.push("AI thematic analysis indicates negative sentiment - may need attention");
        } else {
          insights.push("AI analysis shows neutral sentiment - opportunity for stronger positioning");
        }
      } else {
        // Original sentiment analysis
        const sentimentRange = Math.max(...sentimentScores) - Math.min(...sentimentScores);
        if (sentimentRange > 0.3) {
          insights.push("High sentiment variation across models - consider standardizing messaging");
        } else if (avgSentiment > 0.1) {
          insights.push("Consistently positive sentiment across all models");
        } else if (avgSentiment < -0.1) {
          insights.push("Consistently negative sentiment across all models - may need attention");
        }
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
    const competitorMentions = responses.filter(r => r.detected_competitors).length;
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

  // Extract company name from prompt text if not provided
  const extractedCompanyName = companyName || (() => {
    // Try to extract company name from discovery prompts like "which companies in X industry mention Y?"
    const mentionPattern = /mention\s+([A-Z][a-zA-Z\s&]+?)(?:\s+in|,|\?|$)/i;
    const match = promptText.match(mentionPattern);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try patterns like "about [Company]" or "regarding [Company]"
    const aboutPattern = /(?:about|regarding|for)\s+([A-Z][a-zA-Z\s&]+?)(?:\s+in|,|\?|$)/i;
    const aboutMatch = promptText.match(aboutPattern);
    if (aboutMatch && aboutMatch[1]) {
      return aboutMatch[1].trim();
    }
    
    return null;
  })();

  // Get snippets where company is mentioned
  const getCompanyMentionSnippets = () => {
    if (!extractedCompanyName) return [];
    
    const snippets: { snippet: string; model: string; full: string }[] = [];
    const companyLower = extractedCompanyName.toLowerCase();
    
    // Find responses where company is mentioned
    const mentionedResponses = responses.filter(r => r.company_mentioned === true);
    
    mentionedResponses.forEach(response => {
      if (!response.response_text) return;
      
      const text = response.response_text;
      const textLower = text.toLowerCase();
      
      // Find all occurrences of company name (case-insensitive)
      const companyPattern = new RegExp(
        `(?:\\b)${extractedCompanyName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\b)`,
        'gi'
      );
      
      let match;
      while ((match = companyPattern.exec(text)) !== null) {
        const matchIndex = match.index;
        
        // Get context: 30 characters before and 100 characters after
        const start = Math.max(0, matchIndex - 30);
        const end = Math.min(text.length, matchIndex + match[0].length + 100);
        
        let snippet = text.slice(start, end);
        
        // Highlight the company name in the snippet
        const highlightRegex = new RegExp(
          `(${extractedCompanyName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})`,
          'gi'
        );
        
        // Add ellipsis if not at start/end
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';
        
        snippets.push({
          snippet: snippet.trim(),
          model: response.ai_model || 'Unknown',
          full: response.response_text
        });
        
        // Only get first mention per response to avoid duplicates
        break;
      }
    });
    
    return snippets;
  };

  const companyMentionSnippets = getCompanyMentionSnippets();
  
  // Detect if text is non-English and translate it
  const detectAndTranslate = async (text: string) => {
    if (!text || !user) return;
    
    setIsTranslating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsTranslating(false);
        return;
      }

      // First, detect if the text is non-English
      const detectPrompt = `Detect the language of the following text. Respond with only "English" if it's English, or the language name if it's not English (e.g., "Spanish", "French", "German", etc.). Only respond with the language name, nothing else.\n\nText: "${text.substring(0, 500)}"`;

      const detectResponse = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-openai", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ prompt: detectPrompt })
      });

      if (!detectResponse.ok) {
        setIsTranslating(false);
        return;
      }

      const detectData = await detectResponse.json();
      const detectedLanguage = detectData.response?.trim() || "";
      
      if (detectedLanguage.toLowerCase() === "english" || !detectedLanguage) {
        setIsNonEnglish(false);
        setIsTranslating(false);
        return;
      }

      setIsNonEnglish(true);

      // Translate to English
      const translatePrompt = `Translate the following text to English. Preserve the meaning, tone, and structure. Keep company names, industry names, and proper nouns unchanged.\n\nOriginal text (${detectedLanguage}): "${text}"\n\nEnglish translation:`;

      const translateResponse = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-openai", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ prompt: translatePrompt })
      });

      if (!translateResponse.ok) {
        setIsTranslating(false);
        return;
      }

      const translateData = await translateResponse.json();
      if (translateData.response) {
        setTranslatedSummary(translateData.response.trim());
      }
    } catch (error) {
      console.error("Translation error:", error);
    } finally {
      setIsTranslating(false);
    }
  };

  // Reset translation state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTranslatedSummary("");
      setIsNonEnglish(false);
      setShowTranslation(false);
      setIsTranslating(false);
    }
  }, [isOpen]);

  // Detect language when summary changes
  useEffect(() => {
    if (summary && summary.length > 0 && !translatedSummary && isOpen && user) {
      detectAndTranslate(summary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, isOpen, user]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`max-w-4xl ${companyMentionSnippets.length > 0 ? 'h-[90vh] sm:h-[95vh]' : 'h-[85vh] sm:h-[90vh]'} flex flex-col w-full mx-auto p-0`}>
        <DialogHeader className="pb-3 sm:pb-4 flex-shrink-0 px-6 pt-6">
          <div className="flex-1">
            <DialogTitle className="text-base sm:text-lg font-semibold mb-2 text-[#13274F] leading-tight text-left">
              {promptText}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-[#13274F] text-left">
              Generated {responses.length > 0 ? new Date(responses[0].tested_at).toLocaleDateString() : 'recently'}
            </DialogDescription>
          </div>
        </DialogHeader>
        
        {/* Progress Banner */}
        {isRefreshing && refreshProgress && companyName && (
          <div className="px-6 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200/50 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">
                    We're collecting data about {companyName}
                  </span>
                  {refreshProgress.total > 0 && (
                    <>
                      <span className="text-sm text-gray-600">
                        • {Math.round(((refreshProgress.total - refreshProgress.completed) / refreshProgress.total) * 100)}% remaining
                      </span>
                      {refreshProgress.completed > 0 && refreshProgress.total > refreshProgress.completed && (
                        <span className="text-xs text-gray-500">
                          (est. {Math.ceil(((refreshProgress.total - refreshProgress.completed) * 2.5) / 60)} min)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 px-6 pb-6">

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
                  <p className="text-sm mb-4">
                    This prompt hasn't been tested yet. Responses will appear here once the prompt is analyzed.
                  </p>
                  {onRefreshPrompt && (
                    <Button
                      onClick={async () => {
                        if (!user || !companyName) {
                          toast.error('Unable to refresh prompt');
                          return;
                        }

                        setIsRefreshingPrompt(true);
                        try {
                          // Find the prompt ID from the database
                          const { data: promptData, error } = await supabase
                            .from('confirmed_prompts')
                            .select('id')
                            .eq('prompt_text', promptText)
                            .eq('user_id', user.id)
                            .eq('is_active', true)
                            .limit(1)
                            .single();

                          if (error || !promptData) {
                            toast.error('Could not find prompt to refresh');
                            return;
                          }

                          await onRefreshPrompt([promptData.id], companyName);
                          toast.success('Prompt refresh started. Responses will appear shortly.');
                        } catch (error) {
                          console.error('Error refreshing prompt:', error);
                          toast.error('Failed to refresh prompt');
                        } finally {
                          setIsRefreshingPrompt(false);
                        }
                      }}
                      disabled={isRefreshingPrompt}
                      className="mt-2"
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingPrompt ? 'animate-spin' : ''}`} />
                      {isRefreshingPrompt ? 'Refreshing...' : 'Refresh Responses'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
                         {/* MODELS, SENTIMENT, VISIBILITY & COMPETITORS ROW - with labels above values */}
             <div className="flex flex-row gap-3 sm:gap-8 mt-1 mb-3 sm:mb-1 w-full overflow-x-auto">
               {/* Models */}
               <div className="flex flex-col items-start min-w-[120px] flex-shrink-0">
                 <span className="text-xs text-gray-400 font-medium mb-1">Models</span>
                 <div className="flex flex-row flex-wrap items-center gap-2">
                   {getUniqueLLMs(responses).length === 0 ? (
                     <span className="text-xs text-gray-400">None</span>
                   ) : (
                     getUniqueLLMs(responses).map(model => (
                       <span key={model} className="inline-flex items-center">
                         <LLMLogo modelName={model} size="sm" className="mr-1" />
                         {!isMobile && (
                           <span className="text-xs text-gray-700 mr-2">{getLLMDisplayName(model)}</span>
                         )}
                       </span>
                     ))
                   )}
                 </div>
               </div>
               {/* Sentiment */}
               <div className="flex flex-col items-start min-w-[80px] flex-shrink-0">
                 <span className="text-xs text-gray-400 font-medium mb-1">Sentiment</span>
                 {(() => {
                   let label = "Normal";
                   if (sentimentLabel && sentimentLabel.toLowerCase() === "positive") {
                     label = "Positive";
                   } else if (sentimentLabel && sentimentLabel.toLowerCase() === "negative") {
                     label = "Negative";
                   } else if (!sentimentLabel && responses.length > 0) {
                     // Use the already calculated AI-based avgSentiment
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
               <div className="flex flex-col items-start min-w-[90px] flex-shrink-0">
                 <span className="text-xs text-gray-400 font-medium mb-1">Visibility</span>
                 <span className="flex items-center gap-1">
                   <Badge className={brandMentionedPct > 0 ? 'bg-[#06b6d4] text-white' : 'bg-gray-100 text-gray-800'}>
                     {brandMentionedPct > 0 ? 'Yes' : 'No'}
                   </Badge>
                 </span>
               </div>
             </div>
             
             {/* Competitors Row - Show all competitors */}
             {competitors.length > 0 && (
               <div className="mt-3 mb-3 border-t border-gray-200 pt-3">
                 <div className="flex flex-col items-start">
                   <span className="text-xs text-gray-400 font-medium mb-2">Competitors</span>
                   <div className="flex flex-wrap gap-1 w-full">
                     {competitors.map((name: string, idx: number) => (
                       <Badge key={idx} variant="secondary" className="text-xs">{name}</Badge>
                     ))}
                   </div>
                 </div>
               </div>
             )}
             
             {/* Company Mention Snippets */}
             {brandMentionedPct > 0 && companyMentionSnippets.length > 0 && extractedCompanyName && (
               <div className="mt-4 mb-4 border-t border-gray-200 pt-4">
                 <div className="flex items-center gap-2 mb-3">
                   <Building2 className="w-4 h-4 text-[#06b6d4]" />
                   <span className="text-sm font-semibold text-gray-900">
                     Where {extractedCompanyName} is mentioned:
                   </span>
                 </div>
                 <div className="space-y-3">
                   {companyMentionSnippets.slice(0, 3).map((item, idx) => (
                     <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                       <div className="flex items-center gap-2 mb-2">
                         <LLMLogo modelName={item.model} size="sm" />
                         <span className="text-xs font-medium text-gray-700">{getLLMDisplayName(item.model)}</span>
                       </div>
                       <p className="text-sm text-gray-800 leading-relaxed">
                         {item.snippet.split(new RegExp(`(${extractedCompanyName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi')).map((part, i) => 
                           part.toLowerCase() === extractedCompanyName.toLowerCase() ? (
                             <span key={i} className="bg-yellow-200 font-semibold">{part}</span>
                           ) : part
                         )}
                       </p>
                     </div>
                   ))}
                   {companyMentionSnippets.length > 3 && (
                     <div className="text-xs text-gray-500 text-center pt-2">
                       +{companyMentionSnippets.length - 3} more mention{companyMentionSnippets.length - 3 !== 1 ? 's' : ''}
                     </div>
                   )}
                 </div>
               </div>
             )}
            <div className="flex-1 min-h-0">
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold text-[#13274F]">Summary</CardTitle>
                    {isNonEnglish && !isTranslating && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTranslation(!showTranslation)}
                        className="text-xs"
                      >
                        <Languages className="w-3 h-3 mr-1" />
                        {showTranslation ? 'Show Original' : 'See Translation'}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 p-4">
                  <div className="w-full">
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
                        {isTranslating && (
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Detecting language...</span>
                          </div>
                        )}
                        <div className="text-gray-800 text-sm sm:text-base mb-3 whitespace-pre-line leading-relaxed">
                          <ReactMarkdown>{showTranslation && translatedSummary ? translatedSummary : summary}</ReactMarkdown>
                        </div>
                        {uniqueSources.length > 0 ? (
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
                                <span className="text-xs">
                                  {src.domain || src.url.replace(/^https?:\/\//, '').split('/')[0]}
                                </span>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 mt-2">No sources available</div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Removed unused grid section to prevent layout issues */}

        {showMarkdownCheatSheet && (
          <div className="mt-8 p-3 sm:p-4 border-t border-gray-200">
            <h2 className="text-lg font-bold mb-2">Markdown Cheat Sheet</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                              <div>
                  <h3 className="font-semibold mb-1">Markdown Syntax</h3>
                  <pre className="bg-gray-100 p-2 sm:p-3 rounded text-xs overflow-x-auto">
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
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
