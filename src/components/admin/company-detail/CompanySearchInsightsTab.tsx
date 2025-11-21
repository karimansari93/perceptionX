import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Search, TrendingUp, Hash, AlertCircle, CheckCircle } from 'lucide-react';

interface CompanySearchInsightsTabProps {
  companyId: string;
  companyName: string;
}

export const CompanySearchInsightsTab = ({ companyId, companyName }: CompanySearchInsightsTabProps) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const [progressStatus, setProgressStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');

  const appendMessage = (message: string) => {
    setProgressMessages(prev => [...prev, `${new Date().toLocaleTimeString()} • ${message}`]);
  };

  const handleModalOpenChange = (open: boolean) => {
    if (!open && progressStatus === 'running') {
      return;
    }
    setProgressModalOpen(open);
    if (!open) {
      setProgressMessages([]);
      setProgressStatus('idle');
    }
  };

  const runSearchInsights = async () => {
    setLoading(true);
    setResults(null);
    setProgressMessages([]);
    setProgressStatus('running');
    setProgressModalOpen(true);
    appendMessage(`Starting search insights for ${companyName}`);

    try {
      appendMessage('Calling search-insights edge function');
      const { data, error } = await supabase.functions.invoke('search-insights', {
        body: { companyName, company_id: companyId }
      });

      if (error) {
        appendMessage(`Edge function returned error: ${error.message || 'Unknown error'}`);
        throw error;
      }

      appendMessage('Edge function completed successfully');

      setResults(data);
      toast.success('Search insights generated successfully');
      appendMessage(`Captured ${data?.totalResults ?? 0} total results and ${data?.relatedSearchesCount ?? 0} related searches`);
      if (data?.debug?.combinedSearchTerms) {
        appendMessage(`Combined search terms: ${data.debug.combinedSearchTerms.join(', ')}`);
      }
      setProgressStatus('success');
    } catch (error: any) {
      console.error('Error running search insights:', error);
      toast.error(`Failed to run search insights: ${error.message || 'Unknown error'}`);
      appendMessage(`Failed: ${error.message || 'Unknown error'}`);
      setProgressStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-nightsky flex items-center gap-2">
              <Search className="h-5 w-5 text-teal" />
              Search Insights for {companyName}
            </CardTitle>
            <Button 
              onClick={runSearchInsights}
              disabled={loading}
              className="bg-pink hover:bg-pink/90"
            >
              <Search className={`h-4 w-4 mr-2 ${loading ? 'animate-pulse' : ''}`} />
              {loading ? 'Running...' : 'Run Search Insights'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-teal/10 border border-teal/20 rounded-lg p-4">
              <h4 className="font-medium text-nightsky mb-2 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-teal" />
                About Search Insights
              </h4>
              <p className="text-sm text-nightsky/70">
                Search insights analyzes search trends and volumes for this company's tracked terms. 
                This helps understand market demand and visibility opportunities.
              </p>
            </div>

            {results && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Search insights completed successfully</span>
                </div>

                {results.terms_analyzed && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="border-silver">
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                          <Hash className="h-8 w-8 text-pink" />
                          <div>
                            <p className="text-2xl font-bold text-nightsky">{results.terms_analyzed}</p>
                            <p className="text-sm text-nightsky/60">Terms Analyzed</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card className="border-silver">
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                          <TrendingUp className="h-8 w-8 text-teal" />
                          <div>
                            <p className="text-2xl font-bold text-nightsky">
                              {results.total_volume?.toLocaleString() || 'N/A'}
                            </p>
                            <p className="text-sm text-nightsky/60">Total Volume</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-silver">
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="h-8 w-8 text-green-500" />
                          <div>
                            <p className="text-2xl font-bold text-nightsky">
                              {results.updated || 0}
                            </p>
                            <p className="text-sm text-nightsky/60">Updated Terms</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {results.message && (
                  <div className="bg-nightsky/5 border border-nightsky/10 rounded-lg p-4">
                    <p className="text-sm text-nightsky">{results.message}</p>
                  </div>
                )}
              </div>
            )}

            {!results && !loading && (
              <div className="text-center py-12">
                <Search className="h-16 w-16 text-silver mx-auto mb-4" />
                <p className="text-lg font-medium text-nightsky mb-2">No results yet</p>
                <p className="text-sm text-nightsky/60">Click "Run Search Insights" to analyze search data</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Dialog open={progressModalOpen} onOpenChange={handleModalOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Running Search Insights</DialogTitle>
            <DialogDescription>
              {progressStatus === 'running'
                ? 'Please wait while we gather the latest search data. This can take up to a minute.'
                : 'Review the run summary below.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge
                variant={
                  progressStatus === 'success'
                    ? 'default'
                    : progressStatus === 'error'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {progressStatus === 'running' && 'In Progress'}
                {progressStatus === 'success' && 'Completed'}
                {progressStatus === 'error' && 'Failed'}
                {progressStatus === 'idle' && 'Idle'}
              </Badge>
              {progressStatus === 'running' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-3 w-3 animate-ping rounded-full bg-pink" />
                  Working…
                </div>
              )}
            </div>

            <ScrollArea className="max-h-60 rounded-md border border-dashed border-silver/60 p-3">
              <div className="space-y-2 text-sm text-nightsky/80">
                {progressMessages.length === 0 ? (
                  <p>No updates yet…</p>
                ) : (
                  progressMessages.map((message, index) => (
                    <div key={index} className="leading-relaxed">
                      {message}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {progressStatus !== 'running' && (
            <DialogFooter>
              <Button onClick={() => handleModalOpenChange(false)}>Close</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};










