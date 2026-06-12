import { useState, useEffect, useRef, useMemo } from "react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, MessageSquare, RefreshCw, Languages, X, Sparkles, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RateDonut } from "@/components/ui/rate-donut";
import LLMLogo from "@/components/LLMLogo";
import { PromptResponse, PromptData } from "@/types/dashboard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { enhanceCitations, getFavicon } from "@/utils/citationUtils";
import ReactMarkdown from 'react-markdown';
import { getLLMDisplayName } from '@/config/llmLogos';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { RefreshProgress } from "@/hooks/useRefreshPrompts";

// Same underline-tab treatment as SourceDetailsModal — keep the two modals in step.
const tabTriggerCls = "relative rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-medium text-gray-500 shadow-none transition-colors hover:text-[#13274F] data-[state=active]:border-[#13274F] data-[state=active]:text-[#13274F] data-[state=active]:bg-transparent data-[state=active]:shadow-none";

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
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
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
  refreshProgress = null,
  responseTexts = {},
  fetchResponseTexts,
}: ResponseDetailsModalProps) => {
  const [selectedResponse, setSelectedResponse] = useState<PromptResponse | null>(
    responses.length > 0 ? responses[0] : null
  );
  const [summary, setSummary] = useState<string>("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCache, setSummaryCache] = useState<{ [prompt: string]: string }>({});
  // Set to true once the lazy fetch for response texts has finished (success
  // or failure) for the current open. Lets the summary effect distinguish
  // "text not loaded yet, wait" from "lazy load done, still no text — give up
  // and show a fallback message" instead of stalling on the skeleton forever.
  const [lazyLoadAttempted, setLazyLoadAttempted] = useState(false);
  const [isRefreshingPrompt, setIsRefreshingPrompt] = useState(false);
  const [translatedSummary, setTranslatedSummary] = useState<string>("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isNonEnglish, setIsNonEnglish] = useState(false);
  const { user } = useAuth();
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchingPromptRef = useRef<string | null>(null);
  const previousResponsesKeyRef = useRef<string>("");
  const previousPromptTextRef = useRef<string>("");

  const getResponseText = (r: PromptResponse) => responseTexts[r.id] || r.response_text || '';

  const [activeTab, setActiveTab] = useState<string>('summary');
  const [summaryRetryNonce, setSummaryRetryNonce] = useState(0);
  useEffect(() => {
    if (isOpen) setActiveTab('summary');
  }, [isOpen, promptText]);

  // Watchdog: if the summary request (or the lazy text fetch feeding it)
  // hangs, don't leave the user staring at a loading card forever.
  useEffect(() => {
    if (!loadingSummary) return;
    const timer = setTimeout(() => {
      fetchingPromptRef.current = null;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setLoadingSummary(false);
      setSummaryError("The summary is taking longer than expected.");
    }, 25000);
    return () => clearTimeout(timer);
  }, [loadingSummary]);

  const retrySummary = () => {
    previousResponsesKeyRef.current = "";
    fetchingPromptRef.current = null;
    setSummaryError(null);
    setSummaryCache(prev => {
      const next = { ...prev };
      delete next[promptText];
      return next;
    });
    setSummaryRetryNonce(n => n + 1);
  };

  // Lazy-load response texts when modal opens. Track completion via
  // `lazyLoadAttempted` so the summary effect can fall back to a friendly
  // message if texts genuinely never load (no fetchResponseTexts wired in,
  // or the rows just have empty response_text in the DB).
  useEffect(() => {
    if (!isOpen) {
      setLazyLoadAttempted(false);
      return;
    }
    if (responses.length === 0 || !fetchResponseTexts) {
      setLazyLoadAttempted(true);
      return;
    }
    const ids = responses.map(r => r.id).filter(id => !responseTexts[id]);
    if (ids.length === 0) {
      setLazyLoadAttempted(true);
      return;
    }
    let cancelled = false;
    fetchResponseTexts(ids).finally(() => {
      if (!cancelled) setLazyLoadAttempted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, responses]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally exclude responseTexts to avoid re-firing on every text arrival

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

    // Create a stable key from responses content (calculated inside effect to avoid dependency issues).
    // Include a flag for whether the actual text has been lazy-loaded yet — texts arrive after
    // the modal opens, and without this the key wouldn't change when they do, so we'd never
    // re-run the summary fetch with the real text.
    const responsesContentKey = responses.length === 0 ? "" : responses
      .map(r => {
        const hasText = getResponseText(r).length > 0 ? 't' : 'n';
        if (r.id && r.tested_at) {
          return `${r.id}-${r.tested_at}-${hasText}`;
        }
        return `${getResponseText(r).slice(0, 100) || 'unknown'}-${hasText}`;
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
    // Only include responses whose text has actually loaded. Without this guard, the lazy-loaded
    // text map can be empty on first render and we'd send the LLM an empty Responses block —
    // it would dutifully reply "no responses were provided" and that useless summary would be
    // cached for the prompt.
    const latestWithText = latestByModel.filter(r => getResponseText(r).trim().length > 0);
    if (latestWithText.length === 0) {
      if (!lazyLoadAttempted) {
        // Lazy fetch still in flight — hold the skeleton and wait for it to land;
        // the effect will re-run when `responseTexts` updates (content key flips n→t).
        previousResponsesKeyRef.current = "";
        fetchingPromptRef.current = null;
        return;
      }
      // Lazy load completed but there's still no text to summarize. Don't call the LLM
      // (it would just hallucinate a "no responses" reply that gets cached). Show a
      // friendly fallback so the UI doesn't stall on the skeleton forever.
      setLoadingSummary(false);
      setSummary("_No AI response text is available for this prompt yet._");
      fetchingPromptRef.current = null;
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      return;
    }
    // Build the prompt with only the latest response per model
    const prompt = `Summarize the following AI model responses to the question: "${promptText}" in one concise paragraph, highlighting key themes, sentiment, and any notable mentions.\n\nResponses:\n${latestWithText.map(r => getResponseText(r).slice(0, 1000)).join('\n---\n')}`;
    
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

        const response = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-claude", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
          },
          // Summarizing existing responses — no web search needed (fast/cheap).
          // Uses Claude Haiku 4.5, the same model as the EPS and Sources AI summaries.
          body: JSON.stringify({ prompt, enableWebSearch: false, model: "claude-haiku-4-5", maxTokens: 700 }),
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
  }, [isOpen, promptText, responses, responseTexts, lazyLoadAttempted, summaryCache, summaryRetryNonce]); // responseTexts + lazyLoadAttempted required so the effect re-runs once lazy-loaded text arrives or the fetch resolves empty; summaryRetryNonce forces a manual retry

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
    const responseLengths = responses.map(r => getResponseText(r).length);
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
      const text = getResponseText(response);
      if (!text) return;
      
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
          full: text
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
        body: JSON.stringify({ prompt: detectPrompt, enableWebSearch: false })
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
        body: JSON.stringify({ prompt: translatePrompt, enableWebSearch: false })
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

  const uniqueLLMs = getUniqueLLMs(responses);

  const sentimentDisplay = (() => {
    let label = 'Neutral';
    if (sentimentLabel && sentimentLabel.toLowerCase() === 'positive') {
      label = 'Positive';
    } else if (sentimentLabel && sentimentLabel.toLowerCase() === 'negative') {
      label = 'Negative';
    } else if (!sentimentLabel && responses.length > 0) {
      if (avgSentiment > 0.1) label = 'Positive';
      else if (avgSentiment < -0.1) label = 'Negative';
    }
    const color = label === 'Positive' ? 'text-[#0DBCBA]' : label === 'Negative' ? 'text-[#DB5E89]' : 'text-[#13274F]';
    return { label, color };
  })();

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 gap-0 flex flex-col [&>button]:hidden">
        {/* Header */}
        <div className="border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-headline text-base sm:text-lg font-semibold text-[#13274F] leading-snug text-left">
                {promptText}
              </SheetTitle>
              <SheetDescription className="text-xs text-gray-500 mt-1 text-left">
                Generated {responses.length > 0 ? new Date(responses[0].tested_at).toLocaleDateString() : 'recently'}
              </SheetDescription>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Stat strip */}
          {responses.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border-t border-gray-100">
              <div className="px-6 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Models</p>
                <div className="mt-1 flex items-center">
                  {uniqueLLMs.length === 0 ? (
                    <span className="text-xs text-gray-400">None</span>
                  ) : (
                    <>
                      <div className="flex -space-x-1.5">
                        {uniqueLLMs.slice(0, 5).map(model => (
                          <div
                            key={model}
                            className="w-6 h-6 rounded-full bg-white border border-gray-100 shadow-sm grid place-items-center"
                            title={getLLMDisplayName(model)}
                          >
                            <LLMLogo modelName={model} size="sm" />
                          </div>
                        ))}
                      </div>
                      {uniqueLLMs.length > 5 && (
                        <span className="ml-1.5 text-[10px] font-semibold text-gray-400">+{uniqueLLMs.length - 5}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="px-6 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sentiment</p>
                <p className={`mt-0.5 text-sm font-semibold ${sentimentDisplay.color}`}>{sentimentDisplay.label}</p>
              </div>
              <div className="px-6 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Visibility</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <RateDonut rate={brandMentionedPct / 100} size={18} />
                  <span className="text-sm font-semibold text-[#13274F]">{brandMentionedPct}%</span>
                </div>
              </div>
              <div className="px-6 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Competitors</p>
                <p className="mt-0.5 text-sm font-semibold text-[#13274F]">{competitors.length}</p>
              </div>
            </div>
          )}
        </div>

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

        {responses.length === 0 ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-full justify-start gap-6 rounded-none border-b border-gray-200 bg-transparent p-0 px-6 h-auto shrink-0">
              <TabsTrigger value="summary" className={tabTriggerCls}>Summary</TabsTrigger>
              <TabsTrigger value="mentions" className={tabTriggerCls}>
                Mentions
                {companyMentionSnippets.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {companyMentionSnippets.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="competitors" className={tabTriggerCls}>
                Competitors
                {competitors.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {competitors.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto">
              {/* AI summary — auto-generated on open */}
              <TabsContent value="summary" className="px-6 py-4 mt-0 focus-visible:outline-none">
                {loadingSummary ? (
                  <Card className="border-[#0DBCBA]/30 bg-gradient-to-br from-[#0DBCBA]/5 to-[#0DBCBA]/10">
                    <CardContent className="py-5 px-5 flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                      <Loader2 className="w-4 h-4 animate-spin text-[#0DBCBA]" />
                      <span className="text-sm font-medium text-[#0A8B89]">Summarizing the AI answers…</span>
                    </CardContent>
                  </Card>
                ) : summaryError ? (
                  <Card className="border-red-100 bg-red-50/30">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-red-600 text-sm">{summaryError}</span>
                        <Button variant="ghost" size="sm" onClick={retrySummary} className="text-xs shrink-0">
                          Retry
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-[#0DBCBA]/30 bg-[#0DBCBA]/5">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                          AI Summary
                        </CardTitle>
                        {isNonEnglish && !isTranslating && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowTranslation(!showTranslation)}
                            className="text-xs h-7 px-2.5"
                          >
                            <Languages className="w-3 h-3 mr-1" />
                            {showTranslation ? 'Show Original' : 'See Translation'}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {isTranslating && (
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Detecting language...</span>
                        </div>
                      )}
                      <div className="text-gray-800 text-sm mb-3 whitespace-pre-line leading-relaxed">
                        <ReactMarkdown>{showTranslation && translatedSummary ? translatedSummary : summary}</ReactMarkdown>
                      </div>
                      {uniqueSources.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="text-xs text-gray-500">Sources:</span>
                          {uniqueSources.map((src) => (
                            <a
                              key={src.url}
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 bg-white hover:bg-gray-50 px-2 py-1 rounded-full text-xs font-medium text-gray-800 transition-colors border border-gray-200"
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
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Where the company appears in each model's answer */}
              <TabsContent value="mentions" className="px-6 py-4 mt-0 focus-visible:outline-none">
                {extractedCompanyName && companyMentionSnippets.length > 0 ? (
                  <>
                    <p className="text-xs text-gray-500 mb-3">
                      Where {extractedCompanyName} appears in each model's answer.
                    </p>
                    <div className="space-y-2.5">
                      {companyMentionSnippets.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-gray-100 p-3.5 hover:border-gray-200 hover:shadow-sm transition-all"
                        >
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
                    </div>
                  </>
                ) : (
                  <div className="text-center py-10">
                    <p className="text-sm text-gray-500">
                      {extractedCompanyName || 'The company'} isn’t mentioned in these answers.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* Competitors detected in the answers */}
              <TabsContent value="competitors" className="px-6 py-4 mt-0 focus-visible:outline-none">
                {competitors.length > 0 ? (
                  <>
                    <p className="text-xs text-gray-500 mb-3">Competitors detected in the AI answers to this prompt.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {competitors.map((name: string, idx: number) => (
                        <Badge key={idx} variant="secondary" className="text-xs">{name}</Badge>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-10">
                    <p className="text-sm text-gray-500">No competitors detected in these answers.</p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}

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
      </SheetContent>
    </Sheet>
  );
};
