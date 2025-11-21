import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, XCircle, Loader2, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface DebugResults {
  step: string;
  status: 'success' | 'warning' | 'error' | 'info';
  message: string;
  details?: any;
}

export const RelevanceDebugger = ({ companyId }: { companyId: string }) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DebugResults[]>([]);

  const runDiagnostics = async () => {
    setLoading(true);
    setResults([]);
    const diagnosticResults: DebugResults[] = [];

    try {
      // Step 1: Check if prompt_responses exist for this company
      diagnosticResults.push({
        step: "1",
        status: "info",
        message: "Checking prompt responses for company..."
      });
      
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select('id, citations, tested_at')
        .eq('company_id', companyId)
        .order('tested_at', { ascending: false })
        .limit(50);

      if (responsesError) {
        diagnosticResults.push({
          step: "1",
          status: "error",
          message: "Failed to fetch prompt responses",
          details: responsesError
        });
      } else if (!responses || responses.length === 0) {
        diagnosticResults.push({
          step: "1",
          status: "warning",
          message: "No prompt responses found for this company",
          details: { companyId }
        });
      } else {
        diagnosticResults.push({
          step: "1",
          status: "success",
          message: `Found ${responses.length} prompt responses`,
          details: { responseCount: responses.length }
        });

        // Step 2: Extract all unique URLs from citations
        diagnosticResults.push({
          step: "2",
          status: "info",
          message: "Extracting URLs from citations..."
        });

        const allUrls = new Set<string>();
        responses.forEach(response => {
          if (response.citations) {
            try {
              const citations = typeof response.citations === 'string' 
                ? JSON.parse(response.citations) 
                : response.citations;
              
              if (Array.isArray(citations)) {
                citations.forEach((citation: any) => {
                  const url = citation.url || citation.link;
                  if (url && url.startsWith('http')) {
                    allUrls.add(url);
                  }
                });
              }
            } catch (e) {
              console.error('Error parsing citations:', e);
            }
          }
        });

        if (allUrls.size === 0) {
          diagnosticResults.push({
            step: "2",
            status: "warning",
            message: "No URLs found in citations",
            details: { 
              note: "Responses exist but contain no valid URLs in citations",
              sampleResponse: responses[0]
            }
          });
        } else {
          diagnosticResults.push({
            step: "2",
            status: "success",
            message: `Extracted ${allUrls.size} unique URLs from citations`,
            details: { 
              urlCount: allUrls.size,
              sampleUrls: Array.from(allUrls).slice(0, 5)
            }
          });

          // Step 3: Check url_recency_cache for these URLs
          diagnosticResults.push({
            step: "3",
            status: "info",
            message: "Checking url_recency_cache for extracted URLs..."
          });

          const urlsArray = Array.from(allUrls);
          const batchSize = 50;
          let totalCached = 0;
          let totalWithScores = 0;
          let totalNullScores = 0;
          const extractionMethods: Record<string, number> = {};

          for (let i = 0; i < urlsArray.length; i += batchSize) {
            const batch = urlsArray.slice(i, i + batchSize);
            
            const { data: cachedUrls, error: cacheError } = await supabase
              .from('url_recency_cache')
              .select('url, recency_score, extraction_method, publication_date')
              .in('url', batch);

            if (cacheError) {
              diagnosticResults.push({
                step: "3",
                status: "error",
                message: `Error querying cache batch ${Math.floor(i/batchSize) + 1}`,
                details: cacheError
              });
            } else if (cachedUrls) {
              totalCached += cachedUrls.length;
              
              cachedUrls.forEach(cached => {
                if (cached.recency_score !== null) {
                  totalWithScores++;
                } else {
                  totalNullScores++;
                }
                
                const method = cached.extraction_method || 'unknown';
                extractionMethods[method] = (extractionMethods[method] || 0) + 1;
              });
            }
          }

          if (totalCached === 0) {
            diagnosticResults.push({
              step: "3",
              status: "error",
              message: "❌ CRITICAL: No URLs found in url_recency_cache",
              details: { 
                issue: "The extract-recency-scores edge function has not been run or failed to populate the cache",
                solution: "Run the recency extraction manually or check edge function logs",
                urlsToExtract: urlsArray.slice(0, 10)
              }
            });
          } else {
            const cacheHitRate = ((totalCached / urlsArray.length) * 100).toFixed(1);
            
            if (totalWithScores === 0) {
              diagnosticResults.push({
                step: "3",
                status: "error",
                message: `❌ CRITICAL: Found ${totalCached} cached URLs but ALL have NULL recency_score`,
                details: { 
                  issue: "URLs are cached but recency scores are NULL",
                  totalCached,
                  totalNullScores,
                  extractionMethods,
                  solution: "Check why extraction is failing - likely 'not-found', 'timeout', or 'problematic-domain'"
                }
              });
            } else if (totalWithScores < totalCached * 0.3) {
              diagnosticResults.push({
                step: "3",
                status: "warning",
                message: `⚠️ Found ${totalCached} cached URLs but only ${totalWithScores} have valid scores`,
                details: { 
                  totalCached,
                  totalWithScores,
                  totalNullScores,
                  cacheHitRate: `${cacheHitRate}%`,
                  extractionMethods,
                  note: "Low score rate may be due to extraction failures"
                }
              });
            } else {
              diagnosticResults.push({
                step: "3",
                status: "success",
                message: `✅ Found ${totalCached} cached URLs with ${totalWithScores} valid recency scores`,
                details: { 
                  totalCached,
                  totalWithScores,
                  totalNullScores,
                  cacheHitRate: `${cacheHitRate}%`,
                  extractionMethods
                }
              });
            }
          }

          // Step 4: Check the actual recency_score values
          diagnosticResults.push({
            step: "4",
            status: "info",
            message: "Analyzing recency score distribution..."
          });

          const { data: scoresData, error: scoresError } = await supabase
            .from('url_recency_cache')
            .select('recency_score, publication_date, extraction_method')
            .in('url', urlsArray.slice(0, 100)) // Check first 100 URLs
            .not('recency_score', 'is', null);

          if (scoresError) {
            diagnosticResults.push({
              step: "4",
              status: "error",
              message: "Failed to fetch recency scores",
              details: scoresError
            });
          } else if (!scoresData || scoresData.length === 0) {
            diagnosticResults.push({
              step: "4",
              status: "error",
              message: "❌ No valid recency scores found in cache",
              details: { 
                issue: "All cached URLs have NULL recency_score",
                solution: "Re-run extract-recency-scores with debugging enabled"
              }
            });
          } else {
            const avgScore = scoresData.reduce((sum, item) => sum + (item.recency_score || 0), 0) / scoresData.length;
            const scoreDistribution = {
              '0-20': scoresData.filter(s => s.recency_score >= 0 && s.recency_score < 20).length,
              '20-40': scoresData.filter(s => s.recency_score >= 20 && s.recency_score < 40).length,
              '40-60': scoresData.filter(s => s.recency_score >= 40 && s.recency_score < 60).length,
              '60-80': scoresData.filter(s => s.recency_score >= 60 && s.recency_score < 80).length,
              '80-100': scoresData.filter(s => s.recency_score >= 80 && s.recency_score <= 100).length,
            };

            diagnosticResults.push({
              step: "4",
              status: "success",
              message: `Calculated average recency score: ${avgScore.toFixed(1)}%`,
              details: { 
                avgScore: avgScore.toFixed(1),
                sampleSize: scoresData.length,
                scoreDistribution,
                sampleDates: scoresData.slice(0, 5).map(s => ({
                  date: s.publication_date,
                  score: s.recency_score,
                  method: s.extraction_method
                }))
              }
            });
          }
        }
      }

      // Step 5: Check if fetchRecencyData in useDashboardData is working
      diagnosticResults.push({
        step: "5",
        status: "info",
        message: "Testing fetchRecencyData logic..."
      });

      // Simulate the fetchRecencyData query
      if (responses && responses.length > 0) {
        const allCitations = responses.flatMap(r => {
          if (!r.citations) return [];
          try {
            const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
            return Array.isArray(citations) ? citations : [];
          } catch {
            return [];
          }
        }).filter(c => c.url);

        const urls = allCitations.map(c => c.url);

        if (urls.length > 0) {
          const { data: matches, error: matchError } = await supabase
            .from('url_recency_cache')
            .select('url, recency_score')
            .in('url', urls.slice(0, 25))
            .not('recency_score', 'is', null);

          if (matchError) {
            diagnosticResults.push({
              step: "5",
              status: "error",
              message: "fetchRecencyData simulation failed",
              details: matchError
            });
          } else {
            const matchCount = matches?.length || 0;
            const avgRelevance = matchCount > 0 
              ? matches.reduce((sum, item) => sum + (item.recency_score || 0), 0) / matchCount
              : 0;

            if (matchCount === 0) {
              diagnosticResults.push({
                step: "5",
                status: "error",
                message: "❌ CRITICAL: fetchRecencyData would return 0 matches",
                details: {
                  issue: "URL mismatch between citations and cache",
                  citationUrls: urls.slice(0, 5),
                  solution: "Check if URLs in citations exactly match URLs in cache"
                }
              });
            } else if (avgRelevance === 0) {
              diagnosticResults.push({
                step: "5",
                status: "error",
                message: `❌ Found ${matchCount} matches but average relevance is 0%`,
                details: {
                  issue: "All matched URLs have recency_score of 0",
                  matchCount,
                  avgRelevance: 0
                }
              });
            } else {
              diagnosticResults.push({
                step: "5",
                status: "success",
                message: `✅ fetchRecencyData working: ${matchCount} matches, avg ${avgRelevance.toFixed(1)}%`,
                details: {
                  matchCount,
                  avgRelevance: avgRelevance.toFixed(1),
                  sampleMatches: matches.slice(0, 5)
                }
              });
            }
          }
        }
      }

      // Step 6: Final recommendation
      const hasErrors = diagnosticResults.some(r => r.status === 'error');
      const hasWarnings = diagnosticResults.some(r => r.status === 'warning');

      if (hasErrors) {
        diagnosticResults.push({
          step: "6",
          status: "error",
          message: "🔴 ACTION REQUIRED: Critical issues found",
          details: {
            recommendation: "Follow the solutions provided in the error messages above"
          }
        });
      } else if (hasWarnings) {
        diagnosticResults.push({
          step: "6",
          status: "warning",
          message: "⚠️ Some issues detected but data flow is working",
          details: {
            recommendation: "Review warnings to improve coverage"
          }
        });
      } else {
        diagnosticResults.push({
          step: "6",
          status: "success",
          message: "✅ All checks passed! Relevance scores should be visible",
          details: {
            recommendation: "If you still see 0%, try refreshing the dashboard"
          }
        });
      }

    } catch (error) {
      diagnosticResults.push({
        step: "ERROR",
        status: "error",
        message: "Diagnostic failed with exception",
        details: error
      });
    }

    setResults(diagnosticResults);
    setLoading(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Info className="w-5 h-5 text-blue-600" />;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          Relevance Score Debugger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Debug Relevance Scores</AlertTitle>
          <AlertDescription>
            This tool will check every step of the relevance score calculation process to identify why scores are showing 0%.
          </AlertDescription>
        </Alert>

        <Button 
          onClick={runDiagnostics} 
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Running Diagnostics...
            </>
          ) : (
            'Run Full Diagnostic'
          )}
        </Button>

        {results.length > 0 && (
          <div className="space-y-3">
            {results.map((result, index) => (
              <Card 
                key={index} 
                className={`border-l-4 ${
                  result.status === 'error' ? 'border-l-red-500' :
                  result.status === 'warning' ? 'border-l-yellow-500' :
                  result.status === 'success' ? 'border-l-green-500' :
                  'border-l-blue-500'
                }`}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-1">
                      Step {result.step}
                    </Badge>
                    {getStatusIcon(result.status)}
                    <div className="flex-1">
                      <p className="font-medium text-sm">{result.message}</p>
                      {result.details && (
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                          {JSON.stringify(result.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

