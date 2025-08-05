import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData, Citation, CompetitorMention, LLMMentionRanking } from "@/types/dashboard";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";
import { getLLMDisplayName, getLLMLogo } from "@/config/llmLogos";
import { TalentXProService } from "@/services/talentXProService";
import { useSubscription } from "@/hooks/useSubscription";

export const useDashboardData = () => {
  const { user: rawUser } = useAuth();
  const { isPro } = useSubscription();
  // Memoize user to avoid unnecessary effect reruns
  const user = useMemo(() => rawUser, [rawUser?.id]);
  const [responses, setResponses] = useState<PromptResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [competitorLoading, setCompetitorLoading] = useState(true);
  const [companyName, setCompanyName] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
  const [talentXProData, setTalentXProData] = useState<any[]>([]);
  const [talentXProLoading, setTalentXProLoading] = useState(false);
  const [talentXProPrompts, setTalentXProPrompts] = useState<any[]>([]);
  const subscriptionRef = useRef<any>(null); // Track subscription instance
  const pollingRef = useRef<NodeJS.Timeout | null>(null); // Track polling interval

  const fetchResponses = useCallback(async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      setCompetitorLoading(true);
      
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id')
        .eq('user_id', user.id);

      if (promptsError) throw promptsError;

      if (!userPrompts || userPrompts.length === 0) {
        setResponses([]);
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }

      const promptIds = userPrompts.map(p => p.id);

      // Fetch all responses including TalentX responses
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
      
      // All responses are now in the main prompt_responses table
      let allResponses = data || [];
      
      // If user is Pro, fetch TalentX perception scores and convert them to PromptResponse format
      if (isPro) {
        try {
          // First fetch TalentX Pro prompts to get the actual prompt text
          const { data: talentXPrompts, error: promptsError } = await supabase
            .from('talentx_pro_prompts')
            .select('*')
            .eq('user_id', user.id);

          if (promptsError) {
            logger.error('Error fetching TalentX Pro prompts:', promptsError);
          } else {
            const { data: talentXScores, error: talentXError } = await supabase
              .from('talentx_perception_scores')
              .select('*')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false });

            if (talentXError) {
              logger.error('Error fetching TalentX perception scores:', talentXError);
            } else if (talentXScores && talentXScores.length > 0) {
              // Convert TalentX scores to PromptResponse format
              const talentXResponses: PromptResponse[] = talentXScores.map(score => {
                // Find the matching prompt text
                const matchingPrompt = talentXPrompts?.find(p => 
                  p.attribute_id === score.attribute_id && 
                  p.prompt_type === score.prompt_type
                );
                
                const promptText = matchingPrompt?.prompt_text || `TalentX ${score.prompt_type} analysis for ${score.attribute_id}`;
                
                return {
                  id: score.id,
                  confirmed_prompt_id: score.id, // Use the score ID as prompt ID
                  ai_model: score.ai_model,
                  response_text: score.response_text,
                  sentiment_score: score.sentiment_score,
                  sentiment_label: score.sentiment_score > 0.1 ? 'positive' : score.sentiment_score < -0.1 ? 'negative' : 'neutral',
                  citations: score.citations,
                  tested_at: score.created_at,
                  company_mentioned: true, // TalentX responses are always about the company
                  mention_ranking: 1, // Default to 1 since it's about the company
                  competitor_mentions: score.competitor_mentions,
                  detected_competitors: score.detected_competitors,
                  confirmed_prompts: {
                    prompt_text: promptText,
                    prompt_category: `TalentX: ${score.attribute_id.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                    prompt_type: score.prompt_type
                  }
                };
              });
              
              // Combine regular responses with TalentX responses
              allResponses = [...allResponses, ...talentXResponses];
            }
          }
        } catch (error) {
          logger.error('Error processing TalentX responses:', error);
        }
      }
      
      setResponses(allResponses);
      
      // Set lastUpdated to the most recent response collection time
      if (allResponses.length > 0) {
        const mostRecentResponse = allResponses[0]; // Already sorted by tested_at desc
        setLastUpdated(new Date(mostRecentResponse.tested_at));
      } else {
        setLastUpdated(undefined);
      }
      
      setLoading(false);
      setCompetitorLoading(false);
          } catch (error) {
        logger.error('Error fetching responses:', error);
        setLoading(false);
        setCompetitorLoading(false);
      }
  }, [user]);

  const fetchCompanyName = useCallback(async () => {
    if (!user) return;
    
    try {
      // Get the most recent onboarding record
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        logger.error('Error fetching company name:', error);
        setCompanyName('');
        return;
      }

      // If we have data, use the company name
      if (data && data.length > 0) {
        setCompanyName(data[0].company_name);
      } else {
        setCompanyName('');
      }
    } catch (error) {
      logger.error('Error in fetchCompanyName:', error);
      setCompanyName('');
    }
  }, [user]);

  const fetchTalentXProData = useCallback(async () => {
    if (!user || !isPro) {
      setTalentXProData([]);
      setTalentXProLoading(false);
      return;
    }

    try {
      setTalentXProLoading(true);
      const data = await TalentXProService.getAggregatedProAnalysis(user.id);
      setTalentXProData(data);
    } catch (error) {
      logger.error('Error fetching TalentX Pro data:', error);
      setTalentXProData([]);
    } finally {
      setTalentXProLoading(false);
    }
  }, [user, isPro]);

  // Real-time subscription effect (only once per user session)
  useEffect(() => {
    if (!user) return;
    if (subscriptionRef.current) {
      // Clean up any existing subscription before creating a new one
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
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
          fetchResponses();
        }
      )
      .subscribe();
    subscriptionRef.current = subscription;
    return () => {
      if (subscriptionRef.current) {
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
      }
      return;
    }
    if (pollingRef.current) return; // Already polling
    pollingRef.current = setInterval(() => {
      fetchResponses();
    }, 2000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [user, loading, fetchResponses]);

  // Initial data fetch
  useEffect(() => {
    if (user) {
      fetchResponses();
      fetchCompanyName();
      if (isPro) {
        fetchTalentXProData();
      }
    }
  }, [user, fetchResponses, fetchCompanyName, fetchTalentXProData, isPro]);

  const refreshData = useCallback(async () => {
    await fetchResponses();
    if (isPro) {
      await fetchTalentXProData();
    }
  }, [fetchResponses, fetchTalentXProData, isPro]);

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

  // Fetch TalentX Pro prompts if user is Pro
  useEffect(() => {
    const fetchTalentXProPrompts = async () => {
      if (!isPro || !user) {
        setTalentXProPrompts([]);
        return;
      }

      try {
        const { data: talentXPrompts, error } = await supabase
          .from('talentx_pro_prompts')
          .select('*')
          .eq('user_id', user.id);

        if (error) {
          console.error('Error fetching TalentX Pro prompts:', error);
          setTalentXProPrompts([]);
          return;
        }

        if (talentXPrompts && talentXPrompts.length > 0) {
          const talentXPromptData = talentXPrompts.map(prompt => {
            // Find matching TalentX responses to get visibility scores
            const matchingResponses = responses.filter(r => 
              r.confirmed_prompts?.prompt_type === `talentx_${prompt.prompt_type}` &&
              r.talentx_analysis?.some((analysis: any) => analysis.attributeId === prompt.attribute_id)
            );
            
            // Extract visibility scores from responses
            const visibilityScores = matchingResponses
              .map(r => r.visibility_score)
              .filter((score): score is number => typeof score === 'number');
            
            // Calculate average sentiment from responses
            const avgSentiment = matchingResponses.length > 0 
              ? matchingResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / matchingResponses.length 
              : 0;
            
            // Determine sentiment label
            let sentimentLabel = 'neutral';
            if (avgSentiment > 0.1) sentimentLabel = 'positive';
            else if (avgSentiment < -0.1) sentimentLabel = 'negative';
            
            return {
              prompt: prompt.prompt_text,
              category: `TalentX: ${prompt.attribute_id.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
              type: `talentx_${prompt.prompt_type}` as any,
              responses: prompt.is_generated ? 1 : 0, // Mark as having responses if generated
              avgSentiment: avgSentiment,
              sentimentLabel: sentimentLabel,
              mentionRanking: undefined,
              competitivePosition: undefined,
              competitorMentions: undefined,
              averageVisibility: visibilityScores.length > 0 ? visibilityScores.reduce((sum, score) => sum + score, 0) / visibilityScores.length : undefined,
              visibilityScores: visibilityScores,
              isTalentXPrompt: true,
              talentXAttributeId: prompt.attribute_id,
              talentXPromptType: prompt.prompt_type
            };
          });

          setTalentXProPrompts(talentXPromptData);
        } else {
          setTalentXProPrompts([]);
        }
      } catch (error) {
        console.error('Error processing TalentX Pro prompts:', error);
        setTalentXProPrompts([]);
      }
    };

    fetchTalentXProPrompts();
  }, [isPro, user]);

  const promptsData: PromptData[] = useMemo(() => {
    // Start with prompts derived from responses
    const responseBasedPrompts = responses.reduce((acc: PromptData[], response) => {
      // Use the actual prompt text from confirmed_prompts
      const promptKey = response.confirmed_prompts?.prompt_text;
      const isTalentXResponse = response.confirmed_prompts?.prompt_type?.startsWith('talentx_');
      
      const existing = acc.find(item => item.prompt === promptKey);
      
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
        if (response.confirmed_prompts?.prompt_type === 'visibility' || response.confirmed_prompts?.prompt_type === 'talentx_visibility') {
          if (typeof existing.averageVisibility === 'number') {
            existing.averageVisibility = (existing.averageVisibility * (existing.responses - 1) + (response.company_mentioned ? 100 : 0)) / existing.responses;
          } else {
            existing.averageVisibility = response.company_mentioned ? 100 : 0;
          }
        }
        // Update competitive metrics
        if (response.confirmed_prompts?.prompt_type === 'competitive' || response.confirmed_prompts?.prompt_type === 'talentx_competitive') {
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
        const talentXAnalysis = response.talentx_analysis?.[0];
        acc.push({
          prompt: promptKey || '',
          category: response.confirmed_prompts?.prompt_category || '',
          type: response.confirmed_prompts?.prompt_type || 'sentiment',
          responses: 1,
          avgSentiment: response.sentiment_score || 0,
          sentimentLabel: response.sentiment_label || 'neutral',
          mentionRanking: response.mention_ranking || undefined,
          competitivePosition: response.mention_ranking || undefined,
          competitorMentions: response.competitor_mentions as string[] || undefined,
          averageVisibility: (response.confirmed_prompts?.prompt_type === 'visibility' || response.confirmed_prompts?.prompt_type === 'talentx_visibility') ? (response.company_mentioned ? 100 : 0) : undefined,
          visibilityScores: visibilityScore !== undefined ? [visibilityScore] : [],
          // Add TalentX-specific fields if it's a TalentX response
          isTalentXPrompt: isTalentXResponse,
          talentXAttributeId: talentXAnalysis?.attributeId,
          talentXPromptType: response.confirmed_prompts?.prompt_type?.replace('talentx_', '')
        });
      }
      
      return acc;
    }, []);

    // Combine with TalentX Pro prompts (including those without responses yet)
    const allPrompts = [...responseBasedPrompts, ...talentXProPrompts];
    
    // Remove duplicates - if a TalentX prompt has both a response and is in talentXProPrompts,
    // prioritize the one with response data
    const uniquePrompts = allPrompts.reduce((acc: PromptData[], prompt) => {
      const existing = acc.find(p => p.prompt === prompt.prompt);
      if (!existing) {
        acc.push(prompt);
      } else if (prompt.responses > 0 && existing.responses === 0) {
        // Replace the prompt without responses with the one that has responses
        const index = acc.findIndex(p => p.prompt === prompt.prompt);
        acc[index] = prompt;
      }
      return acc;
    }, []);
    
    return uniquePrompts;
  }, [responses, talentXProPrompts]);

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

  const prepareTalentXPromptData = (responses: any[]): PromptData[] => {
    // Group TalentX responses by attribute and prompt type
    const talentXGroups: Record<string, any[]> = {};
    
    responses.forEach(response => {
      if (response.confirmed_prompts?.prompt_type?.startsWith('talentx_')) {
        const key = `${response.confirmed_prompts.prompt_text}`;
        if (!talentXGroups[key]) {
          talentXGroups[key] = [];
        }
        talentXGroups[key].push(response);
      }
    });

    return Object.entries(talentXGroups).map(([promptText, promptResponses]) => {
      const totalResponses = promptResponses.length;
      
      // Calculate average sentiment
      const totalSentiment = promptResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0);
      const avgSentiment = totalResponses > 0 ? totalSentiment / totalResponses : 0;
      
      // Get the most common sentiment label
      const sentimentLabels = promptResponses
        .map(r => r.sentiment_label)
        .filter(Boolean);
      const sentimentLabel = getMostCommonValue(sentimentLabels) || 'neutral';
      
      // Get TalentX-specific data
      const firstResponse = promptResponses[0];
      const talentXAnalysis = firstResponse.talentx_analysis?.[0];
      
      return {
        prompt: promptText,
        category: firstResponse.confirmed_prompts.prompt_category,
        type: firstResponse.confirmed_prompts.prompt_type,
        responses: totalResponses,
        avgSentiment,
        sentimentLabel,
        mentionRanking: firstResponse.mention_ranking,
        competitivePosition: firstResponse.competitive_position,
        competitorMentions: firstResponse.competitor_mentions,
        averageVisibility: firstResponse.visibility_score,
        isTalentXPrompt: true,
        talentXAttributeId: talentXAnalysis?.attributeId,
        talentXPromptType: firstResponse.confirmed_prompts.prompt_type.replace('talentx_', '')
      };
    });
  };

  const topCompetitors = useMemo(() => {
    if (!companyName || !responses.length || loading) {
      return [];
    }
    
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

    return result;
  }, [responses, companyName, loading]);

  const llmMentionRankings = useMemo(() => {
    if (!responses.length) return [];

    // Group responses by AI model and count mentions
    const modelMentions: Record<string, number> = {};
    
    responses.forEach(response => {
      const model = response.ai_model;
      if (response.company_mentioned) {
        modelMentions[model] = (modelMentions[model] || 0) + 1;
      }
    });

    // Convert to array and sort by mentions descending
    const rankings: LLMMentionRanking[] = Object.entries(modelMentions)
      .map(([model, mentions]) => ({
        model,
        displayName: getLLMDisplayName(model),
        mentions,
        logoUrl: getLLMLogo(model)
      }))
      .sort((a, b) => b.mentions - a.mentions);

    return rankings;
  }, [responses]);

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
    topCompetitors,
    lastUpdated,
    llmMentionRankings,
    talentXProData,
    talentXProLoading,
    fetchTalentXProData
  };
};
