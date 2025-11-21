import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Clock, Play, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

interface CompanyRecencyTestTabProps {
  companyId: string;
  companyName: string;
}

interface RecencyTestResult {
  url: string;
  title: string;
  sourceType: string;
  aiModel: string;
  extractedDate: string | null;
  success: boolean;
  error?: string;
}

export const CompanyRecencyTestTab = ({ companyId, companyName }: CompanyRecencyTestTabProps) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RecencyTestResult[]>([]);
  const [showSuccessOnly, setShowSuccessOnly] = useState(false);

  const runRecencyTest = async () => {
    setLoading(true);
    setResults([]);

    try {
      // Get all citations for the company
      const { data: responses, error: responsesError } = await supabase
        .from('confirmed_prompts')
        .select(`
          prompt_type,
          prompt_responses!inner(
            citations,
            ai_model
          )
        `)
        .eq('company_id', companyId)
        .in('prompt_type', ['sentiment', 'competitive', 'visibility'])
        .not('prompt_responses.citations', 'is', null);

      if (responsesError) throw responsesError;

      if (!responses || responses.length === 0) {
        toast.error('No citations found for this company');
        return;
      }

      // Extract all citations
      const allCitations: any[] = [];
      responses.forEach(response => {
        if (response.prompt_responses && Array.isArray(response.prompt_responses)) {
          response.prompt_responses.forEach((pr: any) => {
            if (pr.citations) {
              const citations = Array.isArray(pr.citations) ? pr.citations : JSON.parse(pr.citations);
              citations.forEach((citation: any) => {
                const sourceType = ['sentiment', 'employer'].includes(response.prompt_type) ? 'sentiment' : 
                                  ['competitive', 'comparison'].includes(response.prompt_type) ? 'competitive' :
                                  ['visibility', 'discovery'].includes(response.prompt_type) ? 'visibility' : 'competitive';
                allCitations.push({
                  ...citation,
                  sourceType: sourceType,
                  aiModel: pr.ai_model
                });
              });
            }
          });
        }
      });

      // Deduplicate by URL
      const uniqueCitations = allCitations.reduce((unique, citation) => {
        const url = citation.url || citation.link;
        if (url && !unique.some(existing => (existing.url || existing.link) === url)) {
          unique.push(citation);
        }
        return unique;
      }, []);

      toast.info(`Testing ${uniqueCitations.length} unique citations...`);

      // Test each citation with the edge function
      const testResults: RecencyTestResult[] = [];
      
      for (const citation of uniqueCitations.slice(0, 50)) { // Limit to 50 for performance
        try {
          const { data, error } = await supabase.functions.invoke('extract-recency-scores', {
            body: { citations: [citation] }
          });

          if (error) throw error;

          const result = data?.results?.[0];
          testResults.push({
            url: citation.url || citation.link,
            title: citation.title || 'Untitled',
            sourceType: citation.sourceType,
            aiModel: citation.aiModel,
            extractedDate: result?.extracted_date || null,
            success: !!result?.extracted_date,
            error: result?.error
          });
        } catch (error: any) {
          testResults.push({
            url: citation.url || citation.link,
            title: citation.title || 'Untitled',
            sourceType: citation.sourceType,
            aiModel: citation.aiModel,
            extractedDate: null,
            success: false,
            error: error.message
          });
        }
      }

      setResults(testResults);
      
      const successCount = testResults.filter(r => r.success).length;
      const successRate = ((successCount / testResults.length) * 100).toFixed(1);
      
      toast.success(`Recency test complete: ${successCount}/${testResults.length} successful (${successRate}%)`);
    } catch (error: any) {
      console.error('Error running recency test:', error);
      toast.error(`Failed to run recency test: ${error.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredResults = showSuccessOnly ? results.filter(r => r.success) : results;
  const successCount = results.filter(r => r.success).length;
  const successRate = results.length > 0 ? ((successCount / results.length) * 100).toFixed(1) : 0;

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-nightsky flex items-center gap-2">
              <Clock className="h-5 w-5 text-pink" />
              Recency Test for {companyName}
            </CardTitle>
            <Button 
              onClick={runRecencyTest}
              disabled={loading}
              className="bg-pink hover:bg-pink/90"
            >
              <Play className={`h-4 w-4 mr-2 ${loading ? 'animate-pulse' : ''}`} />
              {loading ? 'Running Test...' : 'Run Recency Test'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-pink/10 border border-pink/20 rounded-lg p-4">
              <h4 className="font-medium text-nightsky mb-2 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-pink" />
                About Recency Tests
              </h4>
              <p className="text-sm text-nightsky/70">
                This test extracts publication dates from all citations to verify the recency scoring system is working correctly.
                It helps ensure that newer content is properly identified and weighted in reports.
              </p>
            </div>

            {results.length > 0 && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-silver">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="h-8 w-8 text-green-500" />
                        <div>
                          <p className="text-2xl font-bold text-nightsky">{successCount}</p>
                          <p className="text-sm text-nightsky/60">Successful</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="border-silver">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <XCircle className="h-8 w-8 text-red-500" />
                        <div>
                          <p className="text-2xl font-bold text-nightsky">{results.length - successCount}</p>
                          <p className="text-sm text-nightsky/60">Failed</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-silver">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <Clock className="h-8 w-8 text-teal" />
                        <div>
                          <p className="text-2xl font-bold text-nightsky">{successRate}%</p>
                          <p className="text-sm text-nightsky/60">Success Rate</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="show-success"
                    checked={showSuccessOnly}
                    onCheckedChange={(checked) => setShowSuccessOnly(checked as boolean)}
                  />
                  <label htmlFor="show-success" className="text-sm text-nightsky cursor-pointer">
                    Show only successful extractions
                  </label>
                </div>

                <Card className="border-silver">
                  <CardContent className="pt-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Source Type</TableHead>
                          <TableHead>AI Model</TableHead>
                          <TableHead>Extracted Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredResults.map((result, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {result.success ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                            </TableCell>
                            <TableCell className="max-w-xs truncate" title={result.title}>
                              {result.title}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="border-teal/30 text-teal bg-teal/5">
                                {result.sourceType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-nightsky/60">
                              {result.aiModel}
                            </TableCell>
                            <TableCell>
                              {result.extractedDate ? (
                                <span className="text-sm text-nightsky">
                                  {new Date(result.extractedDate).toLocaleDateString()}
                                </span>
                              ) : (
                                <span className="text-sm text-red-500">
                                  {result.error || 'No date found'}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}

            {!results.length && !loading && (
              <div className="text-center py-12">
                <Clock className="h-16 w-16 text-silver mx-auto mb-4" />
                <p className="text-lg font-medium text-nightsky mb-2">No test results yet</p>
                <p className="text-sm text-nightsky/60">Click "Run Recency Test" to test date extraction</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};











