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
  const [responseTexts, setResponseTexts] = useState<Record<string, string>>({});
  const [responseTextsLoading, setResponseTextsLoading] = useState(false);
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
  // Pre-aggregated data from materialized views (Phase 1 MV migration)
  const [mvTopCitations, setMvTopCitations] = useState<CitationCount[]>([]);
  const [mvTopCompetitors, setMvTopCompetitors] = useState<{company: string; count: number}[]>([]);
  const [mvLlmRankings, setMvLlmRankings] = useState<LLMMentionRanking[]>([]);
  // Backend-calculated metrics from materialized views
  const [companySentimentMetrics, setCompanySentimentMetrics] = useState<any | null>(null);
  const [companyRelevanceMetrics, setCompanyRelevanceMetrics] = useState<any | null>(null);
  const [companyMetricsLoading, setCompanyMetricsLoading] = useState(false);
  // Track if metrics are still being calculated (for UX - show all metrics together)
  // Start as true, will be set to false when all metrics are ready
  const [metricsCalculating, setMetricsCalculating] = useState(true);
  
  // Reset metricsCalculating when company changes or when starting to load
  useEffect(() => {
    if (currentCompany?.id) {
      setMetricsCalculating(true);
    }
  }, [currentCompany?.id]);
  
  // Also reset when loading starts
  useEffect(() => {
    if (loading) {
      setMetricsCalculating(true);
    }
  }, [loading]);
  // Pagination state for responses
  const [loadAllResponses, setLoadAllResponses] = useState(false); // Flag to load all historical data
  const [hasMoreResponses, setHasMoreResponses] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);   // Track polling interval
  const recencyDataCacheRef = useRef<{ responseIdsHash: string; data: any[] } | null>(null); // Cache recency data
  const previousResponseIdsRef = useRef<string>(''); // Track previous response IDs to detect changes
  // Cache company dashboard data for instant restore when switching back (stale-while-revalidate)
  const COMPANY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const companyDataCacheRef = useRef<Record<string, { responses: PromptResponse[]; lastUpdated?: Date; timestamp: number }>>({});

  // Network status monitoring - FIXED
  // Track if we're coming back online from being offline (vs just tab visibility change)
  const wasOfflineRef = useRef(!isOnline);
  
  useEffect(() => {
    const removeListener = networkMonitor.addListener((online) => {
      const wasOffline = wasOfflineRef.current;
      wasOfflineRef.current = !online;
      
      setIsOnline(online);
      if (online) {
        setConnectionError(null);
        // Only trigger refetch if:
        // 1. We have user and company
        // 2. We were actually offline before (not just tab visibility change)
        // 3. Tab is currently visible
        if (user?.id && currentCompany?.id && wasOffline && !document.hidden) {
          // Only refetch if we don't have data yet or if this is a real network reconnect
          if (!fetchedCompanyUserKeyRef.current || responses.length === 0) {
            setShouldRefetch(true); // Force refetch only if needed
          }
        }
      } else {
        setConnectionError('No internet connection. Please check your network.');
      }
    });

    return removeListener;
  }, [user?.id, currentCompany?.id, responses.length]); // Only IDs and responses length

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
      
      // Fetch prompts first
      const promptsResult = await retrySupabaseQuery(() =>
        supabase
          .from('confirmed_prompts')
          .select('id, user_id, prompt_text, company_id, prompt_category, prompt_theme, prompt_type, industry_context, job_function_context, location_context, is_pro_prompt, talentx_attribute_id')
          .eq('company_id', currentCompany.id)
      ) as Promise<{ data: any[] | null; error: any }>;

      const { data: userPrompts, error: promptsError } = promptsResult;

      // Fetch ALL prompt_responses for the company (paginate to bypass Supabase 1000-row default cap)
      const PAGE_SIZE = 1000;
      let data: any[] = [];
      let page = 0;
      let chunk: any[] | null;
      do {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const result = await retrySupabaseQuery(() =>
          supabase
            .from('prompt_responses')
            .select(`
              id,
              confirmed_prompt_id,
              company_id,
              ai_model,
              tested_at,
              created_at,
              updated_at,
              company_mentioned,
              detected_competitors,
              citations,
              for_index,
              index_period,
              confirmed_prompts!inner(
                id,
                prompt_text,
                prompt_category,
                prompt_type,
                prompt_theme,
                job_function_context,
                location_context,
                industry_context,
                talentx_attribute_id
              )
            `)
            .eq('company_id', currentCompany.id)
            .order('tested_at', { ascending: false })
            .range(from, to)
        ) as Promise<{ data: any[] | null; error: any }>;
        if (result.error) throw result.error;
        chunk = result.data ?? [];
        data = data.concat(chunk);
        page += 1;
        if (chunk.length === PAGE_SIZE) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } while (chunk.length === PAGE_SIZE);

      const responsesError = null;

      if (promptsError) {
        console.error('🔍 Error fetching prompts:', promptsError);
        if (promptsError.message?.includes('permission') || promptsError.message?.includes('policy')) {
          throw new Error('You don\'t have permission to view prompts for this company. Please contact support if you believe this is an error.');
        }
        throw new Error('Unable to load prompts. Please refresh the page or try again later.');
      }

      if (responsesError) {
        throw responsesError;
      }

      if (!userPrompts || userPrompts.length === 0) {
        setActivePrompts([]);
        setResponses([]);
        setLoading(false);
        setCompetitorLoading(false);
        return;
      }

      setActivePrompts(userPrompts);
      setHasDataIssues(false);
      setHasMoreResponses(false);

      let allResponses = data || [];
      
      // If user is Pro, fetch TalentX responses in parallel with regular responses
      // (We already fetched regular responses above, so fetch TalentX now)
      if (isPro) {
        try {
          // Paginate TalentX responses to bypass 1000-row cap
          const talentXPageSize = 1000;
          let talentXRaw: any[] = [];
          let talentXPage = 0;
          let talentXChunk: any[];
          do {
            const from = talentXPage * talentXPageSize;
            const to = from + talentXPageSize - 1;
            const talentXResult = await supabase
              .from('prompt_responses')
              .select(`
                id,
                confirmed_prompt_id,
                company_id,
                ai_model,
                tested_at,
                created_at,
                updated_at,
                company_mentioned,
                detected_competitors,
                citations,
                for_index,
                index_period,
                confirmed_prompts!inner(
                  id,
                  user_id,
                  prompt_type,
                  prompt_text,
                  talentx_attribute_id,
                  company_id,
                  industry_context,
                  job_function_context,
                  location_context
                )
              `)
              .eq('confirmed_prompts.company_id', currentCompany.id)
              .like('confirmed_prompts.prompt_type', 'talentx_%')
              .order('tested_at', { ascending: false })
              .range(from, to);
            if (talentXResult.error) throw talentXResult.error;
            talentXChunk = talentXResult.data ?? [];
            talentXRaw = talentXRaw.concat(talentXChunk);
            talentXPage += 1;
          } while (talentXChunk.length === talentXPageSize);

            // Filter to get only latest TalentX responses per prompt+model
            const talentXLatestMap = new Map<string, any>();
            talentXRaw.forEach(response => {
              const key = `${response.confirmed_prompt_id}_${response.ai_model}`;
              if (!talentXLatestMap.has(key)) {
                talentXLatestMap.set(key, response);
              }
            });
            const talentXResponses = Array.from(talentXLatestMap.values());

            if (talentXResponses && talentXResponses.length > 0) {
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
                  citations: response.citations,
                  tested_at: response.tested_at || response.updated_at || response.created_at,
                  company_mentioned: true,
                  detected_competitors: response.detected_competitors,

                  confirmed_prompts: {
                    prompt_text: promptText,
                    prompt_category: `TalentX: ${attributeId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                    prompt_type: promptType.replace('talentx_', ''),
                    industry_context: response.confirmed_prompts.industry_context,
                    job_function_context: response.confirmed_prompts.job_function_context,
                    location_context: response.confirmed_prompts.location_context
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
      
      // Yield to the browser before the big state set so pending interactions
      // (clicks, scrolls) can be processed before the useMemo cascade fires.
      await new Promise(resolve => setTimeout(resolve, 0));

      setResponses(allResponses);

      // Set lastUpdated to the most recent response collection time
      let lastUpdatedDate: Date | undefined;
      if (allResponses.length > 0) {
        const mostRecentResponse = allResponses[0]; // Already sorted by updated_at desc
        lastUpdatedDate = new Date(mostRecentResponse.tested_at || mostRecentResponse.updated_at || mostRecentResponse.created_at);
        setLastUpdated(lastUpdatedDate);
      } else {
        setLastUpdated(undefined);
      }

      // Update company cache for instant restore when switching back
      if (currentCompany?.id && allResponses.length > 0) {
        companyDataCacheRef.current[currentCompany.id] = {
          responses: allResponses,
          lastUpdated: lastUpdatedDate,
          timestamp: Date.now()
        };
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

  const fetchResponseTexts = useCallback(async (ids: string[]) => {
    if (!ids.length) return {};

    const missing = ids.filter(id => !responseTexts[id]);
    if (!missing.length) return responseTexts;

    setResponseTextsLoading(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += 100) {
        chunks.push(missing.slice(i, i + 100));
      }

      const results = await Promise.all(
        chunks.map(chunk =>
          supabase
            .from('prompt_responses')
            .select('id, response_text')
            .in('id', chunk)
        )
      );

      const newTexts: Record<string, string> = {};
      results.forEach(({ data }) => {
        data?.forEach(row => {
          newTexts[row.id] = row.response_text;
        });
      });

      setResponseTexts(prev => ({ ...prev, ...newTexts }));
      return { ...responseTexts, ...newTexts };
    } finally {
      setResponseTextsLoading(false);
    }
  }, [responseTexts]);

  // Fetch company metrics from materialized views (backend-calculated)
  const fetchCompanyMetrics = useCallback(async () => {
    if (!user || !currentCompany?.id) return;
    
    try {
      setCompanyMetricsLoading(true);
      
      // Fetch sentiment and relevance metrics from materialized views
      // Get the most recent month with data (not just current month)
      // This handles cases where data is from previous months
      const [sentimentResult, relevanceResult] = await Promise.all([
        supabase
          .from('company_sentiment_scores_mv')
          .select('*')
          .eq('company_id', currentCompany.id)
          .order('response_month', { ascending: false })
          .limit(100), // Get all months, limit to prevent huge queries
        supabase
          .from('company_relevance_scores_mv')
          .select('*')
          .eq('company_id', currentCompany.id)
          .order('response_month', { ascending: false })
          .limit(100) // Get all months, limit to prevent huge queries
      ]);

      if (sentimentResult.error && sentimentResult.error.code !== 'PGRST116') {
        console.warn('Error fetching sentiment metrics from materialized view:', sentimentResult.error);
        // Don't throw - fallback to frontend calculation
      } else if (sentimentResult.data && sentimentResult.data.length > 0) {
        // Aggregate sentiment metrics across all prompt types/themes and months
        // Use the most recent month's data primarily, but aggregate all available months
        const aggregated = sentimentResult.data.reduce((acc, row) => {
          acc.totalThemes += row.total_themes || 0;
          acc.positiveThemes += row.positive_themes || 0;
          acc.negativeThemes += row.negative_themes || 0;
          acc.neutralThemes += row.neutral_themes || 0;
          acc.totalSentimentScore += (row.avg_sentiment_score || 0) * (row.total_themes || 0);
          acc.totalWeight += row.total_themes || 0;
          return acc;
        }, { 
          totalThemes: 0, 
          positiveThemes: 0, 
          negativeThemes: 0, 
          neutralThemes: 0,
          totalSentimentScore: 0,
          totalWeight: 0
        });

        const sentimentRatio = aggregated.totalThemes > 0
          ? aggregated.positiveThemes / aggregated.totalThemes
          : 0;
        
        const avgSentimentScore = aggregated.totalWeight > 0
          ? aggregated.totalSentimentScore / aggregated.totalWeight
          : 0;

        if (aggregated.totalThemes > 0) {
          setCompanySentimentMetrics({
            sentiment_ratio: sentimentRatio,
            avg_sentiment_score: avgSentimentScore,
            total_themes: aggregated.totalThemes,
            positive_themes: aggregated.positiveThemes,
            negative_themes: aggregated.negativeThemes,
            neutral_themes: aggregated.neutralThemes
          });
        } else {
          // Data exists but has no themes - fallback to frontend
          setCompanySentimentMetrics(null);
        }
      } else {
        // No data in materialized view - will use frontend calculation
        setCompanySentimentMetrics(null);
      }

      if (relevanceResult.error && relevanceResult.error.code !== 'PGRST116') {
        console.warn('Error fetching relevance metrics from materialized view:', relevanceResult.error);
        // Don't throw - fallback to frontend calculation
      } else if (relevanceResult.data && relevanceResult.data.length > 0) {
        // Aggregate relevance metrics across all prompt types/themes and months
        // Use the most recent month's data primarily, but aggregate all available months
        const aggregated = relevanceResult.data.reduce((acc, row) => {
          acc.totalCitations += row.total_citations || 0;
          acc.validCitations += row.valid_citations || 0;
          acc.totalRelevanceScore += (row.relevance_score || 0) * (row.valid_citations || 0);
          acc.totalWeight += row.valid_citations || 0;
          return acc;
        }, { 
          totalCitations: 0, 
          validCitations: 0, 
          totalRelevanceScore: 0, 
          totalWeight: 0
        });

        const avgRelevanceScore = aggregated.totalWeight > 0
          ? aggregated.totalRelevanceScore / aggregated.totalWeight
          : 0;

        if (aggregated.validCitations > 0) {
          setCompanyRelevanceMetrics({
            relevance_score: avgRelevanceScore,
            total_citations: aggregated.totalCitations,
            valid_citations: aggregated.validCitations
          });
        } else {
          // Data exists but has no valid citations - fallback to frontend
          setCompanyRelevanceMetrics(null);
        }
      } else {
        // No data in materialized view - will use frontend calculation
        setCompanyRelevanceMetrics(null);
      }
      
    } catch (error: any) {
      console.warn('Error fetching company metrics from materialized views:', error);
      // Don't set error state - fallback to frontend calculation
      setCompanySentimentMetrics(null);
      setCompanyRelevanceMetrics(null);
    } finally {
      setCompanyMetricsLoading(false);
    }
  }, [user, currentCompany?.id]);

  const fetchMVData = useCallback(async () => {
    if (!user || !currentCompany?.id) return;

    try {
      const [sourcesResult, competitorsResult, llmResult] = await Promise.all([
        supabase
          .from('company_top_sources')
          .select('domain, citation_count')
          .eq('company_id', currentCompany.id)
          .order('citation_count', { ascending: false })
          .limit(30),
        supabase
          .from('company_competitors')
          .select('competitor_name, mention_count')
          .eq('company_id', currentCompany.id)
          .order('mention_count', { ascending: false })
          .limit(30),
        supabase
          .from('company_llm_rankings')
          .select('ai_model, mentions')
          .eq('company_id', currentCompany.id)
          .order('mentions', { ascending: false }),
      ]);

      if (sourcesResult.data) {
        setMvTopCitations(
          sourcesResult.data.map(row => ({ domain: row.domain, count: row.citation_count }))
        );
      }

      if (competitorsResult.data) {
        setMvTopCompetitors(
          competitorsResult.data.map(row => ({ company: row.competitor_name, count: row.mention_count }))
        );
      }

      if (llmResult.data) {
        setMvLlmRankings(
          llmResult.data.map(row => ({
            model: row.ai_model,
            displayName: getLLMDisplayName(row.ai_model),
            mentions: row.mentions,
            logoUrl: getLLMLogo(row.ai_model),
          }))
        );
      }
    } catch (err) {
      console.warn('[fetchMVData] error — will fall back to frontend calculation:', err);
    }
  }, [user, currentCompany?.id]);

  const fetchRecencyData = useCallback(async () => {
    if (!user) return;
    
    try {
      // Clear any previous errors
      setRecencyDataError(null);
      setRecencyDataLoading(true);
      
      // Get all URLs from the user's citations first
      const allCitations = responses.flatMap(r => parseCitations(r.citations)).filter(c => c.url);
      const urls = allCitations.map(c => c.url);
      
      // Remove duplicates
      const uniqueUrls = [...new Set(urls)];
      
      if (uniqueUrls.length === 0) {
        setRecencyData([]);
        return;
      }
      
      // Use domain-based matching as primary method for better coverage
      // This matches any URL from the same domain, not requiring exact URL matches
      // Extract unique domains from ALL URLs (not limited to 100)
      const domains = [...new Set(uniqueUrls.map(url => {
        try {
          const hostname = new URL(url).hostname;
          // Normalize domain (remove www. prefix for better matching)
          return hostname.replace(/^www\./, '').toLowerCase();
        } catch {
          return null;
        }
      }).filter(Boolean))];
      
      // Use domain-based matching as primary method for better coverage
      // Process domains in parallel batches for faster fetching
      const domainBatchSize = 50; // Increased batch size for fewer requests
      const domainBatches: string[][] = [];
      for (let i = 0; i < domains.length; i += domainBatchSize) {
        domainBatches.push(domains.slice(i, i + domainBatchSize));
      }
      
      // Process all batches in parallel for much faster fetching
      const batchPromises = domainBatches.map(async (domainBatch, batchIndex) => {
        try {
          const { data: domainMatches, error: domainError } = await retrySupabaseQuery(() =>
            supabase
              .from('url_recency_cache')
              .select('url, recency_score, domain')
              .or(domainBatch.map(domain => `domain.eq.${domain}`).join(','))
              .not('recency_score', 'is', null)
              .limit(500) // Increased limit per batch
          ) as { data: any[] | null; error: any };
          
          if (domainError) {
            return [];
          }
          
          if (!domainMatches || domainMatches.length === 0) {
            return [];
          }
          
          // Filter to only include URLs that match our citation domains
          const domainSet = new Set(domainBatch);
          return domainMatches.filter(match => {
            const matchDomain = (match.domain || new URL(match.url).hostname)
              .replace(/^www\./, '')
              .toLowerCase();
            return domainSet.has(matchDomain);
          });
        } catch (error) {
          return [];
        }
      });
      
      // Wait for all batches to complete in parallel
      const batchResults = await Promise.all(batchPromises);
      
      // Combine results and deduplicate by URL
      const seenUrls = new Set<string>();
      const allDomainMatches: any[] = [];
      batchResults.forEach(batchResult => {
        batchResult.forEach(match => {
          if (!seenUrls.has(match.url)) {
            seenUrls.add(match.url);
            allDomainMatches.push(match);
          }
        });
      });
      
      // Cache the results
      const responseIdsHash = responses.map(r => r.id).sort().join(',');
      recencyDataCacheRef.current = {
        responseIdsHash,
        data: allDomainMatches
      };
      
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
  }, [user, responses]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAIThemes = useCallback(async () => {
    if (!user || !currentCompany?.id) {
      setAiThemes([]);
      setAiThemesLoading(false);
      return;
    }

    try {
      setAiThemesLoading(true);
      
      // OPTIMIZED: Single query using company_id (no batching, no waiting for responses)
      // This eliminates waterfall and batch processing overhead
      // company_id column exists on ai_themes table (from migration 20250201000000)
      const { data: themes, error: themesError } = await retrySupabaseQuery(() =>
        supabase
          .from('ai_themes')
          .select('*')
          .eq('company_id', currentCompany.id)
          .order('created_at', { ascending: false })
      ) as { data: any[] | null; error: any };

      if (themesError) {
        console.error('Error fetching AI themes:', themesError);
        setAiThemes([]);
        return;
      }
      
      // Store all themes - filtering by prompt_type happens in sentiment calculation
      // when responses are available
      setAiThemes(themes || []);
    } catch (error) {
      console.error('Error in fetchAIThemes:', error);
      setAiThemes([]);
    } finally {
      setAiThemesLoading(false);
    }
  }, [user, currentCompany?.id]);

  // Memoized cache of sentiment calculations per response ID
  // OPTIMIZED: Only recalculates when themes change, not on every render
  // This prevents expensive calculations on every render
  const [sentimentCacheState, setSentimentCacheState] = useState<Map<string, { sentiment_score: number; sentiment_label: string }>>(new Map());
  
  // Calculate sentiment cache only when themes change (debounced)
  useEffect(() => {
    if (aiThemes.length === 0 && responses.length === 0) {
      setSentimentCacheState(new Map());
      return;
    }
    
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
      const totalThemes = responseThemes.length;
      
      if (totalThemes === 0) {
        cache.set(responseId, { sentiment_score: 0, sentiment_label: 'neutral' });
        return;
      }
      
      const positiveThemes = responseThemes.filter(theme => theme.sentiment === 'positive').length;
      
      // Sentiment score: positive themes / total themes (0-1 scale)
      const sentimentRatio = positiveThemes / totalThemes;
      const sentimentLabel = sentimentRatio > 0.6 ? 'positive' : sentimentRatio < 0.4 ? 'negative' : 'neutral';
      
      cache.set(responseId, { 
        sentiment_score: sentimentRatio, 
        sentiment_label: sentimentLabel 
      });
    });
    
    setSentimentCacheState(cache);
  }, [aiThemes, responses]);
  
  // Use state-based cache instead of useMemo (prevents recalculation on every render)
  const sentimentCache = sentimentCacheState;

  // Helper function to calculate AI-based sentiment for a response
  // Uses the state-based cache for O(1) lookup (calculated only when themes change)
  const calculateAIBasedSentiment = useCallback((responseId: string) => {
    // Check cache first
    const cached = sentimentCacheState.get(responseId);
    if (cached) {
      return cached;
    }
    
    // No AI themes available for this response - return neutral sentiment
    return {
      sentiment_score: 0,
      sentiment_label: 'neutral'
    };
  }, [sentimentCacheState]);

  const aiThemeByResponseId = useMemo(() => {
    const map = new Map<string, any>();
    aiThemes.forEach(theme => {
      if (!map.has(theme.response_id)) {
        map.set(theme.response_id, theme);
      }
    });
    return map;
  }, [aiThemes]);

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

  // Data freshness is handled on the backend (materialized views / cron jobs).
  // No automatic frontend polling — users can manually refresh via the UI button.

  // Data freshness is managed by backend materialized views and cron jobs.
  // Users can trigger manual refresh via the UI button (setShouldRefetch).
  // The previous 3-second polling loop was re-triggering full data fetches during
  // initial load, causing cascading state updates and 15+ redundant network requests.

  // Add refs to track initial loading state
  const hasInitiallyLoadedRef = useRef(false);
  const currentCompanyIdRef = useRef(currentCompany?.id);
  // Track if we've fetched for this specific company/user combination
  const fetchedCompanyUserKeyRef = useRef<string | null>(null);
  const [shouldRefetch, setShouldRefetch] = useState(false);
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false);

  // Debounce timer ref for rapid company switching
  const switchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update the ref when company changes — debounced to handle rapid switching
  useEffect(() => {
    if (currentCompany?.id !== currentCompanyIdRef.current && currentCompany?.id !== undefined) {
      // Clear any pending debounced switch
      if (switchDebounceRef.current) {
        clearTimeout(switchDebounceRef.current);
      }

      // Set switching flag immediately for UI feedback
      setIsSwitchingCompany(true);

      // Debounce the expensive state clearing + cache operations
      switchDebounceRef.current = setTimeout(() => {
        const previousCompanyId = currentCompanyIdRef.current;
        // Save current company's data to cache before clearing (for instant restore when switching back)
        if (previousCompanyId && responses.length > 0) {
          companyDataCacheRef.current[previousCompanyId] = {
            responses,
            lastUpdated: lastUpdated,
            timestamp: Date.now()
          };
        }
        currentCompanyIdRef.current = currentCompany?.id;

        // Clear all data when switching companies
        setResponses([]);
        setResponseTexts({});
        setAiThemes([]);
        setSearchResults([]);
        setSearchTermsData([]);
        setTalentXProData([]);
        setTalentXProPrompts([]);
        setRecencyData([]);
        setLastUpdated(undefined);
        setMvTopCitations([]);
        setMvTopCompetitors([]);
        setMvLlmRankings([]);

        // Clear search results cache when switching companies
        searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
        // Clear recency data cache when switching companies
        recencyDataCacheRef.current = null;

        // Reset the fetched key so new data will be loaded
        fetchedCompanyUserKeyRef.current = null;
      }, 150);
    }
    return () => {
      if (switchDebounceRef.current) {
        clearTimeout(switchDebounceRef.current);
      }
    };
  }, [currentCompany?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omit responses/lastUpdated to avoid saving on every response change
  
  // Initial data fetch - only run when user or company ID actually changes, or when shouldRefetch is true
  // CRITICAL: Prevent refetch when returning to tab by tracking what we've already loaded
  useEffect(() => {
    if (user?.id && currentCompany?.id) {
      const currentKey = `${user.id}-${currentCompany.id}`;
      const companyId = currentCompany.id;

      // Only fetch if:
      // 1. This is a new company/user combination, OR
      // 2. shouldRefetch is explicitly set to true (user clicked Refresh)
      const isExplicitRefresh = shouldRefetch;
      if (fetchedCompanyUserKeyRef.current !== currentKey || isExplicitRefresh) {
        fetchedCompanyUserKeyRef.current = currentKey;
        hasInitiallyLoadedRef.current = true;
        setShouldRefetch(false); // Reset the refetch flag

        // On explicit refresh: skip cache and clear caches so we get fresh data
        if (isExplicitRefresh) {
          delete companyDataCacheRef.current[companyId];
          recencyDataCacheRef.current = null;
          previousResponseIdsRef.current = '';
        } else {
          // Restore from cache if available (instant UI when switching back to recently viewed company)
          const cached = companyDataCacheRef.current[companyId];
          if (cached && (Date.now() - cached.timestamp) < COMPANY_CACHE_TTL && cached.responses.length > 0) {
            setResponses(cached.responses);
            setLastUpdated(cached.lastUpdated);
            setLoading(false);
            setCompetitorLoading(false);
            setIsSwitchingCompany(false);
          }
        }

        // Always fetch fresh data (in background if cache was used)
        setCompanyName(currentCompany.name || '');
        Promise.all([
          fetchMVData(),
          fetchCompanyMetrics(),
          fetchResponses(),
          // On explicit refresh, also refetch AI themes and clear search cache
          ...(isExplicitRefresh ? [fetchAIThemes()] : []),
        ]);
        if (isPro) {
          fetchTalentXProData();
          if (isExplicitRefresh) {
            searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
          }
        }
      }
    } else {
      // Reset when user/company becomes null
      fetchedCompanyUserKeyRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id, isPro, shouldRefetch]);

  // Clear switching flag when data is actually loaded
  useEffect(() => {
    if (isSwitchingCompany && (responses.length > 0 || searchResults.length > 0)) {
      setIsSwitchingCompany(false);
    }
  }, [isSwitchingCompany, responses.length, searchResults.length]);

  // Reset pagination when company changes
  useEffect(() => {
    setLoadAllResponses(false);
    setHasMoreResponses(false);
  }, [currentCompany?.id]);

  // Clear company metrics when company becomes null
  useEffect(() => {
    if (!currentCompany?.id || !user?.id) {
      setCompanySentimentMetrics(null);
      setCompanyRelevanceMetrics(null);
    }
  }, [currentCompany?.id, user?.id]);

  // Fetch recency data when responses change (with caching to avoid unnecessary refetches)
  useEffect(() => {
    if (responses.length === 0) {
      setRecencyData([]);
      recencyDataCacheRef.current = null;
      previousResponseIdsRef.current = '';
      return;
    }
    
    // Create a hash of response IDs to detect if responses actually changed
    const responseIdsHash = responses.map(r => r.id).sort().join(',');
    
    // Only fetch if responses actually changed (not just on every render)
    if (previousResponseIdsRef.current !== responseIdsHash) {
      previousResponseIdsRef.current = responseIdsHash;
      
      // Recency data is now provided by the company_relevance_scores materialized view
      // (fetched via fetchCompanyMetrics). The old fetchRecencyData fired 15+ parallel
      // requests to url_recency_cache on every load — disabled to eliminate main-thread
      // contention and reduce INP.
      if (recencyDataCacheRef.current && recencyDataCacheRef.current.responseIdsHash === responseIdsHash) {
        setRecencyData(recencyDataCacheRef.current.data);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses.length]); // Only depend on responses length - fetch immediately

  // Fetch AI themes immediately when company changes (PARALLEL with responses)
  // Don't wait for responses to load - fetch directly from database using company_id
  // This eliminates waterfall and makes themes load in parallel with responses
  useEffect(() => {
    if (user && currentCompany?.id) {
      // Fetch themes immediately in parallel with responses
      // No need to wait for responses state - fetch directly from DB
      fetchAIThemes();
    } else {
      setAiThemes([]);
      setAiThemesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id]); // Fetch when company changes, not when responses load

  // Track when metrics are ready
  // Backend metrics (from materialized views) are available immediately
  // Frontend metrics calculation can happen in background - don't block UI
  useEffect(() => {
    if (loading) {
      setMetricsLoading(true);
    } else {
      // Metrics are ready as soon as responses load
      // Backend metrics are already available from materialized views
      // Frontend calculation (themes/recency) can update in background
      setMetricsLoading(false);
    }
  }, [loading]);

  // Comprehensive loading state that includes all critical data
  // Don't wait for recency/themes - backend metrics are available immediately
  // Let recency/themes load in background and update when ready
  const isFullyLoaded = useMemo(() => {
    // Dashboard is ready as soon as responses load
    // Backend metrics (from materialized views) are available immediately
    // Recency/themes can load in background without blocking UI
    return !loading && !metricsLoading && !competitorLoading;
  }, [loading, metricsLoading, competitorLoading]);

  // Fetch search results when company is available
  useEffect(() => {
    if (user && isPro && currentCompany) {
      fetchSearchResults();
    }
  }, [user?.id, isPro, currentCompany?.id]); // Only depend on IDs, not the function

  const refreshData = useCallback(async () => {
    searchResultsCache.current = { companyId: null, timestamp: 0, data: [] };
    setShouldRefetch(true);
  }, []);

  // Function to load all historical responses (for complete trend analysis)
  const loadAllHistoricalResponses = useCallback(async () => {
    setLoadAllResponses(true);
    // Trigger refetch - fetchResponses will check loadAllResponses flag
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

  const parsedCitationsMap = useMemo(() => {
    const map = new Map<string, Citation[]>();
    responses.forEach(r => {
      map.set(r.id, parseCitations(r.citations));
    });
    return map;
  }, [responses, parseCitations]);

  const getCitations = useCallback((responseId: string): Citation[] => {
    return parsedCitationsMap.get(responseId) || [];
  }, [parsedCitationsMap]);

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
              (r.confirmed_prompts as any)?.talentx_attribute_id === prompt.talentx_attribute_id
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
        if (response.confirmed_prompts?.prompt_type === 'discovery' || response.confirmed_prompts?.prompt_type === 'talentx_discovery') {
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
        }
      } else {
        const promptCategoryValue = response.confirmed_prompts?.prompt_category || 'General';
        const promptThemeValue = response.confirmed_prompts?.prompt_theme || 'General';
        acc.push({
          prompt: promptKey || '',
          category: promptThemeValue,
          type: response.confirmed_prompts?.prompt_type || 'experience',
          industryContext: response.confirmed_prompts?.industry_context || undefined,
          jobFunctionContext: response.confirmed_prompts?.job_function_context || undefined,
          locationContext: response.confirmed_prompts?.location_context || undefined,
          promptCategory: promptCategoryValue,
          promptTheme: promptThemeValue,
          responses: 1,
          avgSentiment: aiSentiment.sentiment_score,
          sentimentLabel: aiSentiment.sentiment_label,
          mentionRanking: undefined,
          competitivePosition: undefined,
          detectedCompetitors: response.detected_competitors || undefined,
          averageVisibility: (response.confirmed_prompts?.prompt_type === 'discovery' || response.confirmed_prompts?.prompt_type === 'talentx_discovery') ? (response.company_mentioned ? 100 : 0) : undefined,
          visibilityScores: visibilityScore !== undefined ? [visibilityScore] : [],
          isTalentXPrompt: isTalentXResponse,
          talentXAttributeId: (response.confirmed_prompts as any)?.talentx_attribute_id,
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
          type: prompt.prompt_type || 'experience',
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
          averageVisibility: (prompt.prompt_type === 'discovery') ? 0 : undefined,
          totalWords: undefined,
          firstMentionPosition: undefined,
          visibilityScores: [],
        });
      }
    });
    
    return promptsWithActive;
  }, [responses, talentXProPrompts, calculateAIBasedSentiment, activePrompts]);

  // Track when metrics calculation is complete (all data loaded)
  // Don't show anything until sentiment loads - this ensures all metrics appear together
  // CRITICAL: Only show metrics when data is ACTUALLY ready and calculated
  useEffect(() => {
    // Metrics are ready when:
    // 1. Responses are loaded (needed for visibility calculation)
    // 2. Backend metrics query is complete
    // 3. SENTIMENT is ready (backend metrics exist OR themes fetch completed AND themes are set)
    // 4. Relevance is ready (backend metrics exist OR recency fetch completed AND recency is set)
    const responsesReady = !loading && responses.length > 0;
    const backendMetricsReady = !companyMetricsLoading;
    
    // Check what we have for each metric
    const hasBackendSentiment = companySentimentMetrics !== null;
    const hasBackendRelevance = companyRelevanceMetrics !== null;
    
    // Sentiment is ready if:
    // - Backend metrics exist (has data), OR
    // - Frontend fallback: themes fetch completed (not loading) AND themes have been set (even if empty array)
    //   We check aiThemes.length !== undefined to ensure setAiThemes() was called
    const themesFetchCompleted = !aiThemesLoading && (aiThemes.length >= 0 || hasBackendSentiment);
    const sentimentReady = hasBackendSentiment || themesFetchCompleted;
    
    // Relevance is ready if:
    // - Backend metrics exist (has data), OR
    // - Frontend fallback: recency fetch completed (not loading) AND recency has been set (even if empty array)
    const recencyFetchCompleted = !recencyDataLoading && (recencyData.length >= 0 || hasBackendRelevance);
    const relevanceReady = hasBackendRelevance || recencyFetchCompleted;
    
    // CRITICAL: Don't show anything until sentiment is ready
    // All metrics ready when responses are loaded, backend query complete, AND sentiment/relevance are ready
    const allReady = responsesReady && backendMetricsReady && sentimentReady && relevanceReady;
    setMetricsCalculating(!allReady);
    
  }, [loading, responses.length, companyMetricsLoading, companySentimentMetrics, companyRelevanceMetrics, aiThemesLoading, recencyDataLoading, aiThemes.length, recencyData.length]);

  const metrics: DashboardMetrics = useMemo(() => {
    // PREFER backend-calculated metrics from materialized views if available
    // Fallback to frontend calculation if backend data is not available
    
    // Don't calculate if still loading AND we don't have backend metrics
    // If backend metrics exist, we can use them even if responses aren't fully loaded yet
    if ((loading || responses.length === 0) && !companySentimentMetrics && !companyRelevanceMetrics) {
      return {
        averageSentiment: 0,
        sentimentLabel: 'Neutral',
        sentimentTrendComparison: { value: 0, direction: 'neutral' as const },
        visibilityTrendComparison: { value: 0, direction: 'neutral' as const },
        citationsTrendComparison: { value: 0, direction: 'neutral' as const },
        totalCitations: 0,
        uniqueDomains: 0,
        totalResponses: 0,
        averageVisibility: 0,
        averageRelevance: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        perceptionScore: 0,
        perceptionLabel: 'No Data'
      };
    }
    
    let averageSentiment = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;

    // Use backend-calculated sentiment if available
    if (companySentimentMetrics) {
      averageSentiment = companySentimentMetrics.sentiment_ratio || 0;
      
      // Ensure averageSentiment is set correctly (defensive check)
      if (averageSentiment === 0 && companySentimentMetrics.sentiment_ratio > 0) {
        averageSentiment = companySentimentMetrics.sentiment_ratio;
      }
      
      // If backend returns 0 but we have themes, check if frontend calculation gives different result
      // This handles cases where materialized view is stale or calculation differs
      if (averageSentiment === 0 && aiThemes.length > 0 && responses.length > 0) {
        const relevantResponses = responses.filter(response => {
          const promptType = response.confirmed_prompts?.prompt_type;
          return promptType === 'experience' ||
                 promptType === 'competitive' ||
                 promptType === 'talentx_experience' ||
                 promptType === 'talentx_competitive';
        });
        
        if (relevantResponses.length > 0) {
          const companyResponseIds = new Set(relevantResponses.map(r => r.id));
          const companyThemes = aiThemes.filter(theme => companyResponseIds.has(theme.response_id));
          const positiveThemes = companyThemes.filter(theme => theme.sentiment === 'positive').length;
          const totalThemes = companyThemes.length;
          
          if (totalThemes > 0) {
            // Use frontend calculation if backend returned 0 but themes exist
            // This handles cases where materialized view is stale
            averageSentiment = positiveThemes / totalThemes;
          }
        }
      }
      // Estimate counts based on ratios (for display purposes)
      const totalResponses = responses.length;
      if (companySentimentMetrics.total_themes > 0) {
        const positiveRatio = companySentimentMetrics.positive_themes / companySentimentMetrics.total_themes;
        const negativeRatio = companySentimentMetrics.negative_themes / companySentimentMetrics.total_themes;
        const neutralRatio = companySentimentMetrics.neutral_themes / companySentimentMetrics.total_themes;
        
        positiveCount = Math.round(totalResponses * positiveRatio);
        negativeCount = Math.round(totalResponses * negativeRatio);
        neutralCount = totalResponses - positiveCount - negativeCount;
      } else {
        neutralCount = totalResponses;
      }
    } else {
      // Fallback to frontend calculation
      const relevantResponses = responses.filter(response => {
        const promptType = response.confirmed_prompts?.prompt_type;
        return promptType === 'experience' ||
               promptType === 'competitive' ||
               promptType === 'talentx_experience' ||
               promptType === 'talentx_competitive';
      });

      // Only calculate if we have both themes AND responses loaded
      // This prevents calculation when themes load before responses (parallel fetching)
      if (aiThemes.length > 0 && relevantResponses.length > 0 && !loading) {
        // Use AI themes for sentiment calculation
        // Calculate overall positive ratio directly from all themes (not averaged across responses)
        const companyResponseIds = new Set(relevantResponses.map(r => r.id));
        const companyThemes = aiThemes.filter(theme => companyResponseIds.has(theme.response_id));
        
        const positiveThemes = companyThemes.filter(theme => theme.sentiment === 'positive').length;
        const totalThemes = companyThemes.length;
        
        // Calculate overall positive ratio (0-1 scale): positive themes / total themes
        averageSentiment = totalThemes > 0 
          ? positiveThemes / totalThemes 
          : 0;

        // Calculate sentiment counts based on AI themes (ratio-based)
        const responseSentiments = relevantResponses.map(response => {
          return calculateAIBasedSentiment(response.id);
        });
        positiveCount = responseSentiments.filter(s => s.sentiment_score > 0.6).length;
        neutralCount = responseSentiments.filter(s => s.sentiment_score >= 0.4 && s.sentiment_score <= 0.6).length;
        negativeCount = responseSentiments.filter(s => s.sentiment_score < 0.4).length;
      } else {
        // No AI themes available - check if still loading or truly empty
        if (aiThemesLoading) {
          // Still loading - return 0 temporarily, will update when themes load
          averageSentiment = 0;
          positiveCount = 0;
          neutralCount = 0;
          negativeCount = 0;
        } else if (relevantResponses.length === 0) {
          // No relevant responses (only discovery prompts) - neutral sentiment
          averageSentiment = 0;
          positiveCount = 0;
          neutralCount = responses.length;
          negativeCount = 0;
        } else {
          // Has relevant responses but no themes - neutral sentiment
          averageSentiment = 0;
          positiveCount = 0;
          neutralCount = responses.length;
          negativeCount = 0;
        }
      }
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
        const currentCitationsTotal = currentResponses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
        const previousCitationsTotal = previousResponses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
        const previousCitationsAvg = previousCitationsTotal / numPreviousDays;
        const citationsChange = currentCitationsTotal - previousCitationsAvg;
        citationsTrendComparison = {
          value: Math.abs(Math.round(citationsChange)),
          direction: citationsChange > 0.1 ? 'up' : citationsChange < -0.1 ? 'down' : 'neutral'
        };
      }
    }

    const totalCitations = responses.reduce((sum, r) => sum + getCitations(r.id).length, 0);
    const uniqueDomains = new Set(
      responses.flatMap(r => getCitations(r.id).map((c: Citation) => c.domain).filter(Boolean))
    ).size;

    // Calculate average visibility as the percentage of responses where company_mentioned is TRUE
    const mentionedCount = responses.filter(r => r.company_mentioned === true).length;
    const averageVisibility = responses.length > 0
      ? (mentionedCount / responses.length) * 100
      : 0;

    const averageRelevance = companyRelevanceMetrics?.relevance_score ?? 0;

    // Calculate overall perception score
    const calculatePerceptionScore = () => {
      if (responses.length === 0) return { score: 0, label: 'No Data', sentimentScore: 0, visibilityScore: 0, relevanceScore: 0 };

      const sentimentScore = Math.round(Math.max(0, Math.min(100, averageSentiment * 100)));
      const visibilityScore = Math.round(averageVisibility);
      const relevanceScore = Math.round(averageRelevance);

      // Weighted formula: 50% sentiment + 30% visibility + 20% relevance
      const perceptionScore = Math.round(
        (sentimentScore * 0.5) + 
        (visibilityScore * 0.3) + 
        (relevanceScore * 0.2)
      );

      let perceptionLabel = 'Poor';
      if (perceptionScore >= 80) perceptionLabel = 'Excellent';
      else if (perceptionScore >= 65) perceptionLabel = 'Good';
      else if (perceptionScore >= 50) perceptionLabel = 'Fair';
      else if (perceptionScore >= 30) perceptionLabel = 'Poor';

      return { score: perceptionScore, label: perceptionLabel, sentimentScore, visibilityScore, relevanceScore };
    };

    const { score: perceptionScore, label: perceptionLabel, sentimentScore, visibilityScore, relevanceScore } = calculatePerceptionScore();

    const metricsResult = {
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
      perceptionLabel,
      sentimentScore,
      visibilityScore,
      relevanceScore
    };
    
    return metricsResult;
  }, [responses, promptsData, aiThemes, calculateAIBasedSentiment, companySentimentMetrics, companyRelevanceMetrics, getCitations]);

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
    if (!currentCompany?.id || isSwitchingCompany) return [];

    // Start with MV data (AI citations, pre-aggregated on the backend)
    const combined: Record<string, number> = {};
    mvTopCitations.forEach(c => {
      combined[c.domain] = (combined[c.domain] || 0) + c.count;
    });

    // Merge in search result citations (already cached, lightweight)
    const currentCompanySearchResults = searchResults.filter(r => r.company_id === currentCompany.id);
    currentCompanySearchResults.forEach(result => {
      const domain = result.domain;
      if (domain) {
        combined[domain] = (combined[domain] || 0) + (result.mentionCount || 1);
      }
    });

    // Fallback: if MV hasn't populated yet, compute from responses (same logic as before)
    if (mvTopCitations.length === 0 && responses.length > 0) {
      const currentCompanyResponses = responses.filter(r => r.company_id === currentCompany.id);
      const allCitations = currentCompanyResponses.flatMap(r => enhanceCitations(getCitations(r.id)));
      const websiteCitations = allCitations.filter(citation => citation.type === 'website' && citation.url);
      websiteCitations.forEach((citation: EnhancedCitation) => {
        const domain = citation.domain;
        if (domain) {
          combined[domain] = (combined[domain] || 0) + 1;
        }
      });
    }

    return Object.entries(combined)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  }, [mvTopCitations, searchResults, responses, currentCompany?.id, isSwitchingCompany, getCitations]);

  const preparePromptData = (prompts: any[], responses: any[]): PromptData[] => {
    return prompts.map(prompt => {
      const promptResponses = responses.filter(r => r.confirmed_prompt_id === prompt.id);
      const totalResponses = promptResponses.length;

      const sentiments = promptResponses.map(r => calculateAIBasedSentiment(r.id));
      const avgSentiment = totalResponses > 0
        ? sentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / totalResponses
        : 0;
      const sentimentLabel = avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'neutral';

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
        mentionRanking: undefined,
        competitivePosition: undefined,
        detectedCompetitors: promptResponses[0]?.detected_competitors,
        averageVisibility
      };
    });
  };

  const prepareTalentXPromptData = (responses: any[]): PromptData[] => {
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

      const sentiments = promptResponses.map(r => calculateAIBasedSentiment(r.id));
      const avgSentiment = totalResponses > 0
        ? sentiments.reduce((sum, s) => sum + s.sentiment_score, 0) / totalResponses
        : 0;
      const sentimentLabel = avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'neutral';

      const firstResponse = promptResponses[0];
      const mentionedCount = promptResponses.filter(r => r.company_mentioned === true).length;
      const averageVisibility = totalResponses > 0 ? (mentionedCount / totalResponses) * 100 : undefined;
      
      return {
        prompt: promptText,
        category: firstResponse.confirmed_prompts.prompt_category,
        type: firstResponse.confirmed_prompts.prompt_type,
        responses: totalResponses,
        avgSentiment,
        sentimentLabel,
        mentionRanking: undefined,
        competitivePosition: undefined,
        detectedCompetitors: firstResponse.detected_competitors,
        averageVisibility,
        isTalentXPrompt: true,
        talentXAttributeId: firstResponse.confirmed_prompts?.talentx_attribute_id,
        talentXPromptType: firstResponse.confirmed_prompts.prompt_type.replace('talentx_', '')
      };
    });
  };

  const topCompetitors = useMemo(() => {
    if (!companyName || isSwitchingCompany) return [];

    // Start with MV data (AI responses, pre-aggregated on the backend)
    const combined: Record<string, number> = {};
    mvTopCompetitors.forEach(c => {
      combined[c.company] = (combined[c.company] || 0) + c.count;
    });

    // Merge in search result competitors (already cached, lightweight)
    searchResults.forEach(result => {
      if (result.detectedCompetitors && result.detectedCompetitors.trim()) {
        const validCompetitors = parseCompetitors(result.detectedCompetitors, companyName);
        validCompetitors.forEach(competitor => {
          const weight = result.mentionCount || 1;
          combined[competitor] = (combined[competitor] || 0) + weight;
        });
      }
    });

    // Fallback: if MV hasn't populated yet, compute from responses
    if (mvTopCompetitors.length === 0 && responses.length > 0 && !loading) {
      responses.forEach(response => {
        if (response.detected_competitors) {
          const validCompetitors = parseCompetitors(response.detected_competitors, companyName);
          validCompetitors.forEach(competitor => {
            combined[competitor] = (combined[competitor] || 0) + 1;
          });
        }
      });
    }

    return Object.entries(combined)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [mvTopCompetitors, searchResults, responses, companyName, loading, isSwitchingCompany]);

  const llmMentionRankings = useMemo(() => {
    // Use MV data if available; fall back to responses when MV hasn't refreshed yet
    if (mvLlmRankings.length > 0) return mvLlmRankings;

    if (!responses.length) return [];
    const modelMentions: Record<string, number> = {};
    responses.forEach(response => {
      if (response.company_mentioned) {
        modelMentions[response.ai_model] = (modelMentions[response.ai_model] || 0) + 1;
      }
    });
    return Object.entries(modelMentions)
      .map(([model, mentions]) => ({
        model,
        displayName: getLLMDisplayName(model),
        mentions,
        logoUrl: getLLMLogo(model),
      }))
      .sort((a, b) => b.mentions - a.mentions);
  }, [mvLlmRankings, responses]);

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
          id,
          confirmed_prompt_id,
          company_id,
          ai_model,
          tested_at,
          created_at,
          updated_at,
          company_mentioned,
          detected_competitors,
          citations,
          for_index,
          index_period,
          confirmed_prompts(
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
    getCitations,
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
    companySentimentMetrics, // Backend-calculated sentiment metrics from materialized view
    companyRelevanceMetrics, // Backend-calculated relevance metrics from materialized view
    companyMetricsLoading, // Loading state for company metrics
    aiThemesLoading, // Loading state for AI themes
    hasMoreResponses, // Whether there are more responses to load
    loadAllHistoricalResponses, // Function to load all historical responses
    metricsCalculating, // Whether metrics are still being calculated (for UX - show all together)
    fetchMVData, // Refresh materialized-view-backed data (sources, competitors, LLM rankings)
    responseTexts,
    responseTextsLoading,
    fetchResponseTexts,
  };
};
