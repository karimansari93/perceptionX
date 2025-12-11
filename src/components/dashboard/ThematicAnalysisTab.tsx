import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  ArrowLeft
} from 'lucide-react';
import { PromptResponse } from '@/types/dashboard';
import { supabase } from '@/integrations/supabase/client';
import { TALENTX_ATTRIBUTES } from '@/config/talentXAttributes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import LLMLogo from '@/components/LLMLogo';
import { getLLMDisplayName } from '@/config/llmLogos';
import { extractSourceUrl } from '@/utils/citationUtils';

interface ThematicAnalysisTabProps {
  responses: PromptResponse[];
  companyName: string;
  chartView: 'bubble' | 'bar';
  setChartView: (view: 'bubble' | 'bar') => void;
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

export const ThematicAnalysisTab = ({ responses, companyName, chartView, setChartView }: ThematicAnalysisTabProps) => {
  const [aiThemes, setAiThemes] = useState<AITheme[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // Modal and filter states - persisted
  const [selectedAttribute, setSelectedAttribute] = usePersistedState<string | null>('thematicTab.selectedAttribute', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('thematicTab.isModalOpen', false);
  const [experienceType, setExperienceType] = usePersistedState<'employee' | 'candidate'>('thematicTab.experienceType', 'employee');
  const [selectedIndustry, setSelectedIndustry] = usePersistedState<string>('thematicTab.selectedIndustry', 'all');
  const [selectedFunction, setSelectedFunction] = usePersistedState<string>('thematicTab.selectedFunction', 'all');
  const [selectedPromptType, setSelectedPromptType] = usePersistedState<'all' | 'sentiment' | 'competitive'>('thematicTab.selectedPromptType', 'all');
  const [themeView, setThemeView] = usePersistedState<'swot' | 'rankings'>('thematicTab.themeView', 'swot');
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
  const [showAllAttributeSources, setShowAllAttributeSources] = useState(false);
  const [modalView, setModalView] = usePersistedState<'summary' | 'detail'>('thematicTab.modalView', 'summary');

  // Extract unique industries and functions from responses for filter options
  const { industries, functions } = useMemo(() => {
    const industrySet = new Set<string>();
    const functionSet = new Set<string>();
    
    responses.forEach(response => {
      const industry = response.confirmed_prompts?.industry_context;
      const jobFunction = response.confirmed_prompts?.job_function_context;
      
      if (industry) industrySet.add(industry);
      if (jobFunction) functionSet.add(jobFunction);
    });
    
    return {
      industries: Array.from(industrySet).sort(),
      functions: Array.from(functionSet).sort()
    };
  }, [responses]);

  // Filter responses to only include sentiment and competitive prompts (excluding visibility)
  // Also filter by prompt_category based on experienceType, industry, function, and prompt type
  const filteredResponses = useMemo(() => {
    return responses.filter(response => {
      const promptType = response.confirmed_prompts?.prompt_type;
      const promptCategory = response.confirmed_prompts?.prompt_category;
      const industry = response.confirmed_prompts?.industry_context;
      const jobFunction = response.confirmed_prompts?.job_function_context;
      
      // First, filter by prompt type (sentiment/competitive only, exclude visibility)
      const isValidType = promptType === 'sentiment' || 
                          promptType === 'competitive' || 
                          promptType === 'talentx_sentiment' || 
                          promptType === 'talentx_competitive';
      
      if (!isValidType) return false;
      
      // Filter by selected prompt type (sentiment/competitive)
      if (selectedPromptType !== 'all') {
        if (selectedPromptType === 'sentiment') {
          // Only include sentiment prompts (both regular and talentx)
          if (promptType !== 'sentiment' && promptType !== 'talentx_sentiment') return false;
        } else if (selectedPromptType === 'competitive') {
          // Only include competitive prompts (both regular and talentx)
          if (promptType !== 'competitive' && promptType !== 'talentx_competitive') return false;
        }
      }
      
      // Then, filter by prompt_category based on experienceType
      if (experienceType === 'employee') {
        // Employee Experience: include Employee Experience and General prompts
        // (General prompts like "How is X as an employer?" are about employee experience)
        if (promptCategory !== 'Employee Experience' && promptCategory !== 'General') return false;
      } else {
        // Candidate Experience: only include Candidate Experience prompts
        if (promptCategory !== 'Candidate Experience') return false;
      }
      
      // Filter by industry if selected
      if (selectedIndustry !== 'all' && industry !== selectedIndustry) return false;
      
      // Filter by function if selected
      if (selectedFunction !== 'all' && jobFunction !== selectedFunction) return false;
      
      return true;
    });
  }, [responses, experienceType, selectedIndustry, selectedFunction, selectedPromptType]);

  // Fetch AI themes from database
  // Fetch themes for all relevant responses (sentiment/competitive), then filter by experience type
  // This ensures we don't miss themes that were already created
  const fetchAIThemes = async () => {
    try {
      // Get all relevant responses (sentiment/competitive) regardless of category
      // We'll filter themes by experience type after fetching
      const allRelevantResponses = responses.filter(response => {
        const promptType = response.confirmed_prompts?.prompt_type;
        return promptType === 'sentiment' || 
               promptType === 'competitive' || 
               promptType === 'talentx_sentiment' || 
               promptType === 'talentx_competitive';
      });

      const responseIds = allRelevantResponses.map(r => r.id);
      if (responseIds.length === 0) return;

      // Fetch themes for all relevant responses
      const { data, error } = await supabase
        .from('ai_themes')
        .select('*')
        .in('response_id', responseIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Now filter themes to only include those from responses that match our filters
      // This ensures themes are only shown for responses that pass all filters
      const filteredResponseIds = new Set(filteredResponses.map(r => r.id));
      const filteredThemes = (data || []).filter(theme => 
        filteredResponseIds.has(theme.response_id)
      );
      
      setAiThemes(filteredThemes);
    } catch (error) {
      console.error('Error fetching AI themes:', error);
    }
  };

  useEffect(() => {
    fetchAIThemes();
  }, [filteredResponses]);

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

      // Process responses one by one to show progress
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
              response_text: response.response_text,
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
      await fetchAIThemes();
    } catch (error) {
      console.error('Error running AI analysis:', error);
      setAnalysisError('Failed to run AI analysis. Please try again.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(prev => ({ ...prev, isVisible: false }));
    }
  };

  // Filter themes based on experience type
  const filteredThemes = useMemo(() => {
    // Candidate Experience attribute IDs
    const candidateExperienceIds = [
      'application-process',
      'candidate-communication',
      'interview-experience',
      'candidate-feedback',
      'onboarding-experience',
      'overall-candidate-experience'
    ];

    return aiThemes.filter(theme => {
      const attributeId = theme.talentx_attribute_id;
      
      if (experienceType === 'candidate') {
        // Show only Candidate Experience attributes
        return candidateExperienceIds.includes(attributeId);
      } else {
        // Show only Employee Experience attributes (everything except Candidate Experience)
        return !candidateExperienceIds.includes(attributeId);
      }
    });
  }, [aiThemes, experienceType]);

  // Check if candidate experience exists
  const hasCandidateExperience = useMemo(() => {
    const candidateExperienceIds = [
      'application-process',
      'candidate-communication',
      'interview-experience',
      'candidate-feedback',
      'onboarding-experience',
      'overall-candidate-experience'
    ];
    return aiThemes.some(theme => candidateExperienceIds.includes(theme.talentx_attribute_id));
  }, [aiThemes]);

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
      .slice(0, 10); // Top 10 attributes
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

  // Fetch AI summary for attribute when modal opens
  useEffect(() => {
    if (!isModalOpen || !selectedAttribute || modalView !== 'summary') return;
    setThemeSummary("");
    setThemeSummaryError(null);
    setLoadingThemeSummary(true);
    
    const attributeResponses = getResponsesForAttribute(selectedAttribute);
    if (attributeResponses.length === 0) {
      setThemeSummaryError("No responses found for this attribute.");
      setLoadingThemeSummary(false);
      return;
    }

    const attributeData = bubbleChartData.find(d => d.attributeId === selectedAttribute);
    const attributeName = attributeData?.attributeName || 'this attribute';

    // Build the prompt
    const prompt = `Analyze ${companyName}'s employer brand perception related to ${attributeName} for talent acquisition.

OUTPUT ONLY THE BULLETS BELOW - NO INTRODUCTION, NO EXPLANATION, JUST THE BULLETS:

• [${companyName}'s ${attributeName} strengths - max 15 words]

• [How talent perceives ${companyName}'s ${attributeName} - max 15 words]

• [Key ${attributeName} reputation factors - max 15 words]

• [Notable ${attributeName} characteristics - max 15 words]

Focus on: themes, sentiment, key insights, and how this attribute impacts employer brand perception.

CRITICAL: 
- DO NOT include any introductory text like "Here's an analysis..." or similar
- OUTPUT ONLY THE BULLET POINTS with a blank line between each bullet
- Each bullet must be under 15 words and fit on one line
- Start your response directly with the first bullet point
- Put each bullet on a NEW LINE separated by a blank line
- Focus ONLY on ${attributeName} for ${companyName}

Responses:\n${attributeResponses.map(r => r.response_text?.slice(0, 1000) || '').join('\n---\n')}`;

    // Get session and call Gemini endpoint
    const fetchSummary = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setThemeSummaryError("Authentication required");
          setLoadingThemeSummary(false);
          return;
        }
        const res = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-gemini", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ prompt })
        });
        const data = await res.json();
        if (data.response) {
          // Strip any introductory text before the first bullet point
          let cleanedResponse = data.response.trim();
          const firstBulletIndex = cleanedResponse.search(/^[•\-\*]/m);
          if (firstBulletIndex > 0) {
            cleanedResponse = cleanedResponse.substring(firstBulletIndex);
          }
          
          // Ensure each bullet is on its own line
          cleanedResponse = cleanedResponse
            .replace(/([^\n])\s*([•\-\*])\s+/g, '$1\n\n$2 ')
            .trim();
          
          setThemeSummary(cleanedResponse);
        } else {
          setThemeSummaryError(data.error || "No summary generated.");
        }
      } catch (err) {
        setThemeSummaryError("Failed to fetch summary.");
      } finally {
        setLoadingThemeSummary(false);
      }
    };
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, selectedAttribute, modalView, bubbleChartData, companyName]);

  const maxCount = themeData.length > 0 ? Math.max(...themeData.map(t => t.count)) : 1;

  return (
    <Tabs value={themeView} onValueChange={(value) => setThemeView(value as 'swot' | 'rankings')} className="w-full space-y-6">
      {/* Main Section Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <h2 className="text-2xl font-bold text-gray-900">Thematic Analysis</h2>
            <p className="text-gray-600">
              Analyze themes and sentiment patterns to understand {companyName}'s employer brand perception.
            </p>
          </div>
          
          {/* SWOT/Rankings Switcher - Top Right */}
          {filteredThemes.length > 0 && (
            <TabsList className="grid grid-cols-2 bg-gray-100 w-auto">
              <TabsTrigger 
                value="swot"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                SWOT
              </TabsTrigger>
              <TabsTrigger 
                value="rankings"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Rankings
              </TabsTrigger>
            </TabsList>
          )}
        </div>
        
        {/* Filters - All in one row - Always visible */}
        <div className="w-full flex flex-wrap items-center gap-3">
          {/* Experience Type Filter - only show if candidate experience exists */}
          {hasCandidateExperience && (
            <Select value={experienceType} onValueChange={(value) => setExperienceType(value as 'employee' | 'candidate')}>
              <SelectTrigger className="w-auto min-w-[180px]">
                <SelectValue placeholder="Employee Experience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee Experience</SelectItem>
                <SelectItem value="candidate">Candidate Experience</SelectItem>
              </SelectContent>
            </Select>
          )}
          
          {/* Prompt Type Filter */}
          <Select value={selectedPromptType} onValueChange={(value) => setSelectedPromptType(value as 'all' | 'sentiment' | 'competitive')}>
            <SelectTrigger className="w-auto min-w-[160px]">
              <SelectValue placeholder="All Prompt Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Prompt Types</SelectItem>
              <SelectItem value="sentiment">Employer (Sentiment)</SelectItem>
              <SelectItem value="competitive">Competitive</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Industry Filter */}
          {industries.length > 0 && (
            <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
              <SelectTrigger className="w-auto min-w-[150px]">
                <SelectValue placeholder="All Industries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Industries</SelectItem>
                {industries.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
          {/* Function Filter */}
          {functions.length > 0 && (
            <Select value={selectedFunction} onValueChange={setSelectedFunction}>
              <SelectTrigger className="w-auto min-w-[150px]">
                <SelectValue placeholder="All Functions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Functions</SelectItem>
                {functions.map((func) => (
                  <SelectItem key={func} value={func}>
                    {func}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* No Data Message - Show when filteredResponses is empty, but keep filters visible */}
      {filteredResponses.length === 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No {experienceType === 'employee' ? 'Employee' : 'Candidate'} Experience Data
              </h3>
              <p className="text-gray-600">
                You need responses from {experienceType === 'employee' ? 'Employee Experience' : 'Candidate Experience'} sentiment or competitive prompts to run thematic analysis.
              </p>
              <div className="mt-4 text-sm text-gray-500">
                <p>This analysis focuses on:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  {experienceType === 'employee' ? (
                    <>
                      <li>General sentiment prompts (e.g., "How is X as an employer?")</li>
                      <li>General competitive prompts</li>
                      <li>Employee Experience sentiment prompts</li>
                      <li>Employee Experience competitive prompts</li>
                      <li>TalentX Employee Experience sentiment prompts</li>
                      <li>TalentX Employee Experience competitive prompts</li>
                    </>
                  ) : (
                    <>
                      <li>Candidate Experience sentiment prompts</li>
                      <li>Candidate Experience competitive prompts</li>
                      <li>TalentX Candidate Experience sentiment prompts</li>
                      <li>TalentX Candidate Experience competitive prompts</li>
                    </>
                  )}
                </ul>
                <p className="mt-2">Visibility prompts and {experienceType === 'employee' ? 'Candidate Experience' : 'Employee Experience'} prompts are excluded from this analysis.</p>
              </div>
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

      {/* Empty State for Selected Experience Type */}
      {filteredThemes.length === 0 && aiThemes.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No {experienceType === 'candidate' ? 'Candidate' : 'Employee'} Experience Themes Found
              </h3>
              <p className="text-gray-600">
                No themes have been identified for {experienceType === 'candidate' ? 'candidate experience' : 'employee experience'} attributes yet.
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Try running the AI analysis or switch to {experienceType === 'candidate' ? 'Employee' : 'Candidate'} Experience to see themes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      {filteredThemes.length > 0 && (
      <>
        {/* SWOT Tab Content */}
        <TabsContent value="swot" className="mt-4">
            {/* Bubble Chart (SWOT) */}
            <div className="relative">
              {/* SWOT Chart Container */}
              <div className="h-[calc(100vh-280px)] min-h-96 w-full relative border border-gray-200 rounded-lg bg-gray-50 flex">
                {/* Chart Area */}
                <div className="flex-1 relative">
                  {/* Quadrant Labels */}
                  <div className="absolute top-2 right-2 text-sm font-bold text-green-700 bg-green-100 px-2 py-1 rounded">
                    STRENGTHS
                  </div>
                  <div className="absolute bottom-2 right-2 text-sm font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded">
                    OPPORTUNITIES
                  </div>
                  <div className="absolute bottom-2 left-2 text-sm font-bold text-orange-700 bg-orange-100 px-2 py-1 rounded">
                    THREATS
                  </div>
                  <div className="absolute top-2 left-2 text-sm font-bold text-red-700 bg-red-100 px-2 py-1 rounded">
                    WEAKNESSES
                  </div>

                  {/* Center lines */}
                  <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-300"></div>
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300"></div>

                  {/* Chart Area */}
                  <div className="absolute inset-4">
                  {bubbleChartData.map((data, index) => {
                    const maxVolume = Math.max(...bubbleChartData.map(d => d.volume));
                    const minVolume = Math.min(...bubbleChartData.map(d => d.volume));
                    
                    // Calculate bubble size relative to filtered data (max volume in current view)
                    // The largest bubble in the filtered view will always be the biggest
                    const minBubbleSize = 20;
                    const maxBubbleSize = 50;
                    const volumeRange = maxVolume - minVolume || 1; // Avoid division by zero
                    const relativeSize = maxVolume > 0 
                      ? minBubbleSize + ((data.volume - minVolume) / volumeRange) * (maxBubbleSize - minBubbleSize)
                      : minBubbleSize;
                    const bubbleSize = Math.max(minBubbleSize, Math.min(maxBubbleSize, relativeSize));
                    
                    // FIXED THRESHOLDS for sentiment classification - using actual positive/negative ratios
                    const POSITIVE_SENTIMENT_THRESHOLD = 0.6; // 60%+ positive themes
                    const NEGATIVE_SENTIMENT_THRESHOLD = 0.4; // 40%- positive themes (60%+ negative/neutral)
                    
                    // Calculate clear sentiment ratios
                    const totalThemes = data.positiveCount + data.negativeCount + data.neutralCount;
                    const positiveRatio = data.positiveCount / totalThemes;
                    const negativeRatio = data.negativeCount / totalThemes;
                    const neutralRatio = data.neutralCount / totalThemes;
                    
                    // Calculate positions with fixed sentiment thresholds based on positive ratio
                    // X-axis: Map positive ratio with fixed thresholds
                    let xPosition;
                    if (positiveRatio >= POSITIVE_SENTIMENT_THRESHOLD) {
                      // Map 0.6-1.0 to 60%-90% (right side)
                      xPosition = 60 + ((positiveRatio - POSITIVE_SENTIMENT_THRESHOLD) / (1.0 - POSITIVE_SENTIMENT_THRESHOLD)) * 30;
                    } else if (positiveRatio <= NEGATIVE_SENTIMENT_THRESHOLD) {
                      // Map 0.0-0.4 to 10%-40% (left side)
                      xPosition = 10 + (positiveRatio / NEGATIVE_SENTIMENT_THRESHOLD) * 30;
                    } else {
                      // Map 0.4-0.6 to 40%-60% (neutral zone)
                      xPosition = 40 + ((positiveRatio - NEGATIVE_SENTIMENT_THRESHOLD) / (POSITIVE_SENTIMENT_THRESHOLD - NEGATIVE_SENTIMENT_THRESHOLD)) * 20;
                    }
                    
                    // Y-axis: Keep relative scaling for volume (this makes sense)
                    const yPosition = 10 + ((maxVolume - data.volume) / (maxVolume - minVolume)) * 80;
                    
                    // Determine quadrant based on ABSOLUTE thresholds using positive ratio
                    const isPositiveSentiment = positiveRatio >= POSITIVE_SENTIMENT_THRESHOLD;
                    const isNegativeSentiment = positiveRatio <= NEGATIVE_SENTIMENT_THRESHOLD;
                    const isNeutralSentiment = positiveRatio > NEGATIVE_SENTIMENT_THRESHOLD && positiveRatio < POSITIVE_SENTIMENT_THRESHOLD;
                    const isHighVolume = yPosition < 50; // Top half of chart (high volume)
                    
                    // Determine which quadrant the bubble is actually in based on position
                    const isInStrengthsQuadrant = xPosition >= 50 && yPosition < 50; // Top-right
                    const isInOpportunitiesQuadrant = xPosition >= 50 && yPosition >= 50; // Bottom-right
                    const isInWeaknessesQuadrant = xPosition < 50 && yPosition < 50; // Top-left
                    const isInThreatsQuadrant = xPosition < 50 && yPosition >= 50; // Bottom-left
                    
                    // Color based on actual quadrant position
                    const quadrantColor = isInStrengthsQuadrant
                      ? 'bg-green-500' // Strengths quadrant - always green
                      : isInOpportunitiesQuadrant
                      ? 'bg-blue-500' // Opportunities quadrant - always blue
                      : isInWeaknessesQuadrant
                      ? 'bg-red-500' // Weaknesses quadrant - always red
                      : isInThreatsQuadrant
                      ? 'bg-orange-500' // Threats quadrant - always orange
                      : 'bg-yellow-500'; // Neutral zone (center)

                    return (
                      <div 
                        key={index} 
                        className="absolute"
                        style={{ 
                          left: `${xPosition}%`, 
                          top: `${yPosition}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                      >
                        {/* Bubble */}
                        <div 
                          className={`${quadrantColor} rounded-full flex items-center justify-center text-white font-medium text-xs shadow-lg hover:shadow-xl transition-all cursor-pointer group`}
                          style={{ 
                            width: `${bubbleSize}px`, 
                            height: `${bubbleSize}px` 
                          }}
                          title={`${data.attributeName}: ${(positiveRatio * 100).toFixed(0)}% positive, ${(negativeRatio * 100).toFixed(0)}% negative, ${(neutralRatio * 100).toFixed(0)}% neutral | Volume: ${data.volume} themes`}
                          onClick={() => {
                            setSelectedAttribute(data.attributeId);
                            setIsModalOpen(true);
                          }}
                        >
                          {(() => {
                            const IconComponent = ATTRIBUTE_ICONS[data.attributeId] || Activity;
                            return <IconComponent className="w-4 h-4" />;
                          })()}
                        </div>
                        
                        {/* Attribute name below bubble */}
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 text-xs font-medium text-gray-700 text-center whitespace-nowrap">
                          {data.attributeName}
                        </div>
                        
                      </div>
                    );
                  })}
                </div>

                </div>

                {/* Attributes Key */}
                <div className="w-64 bg-white border-l border-gray-200 p-4 overflow-y-auto">
                  <h4 className="font-semibold text-sm text-gray-900 mb-3">Attributes Key</h4>
                  <div className="space-y-2">
                    {bubbleChartData.map((data, index) => {
                      const maxVolume = Math.max(...bubbleChartData.map(d => d.volume));
                      const minVolume = Math.min(...bubbleChartData.map(d => d.volume));
                      
                      // Use same fixed thresholds as chart
                      const POSITIVE_SENTIMENT_THRESHOLD = 0.6; // 60% positive
                      const NEGATIVE_SENTIMENT_THRESHOLD = 0.4; // 40% positive (60% negative/neutral)
                      
                      // Calculate sentiment ratios using same logic as chart
                      const totalThemes = data.positiveCount + data.negativeCount + data.neutralCount;
                      const positiveRatio = data.positiveCount / totalThemes;
                      
                      // Calculate x position based on sentiment ratio (same as chart)
                      let xPosition;
                      if (positiveRatio >= POSITIVE_SENTIMENT_THRESHOLD) {
                        // Map 0.6-1.0 to 60%-90% (right side)
                        xPosition = 60 + ((positiveRatio - POSITIVE_SENTIMENT_THRESHOLD) / (1.0 - POSITIVE_SENTIMENT_THRESHOLD)) * 30;
                      } else if (positiveRatio <= NEGATIVE_SENTIMENT_THRESHOLD) {
                        // Map 0.0-0.4 to 10%-40% (left side)
                        xPosition = 10 + (positiveRatio / NEGATIVE_SENTIMENT_THRESHOLD) * 30;
                      } else {
                        // Map 0.4-0.6 to 40%-60% (neutral zone)
                        xPosition = 40 + ((positiveRatio - NEGATIVE_SENTIMENT_THRESHOLD) / (POSITIVE_SENTIMENT_THRESHOLD - NEGATIVE_SENTIMENT_THRESHOLD)) * 20;
                      }
                      
                      const yPosition = 10 + ((maxVolume - data.volume) / (maxVolume - minVolume)) * 80;
                      
                      const isPositiveSentiment = positiveRatio >= POSITIVE_SENTIMENT_THRESHOLD;
                      const isNegativeSentiment = positiveRatio <= NEGATIVE_SENTIMENT_THRESHOLD;
                      const isNeutralSentiment = positiveRatio > NEGATIVE_SENTIMENT_THRESHOLD && positiveRatio < POSITIVE_SENTIMENT_THRESHOLD;
                      const isHighVolume = yPosition < 50; // Top half of chart
                      
                      // Determine which quadrant the bubble is actually in based on position
                      const isInStrengthsQuadrant = xPosition >= 50 && yPosition < 50; // Top-right
                      const isInOpportunitiesQuadrant = xPosition >= 50 && yPosition >= 50; // Bottom-right
                      const isInWeaknessesQuadrant = xPosition < 50 && yPosition < 50; // Top-left
                      const isInThreatsQuadrant = xPosition < 50 && yPosition >= 50; // Bottom-left
                      
                      const quadrant = isInStrengthsQuadrant
                        ? 'Strengths'
                        : isInOpportunitiesQuadrant
                        ? 'Opportunities'
                        : isInWeaknessesQuadrant
                        ? 'Weaknesses'
                        : isInThreatsQuadrant
                        ? 'Threats'
                        : 'Neutral';
                        
                      const quadrantColor = isInStrengthsQuadrant
                        ? 'bg-green-100 border-green-300 text-green-800'
                        : isInOpportunitiesQuadrant
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : isInWeaknessesQuadrant
                        ? 'bg-red-100 border-red-300 text-red-800'
                        : isInThreatsQuadrant
                        ? 'bg-orange-100 border-orange-300 text-orange-800'
                        : 'bg-yellow-100 border-yellow-300 text-yellow-800';

                      const IconComponent = ATTRIBUTE_ICONS[data.attributeId] || Activity;
                      
                      return (
                        <div 
                          key={index} 
                          className={`p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-all ${quadrantColor}`}
                          onClick={() => {
                            setSelectedAttribute(data.attributeId);
                            setIsModalOpen(true);
                          }}
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <IconComponent className="w-4 h-4" />
                            <span className="truncate">{data.attributeName}</span>
                          </div>
                          <div className="text-xs opacity-75 mt-1">
                            <div>Positive: {data.positiveCount} | Negative: {data.negativeCount} | Neutral: {data.neutralCount}</div>
                            <div>Ratio: {(data.sentimentRatio * 100).toFixed(0)}% positive</div>
                            <div>Volume: {data.volume}</div>
                            <div className="font-medium">{quadrant}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>
          </TabsContent>

          {/* Rankings Tab Content */}
          <TabsContent value="rankings" className="mt-4">
            {/* Bar Chart (Rankings) */}
            <Card>
              <CardContent>
                <div className="space-y-4">
                  {themeData.map((attribute, index) => {
                    const percentage = (attribute.count / maxCount) * 100;
                    
                    // Calculate sentiment percentages for stacked bar
                    const totalThemes = attribute.positiveCount + attribute.negativeCount + attribute.neutralCount;
                    const positivePercentage = totalThemes > 0 ? (attribute.positiveCount / totalThemes) * percentage : 0;
                    const negativePercentage = totalThemes > 0 ? (attribute.negativeCount / totalThemes) * percentage : 0;
                    const neutralPercentage = totalThemes > 0 ? (attribute.neutralCount / totalThemes) * percentage : 0;
                    
                    // Find the attribute ID from the filtered themes
                    const attributeTheme = filteredThemes.find(theme => theme.talentx_attribute_name === attribute.name);
                    const attributeId = attributeTheme?.talentx_attribute_id;

                    return (
                      <div 
                        key={index} 
                        className="space-y-2 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                        onClick={() => {
                          if (attributeId) {
                            setSelectedAttribute(attributeId);
                            setIsModalOpen(true);
                          }
                        }}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1 mr-4">
                            <span className="text-sm font-medium text-gray-900">
                              {attribute.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">{attribute.count}</span>
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full bg-green-500" title={`${attribute.positiveCount} positive`}></div>
                              <div className="w-2 h-2 rounded-full bg-red-500" title={`${attribute.negativeCount} negative`}></div>
                              <div className="w-2 h-2 rounded-full bg-gray-400" title={`${attribute.neutralCount} neutral`}></div>
                            </div>
                          </div>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 flex overflow-hidden">
                          {positivePercentage > 0 && (
                            <div
                              className="bg-green-500 h-full transition-all duration-500"
                              style={{ width: `${positivePercentage}%` }}
                              title={`${attribute.positiveCount} positive themes`}
                            ></div>
                          )}
                          {negativePercentage > 0 && (
                            <div
                              className="bg-red-500 h-full transition-all duration-500"
                              style={{ width: `${negativePercentage}%` }}
                              title={`${attribute.negativeCount} negative themes`}
                            ></div>
                          )}
                          {neutralPercentage > 0 && (
                            <div
                              className="bg-gray-400 h-full transition-all duration-500"
                              style={{ width: `${neutralPercentage}%` }}
                              title={`${attribute.neutralCount} neutral themes`}
                            ></div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
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

      {/* Attribute Details Modal */}
      <Dialog open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          setModalView('summary');
          setSelectedTheme(null);
          setThemeSummary("");
          setThemeSummaryError(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
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
            </DialogTitle>
          </DialogHeader>
          
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

                {/* Summary Card - matching CompetitorsTab style */}
                <div className="mb-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loadingThemeSummary ? (
                        <div className="w-full">
                          <Skeleton className="h-6 w-3/4 mb-2" />
                          <Skeleton className="h-6 w-5/6 mb-2" />
                          <Skeleton className="h-6 w-2/3 mb-2" />
                          <Skeleton className="h-6 w-1/2 mb-2" />
                        </div>
                      ) : themeSummaryError ? (
                        <div className="text-red-600 text-sm py-2">{themeSummaryError}</div>
                      ) : themeSummary ? (
                        <>
                          <div className="text-gray-800 text-base mb-3">
                            <ReactMarkdown 
                              components={{
                                p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                                ul: ({children}) => <ul className="space-y-1 list-disc list-inside">{children}</ul>,
                                li: ({children}) => <li className="text-sm leading-tight">{children}</li>
                              }}
                            >
                              {themeSummary}
                            </ReactMarkdown>
                          </div>
                          
                          {/* Sources section - matching CompetitorsTab style */}
                          {(() => {
                            const attributeSources = getAttributeSources(selectedAttribute);
                            const topSources = showAllAttributeSources ? attributeSources : attributeSources.slice(0, 5);
                            const hasMoreSources = attributeSources.length > 5;
                            
                            return attributeSources.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-2 mt-2">
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
                                    onClick={() => setShowAllAttributeSources(!showAllAttributeSources)}
                                    className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors font-medium"
                                  >
                                    {showAllAttributeSources 
                                      ? `Show Less` 
                                      : `+${attributeSources.length - 5} more`
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
        </DialogContent>
      </Dialog>
    </Tabs>
  );
};