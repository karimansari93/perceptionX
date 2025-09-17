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
  const [loading, setLoading] = useState(false);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [hasDataIssues, setHasDataIssues] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
  const [talentXProData, setTalentXProData] = useState<any[]>([]);
  const [talentXProLoading, setTalentXProLoading] = useState(false);
  const [talentXProPrompts, setTalentXProPrompts] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchResultsLoading, setSearchResultsLoading] = useState(false);
  const [searchTermsData, setSearchTermsData] = useState<any[]>([]);
  const subscriptionRef = useRef<any>(null); // Track subscription instance
  const pollingRef = useRef<NodeJS.Timeout | null>(null); // Track polling interval

  const fetchResponses = useCallback(async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      setCompetitorLoading(true);
      
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id, user_id, prompt_text')
        .eq('user_id', user.id);

      if (promptsError) {
        throw promptsError;
      }

      if (!userPrompts || userPrompts.length === 0) {
        // Let's check if there are any prompts without user_id
        const { data: allPrompts, error: allPromptsError } = await supabase
          .from('confirmed_prompts')
          .select('id, user_id, prompt_text, onboarding_id')
          .is('user_id', null);

        if (allPromptsError) {
          // Silently handle error
        } else {
          // If we found prompts without user_id, set data issues flag
          if (allPrompts && allPrompts.length > 0) {
            setHasDataIssues(true);
            await fixExistingPrompts();
            return; // Exit early, fixExistingPrompts will call fetchResponses again
          }
        }

        setResponses([]);
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }

      // Clear data issues flag if we found prompts
      setHasDataIssues(false);

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
            // Fetch TalentX responses from prompt_responses table joined with confirmed_prompts
            const { data: talentXResponses, error: talentXError } = await supabase
              .from('prompt_responses')
              .select(`
                *,
                confirmed_prompts!inner(
                  user_id,
                  prompt_type,
                  prompt_text,
                  talentx_attribute_id
                )
              `)
              .eq('confirmed_prompts.user_id', user.id)
              .like('confirmed_prompts.prompt_type', 'talentx_%')
              .not('talentx_analysis', 'eq', '{}')
              .order('created_at', { ascending: false });

            if (talentXError) {
              // Silently handle error
            } else if (talentXResponses && talentXResponses.length > 0) {
              // Convert TalentX responses to PromptResponse format
              const talentXResponsesFormatted: PromptResponse[] = talentXResponses.map(response => {
                const promptType = response.confirmed_prompts.prompt_type;
                const attributeId = response.confirmed_prompts.talentx_attribute_id || 
                                   promptType.replace('talentx_', '');
                
                // Get prompt text from the confirmed_prompts join
                const promptText = response.confirmed_prompts?.prompt_text || `TalentX ${promptType.replace('talentx_', '')} analysis for ${attributeId}`;
                
                return {
                  id: response.id,
                  confirmed_prompt_id: response.confirmed_prompt_id,
                  ai_model: response.ai_model,
                  response_text: response.response_text,
                  sentiment_score: response.sentiment_score,
                  sentiment_label: response.sentiment_score > 0.1 ? 'positive' : response.sentiment_score < -0.1 ? 'negative' : 'neutral',
                  citations: response.citations,
                  tested_at: response.created_at,
                  company_mentioned: true, // TalentX responses are always about the company
                  mention_ranking: 1, // Default to 1 since it's about the company
                  competitor_mentions: response.detected_competitors,

                  confirmed_prompts: {
                    prompt_text: promptText,
                    prompt_category: `TalentX: ${attributeId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                    prompt_type: promptType.replace('talentx_', '')
                  }
                };
              });
              
              // Combine regular responses with TalentX responses
              allResponses = [...allResponses, ...talentXResponsesFormatted];
            }
        } catch (error) {
          // Silently handle error
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
        // Silently handle error
        setLoading(false);
        setCompetitorLoading(false);
      }
  }, [user]);

  const fetchCompanyName = useCallback(async () => {
    if (!user) return;
    
    console.log('🔍 fetchCompanyName called for user:', user.id);
    
    try {
      // Get the most recent onboarding record
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.log('❌ Error fetching company name:', error);
        setCompanyName('');
        return;
      }

      // If we have data, use the company name
      if (data && data.length > 0) {
        console.log('✅ Company name fetched:', data[0].company_name);
        setCompanyName(data[0].company_name);
      } else {
        console.log('⚠️ No company name data found');
        setCompanyName('');
      }
    } catch (error) {
      console.log('❌ Exception fetching company name:', error);
      // Silently handle error
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
      // Silently handle error
      setTalentXProData([]);
    } finally {
      setTalentXProLoading(false);
    }
  }, [user, isPro]);

  const fetchSearchResults = useCallback(async () => {
    if (!user || !companyName) {
      setSearchResults([]);
      setSearchResultsLoading(false);
      return;
    }

    try {
      setSearchResultsLoading(true);
      
      // Get the most recent search session for this company
      const { data: sessionData, error: sessionError } = await supabase
        .from('search_insights_sessions')
        .select(`
          id,
          company_name,
          initial_search_term,
          total_results,
          total_related_terms,
          total_volume,
          keywords_everywhere_available,
          created_at
        `)
        .eq('company_name', companyName)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (sessionError && sessionError.code !== 'PGRST116') { // PGRST116 = no rows found
        console.error('Error fetching search session:', sessionError);
        setSearchResults([]);
        return;
      }

      if (!sessionData) {
        setSearchResults([]);
        return;
      }

      // Get search results for this session
      const { data: resultsData, error: resultsError } = await supabase
        .from('search_insights_results')
        .select('*')
        .eq('session_id', sessionData.id)
        .order('position', { ascending: true });

      if (resultsError) {
        console.error('Error fetching search results:', resultsError);
        setSearchResults([]);
        return;
      }

      // Process and deduplicate the data by URL
      const urlMap = new Map<string, { result: any; count: number; searchTerms: Set<string> }>();
      
      // Group results by URL and count mentions
      (resultsData || []).forEach(result => {
        const url = result.link;
        if (urlMap.has(url)) {
          const existing = urlMap.get(url)!;
          existing.count += 1;
          existing.searchTerms.add(result.search_term);
          // Keep the result with the best position (lowest number)
          if (result.position < existing.result.position) {
            existing.result = result;
          }
        } else {
          urlMap.set(url, {
            result: result,
            count: 1,
            searchTerms: new Set([result.search_term])
          });
        }
      });
      
      // Convert to array and sort by mention count (descending), then by position (ascending)
      const processedResults = Array.from(urlMap.values())
        .map(item => ({
          id: item.result.id,
          title: item.result.title,
          link: item.result.link,
          snippet: item.result.snippet,
          position: item.result.position,
          domain: item.result.domain,
          monthlySearchVolume: item.result.monthly_search_volume,
          mediaType: item.result.media_type,
          companyMentioned: item.result.company_mentioned,
          detectedCompetitors: item.result.detected_competitors || '',
          date: item.result.date_found,
          searchTerm: item.result.search_term,
          mentionCount: item.count,
          searchTermsCount: item.searchTerms.size,
          allSearchTerms: Array.from(item.searchTerms).join(', ')
        }))
        .sort((a, b) => {
          // First sort by mention count (descending)
          if (b.mentionCount !== a.mentionCount) {
            return b.mentionCount - a.mentionCount;
          }
          // Then by position (ascending)
          return a.position - b.position;
        });

      setSearchResults(processedResults);
      console.log('🔍 Search results loaded:', processedResults.length, 'results');

      // Process search terms data for ranking
      if (processedResults.length > 0) {
        const termMap = new Map<string, { volume: number; count: number }>();
        
        processedResults.forEach((result: any) => {
          const term = result.searchTerm || 'combined';
          const volume = result.monthlySearchVolume || 0;
          
          if (termMap.has(term)) {
            const existing = termMap.get(term)!;
            termMap.set(term, {
              volume: Math.max(existing.volume, volume),
              count: existing.count + 1
            });
          } else {
            termMap.set(term, { volume, count: 1 });
          }
        });
        
        const termsData = Array.from(termMap.entries())
          .map(([term, data]) => ({
            term,
            monthlyVolume: data.volume,
            resultsCount: data.count
          }))
          .sort((a, b) => b.monthlyVolume - a.monthlyVolume);
        
        console.log('🔍 Search terms processed:', termsData.length, 'terms');
        setSearchTermsData(termsData);
      }
    } catch (error) {
      console.error('Error loading search results:', error);
      setSearchResults([]);
    } finally {
      setSearchResultsLoading(false);
    }
  }, [user, companyName]);

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

  // Fetch search results when company name is available
  useEffect(() => {
    if (user && isPro && companyName) {
      fetchSearchResults();
    }
  }, [user, isPro, companyName, fetchSearchResults]);

  const refreshData = useCallback(async () => {
    await fetchResponses();
    if (isPro) {
      await fetchTalentXProData();
      await fetchSearchResults();
    }
  }, [fetchResponses, fetchTalentXProData, fetchSearchResults, isPro]);

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
          .from('confirmed_prompts')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_pro_prompt', true);

        if (error) {
          // Silently handle error
          setTalentXProPrompts([]);
          return;
        }

        if (talentXPrompts && talentXPrompts.length > 0) {
          const talentXPromptData = talentXPrompts.map(prompt => {
            // Find matching TalentX responses to get visibility scores
            const matchingResponses = responses.filter(r => 
              r.confirmed_prompts?.prompt_type === prompt.prompt_type &&
              r.talentx_analysis?.some((analysis: any) => analysis.attributeId === prompt.talentx_attribute_id)
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
              category: `TalentX: ${prompt.talentx_attribute_id.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
              type: prompt.prompt_type as any,
              responses: matchingResponses.length > 0 ? 1 : 0, // Mark as having responses if any exist
              avgSentiment: avgSentiment,
              sentimentLabel: sentimentLabel,
              mentionRanking: undefined,
              competitivePosition: undefined,
              competitorMentions: undefined,
              averageVisibility: visibilityScores.length > 0 ? visibilityScores.reduce((sum, score) => sum + score, 0) / visibilityScores.length : undefined,
              visibilityScores: visibilityScores,
              isTalentXPrompt: true,
              talentXAttributeId: prompt.talentx_attribute_id,
              talentXPromptType: prompt.prompt_type.replace('talentx_', '') // Remove prefix for display
            };
          });

          setTalentXProPrompts(talentXPromptData);
        } else {
          setTalentXProPrompts([]);
        }
      } catch (error) {
        // Silently handle error
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
    const competitiveResponses = responses.filter(r => r.competitor_mentions);
    const totalCompetitorMentions = competitiveResponses.reduce((sum, r) => {
      const mentions = Array.isArray(r.competitor_mentions) 
        ? r.competitor_mentions 
        : JSON.parse(r.competitor_mentions as string || '[]');
      return sum + mentions.length;
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
    // Use enhanceCitations to get EnhancedCitation objects from responses
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

    // Add search result domains to citation counts
    searchResults.forEach(result => {
      const domain = result.domain;
      if (domain) {
        // Count each search result as a citation (mentionCount represents how many search terms found this domain)
        const searchCount = result.mentionCount || 1;
        citationCounts[domain] = (citationCounts[domain] || 0) + searchCount;
      }
    });

    const finalCitations = Object.entries(citationCounts)
      .map(([domain, count]) => ({ domain, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    console.log('🔍 Top citations calculated:', finalCitations.length, 'domains, search results:', searchResults.length);
    return finalCitations;
  }, [responses, searchResults]);

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
    if (!companyName || (!responses.length && !searchResults.length) || loading) {
      return [];
    }
    
    const competitorCounts: Record<string, number> = {};
    
    // Excluded competitors and words
    const excludedCompetitors = new Set([
      'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
      'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
    ]);
    
    const excludedWords = new Set([
      'none', 'n/a', 'na', 'null', 'undefined', 'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;',
      'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
      'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
      'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)', 'undefined]', 'undefined}', 'undefined-', 'undefined_',
      'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;', 'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_',
      'none', 'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'na', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_'
    ]);
    
    // Additional patterns to exclude
    const excludedPatterns = [
      /^none$/i,
      /^n\/a$/i,
      /^na$/i,
      /^null$/i,
      /^undefined$/i,
      /^none\.?$/i,
      /^n\/a\.?$/i,
      /^na\.?$/i,
      /^null\.?$/i,
      /^undefined\.?$/i,
      /^none[,:;\)\]\}\-_]$/i,
      /^n\/a[,:;\)\]\}\-_]$/i,
      /^na[,:;\)\]\}\-_]$/i,
      /^null[,:;\)\]\}\-_]$/i,
      /^undefined[,:;\)\]\}\-_]$/i,
      /^[0-9]+$/i, // Pure numbers
      /^[^a-zA-Z0-9]+$/i, // Only special characters
      /^[a-z]{1,2}$/i, // Single or double letter words (likely abbreviations that aren't company names)
    ];
    
    // Process competitors from AI responses
    responses.forEach(response => {
      if (response.competitor_mentions) {
        const mentions = Array.isArray(response.competitor_mentions) 
          ? response.competitor_mentions 
          : JSON.parse(response.competitor_mentions as string || '[]');
        
        mentions.forEach((mention: any) => {
          if (mention.name) {
            const name = mention.name.trim();
            if (name && 
                name.toLowerCase() !== companyName.toLowerCase() &&
                name.length > 1 &&
                !excludedCompetitors.has(name.toLowerCase()) &&
                !excludedWords.has(name.toLowerCase()) &&
                !excludedPatterns.some(pattern => pattern.test(name))) {
              competitorCounts[name] = (competitorCounts[name] || 0) + 1;
            }
          }
        });
      }
    });

    // Process competitors from search results
    searchResults.forEach(result => {
      if (result.detectedCompetitors && result.detectedCompetitors.trim()) {
        const competitors = result.detectedCompetitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0);
        
        competitors.forEach(competitor => {
          const name = competitor.trim();
          if (name && 
              name.toLowerCase() !== companyName.toLowerCase() &&
              name.length > 1 &&
              !excludedCompetitors.has(name.toLowerCase()) &&
              !excludedWords.has(name.toLowerCase()) &&
              !excludedPatterns.some(pattern => pattern.test(name))) {
            // Weight search result competitors by mention count (how many search terms found this domain)
            const weight = result.mentionCount || 1;
            competitorCounts[name] = (competitorCounts[name] || 0) + weight;
          }
        });
      }
    });

    const result = Object.entries(competitorCounts)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    console.log('🔍 Top competitors calculated:', result.length, 'competitors, search results:', searchResults.length);
    return result;
  }, [responses, searchResults, companyName, loading]);

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

  const fixExistingPrompts = useCallback(async () => {
    if (!user) return;
    
    try {
      // Find prompts without user_id that belong to this user's onboarding
      const { data: userOnboarding, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (onboardingError) {
        // Silently handle error
        return;
      }

      if (userOnboarding && userOnboarding.length > 0) {
        const onboardingId = userOnboarding[0].id;
        
        // Update prompts without user_id to have the current user's ID
        const { data: updateResult, error: updateError } = await supabase
          .from('confirmed_prompts')
          .update({ user_id: user.id })
          .eq('onboarding_id', onboardingId)
          .is('user_id', null);

        if (updateError) {
          // Silently handle error
        } else {
          // Refresh the data after fixing
          fetchResponses();
        }
      }
    } catch (error) {
      // Silently handle error
    }
  }, [user, fetchResponses]);

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
    fetchTalentXProData,
    fixExistingPrompts,
    hasDataIssues,
    searchResults,
    searchResultsLoading,
    searchTermsData,
    fetchSearchResults
  };
};
