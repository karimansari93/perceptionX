import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData, Citation, CompetitorMention } from "@/types/dashboard";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";

export const useDashboardData = () => {
  const { user: rawUser } = useAuth();
  // Memoize user to avoid unnecessary effect reruns
  const user = useMemo(() => rawUser, [rawUser?.id]);
  const [responses, setResponses] = useState<PromptResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [competitorLoading, setCompetitorLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string>("");
  const subscriptionRef = useRef<any>(null); // Track subscription instance
  const pollingRef = useRef<NodeJS.Timeout | null>(null); // Track polling interval

  const fetchResponses = useCallback(async () => {
    if (!user) return;
    
    try {
      if (import.meta.env.MODE === 'development') {
        console.log('Fetching responses...');
      }
      setLoading(true);
      setCompetitorLoading(true);
      
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id')
        .eq('user_id', user.id);

      if (promptsError) throw promptsError;

      if (!userPrompts || userPrompts.length === 0) {
        if (import.meta.env.MODE === 'development') {
          console.log('No prompts found');
        }
        setResponses([]);
        setLoading(false);
        setCompetitorLoading(false);
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
      
      if (import.meta.env.MODE === 'development') {
        console.log('Fetched responses:', data?.length || 0);
      }
      
      // Keep all responses for time-based analysis
      const allResponses = data || [];
      
      // Sort by tested_at in descending order
      allResponses.sort((a, b) => new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime());
      
      if (import.meta.env.MODE === 'development') {
        console.log('Setting responses:', allResponses.length);
      }
      setResponses(allResponses);
      setLoading(false);
      setCompetitorLoading(false);
    } catch (error) {
      if (import.meta.env.MODE === 'development') {
        console.error('Error fetching responses:', error);
      }
      setLoading(false);
      setCompetitorLoading(false);
    }
  }, [user]);

  const fetchCompanyName = useCallback(async () => {
    if (!user) return;
    
    try {
      // First try to get the most recent onboarding record
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        if (import.meta.env.MODE === 'development') {
          console.error('Error fetching company name:', error);
        }
        setCompanyName('');
        return;
      }

      // If we have data, use the company name
      if (data && data.length > 0) {
        setCompanyName(data[0].company_name);
      } else {
        // If no data, try to get from profiles table as fallback
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('company_name')
          .eq('id', user.id)
          .single();

        if (profileError) {
          if (import.meta.env.MODE === 'development') {
            console.error('Error fetching profile company name:', profileError);
          }
          setCompanyName('');
        } else if (profileData?.company_name) {
          setCompanyName(profileData.company_name);
        } else {
          setCompanyName('');
        }
      }
    } catch (error) {
      if (import.meta.env.MODE === 'development') {
        console.error('Error in fetchCompanyName:', error);
      }
      setCompanyName('');
    }
  }, [user]);

  // Real-time subscription effect (only once per user session)
  useEffect(() => {
    if (!user) return;
    if (subscriptionRef.current) {
      // Clean up any existing subscription before creating a new one
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    if (import.meta.env.MODE === 'development') {
      console.log('Setting up real-time subscription...');
    }
    const subscription = supabase
      .channel('prompt_responses_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prompt_responses'
        },
        (payload) => {
          if (import.meta.env.MODE === 'development') {
            console.log('Real-time update received:', payload);
          }
          fetchResponses();
        }
      )
      .subscribe();
    subscriptionRef.current = subscription;
    return () => {
      if (subscriptionRef.current) {
        if (import.meta.env.MODE === 'development') {
          console.log('Cleaning up real-time subscription...');
        }
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [user, fetchResponses]);

  // Polling effect: only set up polling when loading is true and only one interval at a time
  useEffect(() => {
    if (!user || !loading) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        if (import.meta.env.MODE === 'development') {
          console.log('Cleaning up polling...');
        }
      }
      return;
    }
    if (pollingRef.current) return; // Already polling
    if (import.meta.env.MODE === 'development') {
      console.log('Setting up polling...');
    }
    pollingRef.current = setInterval(() => {
      if (import.meta.env.MODE === 'development') {
        console.log('Polling for updates...');
      }
      fetchResponses();
    }, 2000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        if (import.meta.env.MODE === 'development') {
          console.log('Cleaning up polling...');
        }
      }
    };
  }, [user, loading, fetchResponses]);

  // Initial data fetch
  useEffect(() => {
    if (user) {
      fetchResponses();
      fetchCompanyName();
    }
  }, [user, fetchResponses, fetchCompanyName]);

  const refreshData = useCallback(async () => {
    await fetchResponses();
  }, [fetchResponses]);

  const parseCitations = useCallback((citations: any): Citation[] => {
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
  }, []);

  const promptsData: PromptData[] = useMemo(() => {
    return responses.reduce((acc: PromptData[], response) => {
      const existing = acc.find(item => 
        item.prompt === response.confirmed_prompts?.prompt_text
      );
      
      // Extract visibility_score if present and numeric
      const visibilityScore = typeof response.visibility_score === 'number' ? response.visibility_score : undefined;
      
      if (existing) {
        existing.responses += 1;
        existing.avgSentiment = (existing.avgSentiment + (response.sentiment_score || 0)) / 2;
        // Add visibility score to array
        if (visibilityScore !== undefined) {
          existing.visibilityScores = existing.visibilityScores || [];
          existing.visibilityScores.push(visibilityScore);
        }
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
          averageVisibility: response.confirmed_prompts?.prompt_type === 'visibility' ? (response.company_mentioned ? 100 : 0) : undefined,
          visibilityScores: visibilityScore !== undefined ? [visibilityScore] : [],
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

    let sentimentTrendComparison: { value: number; direction: 'up' | 'down' | 'neutral' } = { value: 0, direction: 'neutral' };
    let visibilityTrendComparison: { value: number; direction: 'up' | 'down' | 'neutral' } = { value: 0, direction: 'neutral' };
    let citationsTrendComparison: { value: number; direction: 'up' | 'down' | 'neutral' } = { value: 0, direction: 'neutral' };
    
    if (responses.length > 1) {
      const sorted = [...responses].sort((a, b) => new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime());
      
      const latestDate = new Date(sorted[0].tested_at).toDateString();
      
      const currentResponses = sorted.filter(r => new Date(r.tested_at).toDateString() === latestDate);
      const previousResponses = sorted.filter(r => new Date(r.tested_at).toDateString() !== latestDate);

      if (previousResponses.length > 0) {
        const previousUniqueDays = new Set(previousResponses.map(r => new Date(r.tested_at).toDateString()));
        const numPreviousDays = Math.max(1, previousUniqueDays.size);

        // Calculate sentiment trend
        const currentSentimentAvg = currentResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / currentResponses.length;
        const previousSentimentTotal = previousResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0);
        const previousSentimentAvg = previousSentimentTotal / previousResponses.length;
        const sentimentChange = currentSentimentAvg - previousSentimentAvg;
        sentimentTrendComparison = {
          value: Math.abs(Math.round(sentimentChange * 100)),
          direction: sentimentChange > 0.01 ? 'up' : sentimentChange < -0.01 ? 'down' : 'neutral'
        };

        // Calculate visibility trend
        const currentVisibilityScores = currentResponses.map(r => r.visibility_score).filter((v): v is number => typeof v === 'number');
        const currentVisibilityAvg = currentVisibilityScores.length > 0 ? currentVisibilityScores.reduce((a, b) => a + b, 0) / currentVisibilityScores.length : 0;
        
        const previousVisibilityScores = previousResponses.map(r => r.visibility_score).filter((v): v is number => typeof v === 'number');
        const previousVisibilityAvg = previousVisibilityScores.length > 0 ? previousVisibilityScores.reduce((a, b) => a + b, 0) / previousVisibilityScores.length : 0;
        
        const visibilityChange = currentVisibilityAvg - previousVisibilityAvg;
        visibilityTrendComparison = {
          value: Math.abs(visibilityChange),
          direction: visibilityChange > 1 ? 'up' : visibilityChange < -1 ? 'down' : 'neutral'
        };

        // Calculate citations trend
        const currentCitationsTotal = currentResponses.reduce((sum, r) => sum + parseCitations(r.citations).length, 0);
        const previousCitationsTotal = previousResponses.reduce((sum, r) => sum + parseCitations(r.citations).length, 0);
        const previousCitationsAvg = previousCitationsTotal / numPreviousDays;
        const citationsChange = currentCitationsTotal - previousCitationsAvg;
        citationsTrendComparison = {
          value: Math.abs(Math.round(citationsChange)),
          direction: citationsChange > 0.1 ? 'up' : citationsChange < -0.1 ? 'down' : 'neutral'
        };
      }
    }

    const totalCitations = responses.reduce((sum, r) => sum + parseCitations(r.citations).length, 0);
    const uniqueDomains = new Set(
      responses.flatMap(r => parseCitations(r.citations).map((c: Citation) => c.domain).filter(Boolean))
    ).size;

    // Calculate average visibility as the average of all numeric visibility_score values from all responses
    const allVisibilityScores = responses
      .map(r => typeof r.visibility_score === 'number' ? r.visibility_score : undefined)
      .filter((v): v is number => typeof v === 'number');
    const averageVisibility = allVisibilityScores.length > 0
      ? allVisibilityScores.reduce((sum, v) => sum + v, 0) / allVisibilityScores.length
      : 0;

    // Calculate overall perception score
    const calculatePerceptionScore = () => {
      if (responses.length === 0) return { score: 0, label: 'No Data' };

      // Normalize sentiment to 0-100 scale (sentiment is typically -1 to 1)
      const normalizedSentiment = Math.max(0, Math.min(100, (averageSentiment + 1) * 50));
      
      // Visibility is already 0-100 scale
      const visibilityScore = averageVisibility;
      
      // Calculate competitive score based on competitor mentions and positioning
      const competitiveResponses = responses.filter(r => r.detected_competitors);
      const totalCompetitorMentions = competitiveResponses.reduce((sum, r) => {
        const competitors = r.detected_competitors?.split(',').filter(Boolean) || [];
        return sum + competitors.length;
      }, 0);
      
      // Calculate average mention ranking (lower is better)
      const mentionRankings = responses
        .map(r => r.mention_ranking)
        .filter((r): r is number => typeof r === 'number');
      const avgMentionRanking = mentionRankings.length > 0 
        ? mentionRankings.reduce((sum, rank) => sum + rank, 0) / mentionRankings.length 
        : 0;
      
      // Competitive score: higher when mentioned more and ranked better
      const competitiveScore = Math.min(100, Math.max(0, 
        (totalCompetitorMentions * 10) + // Bonus for being mentioned alongside competitors
        (avgMentionRanking > 0 ? Math.max(0, 100 - (avgMentionRanking * 10)) : 50) // Better ranking = higher score
      ));

      // Weighted formula: 40% sentiment + 35% visibility + 25% competitive
      const perceptionScore = Math.round(
        (normalizedSentiment * 0.4) + 
        (visibilityScore * 0.35) + 
        (competitiveScore * 0.25)
      );

      // Determine label based on score
      let perceptionLabel = 'Poor';
      if (perceptionScore >= 80) perceptionLabel = 'Excellent';
      else if (perceptionScore >= 65) perceptionLabel = 'Good';
      else if (perceptionScore >= 50) perceptionLabel = 'Fair';
      else if (perceptionScore >= 30) perceptionLabel = 'Poor';

      return { score: perceptionScore, label: perceptionLabel };
    };

    const { score: perceptionScore, label: perceptionLabel } = calculatePerceptionScore();

    return {
      averageSentiment,
      sentimentLabel,
      sentimentTrendComparison,
      visibilityTrendComparison,
      citationsTrendComparison,
      totalCitations,
      uniqueDomains,
      totalResponses: responses.length,
      averageVisibility,
      positiveCount,
      neutralCount,
      negativeCount,
      perceptionScore,
      perceptionLabel
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

      // Debug: Log company_mentioned values for this prompt
      // (Can be removed if not needed)
      // console.log('Prompt:', prompt.prompt_text, 'Prompt ID:', prompt.id);
      // console.log('company_mentioned values:', promptResponses.map(r => r.company_mentioned));
      
      // Calculate average sentiment
      const totalSentiment = promptResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0);
      const avgSentiment = totalResponses > 0 ? totalSentiment / totalResponses : 0;
      
      // Get the most common sentiment label
      const sentimentLabels = promptResponses
        .map(r => r.sentiment_label)
        .filter(Boolean);
      const sentimentLabel = getMostCommonValue(sentimentLabels) || 'neutral';
      
      // Calculate average visibility as the average of visibility_score for all responses
      const visibilityScores = promptResponses
        .map(r => typeof r.visibility_score === 'number' ? r.visibility_score : undefined)
        .filter((v): v is number => typeof v === 'number');
      let averageVisibility: number | undefined = undefined;
      if (visibilityScores.length > 0) {
        averageVisibility = visibilityScores.reduce((sum, v) => sum + v, 0) / visibilityScores.length;
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
    if (!companyName || !responses.length) {
      console.log('No company name or responses for competitors');
      return [];
    }
    
    console.log('Processing competitors from responses:', responses.length);
    const competitorCounts: Record<string, number> = {};
    
    responses.forEach(response => {
      if (response.detected_competitors) {
        const competitors = response.detected_competitors
          .split(',')
          .map(name => name.trim())
          .filter(name => 
            name && 
            name.toLowerCase() !== companyName.toLowerCase() &&
            name.length > 1
          );
        
        competitors.forEach(name => {
          competitorCounts[name] = (competitorCounts[name] || 0) + 1;
        });
      }
    });

    const result = Object.entries(competitorCounts)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    console.log('Processed competitors:', result);
    return result;
  }, [responses, companyName]);

  // Add debug logging for data updates
  useEffect(() => {
    if (responses.length > 0) {
      console.log('Responses updated:', responses.length);
      console.log('Top competitors:', topCompetitors);
      console.log('Loading states:', { loading, competitorLoading });
    }
  }, [responses, topCompetitors, loading, competitorLoading]);

  return {
    responses,
    loading,
    competitorLoading,
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
