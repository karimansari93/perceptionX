import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardMetrics, CitationCount, LLMMentionRanking } from "@/types/dashboard";
import { Badge } from "@/components/ui/badge";
import { getLLMDisplayName, getLLMLogo } from "@/config/llmLogos";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SourceDetailsModal } from "./SourceDetailsModal";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import ReactMarkdown from 'react-markdown';
import { Skeleton } from "@/components/ui/skeleton";
import LLMLogo from "@/components/LLMLogo";
import { X, ExternalLink } from 'lucide-react';
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";

interface KeyTakeawaysProps {
  metrics: DashboardMetrics;
  topCompetitors: { company: string; count: number }[];
  topCitations: CitationCount[];
  themesBySentiment: {
    positive: string[];
    neutral: string[];
    negative: string[];
  };
  llmMentionRankings: LLMMentionRanking[];
  responses: any[];
  talentXProData?: any[];
  isPro?: boolean;
}

interface BaseInsight {
  text: string;
  type: string;
  action: string;
}

interface InsightWithSources extends BaseInsight {
  sources: CitationCount[];
}

interface InsightWithCompetitor extends BaseInsight {
  competitor: string;
}

interface InsightWithThemes extends BaseInsight {
  themes: { theme: string; sentiment: 'positive' | 'neutral' | 'negative' }[];
}

interface InsightWithLLM extends BaseInsight {
  llm: LLMMentionRanking;
  promptType?: string;
}

interface InsightWithTalentXAttribute extends BaseInsight {
  attribute: {
    id: string;
    name: string;
    score: number;
  };
}

type Insight = BaseInsight | InsightWithSources | InsightWithCompetitor | InsightWithThemes | InsightWithLLM | InsightWithTalentXAttribute;

export const KeyTakeaways = ({ 
  metrics, 
  topCompetitors, 
  topCitations, 
  themesBySentiment = { positive: [], neutral: [], negative: [] },
  llmMentionRankings,
  responses,
  talentXProData = [],
  isPro = false
}: KeyTakeawaysProps) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // Modal states for clickable takeaways
  const [selectedSource, setSelectedSource] = useState<CitationCount | null>(null);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [selectedLLM, setSelectedLLM] = useState<LLMMentionRanking | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isLLMModalOpen, setIsLLMModalOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);

  // Competitor modal states (from CompetitorsTab)
  const [competitorSnippets, setCompetitorSnippets] = useState<{ snippet: string; full: string }[]>([]);
  const [expandedSnippetIdx, setExpandedSnippetIdx] = useState<number | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string>("");
  const [loadingCompetitorSummary, setLoadingCompetitorSummary] = useState(false);
  const [competitorSummaryError, setCompetitorSummaryError] = useState<string | null>(null);
  const [isMentionsDrawerOpen, setIsMentionsDrawerOpen] = useState(false);
  const [expandedMentionIdx, setExpandedMentionIdx] = useState<number | null>(null);

  const [showAllCompetitorSources, setShowAllCompetitorSources] = useState(false);

  // Click handlers
  const handleSourceClick = (source: CitationCount) => {
    setSelectedSource(source);
    setIsSourceModalOpen(true);
  };

  const handleCompetitorClick = (competitor: string) => {
    const snippets = getSnippetsForCompetitor(competitor);
    setSelectedCompetitor(competitor);
    setCompetitorSnippets(snippets);
    setShowAllCompetitorSources(false);
    setIsCompetitorModalOpen(true);
  };

  const handleLLMClick = (llm: LLMMentionRanking) => {
    setSelectedLLM(llm);
    setIsLLMModalOpen(true);
  };

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  const handleCloseCompetitorModal = () => {
    setIsCompetitorModalOpen(false);
    setSelectedCompetitor(null);
    setCompetitorSnippets([]);
  };

  const handleCloseLLMModal = () => {
    setIsLLMModalOpen(false);
    setSelectedLLM(null);
  };

  const handlePromptClick = (promptText: string) => {
    // Close the LLM modal first
    setIsLLMModalOpen(false);
    setSelectedLLM(null);
    
    // Open the ResponseDetailsModal for this specific prompt
    setSelectedPrompt(promptText);
    setIsPromptModalOpen(true);
  };

  const getPromptResponses = (promptText: string) => {
    return responses.filter(r => r.confirmed_prompts?.prompt_text === promptText);
  };

  // Competitor modal handlers (from CompetitorsTab)
  const handleCompetitorSourceClick = (source: { domain: string; count: number }) => {
    // Use the regular source click handler instead of competitor-specific modal
    handleSourceClick({ domain: source.domain, count: source.count });
  };



  // Helper function to get responses for a source (same as SourcesTab)
  const getResponsesForSource = (domain: string) => {
    return responses.filter(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        return Array.isArray(citations) && citations.some((c: any) => c.domain === domain);
      } catch {
        return false;
      }
    });
  };

  // Helper functions (from CompetitorsTab)
  const getSnippetsForCompetitor = (competitor: string) => {
    const snippets: { snippet: string; full: string }[] = [];
    // Regex to match competitor name with optional bolding and punctuation after
    const competitorPattern = `(?:\\*\\*|__)?${competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\*\\*|__)?[\\s]*[:*\-]*`;
    const regex = new RegExp(`((?:\\S+\\s+){0,4})(${competitorPattern})`, 'gi');
    responses.forEach(response => {
      if (!response.response_text) return;
      let match;
      while ((match = regex.exec(response.response_text)) !== null) {
        // Get 4 words before
        const before = match[1]?.split(/\s+/).slice(-4).join(' ') || '';
        // Find the index just after the match
        const afterStartIdx = match.index + match[0].length;
        // Take the next 12 words from the remaining text
        const afterText = response.response_text.slice(afterStartIdx).replace(/^([:*\-\s])+/, '');
        const after = afterText.split(/\s+/).slice(0, 12).join(' ');
        snippets.push({
          snippet: `${before} ${match[2]} ${after}`.trim(),
          full: response.response_text
        });
      }
    });
    return snippets;
  };

  const getFullResponsesForCompetitor = (competitor: string) => {
    return responses.filter(response => 
      response.response_text?.toLowerCase().includes(competitor.toLowerCase())
    );
  };

  function highlightCompetitor(snippet: string, competitor: string) {
    if (!competitor) return snippet;
    
    // Escape special regex characters in competitor name
    const escapedCompetitor = competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    
    // Create regex to match competitor name with optional bolding
    const regex = new RegExp(`(\\*\\*|__)?(${escapedCompetitor})(\\*\\*|__)?`, 'gi');
    
    // Replace matches with highlighted version
    let clean = snippet.replace(regex, (match, prefix, name, suffix) => {
      // If already bolded, keep it bolded
      if (prefix && suffix) {
        return `<strong class="bg-yellow-200 px-1 rounded">${name}</strong>`;
      }
      // Otherwise, just highlight
      return `<span class="bg-yellow-200 px-1 rounded font-medium">${name}</span>`;
    });
    
    return clean;
  }

  // Fetch AI summary for competitor when modal opens
  useEffect(() => {
    if (!isCompetitorModalOpen || !selectedCompetitor) return;
    
    const fetchSummary = async () => {
      setLoadingCompetitorSummary(true);
      setCompetitorSummaryError(null);
      
      try {
        // Generate a simple summary based on the competitor mentions
        const competitorResponses = getFullResponsesForCompetitor(selectedCompetitor);
        const responseTexts = competitorResponses
          .map(r => r.response_text)
          .filter(Boolean)
          .join('\n\n');
        
        if (!responseTexts.trim()) {
          setCompetitorSummary('No detailed mentions found for this competitor.');
          return;
        }

        // Create a simple analysis without calling the analyze-response function
        const totalMentions = competitorResponses.length;
        const uniqueSources = new Set<string>();
        const uniqueLLMs = new Set<string>();
        
        competitorResponses.forEach(response => {
          // Extract sources from citations
          try {
            const citations = typeof response.citations === 'string' 
              ? JSON.parse(response.citations) 
              : response.citations;
            
            if (Array.isArray(citations)) {
              citations.forEach((citation: any) => {
                if (citation.domain) {
                  uniqueSources.add(citation.domain);
                }
              });
            }
          } catch {
            // Skip invalid citations
          }
          
          // Add AI model
          if (response.ai_model) {
            uniqueLLMs.add(response.ai_model);
          }
        });

        // Generate a simple summary
        const summary = `${selectedCompetitor} is mentioned ${totalMentions} times across your analysis. ` +
          `The mentions appear in responses from ${uniqueLLMs.size} different AI models (${Array.from(uniqueLLMs).join(', ')}). ` +
          `These mentions are sourced from ${uniqueSources.size} different websites and sources. ` +
          `This level of competitor presence suggests ${selectedCompetitor} is a significant player in your market space. ` +
          `Consider analyzing the specific contexts of these mentions to understand how your brand compares and identify potential competitive advantages or areas for improvement.`;

        setCompetitorSummary(summary);
      } catch (error) {
        console.error('Error generating competitor summary:', error);
        setCompetitorSummaryError('Failed to generate summary. Please try again.');
      } finally {
        setLoadingCompetitorSummary(false);
      }
    };
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompetitorModalOpen, selectedCompetitor]);

  // Helper to get favicon for a domain
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    // Remove www. and domain extension
    let name = domain.replace(/^www\./, "");
    name = name.replace(/\.(com|org|net|io|co|edu|gov|info|biz|us|uk|ca|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog|io|co|us|ca|uk|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog)(\.[a-z]{2})?$/, "");
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  // Helper to get sources contributing to competitor mentions
  const getCompetitorSources = (competitorName: string) => {
    const sourceCounts: Record<string, number> = {};
    
    responses.forEach(response => {
      // Check if response mentions the competitor
      if (response.response_text?.toLowerCase().includes(competitorName.toLowerCase())) {
        // Parse citations from the response
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          
          if (Array.isArray(citations)) {
            citations.forEach((citation: any) => {
              if (citation.domain) {
                sourceCounts[citation.domain] = (sourceCounts[citation.domain] || 0) + 1;
              }
            });
          }
        } catch {
          // Skip invalid citations
        }
      }
    });
    
    // Convert to array and sort by count
    return Object.entries(sourceCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Calculate key insights
  const getBrandPerceptionInsight = (): InsightWithSources => {
    if (topCitations.length === 0) {
      return {
        text: "No sources found influencing your brand perception",
        type: "negative",
        action: "Add more sources to improve brand visibility",
        sources: []
      };
    }
    
    const topSource = topCitations[0];
    const secondSource = topCitations[1];
    
    const sources = [topSource];
    if (secondSource) {
      sources.push(secondSource);
    }
    
    return {
      text: `${getSourceDisplayName(topSource.domain)} is your primary brand perception source`,
      type: "positive",
      action: secondSource ? 
        `Consider optimizing content from ${getSourceDisplayName(secondSource.domain)} as your secondary source` :
        "Focus on diversifying your brand perception sources",
      sources
    };
  };

  const getCompetitiveInsight = (): InsightWithCompetitor => {
    if (topCompetitors.length === 0) {
      return {
        text: "No significant competitor mentions detected",
        type: "neutral",
        action: "Monitor competitor mentions to understand market positioning",
        competitor: ""
      };
    }
    
    const topCompetitor = topCompetitors[0];
    const secondCompetitor = topCompetitors[1];
    
    return {
      text: `${topCompetitor.company} is most frequently compared to your brand`,
      type: "warning",
      action: secondCompetitor ? 
        `Also monitor mentions of ${secondCompetitor.company} as a secondary competitor` :
        "Focus on differentiating from this primary competitor",
      competitor: topCompetitor.company
    };
  };

  const getPositiveThemesInsight = (): InsightWithThemes => {
    const total = metrics.totalResponses || 1;
    const positivePct = (metrics.positiveCount / total) * 100;

    // Gather up to 5 themes, prioritizing positive, then neutral, then negative
    const themes: { theme: string; sentiment: 'positive' | 'neutral' | 'negative' }[] = [];
    const addThemes = (arr: string[], sentiment: 'positive' | 'neutral' | 'negative') => {
      arr.forEach((theme) => {
        if (themes.length < 5) themes.push({ theme, sentiment });
      });
    };
    addThemes(themesBySentiment.positive, 'positive');
    addThemes(themesBySentiment.neutral, 'neutral');
    addThemes(themesBySentiment.negative, 'negative');

    let text = 'Key themes in responses:';
    if (themes.length === 0) text = 'No key themes detected in responses';

    return {
      text,
      type: positivePct >= 60 ? 'positive' : positivePct >= 40 ? 'neutral' : 'negative',
      action:
        themes.length > 0
          ? 'Focus on amplifying positive themes and addressing negative ones.'
          : 'Encourage more feedback to surface key themes.',
      themes,
    };
  };

  const getAIMentionsInsight = (): InsightWithLLM | BaseInsight => {
    if (!responses || responses.length === 0) {
      return {
        text: "No AI model mentions detected",
        type: "neutral",
        action: "Test prompts with different AI models to understand mention patterns"
      };
    }

    // Count the number of company_mentioned: false for each model
    const modelNonMentions: Record<string, number> = {};
    responses.forEach(response => {
      const model = response.ai_model;
      if (response.company_mentioned === false) {
        modelNonMentions[model] = (modelNonMentions[model] || 0) + 1;
      }
    });

    // If all models mention the company at least once, fall back to old logic
    if (Object.keys(modelNonMentions).length === 0) {
      return {
        text: "All AI models mention your company at least once",
        type: "positive",
        action: "Great job! Your company is being recognized by all tested AI models."
      };
    }

    // Find the model with the most non-mentions (company_mentioned: false)
    const rankings = Object.entries(modelNonMentions)
      .map(([model, nonMentions]) => ({
        model,
        displayName: getLLMDisplayName(model),
        mentions: responses.filter(r => r.ai_model === model).length, // Total responses for this model
        logoUrl: getLLMLogo(model),
        nonMentions // Keep this for sorting
      }))
      .sort((a, b) => b.nonMentions - a.nonMentions);

    const lowestMentionLLM = rankings[0]; // Most non-mentions

    // Analyze what prompts this AI model is used for
    const llmResponses = responses.filter(r => r.ai_model === lowestMentionLLM.model);
    const promptTypes = llmResponses.map(r => r.confirmed_prompts?.prompt_type || 'general');
    const mostCommonPromptType = promptTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dominantPromptType = Object.entries(mostCommonPromptType)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0];

    let text = `${lowestMentionLLM.displayName} mentions your company least`;
    let type = "warning";
    let action = `Click to see which specific prompts are missing company mentions and get actionable insights`;

    return {
      text,
      type,
      action,
      llm: lowestMentionLLM,
      promptType: dominantPromptType
    };
  };

  const getTopTalentXAttributeInsight = (): InsightWithTalentXAttribute | BaseInsight => {
    if (!talentXProData || talentXProData.length === 0) {
      return {
        text: "No TalentX attribute data available",
        type: "neutral",
        action: "Generate TalentX Pro prompts to analyze employer brand attributes"
      };
    }

    // Find the attribute with the highest perception score
    const topAttribute = talentXProData.reduce((best, current) => 
      current.perceptionScore > best.perceptionScore ? current : best
    );

    if (topAttribute.perceptionScore < 50) {
      return {
        text: `${topAttribute.attributeName} is your strongest employer brand attribute`,
        type: "warning",
        action: "Focus on improving perception scores across all attributes",
        attribute: {
          id: topAttribute.attributeId,
          name: topAttribute.attributeName,
          score: topAttribute.perceptionScore
        }
      };
    }

    return {
      text: `${topAttribute.attributeName} is your strongest employer brand attribute`,
      type: "positive",
      action: "Leverage this strength in recruitment and employer branding",
      attribute: {
        id: topAttribute.attributeId,
        name: topAttribute.attributeName,
        score: topAttribute.perceptionScore
      }
    };
  };

  const getTalentXImprovementOpportunityInsight = (): InsightWithTalentXAttribute | BaseInsight => {
    if (!talentXProData || talentXProData.length === 0) {
      return {
        text: "No TalentX attribute data available",
        type: "neutral",
        action: "Generate TalentX Pro prompts to identify improvement opportunities"
      };
    }

    // Find the attribute with the lowest perception score
    const lowestAttribute = talentXProData.reduce((worst, current) => 
      current.perceptionScore < worst.perceptionScore ? current : worst
    );

    if (lowestAttribute.perceptionScore > 70) {
      return {
        text: `${lowestAttribute.attributeName} has the lowest perception score`,
        type: "positive",
        action: "All attributes are performing well, focus on maintaining excellence",
        attribute: {
          id: lowestAttribute.attributeId,
          name: lowestAttribute.attributeName,
          score: lowestAttribute.perceptionScore
        }
      };
    }

    return {
      text: `${lowestAttribute.attributeName} needs attention`,
      type: "warning",
      action: "Develop strategies to improve perception in this area",
      attribute: {
        id: lowestAttribute.attributeId,
        name: lowestAttribute.attributeName,
        score: lowestAttribute.perceptionScore
      }
    };
  };

  const insights: Insight[] = [
    getBrandPerceptionInsight(),
    getCompetitiveInsight(),
    getAIMentionsInsight(),
    // TalentX insights temporarily hidden until feature is fully launched
    // ...(isPro && talentXProData && talentXProData.length > 0 ? [
    //   getTopTalentXAttributeInsight(),
    //   getTalentXImprovementOpportunityInsight()
    // ] : [])
  ];

  return (
    <>
      <Card className="shadow-sm border border-gray-200 h-full">
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="text-lg font-semibold">Key Takeaways</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="grid gap-3 sm:gap-4">
            {insights.map((insight, index) => {
              const isEmpty = insight.text.startsWith('No ');
              const hasSources = 'sources' in insight && insight.sources && insight.sources.length > 0;
              const hasCompetitor = 'competitor' in insight && insight.competitor && insight.competitor.length > 0;
              const hasThemes = 'themes' in insight && insight.themes && insight.themes.length > 0;
              const hasLLM = 'llm' in insight && insight.llm;
              const hasTalentXAttribute = 'attribute' in insight && insight.attribute;
              
              return (
                <div
                  key={index}
                  className={`flex flex-col gap-3 p-3 sm:p-4 rounded-lg bg-gray-50/80 hover:bg-gray-100/80 transition-colors duration-200 ${isEmpty ? 'py-2 sm:py-3' : ''} ${
                    hasSources || hasCompetitor || hasLLM ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => {
                    if (hasSources && insight.sources.length > 0) {
                      handleSourceClick(insight.sources[0]);
                    } else if (hasCompetitor) {
                      handleCompetitorClick(insight.competitor);
                    } else if (hasLLM) {
                      handleLLMClick(insight.llm);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {hasSources ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(getSourceDisplayName(insight.sources[0].domain))[0]}
                            </span>
                            <Badge 
                              variant="outline" 
                              className="flex items-center gap-1.5 bg-white/80 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              <img 
                                src={getFavicon(insight.sources[0].domain)} 
                                alt="" 
                                className="w-3 h-3 flex-shrink-0" 
                              />
                              <span className="text-xs font-medium">
                                {insight.sources[0].domain}
                              </span>
                            </Badge>
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(getSourceDisplayName(insight.sources[0].domain))[1]}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed pl-0 sm:pl-4">{insight.action}</p>
                        </div>
                      ) : hasCompetitor ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(insight.competitor)[0]}
                            </span>
                            <Badge 
                              variant="outline" 
                              className="flex items-center gap-1.5 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
                              onClick={() => handleCompetitorClick(insight.competitor)}
                            >
                              <img 
                                src={getCompetitorFavicon(insight.competitor)} 
                                alt={`${insight.competitor} favicon`}
                                className="w-3 h-3 flex-shrink-0 rounded"
                                onError={(e) => {
                                  // Fallback to initials if favicon fails to load
                                  e.currentTarget.style.display = 'none';
                                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                              <span 
                                className="w-3 h-3 flex-shrink-0 bg-blue-200 rounded flex items-center justify-center text-[8px] font-bold text-blue-600"
                                style={{ display: 'none' }}
                              >
                                {insight.competitor.charAt(0).toUpperCase()}
                              </span>
                              <span className="text-xs font-medium">
                                {insight.competitor}
                              </span>
                            </Badge>
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(insight.competitor)[1]}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed pl-0 sm:pl-4">{insight.action}</p>
                        </div>
                      ) : hasThemes ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text}
                            </span>
                            {insight.themes.map((t, i) => (
                              <Badge
                                key={i}
                                className={`text-xs font-medium px-2 py-1 rounded-full border-0 ${
                                  t.sentiment === 'positive'
                                    ? 'bg-green-100 text-green-800'
                                    : t.sentiment === 'neutral'
                                    ? 'bg-gray-100 text-gray-700'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {t.theme}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed pl-0 sm:pl-4">{insight.action}</p>
                        </div>
                      ) : hasLLM ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(getLLMDisplayName(insight.llm.model))[0]}
                            </span>
                            <Badge 
                              variant="outline" 
                              className="flex items-center gap-1.5 bg-white/80 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              {insight.llm.logoUrl ? (
                                <img src={insight.llm.logoUrl} alt="" className="w-3 h-3 flex-shrink-0" />
                              ) : (
                                <div className="w-3 h-3 flex-shrink-0 bg-gray-200 rounded" />
                              )}
                              <span className="text-xs font-medium">
                                {getLLMDisplayName(insight.llm.model)}
                              </span>
                            </Badge>
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(getLLMDisplayName(insight.llm.model))[1]}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed pl-0 sm:pl-4">{insight.action}</p>
                        </div>
                      ) : hasTalentXAttribute ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(insight.attribute.name)[0]}
                            </span>
                            <Badge 
                              variant="outline" 
                              className="flex items-center gap-1.5 bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors"
                            >
                              <span className="text-xs font-medium">
                                {insight.attribute.name}
                              </span>
                            </Badge>
                            <span className="text-sm font-medium text-gray-900 leading-relaxed">
                              {insight.text.split(insight.attribute.name)[1]}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed pl-0 sm:pl-4">{insight.action}</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <p className={isEmpty ? "text-base font-semibold text-gray-500 m-0 leading-tight" : "text-sm font-medium text-gray-900 leading-relaxed"}>
                            {insight.text}
                          </p>
                          <p className={isEmpty ? "text-xs text-gray-400" : "text-xs text-gray-600 leading-relaxed"}>{insight.action}</p>
                        </div>
                      )}
                    </div>
                    <Badge 
                      variant="secondary"
                      className={`shrink-0 ${
                        insight.type === 'positive' ? 'bg-green-100 text-green-800 border-green-200' :
                        insight.type === 'negative' ? 'bg-red-100 text-red-800 border-red-200' :
                        insight.type === 'warning' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                        'bg-blue-100 text-blue-800 border-blue-200'
                      }`}
                    >
                      {insight.type.charAt(0).toUpperCase() + insight.type.slice(1)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

    {/* Modals */}
    {selectedSource && (
      <SourceDetailsModal
        isOpen={isSourceModalOpen}
        onClose={handleCloseSourceModal}
        source={selectedSource}
        responses={getResponsesForSource(selectedSource.domain)}
      />
    )}

    {/* Competitor Modal */}
    <Dialog open={isCompetitorModalOpen} onOpenChange={handleCloseCompetitorModal}>
      <DialogContent className="max-w-xl w-full sm:max-w-2xl sm:w-[90vw] p-2 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img 
              src={getCompetitorFavicon(selectedCompetitor || '')} 
              alt={`${selectedCompetitor} favicon`}
              className="w-5 h-5 rounded"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span>{selectedCompetitor}</span>
            <Badge variant="secondary">{getFullResponsesForCompetitor(selectedCompetitor || '').length} mentions</Badge>
          </DialogTitle>
          <DialogDescription>
            Detailed analysis of {selectedCompetitor} mentions in your brand perception data, including AI models, sources, and summary insights.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* MODELS ROW - matching PromptsModal style */}
          {selectedCompetitor && (() => {
            const competitorResponses = getFullResponsesForCompetitor(selectedCompetitor);
            const uniqueLLMs = Array.from(new Set(competitorResponses.map(r => r.ai_model).filter(Boolean)));
            
            return (
              <div className="flex flex-row gap-8 mt-1 mb-1 w-full">
                {/* Models */}
                <div className="flex flex-col items-start min-w-[120px]">
                  <span className="text-xs text-gray-400 font-medium mb-1">Models</span>
                  <div className="flex flex-row flex-wrap items-center gap-2">
                    {uniqueLLMs.length === 0 ? (
                      <span className="text-xs text-gray-400">None</span>
                    ) : (
                      uniqueLLMs.map(model => (
                        <span key={model} className="inline-flex items-center">
                          <LLMLogo modelName={model} size="sm" className="mr-1" />
                          <span className="text-xs text-gray-700 mr-2">{getLLMDisplayName(model)}</span>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Summary Card - matching PromptsModal style */}
          <div className="mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingCompetitorSummary ? (
                  <div className="w-full">
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-6 w-5/6 mb-2" />
                    <Skeleton className="h-6 w-2/3 mb-2" />
                    <Skeleton className="h-6 w-1/2 mb-2" />
                  </div>
                ) : competitorSummaryError ? (
                  <div className="text-red-600 text-sm py-2">{competitorSummaryError}</div>
                ) : competitorSummary ? (
                  <>
                    <div className="text-gray-800 text-base mb-3 whitespace-pre-line">
                      <ReactMarkdown>{competitorSummary}</ReactMarkdown>
                    </div>
                    
                    {/* Sources section - matching PromptsModal style */}
                    {selectedCompetitor && (() => {
                      const competitorSources = getCompetitorSources(selectedCompetitor);
                      const topSources = showAllCompetitorSources ? competitorSources : competitorSources.slice(0, 5);
                      const hasMoreSources = competitorSources.length > 5;
                      
                      return competitorSources.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="text-xs text-gray-500">Sources:</span>
                          {topSources.map((source, index) => (
                            <div
                              key={index}
                              onClick={() => handleCompetitorSourceClick(source)}
                              className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-full text-xs font-medium text-gray-800 transition-colors border border-gray-200 cursor-pointer"
                            >
                              <img
                                src={getFavicon(source.domain)}
                                alt=""
                                className="w-4 h-4 mr-1 rounded"
                                style={{ background: '#fff' }}
                                onError={e => { e.currentTarget.style.display = 'none'; }}
                              />
                              {getSourceDisplayName(source.domain)}
                              <span className="ml-1 text-gray-500">({source.count})</span>
                            </div>
                          ))}
                          {hasMoreSources && (
                            <button
                              onClick={() => setShowAllCompetitorSources(!showAllCompetitorSources)}
                              className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors font-medium"
                            >
                              {showAllCompetitorSources 
                                ? `Show Less` 
                                : `+${competitorSources.length - 5} more`
                              }
                            </button>
                          )}
                        </div>
                      ) : null;
                    })()}
                  </>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Mentions Drawer Modal */}
    <Dialog open={isMentionsDrawerOpen} onOpenChange={setIsMentionsDrawerOpen}>
      <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            All Mentions of {selectedCompetitor}
            <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
          </DialogTitle>
          <DialogDescription>
            Browse through all mentions of {selectedCompetitor} found in your brand perception analysis.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-3 border-b bg-gray-50">
          {/* Search input removed as requested */}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-white">
          {competitorSnippets.length > 0 ? (
            competitorSnippets.map((item, idx) => {
              // Show only first 2 lines unless expanded
              const lines = item.snippet.split(/\n|\r/);
              const isExpanded = expandedMentionIdx === idx;
              const preview = lines.slice(0, 2).join(' ');
              const rest = lines.slice(2).join(' ');
              return (
                <div key={idx} className="p-3 bg-gray-50 rounded border text-sm text-gray-800">
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: highlightCompetitor(isExpanded ? item.snippet : preview, selectedCompetitor || "")
                    }}
                  />
                  {lines.length > 2 && (
                    <button
                      className="text-xs text-blue-600 underline mt-1 hover:text-blue-800"
                      onClick={() => setExpandedMentionIdx(isExpanded ? null : idx)}
                    >
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-gray-500 text-sm">No mentions found.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>



    {/* LLM Modal */}
    <Dialog open={isLLMModalOpen} onOpenChange={handleCloseLLMModal}>
      <DialogContent className="max-w-xl w-full sm:max-w-2xl sm:w-[90vw] p-2 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedLLM?.logoUrl ? (
              <img src={selectedLLM.logoUrl} alt="" className="w-5 h-5" />
            ) : (
              <div className="w-5 h-5 bg-gray-200 rounded" />
            )}
            <span>{selectedLLM?.displayName}</span>
            <Badge variant="secondary">
              {selectedLLM?.mentions} mentions
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Analysis of {selectedLLM?.displayName} mentions showing which prompts are missing company mentions and actionable insights for improvement.
          </DialogDescription>
        </DialogHeader>
        
        {selectedLLM && (() => {
          const llmResponses = responses.filter(r => r.ai_model === selectedLLM.model);
          const notMentionedResponses = llmResponses.filter(r => !r.company_mentioned);
          
          if (notMentionedResponses.length === 0) {
            return (
              <div className="space-y-4">
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">✅</div>
                  <h3 className="text-lg font-semibold text-green-700 mb-2">All Prompts Covered</h3>
                  <p className="text-sm text-gray-600">
                    Great news! {selectedLLM.displayName} mentions your company in all analyzed responses.
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              {/* Summary */}
              <div className="text-sm text-gray-800 bg-gray-50 p-3 rounded-lg">
                <p>
                  <strong>{selectedLLM.displayName}</strong> did not mention your company in <strong>{notMentionedResponses.length} out of {llmResponses.length}</strong> responses.
                </p>
              </div>

              {/* Missing Prompts */}
              <div>
                <h3 className="text-base font-semibold text-amber-700 mb-3">
                  Prompts ({notMentionedResponses.length})
                </h3>
                
                                 <div className="space-y-3 max-h-80 overflow-y-auto">
                   {notMentionedResponses.map((response, index) => {
                     // Get sources for this specific response
                     const responseSources: string[] = [];
                     try {
                       const citations = typeof response.citations === 'string' 
                         ? JSON.parse(response.citations) 
                         : response.citations;
                       
                       if (Array.isArray(citations)) {
                         citations.forEach((citation: any) => {
                           if (citation.domain) {
                             responseSources.push(citation.domain);
                           }
                         });
                       }
                     } catch {
                       // Skip invalid citations
                     }

                     return (
                       <div 
                         key={index} 
                         className="p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group"
                         onClick={() => handlePromptClick(response.confirmed_prompts?.prompt_text || '')}
                       >
                         <div className="flex items-start justify-between mb-2">
                           <div className="flex-1">
                             <div className="text-sm font-medium text-gray-900 group-hover:text-gray-800">
                               {response.confirmed_prompts?.prompt_text?.slice(0, 100)}
                               {response.confirmed_prompts?.prompt_text && response.confirmed_prompts.prompt_text.length > 100 && '...'}
                             </div>
                           </div>
                           <ExternalLink className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                         </div>

                         {responseSources.length > 0 && (
                           <div className="flex flex-wrap items-center gap-2">
                             <span className="text-xs text-gray-500">Sources:</span>
                             {responseSources.slice(0, 3).map((domain, sourceIndex) => (
                               <div
                                 key={sourceIndex}
                                 className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-full text-xs font-medium text-gray-800 transition-colors border border-gray-200"
                               >
                                 <img
                                   src={getFavicon(domain)}
                                   alt=""
                                   className="w-3 h-3 mr-1 rounded"
                                   style={{ background: '#fff' }}
                                   onError={e => { e.currentTarget.style.display = 'none'; }}
                                 />
                                 {getSourceDisplayName(domain)}
                               </div>
                             ))}
                             {responseSources.length > 3 && (
                               <span className="text-xs text-gray-500">+{responseSources.length - 3} more</span>
                             )}
                           </div>
                         )}
                       </div>
                     );
                   })}
                 </div>
              </div>



              

              {/* Action Items */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Next Steps:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• <strong>Improve prompts:</strong> Add more specific company context to these prompt types</li>
                  <li>• <strong>Enhance online presence:</strong> Focus on sources where competitors are being mentioned</li>
                </ul>
              </div>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>

    {/* Response Details Modal */}
    {selectedPrompt && (
      <ResponseDetailsModal
        isOpen={isPromptModalOpen}
        onClose={() => {
          setIsPromptModalOpen(false);
          setSelectedPrompt(null);
        }}
        promptText={selectedPrompt}
        responses={getPromptResponses(selectedPrompt)}
        promptsData={[]}
      />
    )}
  </>
  );
}; 