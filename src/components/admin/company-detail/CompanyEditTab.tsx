import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { RefreshCw, Save, Calendar, Trash2, Brain } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

interface Company {
  id: string;
  name: string;
  industry: string;
  created_at: string;
  last_updated: string | null;
  organization_id: string;
}

interface CompanyEditTabProps {
  company: Company;
  onUpdate: () => void;
  onRefresh?: (companyId: string) => void; // Add callback for refresh
  onDelete?: () => void; // Add callback for delete
}

export const CompanyEditTab = ({ company, onUpdate, onRefresh, onDelete }: CompanyEditTabProps) => {
  const [companyName, setCompanyName] = useState(company.name);
  const [companyIndustry, setCompanyIndustry] = useState(company.industry);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loadingIndustries, setLoadingIndustries] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  // AI Themes analysis state
  const [isAnalyzingThemes, setIsAnalyzingThemes] = useState(false);
  const [showThemesConfirmModal, setShowThemesConfirmModal] = useState(false);
  const [themesProgress, setThemesProgress] = useState<{
    current: number;
    total: number;
    currentResponse: string;
  } | null>(null);
  const [themesCount, setThemesCount] = useState<number | null>(null);

  useEffect(() => {
    loadIndustries();
    loadThemesCount();
  }, [company.id]);

  const loadThemesCount = async () => {
    try {
      // Query responses for this company first (using company_id directly on prompt_responses)
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select('id')
        .eq('company_id', company.id);

      if (responsesError || !responses || responses.length === 0) {
        setThemesCount(0);
        return;
      }

      const responseIds = responses.map(r => r.id);
      
      // If we have too many response IDs, count in batches to avoid URL length issues
      if (responseIds.length > 100) {
        const batchSize = 100;
        let totalCount = 0;
        
        for (let i = 0; i < responseIds.length; i += batchSize) {
          const batch = responseIds.slice(i, i + batchSize);
          
          const { count: batchCount, error: batchError } = await supabase
            .from('ai_themes')
            .select('*', { count: 'exact', head: true })
            .in('response_id', batch);
          
          if (!batchError && batchCount !== null) {
            totalCount += batchCount;
          } else if (batchError) {
            console.warn('Error counting themes batch:', batchError);
          }
        }
        
        setThemesCount(totalCount);
      } else {
        // For smaller sets, query directly
        const { count, error: countError } = await supabase
          .from('ai_themes')
          .select('*', { count: 'exact', head: true })
          .in('response_id', responseIds);

        if (countError) {
          console.error('Error counting themes:', countError);
          setThemesCount(null);
        } else {
          setThemesCount(count || 0);
        }
      }
    } catch (error) {
      console.error('Error loading themes count:', error);
      setThemesCount(null);
    }
  };

  const loadIndustries = async () => {
    setLoadingIndustries(true);
    try {
      // Get distinct industries from user_onboarding table
      const { data, error } = await supabase
        .from('user_onboarding')
        .select('industry');

      if (error) throw error;

      // Extract unique industries and sort them
      const uniqueIndustries = [...new Set(data?.map(item => item.industry).filter(Boolean))];
      uniqueIndustries.sort();
      
      setIndustries(uniqueIndustries);
    } catch (error) {
      console.error('Error loading industries:', error);
      toast.error('Failed to load industries');
      // Fallback to some default industries
      setIndustries(['Technology', 'Healthcare', 'Finance', 'Other']);
    } finally {
      setLoadingIndustries(false);
    }
  };

  const handleUpdate = async () => {
    if (!companyName.trim() || !companyIndustry) {
      toast.error('Please fill in all required fields');
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          name: companyName,
          industry: companyIndustry
        })
        .eq('id', company.id);

      if (error) throw error;

      toast.success('Company updated successfully');
      onUpdate();
    } catch (error) {
      console.error('Error updating company:', error);
      toast.error('Failed to update company');
    } finally {
      setUpdating(false);
    }
  };

  const handleRefreshData = async () => {
    if (onRefresh) {
      // Call the parent's refresh handler which will show the modal
      onRefresh(company.id);
    } else {
      toast.error('Refresh functionality not available');
    }
  };

  const runAIThemesAnalysis = async () => {
    try {
      setIsAnalyzingThemes(true);
      setThemesProgress({
        current: 0,
        total: 0,
        currentResponse: 'Preparing analysis...'
      });

      // Get all responses for this company (from all users in the company)
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select(`
          id,
          response_text,
          ai_model,
          confirmed_prompts!inner(
            prompt_type,
            company_id,
            prompt_text
          )
        `)
        .eq('confirmed_prompts.company_id', company.id)
        .in('confirmed_prompts.prompt_type', ['sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive']);

      if (responsesError) {
        throw responsesError;
      }

      if (!responses || responses.length === 0) {
        toast.error('No sentiment/competitive responses found for this company');
        setIsAnalyzingThemes(false);
        setThemesProgress(null);
        return;
      }

      setThemesProgress(prev => prev ? { ...prev, total: responses.length } : null);

      // Get response IDs for later use
      const responseIds = responses.map(r => r.id);

      // Clear existing themes for this company's responses
      if (responseIds.length > 0) {
        setThemesProgress(prev => prev ? { ...prev, currentResponse: 'Clearing existing themes...' } : null);
        const { error: deleteError } = await supabase
          .from('ai_themes')
          .delete()
          .in('response_id', responseIds);
        
        if (deleteError) {
          console.warn('Error clearing existing themes:', deleteError);
        }
      }

      // Track statistics
      let totalThemesCreated = 0;
      let successfulResponses = 0;
      let failedResponses = 0;

      // Process responses one by one
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        const promptText = (response.confirmed_prompts as any)?.prompt_text || 'Unknown prompt';
        const truncatedPrompt = promptText.length > 60 ? promptText.substring(0, 60) + '...' : promptText;
        
        setThemesProgress(prev => prev ? {
          ...prev,
          current: i + 1,
          currentResponse: `Analyzing: ${truncatedPrompt}`
        } : null);

        try {
          const { data, error } = await supabase.functions.invoke('ai-thematic-analysis', {
            body: {
              response_id: response.id,
              company_name: company.name,
              response_text: response.response_text,
              ai_model: response.ai_model,
              force: true // Force regeneration even if themes exist
            }
          });

          if (error) {
            console.error(`Error analyzing response ${response.id}:`, error);
            failedResponses++;
          } else if (data) {
            // Count themes created from the response
            const themesCount = data.themes?.length || data.total_themes || 0;
            totalThemesCreated += themesCount;
            if (themesCount > 0 || data.success) {
              successfulResponses++;
            } else {
              failedResponses++;
            }
          }
        } catch (error) {
          console.error(`Error analyzing response ${response.id}:`, error);
          failedResponses++;
        }

        // Small delay to show progress
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify themes were actually created by querying the database
      setThemesProgress(prev => prev ? { ...prev, currentResponse: 'Verifying themes...' } : null);
      
      const { data: createdThemes, error: verifyError } = await supabase
        .from('ai_themes')
        .select('id, sentiment, talentx_attribute_name')
        .in('response_id', responseIds);

      let verifiedCount = 0;
      let positiveCount = 0;
      let negativeCount = 0;
      let neutralCount = 0;

      if (!verifyError && createdThemes) {
        verifiedCount = createdThemes.length;
        positiveCount = createdThemes.filter(t => t.sentiment === 'positive').length;
        negativeCount = createdThemes.filter(t => t.sentiment === 'negative').length;
        neutralCount = createdThemes.filter(t => t.sentiment === 'neutral').length;
      }

      setThemesProgress(prev => prev ? { ...prev, currentResponse: 'Analysis complete!' } : null);
      
      // Show detailed success message
      if (verifiedCount > 0) {
        toast.success(
          `AI themes analysis completed! Created ${verifiedCount} themes (${positiveCount} positive, ${negativeCount} negative, ${neutralCount} neutral) from ${successfulResponses} responses.`,
          { duration: 6000 }
        );
      } else if (totalThemesCreated > 0) {
        toast.success(
          `Analysis completed! ${totalThemesCreated} themes processed from ${successfulResponses} responses.`,
          { duration: 5000 }
        );
      } else {
        toast.warning(
          `Analysis completed but no themes were created. ${failedResponses > 0 ? `${failedResponses} responses failed.` : 'Check if responses contain relevant content.'}`,
          { duration: 5000 }
        );
      }
      
    } catch (e: any) {
      console.error('Error running AI themes analysis:', e);
      toast.error('Failed to run AI themes analysis');
    } finally {
      setIsAnalyzingThemes(false);
      setThemesProgress(null);
    }
  };

  const handleDeleteCompany = async () => {
    if (!company.organization_id) {
      toast.error('Company is not linked to an organization');
      return;
    }

    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('admin_delete_company', {
        p_company_id: company.id,
        p_organization_id: company.organization_id
      });

      if (error) throw error;

      if (data && data.length > 0) {
        const summary = data[0];
        const counts = (summary.deleted_counts || {}) as Record<string, number>;
        const deletedTotal = Object.values(counts).reduce((acc, value) => acc + (value || 0), 0);
        toast.success(
          `Deleted "${company.name}" and ${deletedTotal} related record${deletedTotal === 1 ? '' : 's'}`
        );
      } else {
        toast.success(`Company "${company.name}" and related data were removed`);
      }

      setShowDeleteModal(false);
      if (onDelete) {
        onDelete();
      }
    } catch (error: any) {
      console.error('Error deleting company:', error);
      const message = error?.message || 'Failed to delete company';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const hasChanges = companyName !== company.name || companyIndustry !== company.industry;

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky">Company Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-nightsky">Company Name *</Label>
              <Input
                placeholder="Enter company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="border-silver"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Industry *</Label>
              <Select 
                value={companyIndustry} 
                onValueChange={setCompanyIndustry}
                disabled={loadingIndustries}
              >
                <SelectTrigger className="border-silver">
                  <SelectValue placeholder={loadingIndustries ? "Loading industries..." : "Select industry"} />
                </SelectTrigger>
                <SelectContent>
                  {industries.map(industry => (
                    <SelectItem key={industry} value={industry}>{industry}</SelectItem>
                  ))}
                  {industries.length === 0 && !loadingIndustries && (
                    <SelectItem value="other" disabled>No industries found</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button 
              onClick={handleUpdate} 
              disabled={updating || !hasChanges}
              className="bg-teal hover:bg-teal/90"
            >
              <Save className="h-4 w-4 mr-2" />
              {updating ? 'Saving...' : 'Save Changes'}
            </Button>
            {hasChanges && (
              <Button
                variant="outline"
                onClick={() => {
                  setCompanyName(company.name);
                  setCompanyIndustry(company.industry);
                }}
                className="border-silver"
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky">Data Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between p-4 bg-silver/30 rounded-lg">
            <div>
              <h4 className="font-medium text-nightsky mb-1">Refresh Company Data</h4>
              <p className="text-sm text-nightsky/60">
                Re-fetch all prompts and responses for this company across all AI models
              </p>
              {company.last_updated && (
                <p className="text-xs text-nightsky/50 mt-2 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Last refreshed: {new Date(company.last_updated).toLocaleString()}
                </p>
              )}
            </div>
            <Button
              onClick={handleRefreshData}
              disabled={refreshing}
              className="bg-pink hover:bg-pink/90"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh Data'}
            </Button>
          </div>
          
          <div className="flex items-start justify-between p-4 bg-silver/30 rounded-lg">
            <div>
              <h4 className="font-medium text-nightsky mb-1">AI Themes Analysis</h4>
              <p className="text-sm text-nightsky/60">
                Analyze sentiment and competitive responses to extract thematic insights
              </p>
              {themesCount !== null && (
                <p className="text-xs text-nightsky/50 mt-2 flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  {themesCount === 0 
                    ? 'No themes found. Run analysis to generate themes.'
                    : `${themesCount} theme${themesCount === 1 ? '' : 's'} currently in database`}
                </p>
              )}
            </div>
            <Button
              onClick={() => setShowThemesConfirmModal(true)}
              disabled={isAnalyzingThemes}
              className="bg-purple-600 hover:bg-purple-700 text-white border-purple-600"
            >
              <Brain className={`h-4 w-4 mr-2 ${isAnalyzingThemes ? 'animate-pulse' : ''}`} />
              {isAnalyzingThemes ? 'Analyzing...' : 'AI Themes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky">Company Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <dt className="text-sm text-nightsky/60 mb-1">Company ID</dt>
              <dd className="text-sm font-mono text-nightsky bg-silver/30 px-2 py-1 rounded">
                {company.id}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-nightsky/60 mb-1">Created Date</dt>
              <dd className="text-sm text-nightsky">
                {new Date(company.created_at).toLocaleDateString()}
              </dd>
            </div>
            <div className="flex items-end">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteModal(true)}
                className="w-full md:w-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Company
              </Button>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Delete Company Modal */}
      <Dialog
        open={showDeleteModal}
        onOpenChange={(open) => {
          setShowDeleteModal(open);
          if (!open) {
            setDeleting(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Company</DialogTitle>
            <DialogDescription>
              This action will remove "{company.name}" and all of its related data, including prompts, responses, members, and search insights. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              Ensure you really want to remove this company. All linked data will be permanently deleted.
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteModal(false);
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteCompany}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Company'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Themes Analysis Confirmation Modal */}
      <Dialog open={showThemesConfirmModal} onOpenChange={setShowThemesConfirmModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              Confirm AI Themes Analysis
            </DialogTitle>
            <DialogDescription>
              This will regenerate all AI themes for {company.name}. Any existing themes will be deleted and replaced.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
              <strong>Warning:</strong> This action will permanently delete all existing themes for this company and regenerate them from scratch. This cannot be undone.
            </div>
            
            {themesCount !== null && themesCount > 0 && (
              <div className="text-sm text-gray-600">
                <strong>Current themes:</strong> {themesCount} theme{themesCount === 1 ? '' : 's'} will be deleted and replaced.
              </div>
            )}
            
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowThemesConfirmModal(false)}
                disabled={isAnalyzingThemes}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setShowThemesConfirmModal(false);
                  await runAIThemesAnalysis();
                  // Refresh the count after analysis
                  await loadThemesCount();
                }}
                disabled={isAnalyzingThemes}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Brain className="h-4 w-4 mr-2" />
                Yes, Regenerate Themes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Themes Analysis Progress Modal */}
      <Dialog open={themesProgress !== null} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              AI Themes Analysis
            </DialogTitle>
          </DialogHeader>
          
          {themesProgress && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                <strong>Company:</strong> {company.name}
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{themesProgress.current} / {themesProgress.total}</span>
                </div>
                <Progress 
                  value={themesProgress.total > 0 ? (themesProgress.current / themesProgress.total) * 100 : 0} 
                  className="w-full"
                />
              </div>
              
              <div className="text-sm">
                <strong>Status:</strong> {themesProgress.currentResponse}
              </div>
              
              <div className="text-xs text-gray-500">
                Analyzing sentiment and competitive responses for thematic insights...
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

