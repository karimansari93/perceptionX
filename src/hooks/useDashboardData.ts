import { useState, useEffect, useMemo } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData, Citation, CompetitorMention } from "@/types/dashboard";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";

export const useDashboardData = () => {
  const { user } = useAuth();
  const [responses, setResponses] = useState<PromptResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string>("");

  const fetchCompanyName = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.error('Error fetching company name:', error);
      } else if (data) {
        setCompanyName(data.company_name);
      }
    } catch (error) {
      console.error('Error fetching company name:', error);
    }
  };

  const fetchResponses = async () => {
    if (!user) return;
    
    try {
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id')
        .eq('user_id', user.id);

      if (promptsError) throw promptsError;

      if (!userPrompts || userPrompts.length === 0) {
        setResponses([]);
        setLoading(false);
        return;
      }

      const promptIds = userPrompts.map(p => p.id);

      const { data, error } = await supabase
        .from('prompt_responses')
        .select(`
          *,
          confirmed_prompts (
            prompt_text,
            prompt_category,
            prompt_type
          )
        `)
        .in('confirmed_prompt_id', promptIds)
        .order('tested_at', { ascending: false });

      if (error) throw error;
      
      // Create a map to store the latest response for each prompt-model combination
      const responseMap = new Map();
      
      // Process responses and keep only the latest one for each prompt-model combination
      (data || []).forEach(response => {
        const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
        const existingResponse = responseMap.get(key);
        
        if (!existingResponse || new Date(response.tested_at) > new Date(existingResponse.tested_at)) {
          responseMap.set(key, response);
        }
      });
      
      // Convert the map values back to an array
      const uniqueResponses = Array.from(responseMap.values());
      
      // Sort by tested_at in descending order
      uniqueResponses.sort((a, b) => new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime());
      
      setResponses(uniqueResponses);
    } catch (error) {
      console.error('Error fetching responses:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    await fetchResponses();
  };

  useEffect(() => {
    if (user) {
      fetchResponses();
      fetchCompanyName();
    }
  }, [user]);

  const parseCitations = (citations: any): Citation[] => {
    if (!citations) return [];
    if (Array.isArray(citations)) return citations;
    if (typeof citations === 'string') {
      try {
        const parsed = JSON.parse(citations);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const promptsData: PromptData[] = useMemo(() => {
    return responses.reduce((acc: PromptData[], response) => {
      const existing = acc.find(item => 
        item.prompt === response.confirmed_prompts?.prompt_text
      );
      
      if (existing) {
        existing.responses += 1;
        existing.avgSentiment = (existing.avgSentiment + (response.sentiment_score || 0)) / 2;
        // Update visibility metrics
        if (response.confirmed_prompts?.prompt_type === 'visibility') {
          if (typeof existing.averageVisibility === 'number') {
            existing.averageVisibility = (existing.averageVisibility * (existing.responses - 1) + (response.company_mentioned ? 100 : 0)) / existing.responses;
          } else {
            existing.averageVisibility = response.company_mentioned ? 100 : 0;
          }
        }
        // Update competitive metrics
        if (response.confirmed_prompts?.prompt_type === 'competitive') {
          if (response.competitor_mentions) {
            const mentions = response.competitor_mentions as string[];
            existing.competitorMentions = [...new Set([...(existing.competitorMentions || []), ...mentions])];
          }
          // Calculate competitive position based on mention order
          if (response.mention_ranking) {
            existing.competitivePosition = existing.competitivePosition 
              ? (existing.competitivePosition + response.mention_ranking) / 2 
              : response.mention_ranking;
          }
        }
      } else {
        acc.push({
          prompt: response.confirmed_prompts?.prompt_text || '',
          category: response.confirmed_prompts?.prompt_category || '',
          type: response.confirmed_prompts?.prompt_type || 'sentiment',
          responses: 1,
          avgSentiment: response.sentiment_score || 0,
          sentimentLabel: response.sentiment_label || 'neutral',
          mentionRanking: response.mention_ranking || undefined,
          competitivePosition: response.mention_ranking || undefined,
          competitorMentions: response.competitor_mentions as string[] || undefined,
          averageVisibility: response.confirmed_prompts?.prompt_type === 'visibility' ? (response.company_mentioned ? 100 : 0) : undefined
        });
      }
      
      return acc;
    }, []);
  }, [responses]);

  const metrics: DashboardMetrics = useMemo(() => {
    const averageSentiment = responses.length > 0 
      ? responses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / responses.length 
      : 0;

    const sentimentLabel = averageSentiment > 0.1 ? 'Positive' : averageSentiment < -0.1 ? 'Negative' : 'Neutral';
    
    // Calculate sentiment counts
    const positiveCount = responses.filter(r => (r.sentiment_score || 0) > 0.1).length;
    const neutralCount = responses.filter(r => (r.sentiment_score || 0) >= -0.1 && (r.sentiment_score || 0) <= 0.1).length;
    const negativeCount = responses.filter(r => (r.sentiment_score || 0) < -0.1).length;
    
    // Calculate sentiment trend comparison
    const lastWeekResponses = responses.filter(r => {
      const responseDate = new Date(r.tested_at);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      return responseDate >= oneWeekAgo;
    });
    
    const previousWeekResponses = responses.filter(r => {
      const responseDate = new Date(r.tested_at);
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      return responseDate >= twoWeeksAgo && responseDate < oneWeekAgo;
    });

    const lastWeekSentiment = lastWeekResponses.length > 0
      ? lastWeekResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / lastWeekResponses.length
      : 0;
    
    const previousWeekSentiment = previousWeekResponses.length > 0
      ? previousWeekResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / previousWeekResponses.length
      : 0;

    const sentimentChange = previousWeekSentiment !== 0
      ? ((lastWeekSentiment - previousWeekSentiment) / Math.abs(previousWeekSentiment)) * 100
      : 0;

    const sentimentTrendComparison = {
      value: Math.abs(Math.round(sentimentChange)),
      direction: sentimentChange > 0 ? 'up' as const : sentimentChange < 0 ? 'down' as const : 'neutral' as const
    };

    const totalCitations = responses.reduce((sum, r) => sum + parseCitations(r.citations).length, 0);
    const uniqueDomains = new Set(
      responses.flatMap(r => parseCitations(r.citations).map((c: Citation) => c.domain).filter(Boolean))
    ).size;

    // Calculate average visibility from promptsData
    const visibilityPrompts = promptsData.filter(p => p.type === 'visibility' && typeof p.averageVisibility === 'number');
    const averageVisibility = visibilityPrompts.length > 0
      ? visibilityPrompts.reduce((sum, p) => sum + (p.averageVisibility || 0), 0) / visibilityPrompts.length
      : 0;

    return {
      averageSentiment,
      sentimentLabel,
      sentimentTrendComparison,
      totalCitations,
      uniqueDomains,
      totalResponses: responses.length,
      averageVisibility,
      positiveCount,
      neutralCount,
      negativeCount
    };
  }, [responses, promptsData]);

  const sentimentTrend: SentimentTrendData[] = useMemo(() => {
    const trend = responses.reduce((acc: SentimentTrendData[], response) => {
      const date = new Date(response.tested_at).toLocaleDateString();
      const existing = acc.find(item => item.date === date);
      
      if (existing) {
        existing.sentiment = (existing.sentiment + (response.sentiment_score || 0)) / 2;
        existing.count += 1;
      } else {
        acc.push({
          date,
          sentiment: response.sentiment_score || 0,
          count: 1
        });
      }
      
      return acc;
    }, []);
    // Sort by date ascending
    trend.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return trend.slice(-7); // get the last 7 days (latest at the end)
  }, [responses]);

  const topCitations: CitationCount[] = useMemo(() => {
    // Use enhanceCitations to get EnhancedCitation objects
    const allCitations = responses.flatMap(r => enhanceCitations(parseCitations(r.citations)));
    // Only keep citations that are real websites
    const websiteCitations = allCitations.filter(citation => citation.type === 'website' && citation.url);

    const citationCounts = websiteCitations.reduce((acc: any, citation: EnhancedCitation) => {
      const domain = citation.domain;
      if (domain) {
        acc[domain] = (acc[domain] || 0) + 1;
      }
      return acc;
    }, {});

    return Object.entries(citationCounts)
      .map(([domain, count]) => ({ domain, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [responses]);

  const getMostCommonValue = (arr: string[]): string | null => {
    if (!arr.length) return null;
    const counts: Record<string, number> = arr.reduce((acc, val) => {
      acc[val] = (acc[val] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };

  const preparePromptData = (prompts: any[], responses: any[]): PromptData[] => {
    return prompts.map(prompt => {
      const promptResponses = responses.filter(r => r.confirmed_prompt_id === prompt.id);
      const totalResponses = promptResponses.length;
      
      // Calculate average sentiment
      const totalSentiment = promptResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0);
      const avgSentiment = totalResponses > 0 ? totalSentiment / totalResponses : 0;
      
      // Get the most common sentiment label
      const sentimentLabels = promptResponses
        .map(r => r.sentiment_label)
        .filter(Boolean);
      const sentimentLabel = getMostCommonValue(sentimentLabels) || 'neutral';
      
      // For visibility prompts, calculate average visibility
      let averageVisibility: number | undefined = undefined;
      if (prompt.prompt_type === 'visibility') {
        if (totalResponses > 0) {
          const mentionedCount = promptResponses.filter(r => r.company_mentioned).length;
          averageVisibility = (mentionedCount / totalResponses) * 100;
        } else {
          averageVisibility = 0;
        }
      }
      
      return {
        prompt: prompt.prompt_text,
        category: prompt.prompt_category,
        type: prompt.prompt_type,
        responses: totalResponses,
        avgSentiment,
        sentimentLabel,
        mentionRanking: promptResponses[0]?.mention_ranking,
        competitivePosition: promptResponses[0]?.competitive_position,
        competitorMentions: promptResponses[0]?.competitor_mentions,
        averageVisibility
      };
    });
  };

  const topCompetitors = useMemo(() => {
    if (!companyName) return [];
    const competitorCounts: Record<string, number> = {};
    responses.forEach(r => {
      if (r.detected_competitors) {
        r.detected_competitors.split(',')
          .map(name => name.trim())
          .filter(name => name && name.toLowerCase() !== companyName.toLowerCase())
          .forEach(name => {
            competitorCounts[name] = (competitorCounts[name] || 0) + 1;
          });
      }
    });
    return Object.entries(competitorCounts)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8); // top 8 competitors
  }, [responses, companyName]);

  return {
    responses,
    loading,
    companyName,
    metrics,
    sentimentTrend,
    topCitations,
    promptsData,
    refreshData,
    parseCitations,
    topCompetitors
  };
};
