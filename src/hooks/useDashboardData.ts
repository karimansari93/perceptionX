import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData, Citation, CompetitorMention, LLMMentionRanking } from "@/types/dashboard";
import { enhanceCitations, EnhancedCitation } from "@/utils/citationUtils";
import { getLLMDisplayName, getLLMLogo } from "@/config/llmLogos";
import { TalentXProService } from "@/services/talentXProService";
import { useSubscription } from "@/hooks/useSubscription";
import { retrySupabaseQuery, retrySupabaseFunction, queryDebouncer, networkMonitor } from "@/utils/supabaseRetry";
import { parseCompetitors } from "@/utils/competitorUtils";

export const useDashboardData = () => {
  const { user: rawUser, clearSession } = useAuth();
  const { currentCompany, loading: companyLoading } = useCompany();
  const { isPro } = useSubscription();
  
  // Memoize user to avoid unnecessary effect reruns
  const user = useMemo(() => rawUser, [rawUser?.id]);
  const [responses, setResponses] = useState<PromptResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [hasDataIssues, setHasDataIssues] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
  const [talentXProData, setTalentXProData] = useState<any[]>([]);
  const [talentXProLoading, setTalentXProLoading] = useState(false);
  const [talentXProPrompts, setTalentXProPrompts] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchResultsLoading, setSearchResultsLoading] = useState(false);
  const [searchTermsData, setSearchTermsData] = useState<any[]>([]);
  const [recencyData, setRecencyData] = useState<any[]>([]);
  const [recencyDataLoading, setRecencyDataLoading] = useState(false);
  const [aiThemes, setAiThemes] = useState<any[]>([]);
  const [aiThemesLoading, setAiThemesLoading] = useState(false);
  const [activePrompts, setActivePrompts] = useState<any[]>([]);
  const [isOnline, setIsOnline] = useState(networkMonitor.online);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [recencyDataError, setRecencyDataError] = useState<string | null>(null);
  const subscriptionRef = useRef<any>(null); // Track subscription instance
  const pollingRef = useRef<NodeJS.Timeout | null>(null);   // Track polling interval

  // Network status monitoring - FIXED
  useEffect(() => {
    const removeListener = networkMonitor.addListener((online) => {
      setIsOnline(online);
      if (online) {
        setConnectionError(null);
        // Only trigger refetch if we have user and company
        if (user?.id && currentCompany?.id) {
          setShouldRefetch(true); // Force refetch
        }
      } else {
        setConnectionError('No internet connection. Please check your network.');
      }
    });

    return removeListener;
  }, [user?.id, currentCompany?.id]); // Only IDs

  const fetchResponses = useCallback(async () => {
    if (!user || !currentCompany) {
      return;
    }
    
    // Check network status first
    if (!isOnline) {
      setConnectionError('No internet connection. Please check your network.');
      return;
    }
    
    
    try {
      setLoading(true);
      setCompetitorLoading(true);
      setConnectionError(null);
      
      const { data: userPrompts, error: promptsError } = await retrySupabaseQuery(() =>
        supabase
          .from('confirmed_prompts')
          .select('id, user_id, prompt_text, company_id, prompt_category, prompt_theme, prompt_type, industry_context, job_function_context, location_context, is_pro_prompt, talentx_attribute_id')
          .eq('company_id', currentCompany.id)
      ) as { data: any[] | null; error: any };

      if (promptsError) {
        console.error('🔍 Error fetching prompts:', promptsError);
        // Provide more user-friendly error message
        if (promptsError.message?.includes('permission') || promptsError.message?.includes('policy')) {
          throw new Error('You don\'t have permission to view prompts for this company. Please contact support if you believe this is an error.');
        }
        throw new Error('Unable to load prompts. Please refresh the page or try again later.');
      }

      if (!userPrompts || userPrompts.length === 0) {
        setActivePrompts([]);
        // No prompts found for this company - this is expected for new companies
        setResponses([]);
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }

      setActivePrompts(userPrompts);


      // Clear data issues flag if we found prompts
      setHasDataIssues(false);

      const promptIds = userPrompts.map(p => p.id);

      // Fetch all responses for this company
      // With historical tracking enabled, we get ALL responses (multiple per prompt+model)
      const { data, error } = await retrySupabaseQuery(() =>
        supabase
          .from('prompt_responses')
          .select(`
            *,
            confirmed_prompts (
              prompt_text,
              prompt_category,
              prompt_theme,
              prompt_type,
              industry_context,
              talentx_attribute_id
            )
          `)
          .eq('company_id', currentCompany.id)
          .order('tested_at', { ascending: false })
      ) as { data: any[] | null; error: any };

      if (error) throw error;
      
      // For trend analysis, we need ALL responses, not just the latest
      // This preserves historical data for score trend calculations
      let allResponses = data || [];
      
      // If user is Pro, fetch TalentX perception scores and convert them to PromptResponse format
      if (isPro) {
        try {
            // Fetch TalentX responses from prompt_responses table joined with confirmed_prompts
            const { data: talentXResponsesRaw, error: talentXError } = await supabase
              .from('prompt_responses')
              .select(`
                *,
                confirmed_prompts!inner(
                  user_id,
                  prompt_type,
                  prompt_text,
                  talentx_attribute_id,
                  company_id,
                  industry_context
                )
              `)
              .eq('confirmed_prompts.company_id', currentCompany.id)
              .like('confirmed_prompts.prompt_type', 'talentx_%')
              .order('tested_at', { ascending: false });
            
            // Filter to get only latest TalentX responses per prompt+model
            const talentXLatestMap = new Map<string, any>();
            (talentXResponsesRaw || []).forEach(response => {
              const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
              if (!talentXLatestMap.has(key)) {
                talentXLatestMap.set(key, response);
              }
            });
            const talentXResponses = Array.from(talentXLatestMap.values());

            if (talentXError) {
              console.error('Error fetching TalentX responses:', talentXError);
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
                  company_id: response.confirmed_prompts.company_id,
                  ai_model: response.ai_model,
                  response_text: response.response_text,
                  sentiment_score: response.sentiment_score,
                  sentiment_label: response.sentiment_score > 0.1 ? 'positive' : response.sentiment_score < -0.1 ? 'negative' : 'neutral',
                  citations: response.citations,
                  tested_at: response.tested_at || response.updated_at || response.created_at,
                  company_mentioned: true, // TalentX responses are always about the company
                  mention_ranking: 1, // Default to 1 since it's about the company
                  detected_competitors: response.detected_competitors,

                  confirmed_prompts: {
                    prompt_text: promptText,
                    prompt_category: `TalentX: ${attributeId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                    prompt_type: promptType.replace('talentx_', ''),
                    industry_context: response.confirmed_prompts.industry_context
                  }
                };
              });
              
              // Combine regular responses with TalentX responses
              allResponses = [...allResponses, ...talentXResponsesFormatted];
            }
        } catch (error) {
          console.error('Error fetching TalentX responses:', error);
          // Continue with regular responses even if TalentX fails
        }
      }
      
      setResponses(allResponses);
      
      // Set lastUpdated to the most recent response collection time
      if (allResponses.length > 0) {
        const mostRecentResponse = allResponses[0]; // Already sorted by updated_at desc
        const lastUpdatedDate = new Date(mostRecentResponse.tested_at || mostRecentResponse.updated_at || mostRecentResponse.created_at);
        setLastUpdated(lastUpdatedDate);
      } else {
        setLastUpdated(undefined);
      }
      
      setLoading(false);
      setCompetitorLoading(false);
    } catch (error) {
      console.error('Error in fetchResponses:', error);
      
      // Handle authentication errors specifically
      if (error?.message?.includes('Invalid login credentials') || 
          error?.message?.includes('Invalid Refresh Token') ||
          error?.message?.includes('JWT') ||
          error?.status === 401) {
        setConnectionError('Authentication expired. Please sign in again.');
        clearSession(); // Clear the invalid session
        
        // Clear any stored auth data and reload to reset the app state
        try {
          localStorage.removeItem('sb-ofyjvfmcgtntwamkubui-auth-token');
          sessionStorage.clear();
          // Reload the page to reset the app state
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } catch (e) {
          console.error('Error clearing auth data:', e);
        }
        
        // Don't retry on auth errors
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }
      
      // Provide more specific error messages
      if (error?.message?.includes('network') || error?.message?.includes('fetch')) {
        setConnectionError('Network error. Please check your internet connection and try again.');
      } else if (error?.message?.includes('timeout')) {
        setConnectionError('Request timed out. The server may be busy. Please try again in a moment.');
      } else if (error?.message?.includes('permission') || error?.message?.includes('policy')) {
        setConnectionError('Permission denied. Please ensure you have access to this company\'s data.');
      } else {
        setConnectionError('Unable to load data. Please refresh the page or try again later.');
      }
      setLoading(false);
      setCompetitorLoading(false);
    }
  }, [user, currentCompany, isOnline]);

  const fetchRecencyData = useCallback(async () => {
    if (!user) return;
    
    try {
      // Clear any previous errors
      setRecencyDataError(null);
      setRecencyDataLoading(true);
      
      // Get all URLs from the user's citations first
      const allCitations = responses.flatMap(r => parseCitations(r.citations)).filter(c => c.url);
      const urls = allCitations.map(c => c.url);
      
      if (urls.length === 0) {
        setRecencyData([]);
        return;
      }
      
      // Limit URLs to process initially to prevent long blocking (process first 100)
      // Remaining URLs can be processed in background if needed
      const maxUrlsToProcess = 100;
      const urlsToProcess = urls.slice(0, maxUrlsToProcess);
      
      // Process URLs in smaller batches to avoid URI length limits
      const batchSize = 50; // Increased from 25 to 50 for better performance
      const allMatches: any[] = [];
      let batchProcessingFailed = false;
      
      // Process URLs in batches
      for (let i = 0; i < urlsToProcess.length; i += batchSize) {
        const batch = urlsToProcess.slice(i, i + batchSize);
        
        try {
          const { data: batchMatches, error: batchError } = await retrySupabaseQuery(() =>
            supabase
              .from('url_recency_cache')
              .select('url, recency_score')
              .in('url', batch)
              .not('recency_score', 'is', null)
          ) as { data: any[] | null; error: any };
          
          if (batchError) {
            console.error(`Error in batch ${Math.floor(i/batchSize) + 1}:`, batchError);
            
            // If this is a URI length error, try even smaller batches
            if (batchError.message?.includes('uri too long') || 
                batchError.message?.includes('request entity too large') ||
                batchError.code === 'ERR_FAILED') {
              batchProcessingFailed = true;
              break;
            }
            
            // Continue with next batch for other errors
            continue;
          }
          
          if (batchMatches && batchMatches.length > 0) {
            allMatches.push(...batchMatches);
          }
          
          // Small delay between batches to prevent overwhelming the server
          if (i + batchSize < urlsToProcess.length) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          
        } catch (error) {
          console.error(`Exception in batch ${Math.floor(i/batchSize) + 1}:`, error);
          
          // If this is a URI length error, try individual queries
          if (error.message?.includes('uri too long') || 
              error.message?.includes('request entity too large') ||
              error.code === 'ERR_FAILED') {
            batchProcessingFailed = true;
            break;
          }
          
          // Continue with next batch for other errors
          continue;
        }
      }
      
      // If batch processing failed due to URI length, try individual URL queries
      if (batchProcessingFailed) {
        // Limit individual queries too (first 50 only)
        const maxIndividualQueries = 50;
        for (const url of urlsToProcess.slice(0, maxIndividualQueries)) {
          try {
            const { data: singleMatch, error: singleError } = await retrySupabaseQuery(() =>
              supabase
                .from('url_recency_cache')
                .select('url, recency_score')
                .eq('url', url)
                .not('recency_score', 'is', null)
                .single()
            ) as { data: any | null; error: any };
            
            if (!singleError && singleMatch) {
              allMatches.push(singleMatch);
            }
            
            // Small delay between individual queries
            await new Promise(resolve => setTimeout(resolve, 10));
            
          } catch (error) {
            console.error(`Error querying individual URL ${url}:`, error);
            continue;
          }
        }
      }
      
      if (allMatches.length > 0) {
        setRecencyData(allMatches);
        setRecencyDataError(null); // Clear any previous errors
        return;
      }
      
      // If no exact matches, try domain-based search as fallback
      // Use the same limited URL set
      const domains = [...new Set(urlsToProcess.map(url => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      }).filter(Boolean))];
      
      // Process domains in batches too
      const domainBatchSize = 10;
      const allDomainMatches: any[] = [];
      
      for (let i = 0; i < domains.length; i += domainBatchSize) {
        const domainBatch = domains.slice(i, i + domainBatchSize);
        
        try {
          const { data: domainMatches, error: domainError } = await retrySupabaseQuery(() =>
            supabase
              .from('url_recency_cache')
              .select('url, recency_score, domain')
              .or(domainBatch.map(domain => `domain.eq.${domain}`).join(','))
              .not('recency_score', 'is', null)
              .limit(50)
          ) as { data: any[] | null; error: any };
          
          if (domainError) {
            console.error(`Error in domain batch ${Math.floor(i/domainBatchSize) + 1}:`, domainError);
            continue;
          }
          
          if (domainMatches && domainMatches.length > 0) {
            allDomainMatches.push(...domainMatches);
          }
          
        } catch (error) {
          console.error(`Exception in domain batch ${Math.floor(i/domainBatchSize) + 1}:`, error);
          continue;
        }
      }
      
      setRecencyData(allDomainMatches);
      setRecencyDataError(null); // Clear any previous errors
    } catch (error) {
      console.error('Error in fetchRecencyData:', error);
      setRecencyData([]);
      
      // Set specific error message for recency data
      if (error.message?.includes('ERR_FAILED') || error.message?.includes('network')) {
        setRecencyDataError('Unable to fetch relevance data due to network issues. The system will retry automatically.');
      } else if (error.message?.includes('uri too long')) {
        setRecencyDataError('Processing a large number of sources. This may take a moment...');
      } else if (error.message?.includes('timeout')) {
        setRecencyDataError('Relevance data is taking longer than expected. Please wait...');
      } else {
        setRecencyDataError('Relevance data is being processed. This may take a moment.');
      }
    } finally {
      setRecencyDataLoading(false);
    }
  }, [user, responses]);

  const fetchAIThemes = useCallback(async () => {
    if (!user || responses.length === 0) {
      setAiThemes([]);
      setAiThemesLoading(false);
      return;
    }

    try {
      setAiThemesLoading(true);
      // Get response IDs for sentiment and competitive prompts (excluding visibility)
      const relevantResponses = responses.filter(response => {
        const promptType = response.confirmed_prompts?.prompt_type;
        return promptType === 'sentiment' || 
               promptType === 'competitive' || 
               promptType === 'talentx_sentiment' || 
               promptType === 'talentx_competitive';
      });

      const responseIds = relevantResponses.map(r => r.id);
      
      if (responseIds.length === 0) {
        setAiThemes([]);
        return;
      }

      // Process response IDs in batches to avoid URI length limits
      // Supabase .in() queries can fail if the array is too large
      const batchSize = 100; // Process 100 response IDs at a time
      const allThemes: any[] = [];
      let batchProcessingFailed = false;

      // Process response IDs in batches
      for (let i = 0; i < responseIds.length; i += batchSize) {
        const batch = responseIds.slice(i, i + batchSize);
        
        try {
          const { data: batchThemes, error: batchError } = await retrySupabaseQuery(() =>
            supabase
              .from('ai_themes')
              .select('*')
              .in('response_id', batch)
              .order('created_at', { ascending: false })
          ) as { data: any[] | null; error: any };

          if (batchError) {
            console.error(`Error fetching AI themes batch ${Math.floor(i/batchSize) + 1}:`, batchError);
            
            // If this is a URI length error, try even smaller batches
            if (batchError.message?.includes('uri too long') || 
                batchError.message?.includes('request entity too large') ||
                batchError.code === 'ERR_FAILED') {
              batchProcessingFailed = true;
              break;
            }
            
            // Continue with next batch for other errors
            continue;
          }

          if (batchThemes && batchThemes.length > 0) {
            allThemes.push(...batchThemes);
          }

          // Small delay between batches to avoid rate limiting
          if (i + batchSize < responseIds.length) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }

        } catch (error) {
          console.error(`Error in AI themes batch ${Math.floor(i/batchSize) + 1}:`, error);
          continue;
        }
      }

      // If batching failed, try individual queries as fallback
      if (batchProcessingFailed && allThemes.length === 0) {
        console.warn('Batch processing failed, trying individual queries for AI themes...');
        for (const responseId of responseIds.slice(0, 50)) { // Limit to first 50 to avoid too many requests
          try {
            const { data: singleTheme, error: singleError } = await retrySupabaseQuery(() =>
              supabase
                .from('ai_themes')
                .select('*')
                .eq('response_id', responseId)
            ) as { data: any[] | null; error: any };

            if (!singleError && singleTheme) {
              allThemes.push(...singleTheme);
            }

            await new Promise(resolve => setTimeout(resolve, 25));
          } catch (error) {
            console.error(`Error fetching themes for response ${responseId}:`, error);
          }
        }
      }

      // Check if we got any themes
      if (batchProcessingFailed && allThemes.length === 0) {
        console.error('❌ Failed to fetch AI themes after batching. Response IDs count:', responseIds.length);
        setAiThemes([]);
        return;
      }
      
      setAiThemes(allThemes);
    } catch (error) {
      console.error('Error in fetchAIThemes:', error);
      setAiThemes([]);
    } finally {
      setAiThemesLoading(false);
    }
  }, [user, responses]);

  // Memoized cache of sentiment calculations per response ID
  // This prevents recalculating sentiment for the same response multiple times
  // Only counts themes from responses that belong to the current company
  const sentimentCache = useMemo(() => {
    const cache = new Map<string, { sentiment_score: number; sentiment_label: string }>();
    
    // Create a Set of response IDs from the current company's responses
    // This ensures we only count themes from responses belonging to the current company
    const companyResponseIds = new Set(responses.map(r => r.id));
    
    // Filter themes to only include those from the current company's responses
    const companyThemes = aiThemes.filter(theme => companyResponseIds.has(theme.response_id));
    
    // Group themes by response_id for efficient processing
    const themesByResponseId = new Map<string, typeof aiThemes>();
    companyThemes.forEach(theme => {
      if (!themesByResponseId.has(theme.response_id)) {
        themesByResponseId.set(theme.response_id, []);
      }
      themesByResponseId.get(theme.response_id)!.push(theme);
    });
    
    // Calculate sentiment for each response ID once
    themesByResponseId.forEach((responseThemes, responseId) => {
      const positiveThemes = responseThemes.filter(theme => theme.sentiment_score > 0.1).length;
      const negativeThemes = responseThemes.filter(theme => theme.sentiment_score < -0.1).length;
      const totalThemes = positiveThemes + negativeThemes;
      
      if (totalThemes === 0) {
        // All themes are neutral
        cache.set(responseId, { sentiment_score: 0, sentiment_label: 'neutral' });
        return;
      }
      
      // Sentiment score is the ratio of positive themes (0-1 scale)
      const sentimentRatio = positiveThemes / totalThemes;
      const sentimentLabel = sentimentRatio > 0.6 ? 'positive' : sentimentRatio < 0.4 ? 'negative' : 'neutral';
      
      cache.set(responseId, { 
        sentiment_score: sentimentRatio, 
        sentiment_label: sentimentLabel 
      });
    });
    
    return cache;
  }, [aiThemes, responses]);

  // Helper function to calculate AI-based sentiment for a response
  // Now uses the memoized cache for O(1) lookup instead of recalculating
  const calculateAIBasedSentiment = useCallback((responseId: string) => {
    // Check cache first
    const cached = sentimentCache.get(responseId);
    if (cached) {
      return cached;
    }
    
    // No AI themes available for this response - return neutral sentiment
    return {
      sentiment_score: 0,
      sentiment_label: 'neutral'
    };
  }, [sentimentCache]);

  const fetchCompanyName = useCallback(async () => {
    if (!currentCompany) {
      setCompanyName('');
      return;
    }
    
    setCompanyName(currentCompany.name);
  }, [currentCompany]);

  const fetchTalentXProData = useCallback(async () => {
    if (!user || !isPro) {
      setTalentXProData([]);
      setTalentXProLoading(false);
      return;
    }

    try {
      setTalentXProLoading(true);
      const data = await TalentXProService.getAggregatedProAnalysis(user.id, currentCompany?.id);
      setTalentXProData(data);
    } catch (error) {
      console.error('Error fetching TalentX Pro data:', error);
      setTalentXProData([]);
    } finally {
      setTalentXProLoading(false);
    }
  }, [user, currentCompany, isPro]);

  // Cache for search results to prevent duplicate requests
  const searchResultsCache = useRef<{
    companyId: string | null;
    timestamp: number;
    data: any[];
  }>({ companyId: null, timestamp: 0, data: [] });

  const fetchSearchResults = useCallback(async () => {
    if (!user || !currentCompany) {
      setSearchResults([]);
      setSearchResultsLoading(false);
      return;
    }

    // Check cache first - if we have recent data for this company, use it
    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    if (
      searchResultsCache.current.companyId === currentCompany.id &&
      (now - searchResultsCache.current.timestamp) < CACHE_DURATION &&
      searchResultsCache.current.data.length > 0
    ) {
      setSearchResults(searchResultsCache.current.data);
      setSearchResultsLoading(false);
      return;
    }

    try {
      setSearchResultsLoading(true);
      
      // Get the most recent search session for this company
      const { data: sessionData, error: sessionError } = await retrySupabaseQuery(() =>
        supabase
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
          .eq('company_id', currentCompany.id)
          .order('created_at', { ascending: false })
          .limit(1)
      ) as { data: any[] | null; error: any };

      if (sessionError) {
        console.error('Error fetching search session:', sessionError);
        setSearchResults([]);
        return;
      }

      // Get the first (and only) result if any exist
      const session = sessionData && sessionData.length > 0 ? sessionData[0] : null;

      if (!session) {
        setSearchResults([]);
        return;
      }

      // Get search results for this session
      const { data: resultsData, error: resultsError } = await retrySupabaseQuery(() =>
        supabase
          .from('search_insights_results')
          .select('*')
          .eq('session_id', session.id)
          .order('position', { ascending: true })
      ) as { data: any[] | null; error: any };

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
          company_id: currentCompany.id, // Add company_id to each search result
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
      
      // Cache the results
      searchResultsCache.current = {
        companyId: currentCompany.id,
        timestamp: now,
        data: processedResults
      };

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
        
        setSearchTermsData(termsData);
      }
    } catch (error) {
      console.error('Error loading search results:', error);
      setSearchResults([]);
    } finally {
      setSearchResultsLoading(false);
    }
  }, [user, currentCompany?.id]);

  // Real-time subscription - FIXED
  useEffect(() => {
    if (!user?.id) return;
    
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    
    const subscription = supabase
      .channel('prompt_responses_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'prompt_responses'
      }, (payload) => {
        // Force refetch on changes
        setShouldRefetch(true);
      })
      .subscribe();
      
    subscriptionRef.current = subscription;
    
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [user?.id]);

  // Polling effect: only set up polling when loading is true and only one interval at a time
  useEffect(() => {
    if (!user?.id || !loading || !isOnline) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    if (pollingRef.current) return; // Already polling
    
    // Use debounced polling to prevent overwhelming the server
    pollingRef.current = setInterval(() => {
      // Only poll if tab is still visible
      if (!document.hidden) {
        // Force refetch instead of calling function directly
        setShouldRefetch(true);
      }
    }, 3000); // Increased interval from 2s to 3s
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [user?.id, loading, isOnline]); // Only depend on IDs and primitive values, not the function

  // Add refs to track initial loading state
  const hasInitiallyLoadedRef = useRef(false);
  const currentCompanyIdRef = useRef(currentCompany?.id);
  const [shouldRefetch, setShouldRefetch] = useState(false);
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false);

  // Update the ref when company changes
  useEffect(() => {
    if (currentCompany?.id !== currentCompanyIdRef.current) {
      // Set switching flag to prevent stale data from being used
      setIsSwitchingCompany(true);
      
      hasInitiallyLoadedRef.current = false;
      currentCompanyIdRef.current = currentCompany?.id;
      
      // Clear all data immediately when switching companies
      setResponses([]);
      setAiThemes([]);
      setSearchResults([]);
      setSearchTermsData([]);
      setTalentXProData([]);
      setTalentXProPrompts([]);
      setRecencyData([]);
      setLastUpdated(undefined);
      
      // Clear search results cache when switching companies
      searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
    }
  }, [currentCompany?.id, responses.length, searchResults.length]);

  // Initial data fetch - only run when user or company ID actually changes, or when shouldRefetch is true
  useEffect(() => {
    if (user && currentCompany && (!hasInitiallyLoadedRef.current || shouldRefetch)) {
      hasInitiallyLoadedRef.current = true;
      setShouldRefetch(false); // Reset the refetch flag
      
      // Fetch fresh data for the new company
      fetchResponses();
      fetchCompanyName();
      if (isPro) {
        fetchTalentXProData();
        fetchSearchResults();
      }
      
      // Don't clear the switching flag here - let it be cleared when data is actually loaded
    }
  }, [user?.id, currentCompany?.id, isPro, shouldRefetch]);

  // Clear switching flag when data is actually loaded
  useEffect(() => {
    if (isSwitchingCompany && (responses.length > 0 || searchResults.length > 0)) {
      setIsSwitchingCompany(false);
    }
  }, [isSwitchingCompany, responses.length, searchResults.length]);

  // Fetch recency data when responses change
  useEffect(() => {
    if (responses.length > 0) {
      fetchRecencyData();
    }
  }, [responses.length]); // Only depend on responses length, not the function

  // Fetch AI themes when responses change
  useEffect(() => {
    if (responses.length > 0) {
      fetchAIThemes();
    }
  }, [responses.length]); // Only depend on responses length, not the function

  // Track when metrics are ready (depends on responses and AI themes)
  // Recency data is non-blocking - dashboard can show without it
  useEffect(() => {
    if (loading) {
      setMetricsLoading(true);
    } else if (responses.length > 0) {
      // Don't wait for recency data - it can load in the background
      // Only wait for responses and AI themes (which should be fast)
      // If AI themes haven't loaded yet but we have responses, still show dashboard
      // The metrics will update when AI themes arrive
      setMetricsLoading(false);
    } else {
      setMetricsLoading(false);
    }
  }, [loading, responses.length]);

  // Comprehensive loading state that includes all critical data
  // Wait for recency data if we have responses (since it affects relevance scores)
  const isFullyLoaded = useMemo(() => {
    const baseLoaded = !loading && !metricsLoading && !competitorLoading;
    // If we have responses, also wait for recency data to prevent score changes
    if (responses.length > 0) {
      return baseLoaded && !recencyDataLoading;
    }
    return baseLoaded;
  }, [loading, metricsLoading, competitorLoading, recencyDataLoading, responses.length]);

  // Fetch search results when company is available
  useEffect(() => {
    if (user && isPro && currentCompany) {
      fetchSearchResults();
    }
  }, [user?.id, isPro, currentCompany?.id]); // Only depend on IDs, not the function

  const refreshData = useCallback(async () => {
    // Force refetch by setting the state
    setShouldRefetch(true);
  }, []);

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
          console.error('Error fetching TalentX Pro prompts:', error);
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
            
            // Calculate visibility from company_mentioned boolean
            const visibilityPercentage = matchingResponses.length > 0 
              ? (matchingResponses.filter(r => r.company_mentioned === true).length / matchingResponses.length) * 100
              : 0;
            
            // Calculate average sentiment from AI themes (if available)
            const avgSentiment = matchingResponses.length > 0 
              ? matchingResponses.reduce((sum, r) => {
                  const aiSentiment = calculateAIBasedSentiment(r.id);
                  return sum + aiSentiment.sentiment_score;
                }, 0) / matchingResponses.length
              : 0;
            
            // Determine sentiment label
            let sentimentLabel = 'neutral';
            if (avgSentiment > 0.1) sentimentLabel = 'positive';
            else if (avgSentiment < -0.1) sentimentLabel = 'negative';
            
            return {
              prompt: prompt.prompt_text,
              category: prompt.prompt_theme || 'General',
              type: prompt.prompt_type as any,
              industryContext: prompt.industry_context || undefined,
              jobFunctionContext: prompt.job_function_context || undefined,
              locationContext: prompt.location_context || undefined,
              promptCategory: prompt.prompt_category || undefined,
              promptTheme: prompt.prompt_theme || 'General',
              responses: matchingResponses.length > 0 ? 1 : 0, // Mark as having responses if any exist
              avgSentiment: avgSentiment,
              sentimentLabel: sentimentLabel,
              mentionRanking: undefined,
              competitivePosition: undefined,
              competitorMentions: undefined,
              averageVisibility: visibilityPercentage,
              visibilityScores: [visibilityPercentage],
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
        console.error('Error in fetchTalentXProPrompts:', error);
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
      
      // Get AI-based sentiment for this response
      const aiSentiment = calculateAIBasedSentiment(response.id);
      
      // Extract visibility from company_mentioned boolean
      const visibilityScore = typeof response.company_mentioned === 'boolean' ? (response.company_mentioned ? 100 : 0) : undefined;
      
      if (existing) {
        existing.responses += 1;
        // Use AI-based sentiment in average calculation
        existing.avgSentiment = (existing.avgSentiment + aiSentiment.sentiment_score) / 2;
        if (!existing.industryContext && response.confirmed_prompts?.industry_context) {
          existing.industryContext = response.confirmed_prompts.industry_context;
        }
        if (!existing.jobFunctionContext && response.confirmed_prompts?.job_function_context) {
          existing.jobFunctionContext = response.confirmed_prompts.job_function_context;
        }
        if (!existing.locationContext && response.confirmed_prompts?.location_context) {
          existing.locationContext = response.confirmed_prompts.location_context;
        }
        if (!existing.promptCategory && response.confirmed_prompts?.prompt_category) {
          existing.promptCategory = response.confirmed_prompts.prompt_category || undefined;
        }
        if (!existing.promptTheme && response.confirmed_prompts?.prompt_theme) {
          const theme = response.confirmed_prompts.prompt_theme || undefined;
          existing.promptTheme = theme;
          if (theme) {
            existing.category = theme;
          }
        }
        // Update talentXAttributeId from confirmed_prompts if not already set
        const talentXAttrId = (response.confirmed_prompts as any)?.talentx_attribute_id;
        if (!existing.talentXAttributeId && talentXAttrId) {
          existing.talentXAttributeId = talentXAttrId;
        }
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
          if (response.detected_competitors) {
            const mentions = response.detected_competitors.split(',').map(m => m.trim()).filter(m => m.length > 0);
            existing.detectedCompetitors = mentions.join(',');
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
        const promptCategoryValue = response.confirmed_prompts?.prompt_category || 'General';
        const promptThemeValue = response.confirmed_prompts?.prompt_theme || 'General';
        acc.push({
          prompt: promptKey || '',
          category: promptThemeValue,
          type: response.confirmed_prompts?.prompt_type || 'sentiment',
          industryContext: response.confirmed_prompts?.industry_context || undefined,
          jobFunctionContext: response.confirmed_prompts?.job_function_context || undefined,
          locationContext: response.confirmed_prompts?.location_context || undefined,
          promptCategory: promptCategoryValue,
          promptTheme: promptThemeValue,
          responses: 1,
          avgSentiment: aiSentiment.sentiment_score, // Use AI-based sentiment
          sentimentLabel: aiSentiment.sentiment_label, // Use AI-based sentiment label
          mentionRanking: response.mention_ranking || undefined,
          competitivePosition: response.mention_ranking || undefined,
          detectedCompetitors: response.detected_competitors || undefined,
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

    const promptsWithActive = [...uniquePrompts];

    activePrompts.forEach(prompt => {
      if (prompt.is_pro_prompt) {
        return;
      }

      const existing = promptsWithActive.find(item => item.prompt === prompt.prompt_text);
      if (!existing) {
        promptsWithActive.push({
          prompt: prompt.prompt_text,
          category: prompt.prompt_theme || 'General',
          type: prompt.prompt_type || 'sentiment',
          industryContext: prompt.industry_context || undefined,
          jobFunctionContext: prompt.job_function_context || undefined,
          locationContext: prompt.location_context || undefined,
          promptCategory: prompt.prompt_category || undefined,
          promptTheme: prompt.prompt_theme || undefined,
          responses: 0,
          avgSentiment: 0,
          sentimentLabel: 'neutral',
          mentionRanking: undefined,
          competitivePosition: undefined,
          detectedCompetitors: undefined,
          averageVisibility: (prompt.prompt_type === 'visibility') ? 0 : undefined,
          totalWords: undefined,
          firstMentionPosition: undefined,
          visibilityScores: [],
        });
      }
    });
    
    return promptsWithActive;
  }, [responses, talentXProPrompts, calculateAIBasedSentiment, activePrompts]);

  const metrics: DashboardMetrics = useMemo(() => {
    // Calculate AI-based sentiment averages
    const relevantResponses = responses.filter(response => {
      const promptType = response.confirmed_prompts?.prompt_type;
      return promptType === 'sentiment' || 
             promptType === 'competitive' || 
             promptType === 'talentx_sentiment' || 
             promptType === 'talentx_competitive';
    });

    let averageSentiment = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;

    if (aiThemes.length > 0 && relevantResponses.length > 0) {
      // Use AI themes for sentiment calculation
      // Calculate overall positive ratio directly from all themes (not averaged across responses)
      const companyResponseIds = new Set(relevantResponses.map(r => r.id));
      const companyThemes = aiThemes.filter(theme => companyResponseIds.has(theme.response_id));
      
      const positiveThemes = companyThemes.filter(theme => theme.sentiment_score > 0.1).length;
      const negativeThemes = companyThemes.filter(theme => theme.sentiment_score < -0.1).length;
      const totalNonNeutralThemes = positiveThemes + negativeThemes;
      
      // Calculate overall positive ratio (0-1 scale)
      averageSentiment = totalNonNeutralThemes > 0 
        ? positiveThemes / totalNonNeutralThemes 
        : 0;

      // Calculate sentiment counts based on AI themes (ratio-based)
      const responseSentiments = relevantResponses.map(response => {
        return calculateAIBasedSentiment(response.id);
      });
      positiveCount = responseSentiments.filter(s => s.sentiment_score > 0.6).length;
      neutralCount = responseSentiments.filter(s => s.sentiment_score >= 0.4 && s.sentiment_score <= 0.6).length;
      negativeCount = responseSentiments.filter(s => s.sentiment_score < 0.4).length;
    } else {
      // No AI themes available - use neutral sentiment as fallback
      averageSentiment = 0; // Neutral sentiment when no AI themes available
      positiveCount = 0;
      neutralCount = responses.length;
      negativeCount = 0;
    }

    const sentimentLabel = averageSentiment > 0.6 ? 'Positive' : averageSentiment < 0.4 ? 'Negative' : 'Neutral';

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

        // Calculate sentiment trend using AI-based sentiment if available
        let currentSentimentAvg: number;
        let previousSentimentAvg: number;

        if (aiThemes.length > 0) {
          const currentAISentiments = currentResponses.map(r => calculateAIBasedSentiment(r.id));
          const previousAISentiments = previousResponses.map(r => calculateAIBasedSentiment(r.id));
          
          currentSentimentAvg = currentAISentiments.length > 0 
            ? currentAISentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / currentAISentiments.length
            : 0;
          
          previousSentimentAvg = previousAISentiments.length > 0
            ? previousAISentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / previousAISentiments.length
            : 0;
        } else {
          // No fallback to original sentiment - use neutral when no AI themes
          currentSentimentAvg = 0;
          previousSentimentAvg = 0;
        }

        const sentimentChange = currentSentimentAvg - previousSentimentAvg;
        sentimentTrendComparison = {
          value: Math.abs(Math.round(sentimentChange * 100)),
          direction: sentimentChange > 0.05 ? 'up' : sentimentChange < -0.05 ? 'down' : 'neutral'
        };

        // Calculate visibility trend using company_mentioned percentage
        const currentMentionedCount = currentResponses.filter(r => r.company_mentioned === true).length;
        const currentVisibilityAvg = currentResponses.length > 0 ? (currentMentionedCount / currentResponses.length) * 100 : 0;
        
        const previousMentionedCount = previousResponses.filter(r => r.company_mentioned === true).length;
        const previousVisibilityAvg = previousResponses.length > 0 ? (previousMentionedCount / previousResponses.length) * 100 : 0;
        
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

    // Calculate average visibility as the percentage of responses where company_mentioned is TRUE
    const mentionedCount = responses.filter(r => r.company_mentioned === true).length;
    const averageVisibility = responses.length > 0
      ? (mentionedCount / responses.length) * 100
      : 0;

    // Calculate average relevance score (ignoring null scores)
    const validRecencyScores = recencyData.filter(item => 
      item.recency_score !== null && item.recency_score !== undefined
    );
    const averageRelevance = validRecencyScores.length > 0 
      ? validRecencyScores.reduce((sum, item) => sum + item.recency_score, 0) / validRecencyScores.length 
      : 0;

    // Calculate overall perception score
    const calculatePerceptionScore = () => {
      if (responses.length === 0) return { score: 0, label: 'No Data' };

      // Convert sentiment ratio (0-1) to 0-100 scale
      const normalizedSentiment = Math.max(0, Math.min(100, averageSentiment * 100));
      
      // Visibility is already 0-100 scale
      const visibilityScore = averageVisibility;
      
      // Relevance is already 0-100 scale
      const relevanceScore = averageRelevance;

      // Weighted formula: 50% sentiment + 30% visibility + 20% relevance (excluding competitive)
      const perceptionScore = Math.round(
        (normalizedSentiment * 0.5) + 
        (visibilityScore * 0.3) + 
        (relevanceScore * 0.2)
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
      averageRelevance,
      positiveCount,
      neutralCount,
      negativeCount,
      perceptionScore,
      perceptionLabel
    };
  }, [responses, promptsData, recencyData, aiThemes, calculateAIBasedSentiment]);

  const sentimentTrend: SentimentTrendData[] = useMemo(() => {
    const trend = responses.reduce((acc: SentimentTrendData[], response) => {
      const date = new Date(response.tested_at).toLocaleDateString();
      const existing = acc.find(item => item.date === date);
      
      // Get AI-based sentiment for this response
      const aiSentiment = calculateAIBasedSentiment(response.id);
      
      if (existing) {
        existing.sentiment = (existing.sentiment + aiSentiment.sentiment_score) / 2;
        existing.count += 1;
      } else {
        acc.push({
          date,
          sentiment: aiSentiment.sentiment_score,
          count: 1
        });
      }
      
      return acc;
    }, []);
    // Sort by date ascending
    trend.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return trend.slice(-7); // get the last 7 days (latest at the end)
  }, [responses, calculateAIBasedSentiment]);

  const topCitations: CitationCount[] = useMemo(() => {
    // If no current company, return empty array
    if (!currentCompany?.id) {
      return [];
    }

    // If we're switching companies, return empty array to prevent stale data
    if (isSwitchingCompany) {
      return [];
    }

    // CRITICAL: Filter responses and search results by current company ID
    // This ensures we only count citations from the currently selected company
    const currentCompanyResponses = responses.filter(r => r.company_id === currentCompany.id);
    const currentCompanySearchResults = searchResults.filter(r => r.company_id === currentCompany.id);


    // Use enhanceCitations to get EnhancedCitation objects from filtered responses
    const allCitations = currentCompanyResponses.flatMap(r => enhanceCitations(parseCitations(r.citations)));
    // Only keep citations that are real websites
    const websiteCitations = allCitations.filter(citation => citation.type === 'website' && citation.url);

    const citationCounts = websiteCitations.reduce((acc: any, citation: EnhancedCitation) => {
      const domain = citation.domain;
      if (domain) {
        acc[domain] = (acc[domain] || 0) + 1;
      }
      return acc;
    }, {});

    // Add search result domains to citation counts (from filtered search results)
    currentCompanySearchResults.forEach(result => {
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
    
    return finalCitations;
  }, [responses, searchResults, currentCompany?.name, currentCompany?.id, isSwitchingCompany]);

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
      
      // Calculate average visibility as the percentage of responses where company_mentioned is TRUE
      const mentionedCount = promptResponses.filter(r => r.company_mentioned === true).length;
      let averageVisibility: number | undefined = undefined;
      if (promptResponses.length > 0) {
        averageVisibility = (mentionedCount / promptResponses.length) * 100;
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
        detectedCompetitors: promptResponses[0]?.detected_competitors,
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
        detectedCompetitors: firstResponse.detected_competitors,
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
    
    // Process competitors from AI responses
    responses.forEach(response => {
      if (response.detected_competitors) {
        const validCompetitors = parseCompetitors(response.detected_competitors, companyName);
        validCompetitors.forEach(competitor => {
          competitorCounts[competitor] = (competitorCounts[competitor] || 0) + 1;
        });
      }
    });

    // Process competitors from search results
    searchResults.forEach(result => {
      if (result.detectedCompetitors && result.detectedCompetitors.trim()) {
        const validCompetitors = parseCompetitors(result.detectedCompetitors, companyName);
        validCompetitors.forEach(competitor => {
          // Weight search result competitors by mention count (how many search terms found this domain)
          const weight = result.mentionCount || 1;
          competitorCounts[competitor] = (competitorCounts[competitor] || 0) + weight;
        });
      }
    });

    const result = Object.entries(competitorCounts)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

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
        console.error('Error fetching user onboarding:', onboardingError);
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
          console.error('Error updating confirmed prompts:', updateError);
        } else {
          // Refresh the data after fixing
          fetchResponses();
        }
      }
    } catch (error) {
      console.error('Error in fixMissingUserIds:', error);
    }
  }, [user, fetchResponses]);

  // Function to fetch historical responses for a specific time range
  // Enables time period comparison features in the dashboard
  const fetchHistoricalResponses = useCallback(async (startDate: Date, endDate: Date) => {
    if (!user || !currentCompany) {
      return [];
    }

    try {
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
        .eq('company_id', currentCompany.id)
        .gte('tested_at', startDate.toISOString())
        .lte('tested_at', endDate.toISOString())
        .order('tested_at', { ascending: false });

      if (error) throw error;

      // Filter to get only the latest response for each prompt+model in this time range
      const latestInRangeMap = new Map<string, any>();
      (data || []).forEach(response => {
        const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
        if (!latestInRangeMap.has(key)) {
          latestInRangeMap.set(key, response);
        }
      });

      return Array.from(latestInRangeMap.values());
    } catch (error) {
      console.error('Error fetching historical responses:', error);
      return [];
    }
  }, [user, currentCompany]);

  // Function to get all unique collection dates for this company
  // Useful for showing a timeline or date selector for comparisons
  const fetchCollectionDates = useCallback(async () => {
    if (!user || !currentCompany) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('prompt_responses')
        .select('tested_at')
        .eq('company_id', currentCompany.id)
        .order('tested_at', { ascending: false });

      if (error) throw error;

      // Get unique dates (just the date part, not time)
      const uniqueDates = new Set<string>();
      (data || []).forEach(response => {
        const date = new Date(response.tested_at).toISOString().split('T')[0];
        uniqueDates.add(date);
      });

      return Array.from(uniqueDates).sort().reverse();
    } catch (error) {
      console.error('Error fetching collection dates:', error);
      return [];
    }
  }, [user, currentCompany]);

  return {
    responses,
    loading,
    competitorLoading,
    metricsLoading,
    isFullyLoaded,
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
    fetchSearchResults,
    aiThemes, // Export AI themes for use in components
    fetchAIThemes, // Export function to refresh AI themes
    fetchHistoricalResponses, // Fetch responses for a specific time range
    fetchCollectionDates, // Get all collection dates for timeline/comparison
    isOnline, // Network status
    connectionError, // Connection error message
    recencyDataError, // Recency data specific error message
    recencyData, // Export recency data for components
    recencyDataLoading, // Loading state for recency data
    aiThemesLoading // Loading state for AI themes
  };
};
