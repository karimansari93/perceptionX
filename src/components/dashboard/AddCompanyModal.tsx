import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { retrySupabaseFunction } from '@/utils/supabaseRetry';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';
import { generatePromptsFromData } from '@/hooks/usePromptsLogic';
import { Star, RefreshCw } from 'lucide-react';

// Helper function to get country name from code
const getCountryName = (code: string): string => {
  const countryNames: Record<string, string> = {
    'GLOBAL': 'Global',
    'PL': 'Poland',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'PT': 'Portugal',
    'NL': 'Netherlands',
    'CZ': 'Czech Republic',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'LT': 'Lithuania',
    'LV': 'Latvia',
    'EE': 'Estonia',
    'FI': 'Finland',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'GR': 'Greece',
    'JP': 'Japan',
    'KR': 'South Korea',
    'TH': 'Thailand',
    'ID': 'Indonesia',
    'VN': 'Vietnam',
    'TR': 'Turkey',
    'RU': 'Russia',
    'CN': 'China',
    'MX': 'Mexico',
    'AR': 'Argentina',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'BR': 'Brazil',
    'AE': 'United Arab Emirates',
    'SA': 'Saudi Arabia',
    'AT': 'Austria',
    'CH': 'Switzerland',
    'BE': 'Belgium',
  };
  return countryNames[code] || code;
};

// Custom AI model logo component
const AIModelLogo = ({ modelName, size = 'lg' }: { modelName: string; size?: 'sm' | 'md' | 'lg' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-12 h-12',
  };

  const getLogoPath = (model: string) => {
    const normalizedModel = model.toLowerCase();
    
    if (normalizedModel.includes('google') || normalizedModel.includes('google-ai')) {
      return '/logos/google.png';
    } else if (normalizedModel.includes('openai') || normalizedModel.includes('chatgpt')) {
      return '/logos/chatgpt.png';
    } else if (normalizedModel.includes('perplexity')) {
      return '/logos/perplexity.png';
    }
    
    return null;
  };

  const logoPath = getLogoPath(modelName);
  
  if (logoPath) {
    return (
      <img 
        src={logoPath} 
        alt={`${modelName} logo`}
        className={`${sizeClasses[size]} object-contain`}
      />
    );
  }
  
  return (
    <div className={`${sizeClasses[size]} bg-gray-100 rounded flex items-center justify-center`}>
      <span className="text-xs font-medium text-gray-600">
        {modelName?.charAt(0)?.toUpperCase() || 'A'}
      </span>
    </div>
  );
};

interface AddCompanyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alwaysMounted?: boolean;
  existingCompanyName?: string;
  existingIndustry?: string;
  mode?: 'new' | 'add-location';
}

interface ProgressInfo {
  currentPrompt: string;
  currentModel: string;
  completed: number;
  total: number;
}

// Helper function to wait for company creation
const waitForCompany = async (onboardingId: string, maxAttempts = 10) => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from('user_onboarding')
      .select('company_id')
      .eq('id', onboardingId)
      .single();
    
    if (error) {
      console.error('❌ Error fetching onboarding data:', error);
      throw new Error('Failed to get company information from onboarding record');
    }
    
    if (data?.company_id) {
      return data.company_id;
    }
    
    // Wait with exponential backoff
    const delay = 500 * (attempt + 1);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  throw new Error('Company creation timed out after maximum attempts');
};

export const AddCompanyModal = ({ 
  open, 
  onOpenChange, 
  alwaysMounted = false,
  existingCompanyName,
  existingIndustry,
  mode = 'new'
}: AddCompanyModalProps) => {
  const { user } = useAuth();
  const { refreshCompanies, switchCompany } = useCompany();
  const { isPro } = useSubscription();
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [country, setCountry] = useState('GLOBAL');

  // Initialize form when modal opens or props change
  useEffect(() => {
    if (open) {
      if (mode === 'add-location' && existingCompanyName && existingIndustry) {
        setCompanyName(existingCompanyName);
        setIndustry(existingIndustry);
        setCountry('GLOBAL');
      } else {
        setCompanyName('');
        setIndustry('');
        setCountry('GLOBAL');
      }
    }
  }, [open, mode, existingCompanyName, existingIndustry]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCollectingSearchInsights, setIsCollectingSearchInsights] = useState(false);
  const [collectingCompanyId, setCollectingCompanyId] = useState<string | null>(null);
  /** When set, Step 2 stays visible with this error message and user can close (avoids Step 2 disappearing on timeout/error). */
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo>({
    currentPrompt: '',
    currentModel: '',
    completed: 0,
    total: 0,
  });

  // Poll company progress during LLM phase so the progress bar updates in real time
  useEffect(() => {
    if (!isAnalyzing || !collectingCompanyId || isCollectingSearchInsights) return;
    const poll = async () => {
      const { data } = await supabase
        .from('companies')
        .select('data_collection_status, data_collection_progress')
        .eq('id', collectingCompanyId)
        .single();
      if (data?.data_collection_progress && typeof data.data_collection_progress === 'object') {
        const p = data.data_collection_progress as { completed?: number; total?: number; currentPrompt?: string; currentModel?: string };
        setProgress(prev => ({
          ...prev,
          completed: p.completed ?? prev.completed,
          total: p.total ?? prev.total,
          currentPrompt: p.currentPrompt ?? prev.currentPrompt,
          currentModel: p.currentModel ?? prev.currentModel,
        }));
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [isAnalyzing, collectingCompanyId, isCollectingSearchInsights]);

  // No need for company limit checks here - the modal should only be opened when user is allowed to add a company

  const handleClose = () => {
    // Prevent closing during analysis or search insights collection (allow close if step2Error so user can dismiss after error)
    if (!step2Error && (isAnalyzing || isCollectingSearchInsights)) {
      toast.error('Please wait for the process to complete before closing.');
      return;
    }
    
    setCompanyName('');
    setIndustry('');
    setCountry('GLOBAL');
    setIsAnalyzing(false);
    setIsCollectingSearchInsights(false);
    setCollectingCompanyId(null);
    setStep2Error(null);
    setProgress({
      currentPrompt: '',
      currentModel: '',
      completed: 0,
      total: 0,
    });
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    // Prevent closing during analysis or search insights collection (allow close if step2Error)
    if (!newOpen && !step2Error && (isAnalyzing || isCollectingSearchInsights)) {
      toast.error('Please wait for the process to complete before closing.');
      return;
    }
    
    // Allow closing if not in progress
    if (!newOpen) {
      handleClose();
    } else {
      onOpenChange(newOpen);
    }
  };

  const handleSubmit = async () => {
    if (!companyName.trim() || !industry.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!user) {
      toast.error('You must be logged in');
      return;
    }

    // Company limit check is handled before opening the modal

    setStep2Error(null);
    setIsAnalyzing(true);
    let onboardingData: any = null;
    let companyId: string | null = null;

    try {
      // 1. Create onboarding record
      const { data: onboarding, error: onboardingError } = await supabase
        .from('user_onboarding')
        .insert({
          user_id: user.id,
          company_name: companyName,
          industry: industry,
          country: country,
          session_id: `session_${user.id}_${Date.now()}`
        })
        .select()
        .single();

      if (onboardingError) throw onboardingError;
      onboardingData = onboarding;

      // 2. Wait for company creation
      companyId = await waitForCompany(onboardingData.id);
      setCollectingCompanyId(companyId);
      const newCompany = { id: companyId };

      // 2.5. Initialize collection status in database
      await supabase
        .from('companies')
        .update({
          data_collection_status: 'pending',
          data_collection_started_at: new Date().toISOString(),
          onboarding_id: onboardingData.id
        })
        .eq('id', companyId);

      // 3. Generate prompts
      const generatedPrompts = generatePromptsFromData({
        companyName,
        industry,
        country
      }, isPro);

      // 3.5. Translate prompts if country is not GLOBAL and language is not English
      // CRITICAL: Translation is REQUIRED for non-English countries - cannot proceed without it
      let finalPrompts = generatedPrompts;
      if (country && country !== 'GLOBAL') {
        // Check if country uses English (no translation needed)
        const englishSpeakingCountries = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'ZA', 'IN', 'SG', 'MY', 'PH', 'HK', 'AE', 'SA'];
        const needsTranslation = !englishSpeakingCountries.includes(country);
        
        if (needsTranslation) {
          try {
            console.log(`🌍 Translating ${generatedPrompts.length} prompts for country: ${country}`);
            const promptTexts = generatedPrompts.map(p => p.text);

            const invokeTranslate = () =>
              supabase.functions.invoke('translate-prompts', {
                body: { prompts: promptTexts, countryCode: country },
              });
            let { data: translationData, error: translationError } = await invokeTranslate();
            if (translationError && (translationError.message?.includes('504') || translationError.message?.includes('timeout'))) {
              console.warn('🔄 Translation timed out, retrying once...');
              await new Promise((r) => setTimeout(r, 2000));
              const retry = await invokeTranslate();
              translationData = retry.data;
              translationError = retry.error;
            }

            if (!translationError && translationData?.translatedPrompts && translationData.translatedPrompts.length > 0) {
              // Verify all prompts were translated
              const allTranslated = translationData.translatedPrompts.every((translated: string, index: number) => 
                translated && translated.trim().length > 0 && translated !== promptTexts[index]
              );
              
              if (allTranslated) {
                // Map translated prompts back to the original prompt structure
                finalPrompts = generatedPrompts.map((prompt, index) => ({
                  ...prompt,
                  text: translationData.translatedPrompts[index] || prompt.text
                }));
                console.log(`✅ Translated prompts to ${translationData.targetLanguage || 'target language'}`);
              } else {
                // Translation incomplete - fail the process
                const countryName = getCountryName(country);
                const targetLanguage = translationData?.targetLanguage || 'the local language';
                throw new Error(`Translation incomplete for ${countryName}. All prompts must be translated to ${targetLanguage}.`);
              }
            } else {
              // Translation failed - fail the process
              const countryName = getCountryName(country);
              const errorMessage = translationError?.message || 'Unknown error';
              throw new Error(`Failed to translate prompts for ${countryName}. Translation service error: ${errorMessage}`);
            }
          } catch (translationException: any) {
            // Translation is REQUIRED - cannot proceed without it
            const countryName = getCountryName(country);
            const errorMsg = translationException?.message || translationException?.toString() || 'Translation service unavailable';
            console.error(`❌ Translation failed for ${countryName}:`, errorMsg);
            toast.error(`Cannot proceed: Translation to ${countryName}'s language is required but failed. Please try again or contact support.`);
            setIsAnalyzing(false);
            setIsCollectingSearchInsights(false);
            return; // Stop the process - don't create company with English prompts
          }
        } else {
          console.log(`✅ Country ${country} uses English, skipping translation`);
        }
      }

      // 4. Insert prompts
      const promptsToInsert = finalPrompts.map(prompt => {
        // Extract talentx_attribute_id if this is a TalentX prompt
        // Format: talentx-{attributeId}-{type}
        let talentxAttributeId = null;
        if (prompt.id.startsWith('talentx-')) {
          // Remove 'talentx-' prefix and get the attributeId (everything before the last '-')
          const parts = prompt.id.replace('talentx-', '').split('-');
          // Remove the last part (which is the type: experience/competitive/discovery/informational)
          parts.pop();
          talentxAttributeId = parts.join('-');
        }

        return {
          onboarding_id: onboardingData.id,
          user_id: user.id,
          company_id: newCompany.id,
          prompt_text: prompt.text,
        prompt_category: prompt.promptCategory,
        prompt_theme: prompt.promptTheme,
          prompt_type: prompt.type,
          talentx_attribute_id: talentxAttributeId,
          industry_context: prompt.industryContext || industry,
          job_function_context: prompt.jobFunctionContext || null,
          location_context: prompt.locationContext || null,
          is_active: true
        };
      });

      const { error: insertError } = await supabase
        .from('confirmed_prompts')
        .insert(promptsToInsert);

      if (insertError) throw insertError;

      // 5. Get confirmed prompts
      const { data: confirmedPrompts, error: confirmedError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('onboarding_id', onboardingData.id);

      if (confirmedError) throw confirmedError;

      if (!confirmedPrompts || confirmedPrompts.length === 0) {
        throw new Error('No prompts generated');
      }

      // 6. Define AI models
      const models = [
        { name: 'openai', functionName: 'test-prompt-openai', displayName: 'ChatGPT' },
        { name: 'perplexity', functionName: 'test-prompt-perplexity', displayName: 'Perplexity' },
        { name: 'google-ai-overviews', functionName: 'test-prompt-google-ai-overviews', displayName: 'Google AI' }
        // Bing Copilot temporarily disabled - not working
      ];

      // 7. Run search insights FIRST
      setIsCollectingSearchInsights(true);
      
      // Update status to collecting_search_insights
      await supabase
        .from('companies')
        .update({ data_collection_status: 'collecting_search_insights' })
        .eq('id', companyId);

      const runSearchInsights = async () => {
        try {
          console.log(`🌍 Running search insights for company with country: ${country || 'GLOBAL'}`);
          const { error: searchError } = await supabase.functions.invoke('search-insights', {
            body: {
              companyName: companyName,
              company_id: newCompany.id,
              onboarding_id: onboardingData.id // Pass onboarding_id for reliable country lookup
            }
          });

          if (searchError) {
            console.error('❌ Search insights error:', searchError);
          } else {
            console.log(`✅ Search insights completed for ${companyName} (country: ${country || 'GLOBAL'})`);
          }
          
        } catch (searchException) {
          console.error('Exception during search insights:', searchException);
        }
      };

      // Wait for search insights to complete
      await runSearchInsights();
      
      // Transition to LLM analysis phase
      setIsCollectingSearchInsights(false);
      
      // 8. Calculate total operations BEFORE updating status
      const totalOperations = confirmedPrompts.length * models.length;
      
      // Update status to collecting_llm_data
      await supabase
        .from('companies')
        .update({ 
          data_collection_status: 'collecting_llm_data',
          data_collection_progress: {
            currentPrompt: 'Starting AI analysis...',
            currentModel: '',
            completed: 0,
            total: totalOperations
          }
        })
        .eq('id', companyId);

      // 9. Run AI analysis via batch collect-company-responses (parallel models per prompt, stays under 60s)
      setProgress({
        currentPrompt: 'Collecting AI responses...',
        currentModel: 'Batch',
        completed: 0,
        total: totalOperations,
      });

      await supabase
        .from('companies')
        .update({
          data_collection_progress: {
            currentPrompt: 'Collecting AI responses...',
            currentModel: 'Batch',
            completed: 0,
            total: totalOperations,
          },
        })
        .eq('id', companyId);

      const promptIds = confirmedPrompts.map((p) => p.id);
      const modelNames = models.map((m) => m.name);

      const batchBody = {
        companyId: newCompany.id,
        promptIds,
        models: modelNames,
        batchSize: 3,
        skipExisting: true,
      };
      const { data: batchData, error: batchError } = await retrySupabaseFunction('collect-company-responses', batchBody, {
        maxRetries: 2,
        initialDelay: 2000,
      });

      if (batchError) {
        console.error('Batch collection error:', batchError);
        const isFetchError =
          batchError?.name === 'FunctionsFetchError' ||
          (batchError?.message && String(batchError.message).toLowerCase().includes('failed to send a request'));
        const msg = isFetchError
          ? 'Could not reach the server. Check your connection and try again, or the Edge Function may need to be redeployed (see docs/debug/DEBUG_CORS_EDGE_FUNCTIONS.md).'
          : batchError.message || 'Connection or timeout error. Collection may still be running.';
        setStep2Error(msg);
        toast.error(isFetchError ? 'Server unreachable — check connection or redeploy Edge Function' : `Collection failed: ${batchError.message}`);
        return; // Keep Step 2 visible with error; do not close or run success path
      }
      if (!batchData?.success) {
        console.error('Batch collection failed:', batchData?.error);
        const msg = batchData?.error || 'Collection failed';
        setStep2Error(msg);
        toast.error(msg);
        return; // Keep Step 2 visible with error
      }

      setProgress({
        currentPrompt: 'Complete',
        currentModel: '',
        completed: totalOperations,
        total: totalOperations,
      });

      await supabase
        .from('companies')
        .update({
          data_collection_progress: {
            currentPrompt: 'Complete',
            currentModel: '',
            completed: totalOperations,
            total: totalOperations,
          },
        })
        .eq('id', companyId);

      // Mark collection as completed
      await supabase
        .from('companies')
        .update({
          data_collection_status: 'completed',
          data_collection_completed_at: new Date().toISOString(),
          data_collection_progress: null
        })
        .eq('id', companyId);

      // 9. Success
      toast.success('Company analysis complete!');

      // Refresh companies to load the new company into context
      await refreshCompanies();

      // Wait for the company to appear in the context
      let companyFound = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        
        // Check if company exists in userCompanies by refreshing
        await refreshCompanies();
        
        const { data: verifyCompany } = await supabase
          .from('company_members')
          .select('company_id, company:companies(*)')
          .eq('user_id', user.id)
          .eq('company_id', newCompany.id)
          .single();
        
        if (verifyCompany) {
          companyFound = true;
          break;
        }
      }

      if (!companyFound) {
        console.error('Company membership not found after creation');
        toast.error('Company created but membership not found. Please refresh the page.');
        handleClose();
        return;
      }

      // CRITICAL: Switch to the new company BEFORE closing the modal
      // This ensures the switch happens before any other state updates
      await switchCompany(newCompany.id);

      // Small delay to ensure the switch completes
      await new Promise(resolve => setTimeout(resolve, 500));

      setCollectingCompanyId(null);
      // Now close the modal
      handleClose();

    } catch (error) {
      console.error('Error analyzing company:', error);
      const errMsg = error instanceof Error ? error.message : 'Failed to analyze company';
      toast.error(errMsg);
      // Keep Step 2 visible with error instead of reverting to form (only set step2Error if we're in Step 2)
      if (progress.total > 0) {
        setStep2Error(errMsg);
      } else {
        setIsAnalyzing(false);
      }
      setIsCollectingSearchInsights(false);
      setCollectingCompanyId(null);
      
      // Mark collection as failed if we have a companyId
      if (companyId) {
        try {
          await supabase
            .from('companies')
            .update({ data_collection_status: 'failed' })
            .eq('id', companyId);
        } catch (updateError) {
          console.error('Error updating collection status to failed:', updateError);
        }
      }
    }
  };

  // Loading state - Search insights phase
  if (isAnalyzing && isCollectingSearchInsights) {
    return (
      <Dialog 
        open={open} 
        onOpenChange={(newOpen) => {
          // Completely block any close attempts during analysis
          if (!newOpen && isAnalyzing) {
            return;
          }
        }}
        modal={true}
        {...(alwaysMounted && { forceMount: true })}
      >
        <DialogContent 
          className="max-w-md" 
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Collecting Data for {companyName}</DialogTitle>
            <DialogDescription>
              Step 1 of 2 — We're collecting traditional search results first
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Step 1 of 2</span>
              <span>Search insights</span>
            </div>
            <div className="flex justify-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>

            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-blue-700 text-center">
                Gathering search insights from traditional search engines...
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Loading state - LLM analysis phase (also show when step2Error so Step 2 doesn't "close" before user can read error)
  const showingStep2 = (isAnalyzing || step2Error) && progress.total > 0;
  if (showingStep2) {
    const progressPercent = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
    const allowClose = !!step2Error;
    
    return (
      <Dialog 
        open={open} 
        onOpenChange={(newOpen) => {
          if (!newOpen && !allowClose) return;
          if (!newOpen) handleClose();
        }}
        modal={true}
        {...(alwaysMounted && { forceMount: true })}
      >
        <DialogContent 
          className="max-w-md" 
          onInteractOutside={(e) => {
            if (!allowClose) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!allowClose) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Analyzing {companyName}</DialogTitle>
            <DialogDescription>
              Step 2 of 2 — {step2Error ? 'Something went wrong' : `Please wait while we analyze ${companyName} across multiple AI platforms`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {step2Error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">Collection failed or timed out</p>
                <p className="mt-1 text-red-700">{step2Error}</p>
                <p className="mt-2 text-red-600">You can close and retry, or check this company later — collection may have continued in the background.</p>
                <Button variant="outline" size="sm" className="mt-3 border-red-300 text-red-700 hover:bg-red-100" onClick={handleClose}>
                  Close
                </Button>
              </div>
            )}
            {!step2Error && (
              <>
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>Step 2 of 2</span>
                  <span>{progress.completed} / {progress.total} responses</span>
                </div>
                <div className="flex justify-center">
                  <AIModelLogo modelName={progress.currentModel} size="lg" />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{progress.currentModel}</span>
                    <span className="text-gray-600">{progress.completed} / {progress.total}</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                  <p className="text-xs text-gray-500 text-center truncate max-w-full" title={progress.currentPrompt || undefined}>
                    {progress.currentPrompt || 'Analyzing responses...'}
                  </p>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-blue-700 text-center">
                    This may take 2-3 minutes. We're gathering insights from multiple AI sources.
                  </p>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Form state
  return (
    <Dialog 
      open={open} 
      onOpenChange={handleOpenChange}
      modal={true}
      {...(alwaysMounted && { forceMount: true })}
    >
      <DialogContent 
        className="max-w-md"
        onPointerDownOutside={(e) => {
          if (isAnalyzing || isCollectingSearchInsights) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'add-location' ? 'Add Location for Company' : 'Add New Company'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'add-location' 
              ? 'Add a new location for this company. You can also adjust the industry if needed. We\'ll scan AI to uncover what people really think about working there in this location.'
              : 'We\'ll scan AI to uncover what people really think about working there.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Progress Banner - Show when collecting search insights */}
          {isCollectingSearchInsights && (
            <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 border border-blue-200">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>
                  Collecting search results and response data... This may take a minute.
                </span>
              </div>
            </div>
          )}

          {/* Company limit checks are handled before opening the modal */}

          <div className="space-y-2">
            <Label htmlFor="company">Company *</Label>
            <Input
              id="company"
              placeholder="e.g., Tesla"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={isAnalyzing || mode === 'add-location'}
              className={mode === 'add-location' ? 'bg-gray-100 cursor-not-allowed' : ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="industry">Industry *</Label>
            <Input
              id="industry"
              placeholder="e.g., Software"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              disabled={isAnalyzing}
            />
            {mode === 'add-location' && (
              <p className="text-xs text-muted-foreground">
                You can change the industry for this location if needed.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="country" className="flex items-center gap-2">
              {mode === 'add-location' ? 'Country/Location *' : 'Country'}
            </Label>
            <Select value={country} onValueChange={setCountry} disabled={isAnalyzing || (mode !== 'add-location')}>
              <SelectTrigger id="country" className={mode !== 'add-location' ? 'cursor-not-allowed opacity-50' : ''}>
                <SelectValue placeholder="Select a country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GLOBAL">🌍 Global</SelectItem>
                <SelectItem value="AX">🇦🇽 Åland Islands</SelectItem>
                <SelectItem value="AD">🇦🇩 Andorra</SelectItem>
                <SelectItem value="AI">🇦🇮 Anguilla</SelectItem>
                <SelectItem value="AQ">🇦🇶 Antarctica</SelectItem>
                <SelectItem value="AG">🇦🇬 Antigua and Barbuda</SelectItem>
                <SelectItem value="AR">🇦🇷 Argentina</SelectItem>
                <SelectItem value="AW">🇦🇼 Aruba</SelectItem>
                <SelectItem value="AU">🇦🇺 Australia</SelectItem>
                <SelectItem value="AT">🇦🇹 Austria</SelectItem>
                <SelectItem value="BS">🇧🇸 Bahamas</SelectItem>
                <SelectItem value="BB">🇧🇧 Barbados</SelectItem>
                <SelectItem value="BE">🇧🇪 Belgium</SelectItem>
                <SelectItem value="BM">🇧🇲 Bermuda</SelectItem>
                <SelectItem value="BV">🇧🇻 Bouvet Island</SelectItem>
                <SelectItem value="BR">🇧🇷 Brazil</SelectItem>
                <SelectItem value="IO">🇮🇴 British Indian Ocean Territory</SelectItem>
                <SelectItem value="VG">🇻🇬 British Virgin Islands</SelectItem>
                <SelectItem value="BG">🇧🇬 Bulgaria</SelectItem>
                <SelectItem value="CA">🇨🇦 Canada</SelectItem>
                <SelectItem value="BQ">🇧🇶 Caribbean Netherlands</SelectItem>
                <SelectItem value="KY">🇰🇾 Cayman Islands</SelectItem>
                <SelectItem value="CL">🇨🇱 Chile</SelectItem>
                <SelectItem value="CO">🇨🇴 Colombia</SelectItem>
                <SelectItem value="HR">🇭🇷 Croatia</SelectItem>
                <SelectItem value="CU">🇨🇺 Cuba</SelectItem>
                <SelectItem value="CW">🇨🇼 Curaçao</SelectItem>
                <SelectItem value="CY">🇨🇾 Cyprus</SelectItem>
                <SelectItem value="CZ">🇨🇿 Czech Republic</SelectItem>
                <SelectItem value="DK">🇩🇰 Denmark</SelectItem>
                <SelectItem value="DM">🇩🇲 Dominica</SelectItem>
                <SelectItem value="DO">🇩🇴 Dominican Republic</SelectItem>
                <SelectItem value="EE">🇪🇪 Estonia</SelectItem>
                <SelectItem value="FK">🇫🇰 Falkland Islands</SelectItem>
                <SelectItem value="FO">🇫🇴 Faroe Islands</SelectItem>
                <SelectItem value="FI">🇫🇮 Finland</SelectItem>
                <SelectItem value="FR">🇫🇷 France</SelectItem>
                <SelectItem value="GF">🇬🇫 French Guiana</SelectItem>
                <SelectItem value="PF">🇵🇫 French Polynesia</SelectItem>
                <SelectItem value="DE">🇩🇪 Germany</SelectItem>
                <SelectItem value="GI">🇬🇮 Gibraltar</SelectItem>
                <SelectItem value="GR">🇬🇷 Greece</SelectItem>
                <SelectItem value="GL">🇬🇱 Greenland</SelectItem>
                <SelectItem value="GD">🇬🇩 Grenada</SelectItem>
                <SelectItem value="GP">🇬🇵 Guadeloupe</SelectItem>
                <SelectItem value="HT">🇭🇹 Haiti</SelectItem>
                <SelectItem value="HM">🇭🇲 Heard Island and McDonald Islands</SelectItem>
                <SelectItem value="HU">🇭🇺 Hungary</SelectItem>
                <SelectItem value="IS">🇮🇸 Iceland</SelectItem>
                <SelectItem value="IN">🇮🇳 India</SelectItem>
                <SelectItem value="ID">🇮🇩 Indonesia</SelectItem>
                <SelectItem value="IE">🇮🇪 Ireland</SelectItem>
                <SelectItem value="IT">🇮🇹 Italy</SelectItem>
                <SelectItem value="JM">🇯🇲 Jamaica</SelectItem>
                <SelectItem value="JP">🇯🇵 Japan</SelectItem>
                <SelectItem value="LV">🇱🇻 Latvia</SelectItem>
                <SelectItem value="LI">🇱🇮 Liechtenstein</SelectItem>
                <SelectItem value="LT">🇱🇹 Lithuania</SelectItem>
                <SelectItem value="LU">🇱🇺 Luxembourg</SelectItem>
                <SelectItem value="MY">🇲🇾 Malaysia</SelectItem>
                <SelectItem value="MT">🇲🇹 Malta</SelectItem>
                <SelectItem value="MQ">🇲🇶 Martinique</SelectItem>
                <SelectItem value="YT">🇾🇹 Mayotte</SelectItem>
                <SelectItem value="MX">🇲🇽 Mexico</SelectItem>
                <SelectItem value="MC">🇲🇨 Monaco</SelectItem>
                <SelectItem value="MS">🇲🇸 Montserrat</SelectItem>
                <SelectItem value="NL">🇳🇱 Netherlands</SelectItem>
                <SelectItem value="NC">🇳🇨 New Caledonia</SelectItem>
                <SelectItem value="NZ">🇳🇿 New Zealand</SelectItem>
                <SelectItem value="NO">🇳🇴 Norway</SelectItem>
                <SelectItem value="PS">🇵🇸 Palestine</SelectItem>
                <SelectItem value="PE">🇵🇪 Peru</SelectItem>
                <SelectItem value="PH">🇵🇭 Philippines</SelectItem>
                <SelectItem value="PL">🇵🇱 Poland</SelectItem>
                <SelectItem value="PT">🇵🇹 Portugal</SelectItem>
                <SelectItem value="PR">🇵🇷 Puerto Rico</SelectItem>
                <SelectItem value="RE">🇷🇪 Réunion</SelectItem>
                <SelectItem value="RO">🇷🇴 Romania</SelectItem>
                <SelectItem value="BL">🇧🇱 Saint Barthélemy</SelectItem>
                <SelectItem value="KN">🇰🇳 Saint Kitts and Nevis</SelectItem>
                <SelectItem value="LC">🇱🇨 Saint Lucia</SelectItem>
                <SelectItem value="MF">🇲🇫 Saint Martin</SelectItem>
                <SelectItem value="PM">🇵🇲 Saint Pierre and Miquelon</SelectItem>
                <SelectItem value="VC">🇻🇨 Saint Vincent and the Grenadines</SelectItem>
                <SelectItem value="SM">🇸🇲 San Marino</SelectItem>
                <SelectItem value="SA">🇸🇦 Saudi Arabia</SelectItem>
                <SelectItem value="SG">🇸🇬 Singapore</SelectItem>
                <SelectItem value="SX">🇸🇽 Sint Maarten</SelectItem>
                <SelectItem value="SK">🇸🇰 Slovakia</SelectItem>
                <SelectItem value="SI">🇸🇮 Slovenia</SelectItem>
                <SelectItem value="ZA">🇿🇦 South Africa</SelectItem>
                <SelectItem value="GS">🇬🇸 South Georgia and the South Sandwich Islands</SelectItem>
                <SelectItem value="KR">🇰🇷 South Korea</SelectItem>
                <SelectItem value="ES">🇪🇸 Spain</SelectItem>
                <SelectItem value="SJ">🇸🇯 Svalbard and Jan Mayen</SelectItem>
                <SelectItem value="SE">🇸🇪 Sweden</SelectItem>
                <SelectItem value="CH">🇨🇭 Switzerland</SelectItem>
                <SelectItem value="TH">🇹🇭 Thailand</SelectItem>
                <SelectItem value="TT">🇹🇹 Trinidad and Tobago</SelectItem>
                <SelectItem value="TR">🇹🇷 Turkey</SelectItem>
                <SelectItem value="TC">🇹🇨 Turks and Caicos Islands</SelectItem>
                <SelectItem value="AE">🇦🇪 United Arab Emirates</SelectItem>
                <SelectItem value="GB">🇬🇧 United Kingdom</SelectItem>
                <SelectItem value="US">🇺🇸 United States</SelectItem>
                <SelectItem value="VA">🇻🇦 Vatican City</SelectItem>
                <SelectItem value="VN">🇻🇳 Vietnam</SelectItem>
                <SelectItem value="WF">🇼🇫 Wallis and Futuna</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isAnalyzing || isCollectingSearchInsights}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isAnalyzing || isCollectingSearchInsights || !companyName.trim() || !industry.trim() || (mode === 'add-location' && !country)}
              className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
            >
              {(isAnalyzing || isCollectingSearchInsights) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  {isCollectingSearchInsights ? 'Collecting data...' : 'Analyzing...'}
                </>
              ) : (
                <>
                  <Star className="h-4 w-4 mr-2" />
                  Analyze Company
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};