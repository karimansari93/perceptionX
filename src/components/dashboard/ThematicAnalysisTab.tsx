import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import ReactMarkdown from 'react-markdown';
import { usePersistedState } from '@/hooks/usePersistedState';
import { 
  Brain,
  Loader2,
  BarChart3,
  Activity,
  Target,
  Award,
  Users,
  Heart,
  Shield,
  Lightbulb,
  Coffee,
  Crown,
  Lock,
  TrendingUp,
  FileText,
  MessageSquare,
  ClipboardList,
  MessageCircle,
  UserCheck,
  Briefcase,
  ArrowLeft,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { PromptResponse } from '@/types/dashboard';
import { supabase } from '@/integrations/supabase/client';
import { TALENTX_ATTRIBUTES } from '@/config/talentXAttributes';
import LLMLogo from '@/components/LLMLogo';
import { getLLMDisplayName } from '@/config/llmLogos';
import { extractSourceUrl } from '@/utils/citationUtils';

interface ThematicAnalysisTabProps {
  responses: PromptResponse[];
  companyName: string;
  aiThemes: AITheme[];
  aiThemesLoading: boolean;
  onRefreshThemes: () => Promise<void>;
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
}

interface AITheme {
  id: string;
  response_id: string;
  theme_name: string;
  theme_description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  talentx_attribute_id: string;
  talentx_attribute_name: string;
  confidence_score: number;
  keywords: string[];
  context_snippets: string[];
  created_at: string;
}

// Icon mapping for TalentX attributes
const ATTRIBUTE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  // Employee Experience
  'mission-purpose': Target,
  'rewards-recognition': Award,
  'company-culture': Users,
  'social-impact': Heart,
  'inclusion': Shield,
  'innovation': Lightbulb,
  'wellbeing-balance': Coffee,
  'leadership': Crown,
  'security-perks': Lock,
  'career-opportunities': TrendingUp,
  // Candidate Experience
  'application-process': FileText,
  'candidate-communication': MessageSquare,
  'interview-experience': ClipboardList,
  'candidate-feedback': MessageCircle,
  'onboarding-experience': UserCheck,
  'overall-candidate-experience': Briefcase
};

export const ThematicAnalysisTab = React.memo(({ responses, companyName, aiThemes, aiThemesLoading, onRefreshThemes, responseTexts = {}, fetchResponseTexts }: ThematicAnalysisTabProps) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // Modal and filter states - persisted
  const [selectedAttribute, setSelectedAttribute] = usePersistedState<string | null>('thematicTab.selectedAttribute', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('thematicTab.isModalOpen', false);
  const [selectedPromptType, setSelectedPromptType] = usePersistedState<'all' | 'experience' | 'competitive'>('thematicTab.selectedPromptType', 'experience');
  const [rankingSort, setRankingSort] = usePersistedState<'sentiment' | 'volume' | 'az'>('thematicTab.rankingSort', 'sentiment');
  const [analysisProgress, setAnalysisProgress] = useState({
    current: 0,
    total: 0,
    currentResponse: '',
    isVisible: false
  });
  const [showAllThemeSources, setShowAllThemeSources] = useState<Record<string, boolean>>({});
  const [selectedTheme, setSelectedTheme] = usePersistedState<AITheme | null>('thematicTab.selectedTheme', null);
  const [themeSummary, setThemeSummary] = useState<string>("");
  const [loadingThemeSummary, setLoadingThemeSummary] = useState(false);
  const [themeSummaryError, setThemeSummaryError] = useState<string | null>(null);
  const [thinkingStep, setThinkingStep] = useState<number>(-1);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [summarySources, setSummarySources] = useState<{ domain: string; url: string | null; displayName: string }[]>([]);
  const [showAllAttributeSources, setShowAllAttributeSources] = useState(false);
  const [modalView, setModalView] = usePersistedState<'summary' | 'detail'>('thematicTab.modalView', 'summary');

  // Filter responses by prompt type (experience by default, excludes discovery)
  const filteredResponses = useMemo(() => {
    return responses.filter(response => {
      const promptType = response.confirmed_prompts?.prompt_type;
      
      const isValidType = promptType === 'experience' ||
                          promptType === 'competitive' ||
                          promptType === 'talentx_experience' ||
                          promptType === 'talentx_competitive';
      
      if (!isValidType) return false;
      
      if (selectedPromptType !== 'all') {
        if (selectedPromptType === 'experience') {
          if (promptType !== 'experience' && promptType !== 'talentx_experience') return false;
        } else if (selectedPromptType === 'competitive') {
          if (promptType !== 'competitive' && promptType !== 'talentx_competitive') return false;
        }
      }
      
      return true;
    });
  }, [responses, selectedPromptType]);


  // Run AI analysis on filtered responses
  const runAIAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisProgress({
      current: 0,
      total: filteredResponses.length,
      currentResponse: '',
      isVisible: true
    });

    try {
      // First, clear existing themes for re-analysis
      const responseIds = filteredResponses.map(r => r.id);
      if (responseIds.length > 0) {
        setAnalysisProgress(prev => ({ ...prev, currentResponse: 'Clearing existing themes...' }));
        const { error: deleteError } = await supabase
          .from('ai_themes')
          .delete()
          .in('response_id', responseIds);
        
        if (deleteError) {
          console.warn('Error clearing existing themes:', deleteError);
        }
      }

      // Fetch response texts on-demand before analysis
      let texts = responseTexts;
      if (fetchResponseTexts) {
        setAnalysisProgress(prev => ({ ...prev, currentResponse: 'Loading response texts...' }));
        texts = await fetchResponseTexts(filteredResponses.map(r => r.id));
      }

      for (let i = 0; i < filteredResponses.length; i++) {
        const response = filteredResponses[i];
        const promptText = response.confirmed_prompts?.prompt_text || 'Unknown prompt';
        const truncatedPrompt = promptText.length > 60 ? promptText.substring(0, 60) + '...' : promptText;
        
        setAnalysisProgress(prev => ({
          ...prev,
          current: i + 1,
          currentResponse: `Analyzing: ${truncatedPrompt}`
        }));

        try {
          const { data, error } = await supabase.functions.invoke('ai-thematic-analysis', {
            body: {
              response_id: response.id,
              company_name: companyName,
              response_text: texts[response.id] || response.response_text || '',
              ai_model: response.ai_model
            }
          });

          if (error) {
            console.error(`Error analyzing response ${response.id}:`, error);
          }
        } catch (error) {
          console.error(`Error analyzing response ${response.id}:`, error);
        }

        // Small delay to show progress
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      setAnalysisProgress(prev => ({ ...prev, currentResponse: 'Finalizing analysis...' }));
      
      // Refresh the themes after analysis
      await onRefreshThemes();
    } catch (error) {
      console.error('Error running AI analysis:', error);
      setAnalysisError('Failed to run AI analysis. Please try again.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(prev => ({ ...prev, isVisible: false }));
    }
  };

  // Only include themes with a valid known attribute ID
  const validAttributeIds = new Set(TALENTX_ATTRIBUTES.map(a => a.id));
  const filteredThemes = aiThemes.filter(theme => validAttributeIds.has(theme.talentx_attribute_id));

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

  // Helper to get sources for a theme
  const getThemeSources = (theme: AITheme) => {
    const sourceData: Record<string, { count: number; url: string | null }> = {};
    
    // Find the response associated with this theme
    const response = responses.find(r => r.id === theme.response_id);
    
    if (response) {
      // Parse citations from the response
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        
        if (Array.isArray(citations)) {
          citations.forEach((citation: any) => {
            if (citation.domain) {
              if (!sourceData[citation.domain]) {
                sourceData[citation.domain] = { count: 0, url: null };
              }
              sourceData[citation.domain].count += 1;
              // Store the first URL found for this domain
              if (!sourceData[citation.domain].url && citation.url) {
                // Extract actual source URL if it's a Google Translate URL
                sourceData[citation.domain].url = extractSourceUrl(citation.url);
              }
            }
          });
        }
      } catch {
        // Skip invalid citations
      }
    }
    
    // Convert to array and sort by count
    return Object.entries(sourceData)
      .map(([domain, data]) => ({ domain, count: data.count, url: data.url }))
      .sort((a, b) => b.count - a.count);
  };

  // Helper to aggregate sources across all instances of themes for an attribute
  const getAttributeSources = (attributeId: string) => {
    const sourceData: Record<string, { count: number; url: string | null }> = {};
    
    // Get all themes for this attribute
    const attributeThemes = filteredThemes.filter(theme => theme.talentx_attribute_id === attributeId);
    
    // Aggregate sources from all themes
    attributeThemes.forEach(theme => {
      const themeSources = getThemeSources(theme);
      themeSources.forEach(source => {
        if (!sourceData[source.domain]) {
          sourceData[source.domain] = { count: 0, url: null };
        }
        sourceData[source.domain].count += source.count;
        // Store the first URL found for this domain
        if (!sourceData[source.domain].url && source.url) {
          // Extract actual source URL if it's a Google Translate URL
          sourceData[source.domain].url = extractSourceUrl(source.url);
        }
      });
    });
    
    // Convert to array and sort by count
    return Object.entries(sourceData)
      .map(([domain, data]) => ({ domain, count: data.count, url: data.url }))
      .sort((a, b) => b.count - a.count);
  };

  // Helper to get all responses mentioning themes for an attribute
  const getResponsesForAttribute = (attributeId: string) => {
    const attributeThemes = filteredThemes.filter(theme => theme.talentx_attribute_id === attributeId);
    const responseIds = new Set(attributeThemes.map(theme => theme.response_id));
    return responses.filter(response => responseIds.has(response.id));
  };

  // Group AI themes by TalentX attribute and sort for bar chart
  const themeData = useMemo(() => {
    const attributeMap = new Map<string, { 
      name: string; 
      count: number; 
      sentiment: string; 
      sentimentRatio: number; // Ratio of positive sentiment (0 to 1)
      positiveCount: number;
      negativeCount: number;
      neutralCount: number;
      themes: string[] 
    }>();
    
    // Track unique responses per attribute for response-based counting
    const responseAttributeMap = new Map<string, Set<string>>(); // attribute -> response_ids
    const attributeSentimentMap = new Map<string, Map<string, number>>(); // attribute -> sentiment -> count
    
    filteredThemes.forEach(theme => {
      const key = theme.talentx_attribute_id;
      
      // Initialize response tracking for this attribute
      if (!responseAttributeMap.has(key)) {
        responseAttributeMap.set(key, new Set());
        attributeSentimentMap.set(key, new Map([
          ['positive', 0],
          ['negative', 0], 
          ['neutral', 0]
        ]));
      }
      
      // Track unique responses per attribute
      responseAttributeMap.get(key)!.add(theme.response_id);
      
      // Track sentiment counts per attribute
      const sentimentMap = attributeSentimentMap.get(key)!;
      sentimentMap.set(theme.sentiment, (sentimentMap.get(theme.sentiment) || 0) + 1);
      
      // Build or update attribute data
      if (attributeMap.has(key)) {
        const existing = attributeMap.get(key)!;
        existing.themes.push(theme.theme_name);
      } else {
        attributeMap.set(key, { 
          name: theme.talentx_attribute_name, 
          count: 0, // Will be set below
          sentiment: theme.sentiment,
          sentimentRatio: 0, // Will be calculated below
          positiveCount: 0,
          negativeCount: 0,
          neutralCount: 0,
          themes: [theme.theme_name]
        });
      }
    });

    // Calculate response-based counts and sentiment ratios
    responseAttributeMap.forEach((responseIds, attributeId) => {
      const attribute = attributeMap.get(attributeId);
      if (attribute) {
        // Count unique responses (response-based counting)
        attribute.count = responseIds.size;
        
        // Get sentiment counts for this attribute
        const sentimentMap = attributeSentimentMap.get(attributeId)!;
        attribute.positiveCount = sentimentMap.get('positive') || 0;
        attribute.negativeCount = sentimentMap.get('negative') || 0;
        attribute.neutralCount = sentimentMap.get('neutral') || 0;
        
        // Calculate sentiment ratio (positive / total)
        const total = attribute.positiveCount + attribute.negativeCount + attribute.neutralCount;
        attribute.sentimentRatio = total > 0 ? attribute.positiveCount / total : 0;
        
        // Determine dominant sentiment
        if (attribute.positiveCount > attribute.negativeCount && attribute.positiveCount > attribute.neutralCount) {
          attribute.sentiment = 'positive';
        } else if (attribute.negativeCount > attribute.positiveCount && attribute.negativeCount > attribute.neutralCount) {
          attribute.sentiment = 'negative';
        } else {
          attribute.sentiment = 'neutral';
        }
      }
    });

    return Array.from(attributeMap.values())
      .sort((a, b) => b.count - a.count)
;
  }, [filteredThemes]);

  // Process data for bubble chart (attributes as data points, sentiment ratio vs volume)
  const bubbleChartData = useMemo(() => {
    return themeData.map(attribute => {
      // Find the attribute ID from the first theme that matches this attribute
      const firstTheme = filteredThemes.find(theme => theme.talentx_attribute_name === attribute.name);
      return {
        attributeName: attribute.name,
        attributeId: firstTheme?.talentx_attribute_id || 'unknown',
        sentiment: attribute.sentiment,
        sentimentRatio: attribute.sentimentRatio,
        positiveCount: attribute.positiveCount,
        negativeCount: attribute.negativeCount,
        neutralCount: attribute.neutralCount,
        volume: attribute.count, // Now represents unique responses, not theme instances
        themes: attribute.themes
      };
    });
  }, [themeData, filteredThemes]);

  const fetchAttributeSummary = async () => {
    if (!selectedAttribute) return;
    setThemeSummary("");
    setThemeSummaryError(null);
    setLoadingThemeSummary(true);
    setThinkingStep(0);
    setThinkingSteps([]);

    const attributeResponses = getResponsesForAttribute(selectedAttribute);
    if (attributeResponses.length === 0) {
      setThemeSummaryError("No responses found for this attribute.");
      setLoadingThemeSummary(false);
      setThinkingStep(-1);
      return;
    }

    const matchingTheme = filteredThemes.find(t => t.talentx_attribute_id === selectedAttribute);
    const attributeName = matchingTheme?.talentx_attribute_name || 'this attribute';

    const attributeThemes = filteredThemes.filter(t => t.talentx_attribute_id === selectedAttribute);
    const positiveThemes = attributeThemes.filter(t => t.sentiment === 'positive').map(t => t.theme_name);
    const negativeThemes = attributeThemes.filter(t => t.sentiment === 'negative').map(t => t.theme_name);
    const total = attributeThemes.length;
    const positiveRatio = total > 0 ? Math.round((positiveThemes.length / total) * 100) : 0;

    const steps = [
      `Reading ${attributeResponses.length} responses across sources...`,
      `Analyzing ${total} themes for ${attributeName}...`,
      `Evaluating sentiment patterns (${positiveRatio}% positive)...`,
      `Cross-referencing positive and negative signals...`,
      `Writing summary for ${companyName}...`,
    ];
    setThinkingSteps(steps);

    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < steps.length; i++) {
      stepTimers.push(setTimeout(() => setThinkingStep(i), i * 1800));
    }

    // Build numbered source list from responses with citations
    const sourceMap: { domain: string; url: string | null; displayName: string }[] = [];
    const seenDomains = new Set<string>();
    attributeResponses.forEach(r => {
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (Array.isArray(citations)) {
          citations.forEach((c: any) => {
            if (c.domain && !seenDomains.has(c.domain)) {
              seenDomains.add(c.domain);
              sourceMap.push({
                domain: c.domain,
                url: c.url ? extractSourceUrl(c.url) : null,
                displayName: getSourceDisplayName(c.domain),
              });
            }
          });
        }
      } catch { /* skip */ }
    });
    setSummarySources(sourceMap);

    const sourcesList = sourceMap.map((s, i) => `[${i + 1}] ${s.displayName} (${s.domain})`).join('\n');

    const prompt = `You are an employer brand analyst. Write a concise, insightful summary of how ${companyName} is perceived regarding "${attributeName}" based on AI-sourced data from job review sites, forums, and LLM responses.

Context:
- ${total} themes were extracted for this attribute
- ${positiveRatio}% positive sentiment
- Key positive signals: ${positiveThemes.slice(0, 5).join(', ') || 'None'}
- Key negative signals: ${negativeThemes.slice(0, 5).join(', ') || 'None'}

Available sources:
${sourcesList || 'No sources available'}

Source responses:
${attributeResponses.map((r, i) => {
      let responseSources = '';
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (Array.isArray(citations)) {
          const domains = [...new Set(citations.map((c: any) => c.domain).filter(Boolean))];
          const indices = domains.map(d => sourceMap.findIndex(s => s.domain === d) + 1).filter(n => n > 0);
          if (indices.length > 0) responseSources = ` [Sources: ${indices.join(', ')}]`;
        }
      } catch { /* skip */ }
      return `${(responseTexts[r.id] || r.response_text || '').slice(0, 800)}${responseSources}`;
    }).join('\n---\n')}

Write 2-3 short paragraphs (no bullet points, no headings). Be direct and specific to ${companyName}. Cover: (1) overall perception and what stands out, (2) any concerns or gaps candidates notice, (3) how this compares to what talent typically looks for. Write in a professional but accessible tone. Do not start with "${companyName} is perceived..." — vary the opening.

CRITICAL: When you reference information from a source, add an inline citation like [1], [2], etc. matching the source numbers above. Place citations naturally at the end of the relevant sentence or claim. Use citations frequently — every key claim should have one. Only cite sources from the numbered list above.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setThemeSummaryError("Authentication required");
        setLoadingThemeSummary(false);
        setThinkingStep(-1);
        stepTimers.forEach(clearTimeout);
        return;
      }
      const res = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ prompt, enableWebSearch: false })
      });
      const data = await res.json();
      stepTimers.forEach(clearTimeout);
      if (data.response) {
        setThemeSummary(data.response.trim());
      } else {
        setThemeSummaryError(data.error || "No summary generated.");
      }
    } catch (err) {
      stepTimers.forEach(clearTimeout);
      setThemeSummaryError("Failed to generate summary.");
    } finally {
      setLoadingThemeSummary(false);
      setThinkingStep(-1);
    }
  };

  const volumeThresholds = useMemo(() => {
    if (themeData.length === 0) return { p20: 0, p40: 0, p60: 0, p80: 0 };
    const sorted = [...themeData.map(t => t.count)].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
      return sorted[idx];
    };
    return { p20: percentile(20), p40: percentile(40), p60: percentile(60), p80: percentile(80) };
  }, [themeData]);

  const getVolumeLabel = (count: number) => {
    if (count > volumeThresholds.p80) return { text: 'Very High', style: 'bg-blue-100 text-blue-700' };
    if (count > volumeThresholds.p60) return { text: 'High', style: 'bg-sky-50 text-sky-700' };
    if (count > volumeThresholds.p40) return { text: 'Medium', style: 'bg-amber-50 text-amber-700' };
    if (count > volumeThresholds.p20) return { text: 'Low', style: 'bg-orange-50 text-orange-700' };
    return { text: 'Very Low', style: 'bg-red-50 text-red-600' };
  };

  return (
    <div className="w-full space-y-6">
      {/* Main Section Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <h2 className="text-2xl font-bold text-gray-900">Thematic Analysis</h2>
            <p className="text-gray-600">
              Analyze themes and sentiment patterns to understand {companyName}'s employer brand perception.
            </p>
          </div>
        </div>
      </div>

      {/* No Data Message */}
      {filteredResponses.length === 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Experience Data</h3>
              <p className="text-gray-600">
                You need responses from experience prompts to run thematic analysis.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {analysisError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-red-700">{analysisError}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty State — only show after loading completes */}
      {!aiThemesLoading && filteredThemes.length === 0 && filteredResponses.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Themes Found</h3>
              <p className="text-gray-600">
                No themes have been identified yet. Try running the AI analysis.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ranking */}
      {filteredThemes.length > 0 && (
      <>
          <div className="mt-4">
            <div className="space-y-1">
              {/* Column Headers — clickable to sort */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 select-none">
                <span className="w-5" />
                <span className="w-4" />
                <button onClick={() => setRankingSort('az')} className={`text-xs font-medium uppercase tracking-wide w-44 text-left transition-colors ${rankingSort === 'az' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>
                  Attribute {rankingSort === 'az' && '↓'}
                </button>
                <button onClick={() => setRankingSort('volume')} className={`text-xs font-medium uppercase tracking-wide flex-shrink-0 w-10 text-center transition-colors ${rankingSort === 'volume' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>
                  Volume {rankingSort === 'volume' && '↓'}
                </button>
                <span className="flex-1" />
                <button onClick={() => setRankingSort('sentiment')} className={`text-xs font-medium uppercase tracking-wide text-right flex-shrink-0 w-12 transition-colors ${rankingSort === 'sentiment' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>
                  Sentiment {rankingSort === 'sentiment' && '↓'}
                </button>
              </div>
              {[...themeData]
                .sort((a, b) => {
                  if (rankingSort === 'az') return a.name.localeCompare(b.name);
                  if (rankingSort === 'volume') return b.count - a.count;
                  const totalA = a.positiveCount + a.negativeCount + a.neutralCount;
                  const totalB = b.positiveCount + b.negativeCount + b.neutralCount;
                  return (totalB > 0 ? b.positiveCount / totalB : 0) - (totalA > 0 ? a.positiveCount / totalA : 0);
                })
                .map((attribute, index) => {
                  const totalThemes = attribute.positiveCount + attribute.negativeCount + attribute.neutralCount;
                  const sentimentScore = totalThemes > 0 ? Math.round((attribute.positiveCount / totalThemes) * 100) : 0;
                  const attributeTheme = filteredThemes.find(theme => theme.talentx_attribute_name === attribute.name);
                  const attributeId = attributeTheme?.talentx_attribute_id;
                  const IconComponent = attributeId ? (ATTRIBUTE_ICONS[attributeId] || Activity) : Activity;

                  const barColor = sentimentScore >= 80 ? 'bg-green-400' : sentimentScore >= 60 ? 'bg-yellow-300' : sentimentScore >= 40 ? 'bg-orange-300' : 'bg-red-400';

                  const volumeLabel = getVolumeLabel(attribute.count);

                  return (
                    <div
                      key={index}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => {
                        if (attributeId) {
                          setSelectedAttribute(attributeId);
                          setIsModalOpen(true);
                        }
                      }}
                    >
                      <span className="text-sm font-medium text-gray-400 w-5 text-right">{index + 1}</span>
                      <IconComponent className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900 w-44 truncate">{attribute.name}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${volumeLabel.style} flex-shrink-0`}>{volumeLabel.text}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${sentimentScore}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-gray-700 w-12 text-right">{sentimentScore}%</span>
                    </div>
                  );
                })}
            </div>
          </div>
      </>
      )}

      {/* Analysis Progress Modal */}
      {analysisProgress.isVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <h3 className="text-lg font-semibold text-gray-900">Analyzing Themes</h3>
            </div>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Progress</span>
                <span>{analysisProgress.current} of {analysisProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <p className="text-sm text-gray-700 mb-2">
              {analysisProgress.currentResponse}
            </p>
            
            <p className="text-xs text-gray-500">
              This may take a few moments as we analyze each response...
            </p>
          </div>
        </div>
      )}

      {/* Attribute Details Panel */}
      <Sheet open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          setModalView('summary');
          setSelectedTheme(null);
          setThemeSummary("");
          setThemeSummaryError(null);
          setThinkingStep(-1);
          setThinkingSteps([]);
          setSummarySources([]);
          setHoveredCitation(null);
        }
      }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0 [&>button]:hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              {modalView === 'detail' && selectedTheme ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setModalView('summary');
                      setSelectedTheme(null);
                    }}
                    className="p-1 h-auto"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <span>{selectedTheme.theme_name}</span>
                </div>
              ) : selectedAttribute && (() => {
                const IconComponent = ATTRIBUTE_ICONS[selectedAttribute] || Activity;
                const attributeData = bubbleChartData.find(d => d.attributeId === selectedAttribute);
                return (
                  <>
                    <IconComponent className="w-5 h-5" />
                    {attributeData?.attributeName || 'Attribute Details'}
                  </>
                );
              })()}
            </SheetTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
          
          {modalView === 'detail' && selectedTheme ? (
            // Detail view for a specific theme
            (() => {
              const getBadgeColor = (sentiment: string) => {
                switch (sentiment) {
                  case 'positive':
                    return 'bg-green-100 text-green-800';
                  case 'negative':
                    return 'bg-red-100 text-red-800';
                  case 'neutral':
                    return 'bg-gray-100 text-gray-800';
                  default:
                    return 'bg-gray-100 text-gray-800';
                }
              };

              const getBorderColor = (sentiment: string) => {
                switch (sentiment) {
                  case 'positive':
                    return 'border-green-500';
                  case 'negative':
                    return 'border-red-500';
                  case 'neutral':
                    return 'border-gray-500';
                  default:
                    return 'border-gray-500';
                }
              };

              const themeSources = getThemeSources(selectedTheme);
              const showAll = showAllThemeSources[selectedTheme.id] || false;
              const topSources = showAll ? themeSources : themeSources.slice(0, 5);
              const hasMoreSources = themeSources.length > 5;

              return (
                <div className="space-y-4">
                  <Card className={`border-l-4 ${getBorderColor(selectedTheme.sentiment)}`}>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <h4 className="font-medium text-gray-900">{selectedTheme.theme_name}</h4>
                          <span className={`text-xs px-2 py-1 rounded capitalize ${getBadgeColor(selectedTheme.sentiment)}`}>
                            {selectedTheme.sentiment}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{selectedTheme.theme_description}</p>
                        {selectedTheme.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedTheme.keywords.map((keyword, idx) => (
                              <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                                {keyword}
                              </span>
                            ))}
                          </div>
                        )}
                        {selectedTheme.context_snippets.length > 0 && (
                          <div className="mt-3">
                            <h5 className="text-xs font-medium text-gray-700 mb-2">Context Snippets:</h5>
                            <div className="space-y-1">
                              {selectedTheme.context_snippets.map((snippet, idx) => (
                                <div key={idx} className="text-xs text-gray-600 bg-gray-50 p-2 rounded italic">
                                  "{snippet}"
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Sources section */}
                        {themeSources.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <span className="text-xs text-gray-500">Sources:</span>
                            {topSources.map((source, index) => (
                              <div
                                key={index}
                                onClick={() => {
                                  if (source.url) {
                                    window.open(source.url, '_blank', 'noopener,noreferrer');
                                  }
                                }}
                                className={`inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-full text-xs font-medium text-gray-800 transition-colors border border-gray-200 ${source.url ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                <img
                                  src={getFavicon(source.domain)}
                                  alt=""
                                  className="w-4 h-4 mr-1 rounded"
                                  style={{ background: '#fff', display: 'block' }}
                                  onError={e => { e.currentTarget.style.display = 'none'; }}
                                />
                                {getSourceDisplayName(source.domain)}
                                <span className="ml-1 text-gray-500">({source.count})</span>
                              </div>
                            ))}
                            {hasMoreSources && (
                              <button
                                onClick={() => setShowAllThemeSources(prev => ({
                                  ...prev,
                                  [selectedTheme.id]: !showAll
                                }))}
                                className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors font-medium"
                              >
                                {showAll
                                  ? `Show Less` 
                                  : `+${themeSources.length - 5} more`
                                }
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })()
          ) : selectedAttribute && (() => {
            // Get all themes for the selected attribute (filtered by experience type)
            const attributeThemes = filteredThemes.filter(theme => theme.talentx_attribute_id === selectedAttribute);
            
            // Group themes by sentiment
            const positiveThemes = attributeThemes.filter(theme => theme.sentiment === 'positive');
            const negativeThemes = attributeThemes.filter(theme => theme.sentiment === 'negative');
            const neutralThemes = attributeThemes.filter(theme => theme.sentiment === 'neutral');
            
            // Get unique theme names (grouped by theme_name)
            const themeMap = new Map<string, AITheme[]>();
            attributeThemes.forEach(theme => {
              if (!themeMap.has(theme.theme_name)) {
                themeMap.set(theme.theme_name, []);
              }
              themeMap.get(theme.theme_name)!.push(theme);
            });
            const uniqueThemeNames = Array.from(themeMap.entries()).map(([name, themes]) => ({
              name,
              themes,
              count: themes.length,
              dominantSentiment: themes.reduce((acc, t) => {
                acc[t.sentiment] = (acc[t.sentiment] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            })).sort((a, b) => b.count - a.count);

            return (
              <div className="space-y-6">
                {/* MODELS ROW - matching CompetitorsTab style */}
                {(() => {
                  const attributeResponses = getResponsesForAttribute(selectedAttribute);
                  const uniqueLLMs = Array.from(new Set(attributeResponses.map(r => r.ai_model).filter(Boolean)));
                  
                  return (
                    <div className="flex flex-row gap-8 mt-1 mb-1 w-full">
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

                {/* AI Summary — on demand */}
                {themeSummary ? (
                  <Card className="mb-6 border-blue-100 bg-blue-50/30">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-blue-500" />
                          AI Summary
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={fetchAttributeSummary}
                          disabled={loadingThemeSummary}
                          className="text-xs text-gray-400 hover:text-gray-600 h-auto py-1"
                        >
                          {loadingThemeSummary ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          Regenerate
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-gray-800 text-sm leading-relaxed">
                        {themeSummary.split('\n\n').filter(Boolean).map((paragraph, pIdx) => {
                          const parts = paragraph.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
                          return (
                            <p key={pIdx} className="mb-3 last:mb-0">
                              {parts.map((part, partIdx) => {
                                const citationMatch = part.match(/^\[([\d\s,]+)\]$/);
                                if (citationMatch) {
                                  const nums = citationMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                                  return (
                                    <span key={partIdx}>
                                      {nums.map((num, nIdx) => {
                                        const source = summarySources[num - 1];
                                        if (!source) return null;
                                        return (
                                          <button
                                            key={nIdx}
                                            onClick={() => { if (source.url) window.open(source.url, '_blank', 'noopener,noreferrer'); }}
                                            className={`inline-flex items-center gap-1 bg-white hover:bg-gray-50 pl-1 pr-2 py-0.5 rounded-full text-xs text-gray-600 transition-colors border border-gray-200 mx-0.5 align-middle ${source.url ? 'cursor-pointer' : 'cursor-default'}`}
                                          >
                                            <img src={getFavicon(source.domain)} alt="" className="w-3.5 h-3.5 rounded flex-shrink-0" style={{ background: '#fff', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                                            <span>{source.displayName}</span>
                                          </button>
                                        );
                                      })}
                                    </span>
                                  );
                                }
                                return <span key={partIdx}>{part}</span>;
                              })}
                            </p>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ) : loadingThemeSummary ? (
                  <Card className="mb-6 border-blue-100 bg-gradient-to-br from-blue-50/40 to-indigo-50/30 overflow-hidden">
                    <CardContent className="py-5 px-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="relative">
                          <Sparkles className="w-4 h-4 text-blue-500" />
                          <div className="absolute inset-0 animate-ping">
                            <Sparkles className="w-4 h-4 text-blue-400 opacity-30" />
                          </div>
                        </div>
                        <span className="text-sm font-medium text-blue-700">Analyzing...</span>
                      </div>
                      <div className="space-y-0.5">
                        {thinkingSteps.map((step, i) => {
                          const isActive = i === thinkingStep;
                          const isComplete = i < thinkingStep;
                          const isPending = i > thinkingStep;
                          return (
                            <div
                              key={i}
                              className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-500 ${
                                isActive ? 'bg-blue-100/60' : ''
                              }`}
                              style={{
                                opacity: isPending ? 0.3 : 1,
                                transform: isPending ? 'translateX(4px)' : 'translateX(0)',
                                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                              }}
                            >
                              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                                {isComplete ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 transition-all duration-300" />
                                ) : isActive ? (
                                  <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                                ) : (
                                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                                )}
                              </div>
                              <span className={`text-xs transition-colors duration-300 ${
                                isActive ? 'text-blue-700 font-medium' : isComplete ? 'text-blue-500' : 'text-gray-400'
                              }`}>
                                {step}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-4 h-1 bg-blue-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${thinkingSteps.length > 0 ? ((thinkingStep + 1) / thinkingSteps.length) * 100 : 0}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ) : themeSummaryError ? (
                  <Card className="mb-6 border-red-100 bg-red-50/30">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <span className="text-red-600 text-sm">{themeSummaryError}</span>
                        <Button variant="ghost" size="sm" onClick={fetchAttributeSummary} className="text-xs">
                          Retry
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">{positiveThemes.length}</div>
                    <div className="text-sm text-green-700">Positive Themes</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <div className="text-2xl font-bold text-red-600">{negativeThemes.length}</div>
                    <div className="text-sm text-red-700">Negative Themes</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-2xl font-bold text-gray-600">{neutralThemes.length}</div>
                    <div className="text-sm text-gray-700">Neutral Themes</div>
                  </div>
                </div>

                {/* Key Themes List - Clickable */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">Key Themes</h3>
                  {uniqueThemeNames.map((themeGroup, index) => {
                    const dominantSentiment = Object.entries(themeGroup.dominantSentiment)
                      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'neutral';
                    
                    const getBadgeColor = (sentiment: string) => {
                      switch (sentiment) {
                        case 'positive':
                          return 'bg-green-100 text-green-800';
                        case 'negative':
                          return 'bg-red-100 text-red-800';
                        case 'neutral':
                          return 'bg-gray-100 text-gray-800';
                        default:
                          return 'bg-gray-100 text-gray-800';
                      }
                    };

                    const getBorderColor = (sentiment: string) => {
                      switch (sentiment) {
                        case 'positive':
                          return 'border-green-500';
                        case 'negative':
                          return 'border-red-500';
                        case 'neutral':
                          return 'border-gray-500';
                        default:
                          return 'border-gray-500';
                      }
                    };

                    // Use the first theme as representative for display
                    const representativeTheme = themeGroup.themes[0];

                    return (
                      <Card 
                        key={index} 
                        className={`border-l-4 ${getBorderColor(dominantSentiment)} cursor-pointer hover:shadow-md transition-shadow`}
                        onClick={() => {
                          setSelectedTheme(representativeTheme);
                          setModalView('detail');
                        }}
                      >
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 mb-1">{themeGroup.name}</h4>
                              <p className="text-sm text-gray-600 mb-2">{representativeTheme.theme_description}</p>
                              {representativeTheme.keywords && representativeTheme.keywords.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {representativeTheme.keywords.slice(0, 5).map((keyword, idx) => (
                                    <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                                      {keyword}
                                    </span>
                                  ))}
                                  {representativeTheme.keywords.length > 5 && (
                                    <span className="text-xs text-gray-500">+{representativeTheme.keywords.length - 5} more</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2 ml-4">
                              <span className={`text-xs px-2 py-1 rounded capitalize ${getBadgeColor(dominantSentiment)}`}>
                                {dominantSentiment}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {themeGroup.count} {themeGroup.count === 1 ? 'instance' : 'instances'}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {attributeThemes.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No themes found for this attribute.
                  </div>
                )}
              </div>
            );
          })()}

          </div>

          {/* Floating Ask AI button — bottom right of panel */}
          {!themeSummary && !loadingThemeSummary && !themeSummaryError && selectedAttribute && modalView === 'summary' && (
            <div className="absolute bottom-6 right-6 z-10 animate-slideUpGlow rounded-full">
              <button
                onClick={fetchAttributeSummary}
                className="h-12 rounded-full bg-[#13274F] text-white shadow-lg hover:bg-[#1a3468] transition-all hover:scale-105 flex items-center justify-center gap-2 px-5"
              >
                <img alt="PerceptionX" className="h-5 w-5 object-contain shrink-0 brightness-0 invert" src="/logos/perceptionx-small.png" />
                <span className="text-sm font-medium whitespace-nowrap">Ask AI</span>
                <span className="text-[10px] font-semibold bg-[#DB5E89] text-white px-1.5 py-0.5 rounded-full leading-none">BETA</span>
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
});
ThematicAnalysisTab.displayName = 'ThematicAnalysisTab';