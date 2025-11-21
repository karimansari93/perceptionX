import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ExternalLink, TrendingUp, Calendar, Globe, Lock, BarChart3 } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradeModal } from "@/components/upgrade/UpgradeModal";
import { supabase } from "@/integrations/supabase/client";
import { Favicon } from "@/components/ui/favicon";
import { useCompany } from "@/contexts/CompanyContext";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Media type colors and labels
const MEDIA_TYPE_COLORS = {
  owned: 'bg-green-100 text-green-800 border-green-200',
  influenced: 'bg-blue-100 text-blue-800 border-blue-200',
  organic: 'bg-gray-100 text-gray-800 border-gray-200',
  competitive: 'bg-red-100 text-red-800 border-red-200',
  irrelevant: 'bg-yellow-100 text-yellow-800 border-yellow-200'
};

const MEDIA_TYPE_LABELS = {
  owned: 'Owned',
  influenced: 'Influenced',
  organic: 'Organic',
  competitive: 'Competitive',
  irrelevant: 'Irrelevant'
};

interface SearchResult {
  id: string;
  title: string;
  link: string;
  snippet: string;
  position: number;
  domain: string;
  monthlySearchVolume?: number;
  mediaType?: 'owned' | 'influenced' | 'organic' | 'competitive' | 'irrelevant';
  companyMentioned?: boolean;
  detectedCompetitors?: string;
  relatedSearches?: string[];
  date: string;
  searchTerm?: string;
  mentionCount?: number;
  searchTermsCount?: number;
  allSearchTerms?: string;
}

interface SearchTermData {
  term: string;
  monthlyVolume: number;
  resultsCount: number;
}

interface SearchTabProps {
  companyName?: string;
  activeTab: 'terms' | 'results';
  setActiveTab: (tab: 'terms' | 'results') => void;
  searchResults: any[];
  searchTermsData: any[];
  setSearchTermsData?: (data: any[]) => void;
}

export const SearchTab = ({ 
  companyName, 
  activeTab, 
  setActiveTab, 
  searchResults: propSearchResults, 
  searchTermsData: propSearchTermsData
}: SearchTabProps) => {
  const { isPro } = useSubscription();
  const { currentCompany } = useCompany();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>(propSearchResults);
  const [searchTermsData, setSearchTermsData] = useState<SearchTermData[]>(propSearchTermsData);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [storedSearchData, setStoredSearchData] = useState<any>(null);

  // Initialize search term when company name is available
  useEffect(() => {
    if (currentCompany?.name && !searchTerm) {
      setSearchTerm(`${currentCompany.name} careers`);
    }
  }, [currentCompany?.name, searchTerm]);

  // Load stored search data when component mounts or company name changes
  // DISABLED: Search data is now provided via props from useDashboardData hook
  // useEffect(() => {
  //   if (currentCompany?.id) {
  //     loadStoredSearchData();
  //   }
  // }, [currentCompany?.id]);

  // Load stored search insights data
  const loadStoredSearchData = async () => {
    // Allow free users to load basic stored data
    
    try {
      // Get the most recent search session for this company
      let { data: sessionData, error: sessionError } = await supabase
        .from('search_insights_sessions')
        .select(`
          id,
          company_name,
          company_id,
          initial_search_term,
          total_results,
          total_related_terms,
          total_volume,
          keywords_everywhere_available,
          created_at
        `)
        .eq('company_id', currentCompany?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      // If no session found by company_id, try by company_name (for older data)
      if (!sessionData || sessionData.length === 0) {
        const { data: sessionDataByName, error: sessionErrorByName } = await supabase
          .from('search_insights_sessions')
          .select(`
            id,
            company_name,
            company_id,
            initial_search_term,
            total_results,
            total_related_terms,
            total_volume,
            keywords_everywhere_available,
            created_at
          `)
          .eq('company_name', currentCompany?.name)
          .order('created_at', { ascending: false })
          .limit(1);
        
        sessionData = sessionDataByName;
        sessionError = sessionErrorByName;
      }

      if (sessionError) {
        console.error('❌ Error fetching search session:', sessionError);
        return;
      }

      // Get the first (and only) result if any exist
      const session = sessionData && sessionData.length > 0 ? sessionData[0] : null;

      if (!session) {
        return;
      }

      // Get search results for this session
      const { data: resultsData, error: resultsError } = await supabase
        .from('search_insights_results')
        .select('*')
        .eq('session_id', session.id)
        .order('position', { ascending: true });

      if (resultsError) {
        console.error('❌ Error fetching search results:', resultsError);
      }

      // Get search terms for this session
      const { data: termsData, error: termsError } = await supabase
        .from('search_insights_terms')
        .select('*')
        .eq('session_id', session.id)
        .order('monthly_volume', { ascending: false });

      if (termsError) {
        console.error('❌ Error fetching search terms:', termsError);
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
      const processedResults: SearchResult[] = Array.from(urlMap.values())
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

      const processedTermsData: SearchTermData[] = (termsData || []).map(term => ({
        term: term.term,
        monthlyVolume: term.monthly_volume,
        resultsCount: term.results_count
      }));

      // Set the stored data
      setStoredSearchData({
        session: session,
        results: processedResults,
        terms: processedTermsData
      });

      // Also set the current search results and terms data for display
      setSearchResults(processedResults);
      setSearchTermsData(processedTermsData);
      setSearchTerm(session.initial_search_term);

    } catch (error) {
      console.error('❌ Error loading stored search data:', error);
    }
  };

  // Sync local state with props when they change
  useEffect(() => {
    setSearchResults(propSearchResults);
  }, [propSearchResults]);

  useEffect(() => {
    setSearchTermsData(propSearchTermsData);
  }, [propSearchTermsData]);

  const handleStartSearch = async () => {
    if (!currentCompany?.name) {
      console.error('❌ No company name provided for search');
      return;
    }

    setIsLoading(true);
    try {
      // Call the search insights function with combined search
      const { data, error } = await supabase.functions.invoke('search-insights', {
        body: {
          companyName: currentCompany.name,
          company_id: currentCompany.id
        }
      });

      if (error) {
        console.error('❌ Search insights error:', error);
        throw new Error(error.message || 'Failed to fetch search insights');
      }

        setSearchResults(data?.results || []);
        setDebugInfo(data?.debug || null);
        
        // Process search terms data for ranking
        if (data?.results) {
          const termMap = new Map<string, { volume: number; count: number }>();
          
          data.results.forEach((result: SearchResult) => {
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
          
          const termsData: SearchTermData[] = Array.from(termMap.entries())
            .map(([term, data]) => ({
              term,
              monthlyVolume: data.volume,
              resultsCount: data.count
            }))
            .sort((a, b) => b.monthlyVolume - a.monthlyVolume);
          
          setSearchTermsData(termsData);
        }
      
      // Refresh stored search data after successful search
      await loadStoredSearchData();
    } catch (error) {
      console.error('Error fetching search insights:', error);
      // Show placeholder data
      setSearchResults([
        {
          id: '1',
          title: `${currentCompany?.name} Careers - Join Our Team`,
          link: `https://www.${currentCompany?.name?.toLowerCase()}.com/careers`,
          snippet: `Discover exciting career opportunities at ${currentCompany?.name}. We're looking for talented individuals to join our growing team.`,
          position: 1,
          domain: `${currentCompany?.name?.toLowerCase()}.com`,
          monthlySearchVolume: 1000,
          relatedSearches: [`${currentCompany?.name} jobs`, `${currentCompany?.name} careers salary`, `${currentCompany?.name} careers for freshers`],
          date: new Date().toISOString()
        }
      ]);
      
      setSearchTermsData([
        { term: `${currentCompany?.name} careers`, monthlyVolume: 1000, resultsCount: 1 },
        { term: `${currentCompany?.name} jobs`, monthlyVolume: 800, resultsCount: 1 },
        { term: `${currentCompany?.name} careers salary`, monthlyVolume: 600, resultsCount: 1 }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatSearchVolume = (volume?: number) => {
    if (!volume) return 'N/A';
    if (volume >= 1000) return `${(volume / 1000).toFixed(1)}K`;
    return volume.toString();
  };

  // Show upgrade modal when needed
  if (showUpgradeModal) {
    return <UpgradeModal open={showUpgradeModal} onOpenChange={setShowUpgradeModal} />;
  }

  return (
    <div className="space-y-6">
      {/* Main Section Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-gray-900">Search</h2>
          <p className="text-gray-600">
            Explore traditional search results and analyze how {companyName} appears in web searches across different platforms.
          </p>
        </div>
        {(searchResults.length > 0 || searchTermsData.length > 0) && (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as 'results' | 'terms')}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid w-full grid-cols-2 sm:w-auto">
              <TabsTrigger value="results">Search Results</TabsTrigger>
              <TabsTrigger value="terms">Search Terms</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* Combined Search Data */}
      {(searchResults.length > 0 || searchTermsData.length > 0) && (
        <Card>
          <CardContent className="p-0">
            {activeTab === 'results' && searchResults.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Rank</TableHead>
                      <TableHead className="w-48">Title</TableHead>
                      <TableHead className="w-32">Domain</TableHead>
                      <TableHead className="w-32">Search Term</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      // Sort by mention count (descending), then by position (ascending)
                      const sortedResults = [...searchResults].sort((a, b) => {
                        // First sort by mention count (descending)
                        const aMentions = a.mentionCount || 1;
                        const bMentions = b.mentionCount || 1;
                        if (bMentions !== aMentions) {
                          return bMentions - aMentions;
                        }
                        // Then by position (ascending)
                        return (a.position || 100) - (b.position || 100);
                      });
                      
                      return sortedResults.map((result, index) => (
                      <TableRow 
                        key={result.id}
                        className="cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => window.open(result.link, '_blank', 'noopener,noreferrer')}
                      >
                        <TableCell className="w-12">
                          <Badge variant="outline" className="font-mono text-xs bg-gray-50 text-gray-700 border-gray-300">
                            {index + 1}
                          </Badge>
                        </TableCell>
                        <TableCell className="w-48 overflow-hidden">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate" title={result.title}>
                              {result.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-1 line-clamp-1" title={result.snippet}>
                              {result.snippet}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="w-32 overflow-hidden">
                          <div className="flex items-center gap-1 min-w-0">
                            <Favicon domain={result.domain} size="sm" className="shrink-0" />
                            <span className="text-sm font-medium text-gray-900 truncate min-w-0" title={result.domain}>
                              {result.domain}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="w-32 overflow-hidden">
                          <div className="min-w-0">
                            {(() => {
                              const searchTerms = (result.allSearchTerms || result.searchTerm || searchTerm)
                                .split(',')
                                .map(term => term.trim())
                                .filter(term => term.length > 0);
                              
                              const maxToShow = 1;
                              const extraCount = searchTerms.length - maxToShow;
                              
                              return (
                                <div className="flex items-center gap-1 min-w-0">
                                  {searchTerms.slice(0, maxToShow).map((term, idx) => (
                                    <span key={idx} className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 truncate" title={term}>
                                      {term}
                                    </span>
                                  ))}
                                  {extraCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">
                                      +{extraCount}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>
                      </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
            
            {activeTab === 'terms' && searchTermsData.length > 0 && (
              <div className="w-full overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Search Term</TableHead>
                      <TableHead>Monthly Volume</TableHead>
                      <TableHead>Results Found</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchTermsData.map((termData, index) => (
                      <TableRow key={termData.term}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            #{index + 1}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium text-sm">{termData.term}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <TrendingUp className="w-4 h-4 text-gray-400" />
                            <span className="text-sm font-medium">{formatSearchVolume(termData.monthlyVolume)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {termData.resultsCount} result{termData.resultsCount !== 1 ? 's' : ''}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Debug Information */}
      {debugInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-sm">🐛</span>
              Debug Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">Keywords Everywhere Available:</span>
                <Badge variant={debugInfo.keywordsEverywhereAvailable ? "default" : "destructive"}>
                  {debugInfo.keywordsEverywhereAvailable ? "Yes" : "No"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Results with Volume Data:</span>
                <span>{debugInfo.resultsWithVolume || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Total Volume:</span>
                <span>{debugInfo.totalVolume || 0}</span>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer font-medium">Full Debug Data</summary>
                <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">
                  {JSON.stringify(debugInfo, null, 2)}
                </pre>
              </details>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Related Searches */}
      {searchResults.length > 0 && searchResults[0].relatedSearches && (
        <Card>
          <CardHeader>
            <CardTitle>Related Search Terms</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {searchResults[0].relatedSearches.map((term, index) => (
                <Badge key={index} variant="secondary" className="text-sm">
                  {term}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {searchResults.length === 0 && !isLoading && !storedSearchData && (
        <Card>
          <CardContent className="text-center py-12">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Search Insights Yet</h3>
            <p className="text-gray-500 mb-4">
              Generate search insights to analyze your company's career presence and competitor positioning.
            </p>
            <div className="space-y-4">
              <Button 
                onClick={handleStartSearch}
                disabled={isLoading || !currentCompany?.name}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating Search Insights...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Generate Search Insights
                  </>
                )}
              </Button>
              
              <div className="text-xs text-gray-500">
                <p>Company ID: {currentCompany?.id}</p>
                <p>Company Name: {currentCompany?.name}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};