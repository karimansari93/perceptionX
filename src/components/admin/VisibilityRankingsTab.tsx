import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Trophy, Calendar, Loader2, RefreshCw, TrendingUp, Building2, Users, Award, Play, CheckCircle2, Plus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface RankingSummary {
  industry: string;
  experience_category: string;
  theme: string;
  companies_ranked: number;
  top_rank: number;
  bottom_rank: number;
}

interface RankingData {
  company_id: string;
  company_name: string;
  industry: string;
  experience_category: string;
  theme: string;
  detected_competitors: string | null;
  visibility_score: number;
  rank_position: number;
  total_companies_in_ranking: number;
  mentioned_count: number;
  total_responses: number;
}

export const VisibilityRankingsTab = () => {
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [rankings, setRankings] = useState<RankingData[]>([]);
  const [summary, setSummary] = useState<RankingSummary[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('');
  const [selectedCountry, setSelectedCountry] = useState<string>('US');
  const [availableIndustries, setAvailableIndustries] = useState<string[]>([]);
  const [showAddIndustryDialog, setShowAddIndustryDialog] = useState(false);
  const [newIndustryName, setNewIndustryName] = useState('');
  const [addingIndustry, setAddingIndustry] = useState(false);

  // Common countries for visibility rankings
  const countries = [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'IT', name: 'Italy' },
    { code: 'ES', name: 'Spain' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'AT', name: 'Austria' },
    { code: 'BE', name: 'Belgium' },
    { code: 'IE', name: 'Ireland' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'SG', name: 'Singapore' },
    { code: 'JP', name: 'Japan' },
    { code: 'KR', name: 'South Korea' },
    { code: 'CN', name: 'China' },
    { code: 'IN', name: 'India' },
    { code: 'BR', name: 'Brazil' },
    { code: 'MX', name: 'Mexico' },
    { code: 'AR', name: 'Argentina' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'GLOBAL', name: 'Global (All Countries)' }
  ];
  const [collectionProgress, setCollectionProgress] = useState<{
    companiesProcessed: number;
    promptsCreated: number;
    responsesCollected: number;
    totalCompanies: number;
  } | null>(null);

  useEffect(() => {
    // Set default to last month
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const defaultPeriod = lastMonth.toISOString().split('T')[0].substring(0, 7); // YYYY-MM format
    setSelectedPeriod(defaultPeriod);
    loadIndustries();
    loadRankings(defaultPeriod);
  }, []);

  const loadIndustries = async () => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('industry')
        .not('industry', 'is', null);

      if (error) throw error;

      // Use case-insensitive deduplication and sort
      const industriesMap = new Map<string, string>();
      (data || []).forEach(c => {
        if (c.industry) {
          const lower = c.industry.toLowerCase();
          // Keep the first occurrence (preserves original casing)
          if (!industriesMap.has(lower)) {
            industriesMap.set(lower, c.industry);
          }
        }
      });
      
      const uniqueIndustries = Array.from(industriesMap.values()).sort();
      setAvailableIndustries(uniqueIndustries);
      console.log('Loaded industries:', uniqueIndustries);
    } catch (error) {
      console.error('Error loading industries:', error);
      toast.error('Failed to load industries');
    }
  };

  const handleAddIndustry = async () => {
    if (!newIndustryName.trim()) {
      toast.error('Please enter an industry name');
      return;
    }

    const trimmedName = newIndustryName.trim();
    
    // Check if industry already exists
    if (availableIndustries.includes(trimmedName)) {
      toast.error('This industry already exists');
      setNewIndustryName('');
      setShowAddIndustryDialog(false);
      setSelectedIndustry(trimmedName);
      return;
    }

    setAddingIndustry(true);
    try {
      // Add to available industries list
      const updatedIndustries = [...availableIndustries, trimmedName].sort();
      setAvailableIndustries(updatedIndustries);
      
      // Select the new industry
      setSelectedIndustry(trimmedName);
      
      // Close dialog and reset input
      setShowAddIndustryDialog(false);
      setNewIndustryName('');
      
      toast.success(`Industry "${trimmedName}" added successfully`);
    } catch (error) {
      console.error('Error adding industry:', error);
      toast.error('Failed to add industry');
    } finally {
      setAddingIndustry(false);
    }
  };

  const loadRankings = async (period: string) => {
    if (!period) return;

    setLoading(true);
    try {
      // Get the first and last day of the month
      const periodDate = new Date(period + '-01');
      const periodStart = periodDate.toISOString().split('T')[0];
      const periodEnd = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 1).toISOString().split('T')[0];

      // Query prompt_responses with for_index = true for this period
      // Include all models: gpt-5-nano, perplexity, google-ai-overviews
      // These are industry-wide responses (company_id = NULL) - explicitly filter to ensure separation
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select(`
          id,
          detected_competitors,
          tested_at,
          ai_model,
          confirmed_prompts!inner(
            prompt_type,
            prompt_category,
            prompt_theme,
            industry_context
          )
        `)
        .eq('for_index', true)
        .is('company_id', null) // Explicitly filter for industry-wide responses only
        .in('confirmed_prompts.prompt_type', ['visibility', 'talentx_visibility'])
        .in('confirmed_prompts.prompt_category', ['Employee Experience', 'Candidate Experience'])
        .in('ai_model', ['gpt-5-nano', 'perplexity', 'google-ai-overviews'])
        .gte('tested_at', periodStart)
        .lt('tested_at', periodEnd);

      if (responsesError) throw responsesError;

      if (!responses || responses.length === 0) {
        setRankings([]);
        setSummary([]);
        return;
      }

      // Get all companies from our database to match against detected_competitors
      const { data: allCompanies, error: companiesError } = await supabase
        .from('companies')
        .select('id, name, industry')
        .not('industry', 'is', null);

      if (companiesError) throw companiesError;

      // Create a map of company names to company data (case-insensitive matching)
      const companyNameMap = new Map<string, Array<{ id: string; name: string; industry: string }>>();
      (allCompanies || []).forEach(company => {
        const normalizedName = company.name.toLowerCase().trim();
        if (!companyNameMap.has(normalizedName)) {
          companyNameMap.set(normalizedName, []);
        }
        companyNameMap.get(normalizedName)!.push(company);
      });

      // Group responses by industry, experience_category, theme
      // Then match companies from our DB to detected_competitors
      const companyScores = new Map<string, {
        company_id: string;
        company_name: string;
        industry: string;
        experience_category: string;
        theme: string;
        total_responses: number;
        mentioned_count: number;
        detected_competitors: Set<string>;
      }>();

      responses.forEach((response: any) => {
        const industry = response.confirmed_prompts?.industry_context || 'Unknown';
        const category = response.confirmed_prompts?.prompt_category || 'Unknown';
        const theme = response.confirmed_prompts?.prompt_theme || 'Unknown';
        
        // Extract competitors from this response
        const competitors = response.detected_competitors 
          ? response.detected_competitors.split(',').map((c: string) => c.trim()).filter(Boolean)
          : [];

        // For each competitor mentioned, check if it matches a company in our database
        competitors.forEach((competitorName: string) => {
          const normalizedCompetitor = competitorName.toLowerCase().trim();
          
          // Try to find matching company (exact match or partial match)
          let matchedCompanies = companyNameMap.get(normalizedCompetitor) || [];
          
          // If no exact match, try partial matching
          if (matchedCompanies.length === 0) {
            for (const [normalizedName, companies] of companyNameMap.entries()) {
              if (normalizedName.includes(normalizedCompetitor) || normalizedCompetitor.includes(normalizedName)) {
                matchedCompanies = companies;
                break;
              }
            }
          }

          // For each matched company, update their score
          matchedCompanies.forEach(company => {
            // Only count if company is in the same industry as the prompt
            if (company.industry.toLowerCase() === industry.toLowerCase()) {
              const key = `${industry}-${category}-${theme}-${company.id}`;

              if (!companyScores.has(key)) {
                companyScores.set(key, {
                  company_id: company.id,
                  company_name: company.name,
                  industry,
                  experience_category: category,
                  theme,
                  total_responses: 0,
                  mentioned_count: 0,
                  detected_competitors: new Set<string>()
                });
              }

              const score = companyScores.get(key)!;
              score.total_responses++;
              score.mentioned_count++; // Company was mentioned in this response
            }
          });
        });

        // Also aggregate all competitors for display
        competitors.forEach(comp => {
          const normalizedComp = comp.toLowerCase().trim();
          // Find which company this competitor matches (if any)
          const matchedCompanies = companyNameMap.get(normalizedComp) || [];
          matchedCompanies.forEach(company => {
            if (company.industry.toLowerCase() === industry.toLowerCase()) {
              const key = `${industry}-${category}-${theme}-${company.id}`;
              const score = companyScores.get(key);
              if (score) {
                score.detected_competitors.add(comp);
              }
            }
          });
        });
      });

      // Filter companies with at least 3 responses and calculate rankings
      const rankingsByGroup = new Map<string, RankingData[]>();

      companyScores.forEach((score, key) => {
        if (score.total_responses < 3) return; // Minimum 3 responses required

        const visibilityScore = (score.mentioned_count / score.total_responses) * 100;
        const groupKey = `${score.industry}-${score.experience_category}-${score.theme}`;

        if (!rankingsByGroup.has(groupKey)) {
          rankingsByGroup.set(groupKey, []);
        }

        rankingsByGroup.get(groupKey)!.push({
          company_id: score.company_id,
          company_name: score.company_name,
          industry: score.industry,
          experience_category: score.experience_category,
          theme: score.theme,
          detected_competitors: Array.from(score.detected_competitors).join(', ') || null,
          visibility_score: visibilityScore,
          rank_position: 0, // Will be set after sorting
          total_companies_in_ranking: 0, // Will be set after grouping
          mentioned_count: score.mentioned_count,
          total_responses: score.total_responses
        });
      });

      // Rank companies within each group
      const allRankings: RankingData[] = [];
      const summaryMap = new Map<string, RankingSummary>();

      rankingsByGroup.forEach((groupRankings, groupKey) => {
        // Sort by visibility score (descending)
        groupRankings.sort((a, b) => b.visibility_score - a.visibility_score);

        // Assign ranks
        groupRankings.forEach((ranking, index) => {
          ranking.rank_position = index + 1;
          ranking.total_companies_in_ranking = groupRankings.length;
        });

        allRankings.push(...groupRankings);

        // Update summary (use values from first ranking to avoid splitting issues)
        const firstRanking = groupRankings[0];
        if (!summaryMap.has(groupKey)) {
          summaryMap.set(groupKey, {
            industry: firstRanking.industry,
            experience_category: firstRanking.experience_category,
            theme: firstRanking.theme,
            companies_ranked: 0,
            top_rank: Infinity,
            bottom_rank: 0
          });
        }
        const summary = summaryMap.get(groupKey)!;
        summary.companies_ranked = groupRankings.length;
        summary.top_rank = 1;
        summary.bottom_rank = groupRankings.length;
      });

      // Sort all rankings for display
      allRankings.sort((a, b) => {
        if (a.industry !== b.industry) return a.industry.localeCompare(b.industry);
        if (a.experience_category !== b.experience_category) return a.experience_category.localeCompare(b.experience_category);
        if (a.theme !== b.theme) return a.theme.localeCompare(b.theme);
        return a.rank_position - b.rank_position;
      });

      setRankings(allRankings);
      setSummary(Array.from(summaryMap.values()));

    } catch (error) {
      console.error('Error loading rankings:', error);
      toast.error('Failed to load rankings');
    } finally {
      setLoading(false);
    }
  };

  const collectVisibilityResponses = async () => {
    if (!selectedIndustry) {
      toast.error('Please select an industry');
      return;
    }

    setCollecting(true);
    
    try {
      // Initialize progress (no need to count companies - we're collecting industry-wide responses)
      setCollectionProgress({
        companiesProcessed: 0, // Not used for industry-wide collection
        promptsCreated: 0,
        responsesCollected: 0,
        totalCompanies: 0 // Not applicable for industry-wide prompts
      });

      // Start collection process
      console.log('Invoking collect-industry-visibility function with industry:', selectedIndustry, 'country:', selectedCountry);
      const { data, error } = await supabase.functions.invoke('collect-industry-visibility', {
        body: { industry: selectedIndustry, country: selectedCountry }
      });

      console.log('Edge function response:', { data, error });

      // Check for Supabase function invocation error
      if (error) {
        console.error('Edge function invocation error:', {
          message: error.message,
          details: (error as any).details,
          context: (error as any).context,
          status: (error as any).status,
          statusText: (error as any).statusText,
          name: (error as any).name
        });
        throw new Error(error.message || 'Failed to invoke collection function');
      }

      // Check if we got a response
      if (!data) {
        console.error('No data returned from edge function');
        throw new Error('No response data from collection function');
      }

      // Log the full response for debugging
      console.log('Full response data:', JSON.stringify(data, null, 2));

      // Check if the function returned success: false
      if ((data as any).success === false) {
        const errorMessage = (data as any).error || (data as any).message || 'Failed to collect visibility responses';
        const errorDetails = (data as any).details ? ` Details: ${(data as any).details}` : '';
        const availableIndustries = (data as any).availableIndustries;
        
        console.error('Edge function returned success: false', { 
          error: errorMessage, 
          details: (data as any).details,
          availableIndustries 
        });
        
        // If available industries are provided, add them to the error message
        let fullErrorMessage = errorMessage + errorDetails;
        if (availableIndustries && availableIndustries.length > 0) {
          fullErrorMessage += `\n\nDid you mean one of these industries? ${availableIndustries.join(', ')}`;
        }
        
        throw new Error(fullErrorMessage);
      }

      // Check if success is true
      if ((data as any).success === true) {
        const results = (data as any).results || {};
        
        // Update progress with final results
        setCollectionProgress({
          companiesProcessed: results.companiesProcessed || 0,
          promptsCreated: results.promptsCreated || 0,
          responsesCollected: results.responsesCollected || 0,
          totalCompanies
        });
        
        // Show success message
        toast.success((data as any).message || 'Visibility responses collected successfully');
        
        // Wait a moment to show final progress, then close modal and calculate rankings
        setTimeout(async () => {
          setCollecting(false);
          
          // Automatically refresh rankings for current month after collection
          const currentMonth = new Date();
          const currentPeriod = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
          setSelectedPeriod(currentPeriod);
          
          // Refresh rankings
          await refreshRankings();
          
          // Clear progress after a delay
          setTimeout(() => setCollectionProgress(null), 2000);
        }, 1500);
      } else {
        throw new Error((data as any).error || 'Failed to collect visibility responses');
      }
    } catch (error: any) {
      console.error('Error collecting visibility responses:', error);
      toast.error(error.message || 'Failed to collect visibility responses');
      setCollecting(false);
      setTimeout(() => setCollectionProgress(null), 2000);
    }
  };

  // Rankings are now calculated on the frontend, so this just reloads the data
  const refreshRankings = async () => {
    if (!selectedPeriod) {
      toast.error('Please select a period');
      return;
    }

    setCalculating(true);
    try {
      await loadRankings(selectedPeriod);
      toast.success('Rankings refreshed');
    } catch (error: any) {
      console.error('Error refreshing rankings:', error);
      toast.error(error.message || 'Failed to refresh rankings');
    } finally {
      setCalculating(false);
    }
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPeriod = e.target.value;
    setSelectedPeriod(newPeriod);
    if (newPeriod) {
      loadRankings(newPeriod);
    }
  };

  // Group rankings by industry, category, and theme
  const groupedRankings = rankings.reduce((acc, ranking) => {
    const key = `${ranking.industry}-${ranking.experience_category}-${ranking.theme}`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(ranking);
    return acc;
  }, {} as Record<string, RankingData[]>);

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const progressPercent = collectionProgress && collectionProgress.totalCompanies > 0
    ? (collectionProgress.companiesProcessed / collectionProgress.totalCompanies) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Add Industry Dialog */}
      <Dialog open={showAddIndustryDialog} onOpenChange={setShowAddIndustryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Industry</DialogTitle>
            <DialogDescription>
              Add a new industry to the list. This will be available for selection immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="newIndustry">Industry Name</Label>
              <Input
                id="newIndustry"
                value={newIndustryName}
                onChange={(e) => setNewIndustryName(e.target.value)}
                placeholder="e.g., Healthcare, Technology, Finance"
                className="mt-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddIndustry();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddIndustryDialog(false);
                  setNewIndustryName('');
                }}
                disabled={addingIndustry}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddIndustry}
                disabled={addingIndustry || !newIndustryName.trim()}
                className="bg-teal hover:bg-teal/90"
              >
                {addingIndustry ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Industry'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Collection Progress Modal */}
      <Dialog 
        open={collecting || (collectionProgress !== null && collectionProgress.companiesProcessed > 0)} 
        onOpenChange={(open) => {
          // Prevent closing during collection
          if (!open && collecting) return;
          if (!open && !collecting) {
            setCollectionProgress(null);
          }
        }}
        modal={true}
      >
        <DialogContent 
          className="sm:max-w-md"
          onInteractOutside={(e) => {
            if (collecting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (collecting) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {collecting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-teal" />
                  Collecting Visibility Responses
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-teal" />
                  Collection Complete
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {collecting 
                ? `Gathering GPT-5 nano, Perplexity, and Google AI responses for ${selectedIndustry} industry in ${countries.find(c => c.code === selectedCountry)?.name || selectedCountry}`
                : `Successfully collected responses for ${selectedIndustry} industry in ${countries.find(c => c.code === selectedCountry)?.name || selectedCountry}`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Overall Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-silver/70">Companies Processed</span>
                <span className="font-semibold text-nightsky">
                  {collectionProgress?.companiesProcessed || 0} / {collectionProgress?.totalCompanies || 0}
                </span>
              </div>
              <Progress 
                value={progressPercent} 
                className="h-3"
              />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-silver/20 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-teal">
                  {collectionProgress?.companiesProcessed || 0}
                </div>
                <div className="text-xs text-silver/60 mt-1">Companies</div>
              </div>
              <div className="bg-silver/20 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-pink">
                  {collectionProgress?.promptsCreated || 0}
                </div>
                <div className="text-xs text-silver/60 mt-1">Prompts</div>
              </div>
              <div className="bg-silver/20 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-teal">
                  {collectionProgress?.responsesCollected || 0}
                </div>
                <div className="text-xs text-silver/60 mt-1">Responses</div>
              </div>
            </div>

            {/* Info Message */}
            {collecting ? (
              <div className="bg-teal/10 border border-teal/20 rounded-lg p-3">
                <p className="text-sm text-teal/80 text-center">
                  This may take several minutes depending on the number of companies. 
                  Please keep this window open.
                </p>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-700 text-center">
                  ✓ Collection completed successfully! Calculating rankings...
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-headline font-bold text-nightsky mb-2">Visibility Rankings</h1>
        <p className="text-silver/70">
          Calculate and view monthly company visibility rankings based on GPT-5 nano, Perplexity, and Google AI responses
        </p>
      </div>

      {/* Collection Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Collect Visibility Responses</CardTitle>
          <CardDescription>
            Select an industry and country (market context) to collect responses from GPT-5 nano, Perplexity, and Google AI. Country is used in prompts for market context (e.g., "companies in Healthcare in US"), but responses are collected for ALL companies in the industry regardless of their origin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="industry">Industry</Label>
              <div className="flex gap-2 mt-1">
                <Select value={selectedIndustry} onValueChange={setSelectedIndustry} className="flex-1">
                  <SelectTrigger>
                    <SelectValue placeholder="Select an industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableIndustries.map((industry) => (
                      <SelectItem key={industry} value={industry}>
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddIndustryDialog(true)}
                  className="shrink-0"
                  title="Add new industry"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="country">Country</Label>
              <Select value={selectedCountry} onValueChange={setSelectedCountry} className="mt-1">
                <SelectTrigger>
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={collectVisibilityResponses}
              disabled={collecting || !selectedIndustry}
              className="bg-teal hover:bg-teal/90"
            >
              {collecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Collecting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Collect Responses
                </>
              )}
            </Button>
          </div>
          
        </CardContent>
      </Card>

      {/* View Rankings */}
      <Card>
        <CardHeader>
          <CardTitle>View Rankings</CardTitle>
          <CardDescription>
            Select a month to view rankings (calculated from responses with for_index = true)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="period">View Rankings For (Month)</Label>
              <Input
                id="period"
                type="month"
                value={selectedPeriod}
                onChange={handlePeriodChange}
                className="mt-1"
              />
            </div>
            <Button
              onClick={refreshRankings}
              disabled={calculating || !selectedPeriod || collecting}
              className="bg-pink hover:bg-pink/90"
            >
              {calculating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Rankings
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-silver/60">Total Rankings</p>
                  <p className="text-2xl font-bold text-nightsky">{summary.length}</p>
                </div>
                <Trophy className="h-8 w-8 text-pink" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-silver/60">Companies Ranked</p>
                  <p className="text-2xl font-bold text-nightsky">
                    {summary.reduce((sum, s) => sum + s.companies_ranked, 0)}
                  </p>
                </div>
                <Building2 className="h-8 w-8 text-teal" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-silver/60">Industries</p>
                  <p className="text-2xl font-bold text-nightsky">
                    {new Set(summary.map(s => s.industry)).size}
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-teal" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-silver/60">Themes</p>
                  <p className="text-2xl font-bold text-nightsky">
                    {new Set(summary.map(s => s.theme)).size}
                  </p>
                </div>
                <Award className="h-8 w-8 text-pink" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Rankings Table */}
      {loading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-pink" />
            </div>
          </CardContent>
        </Card>
      ) : rankings.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8 text-silver/60">
              <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No rankings found for the selected period.</p>
              <p className="text-sm mt-2">Make sure you have collected responses with for_index = true for this month.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedRankings).map(([key, groupRankings]) => {
            const first = groupRankings[0];
            return (
              <Card key={key}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {first.industry} - {first.experience_category}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Theme: {first.theme} • {groupRankings.length} companies ranked
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="bg-teal/10 text-teal border-teal/20">
                      {first.total_companies_in_ranking} total
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Rank</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Industry</TableHead>
                        <TableHead>Visibility Score</TableHead>
                        <TableHead>Companies Mentioned</TableHead>
                        <TableHead className="text-right">Position</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupRankings.map((ranking) => (
                        <TableRow key={ranking.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{getRankIcon(ranking.rank_position)}</span>
                              <span className="font-semibold text-nightsky">
                                {ranking.rank_position}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {ranking.company_name}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{ranking.industry}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-nightsky">
                                {ranking.visibility_score.toFixed(1)}%
                              </span>
                              <span className="text-xs text-silver/60">
                                ({ranking.mentioned_count}/{ranking.total_responses})
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {ranking.detected_competitors ? (
                              <div className="text-sm text-silver/70 max-w-md truncate" title={ranking.detected_competitors}>
                                {ranking.detected_competitors}
                              </div>
                            ) : (
                              <span className="text-sm text-silver/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {ranking.rank_position} of {ranking.total_companies_in_ranking}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
