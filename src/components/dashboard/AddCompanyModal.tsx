import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';
import { generatePromptsFromData } from '@/hooks/usePromptsLogic';
import { Star, RefreshCw, Lock } from 'lucide-react';

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
  const [progress, setProgress] = useState<ProgressInfo>({
    currentPrompt: '',
    currentModel: '',
    completed: 0,
    total: 0,
  });
  
  // No need for company limit checks here - the modal should only be opened when user is allowed to add a company

  const handleClose = () => {
    // Prevent closing during analysis or search insights collection
    if (isAnalyzing || isCollectingSearchInsights) {
      toast.error('Please wait for the process to complete before closing.');
      return;
    }
    
    setCompanyName('');
    setIndustry('');
    setCountry('GLOBAL');
    setIsAnalyzing(false);
    setIsCollectingSearchInsights(false);
    setProgress({
      currentPrompt: '',
      currentModel: '',
      completed: 0,
      total: 0,
    });
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    // Prevent closing during analysis or search insights collection
    if (!newOpen && (isAnalyzing || isCollectingSearchInsights)) {
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
      let finalPrompts = generatedPrompts;
      if (country && country !== 'GLOBAL') {
        // Check if country uses English (no translation needed)
        const englishSpeakingCountries = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'ZA', 'IN', 'SG', 'MY', 'PH', 'HK', 'AE', 'SA'];
        const needsTranslation = !englishSpeakingCountries.includes(country);
        
        if (needsTranslation) {
          try {
            console.log(`🌍 Translating ${generatedPrompts.length} prompts for country: ${country}`);
            const promptTexts = generatedPrompts.map(p => p.text);
            
            const { data: translationData, error: translationError } = await supabase.functions.invoke('translate-prompts', {
              body: {
                prompts: promptTexts,
                countryCode: country
              }
            });

            if (!translationError && translationData?.translatedPrompts) {
              // Map translated prompts back to the original prompt structure
              finalPrompts = generatedPrompts.map((prompt, index) => ({
                ...prompt,
                text: translationData.translatedPrompts[index] || prompt.text
              }));
              console.log(`✅ Translated prompts to ${translationData.targetLanguage}`);
            } else {
              console.warn('⚠️ Translation failed, using original prompts:', translationError);
            }
          } catch (translationException) {
            console.warn('⚠️ Translation exception, using original prompts:', translationException);
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
          // Remove the last part (which is the type: sentiment/competitive/visibility)
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

      // 9. Run AI analysis
      let completedOperations = 0;

      setProgress({
        currentPrompt: 'Starting AI analysis...',
        currentModel: '',
        completed: 0,
        total: totalOperations,
      });

      const runAIPrompts = async () => {
        for (const prompt of confirmedPrompts) {
          for (const model of models) {
            try {
              const currentProgress = {
                currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
                currentModel: model.displayName,
                completed: completedOperations,
                total: totalOperations,
              };

              setProgress(currentProgress);

              // Update progress in database
              await supabase
                .from('companies')
                .update({ data_collection_progress: currentProgress })
                .eq('id', companyId);

              const { data: responseData, error: functionError } = await supabase.functions.invoke(model.functionName, {
                body: { prompt: prompt.prompt_text }
              });

              if (functionError) {
                console.error(`${model.functionName} error:`, functionError);
                completedOperations++;
                continue;
              }

              if (responseData?.response) {
                const perplexityCitations = model.name === 'perplexity' ? responseData.citations : null;
                const googleAICitations = model.name === 'google-ai-overviews' ? responseData.citations : null;

                const { error: analyzeError } = await supabase.functions.invoke('analyze-response', {
                  body: {
                    response: responseData.response,
                    companyName: companyName,
                    promptType: prompt.prompt_type,
                    perplexityCitations: perplexityCitations,
                    citations: googleAICitations,
                    confirmed_prompt_id: prompt.id,
                    ai_model: model.name,
                    company_id: newCompany.id,
                  }
                });

                if (analyzeError) {
                  console.error('Analyze error:', analyzeError);
                }
              }

              completedOperations++;
              const updatedProgress = {
                currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
                currentModel: model.displayName,
                completed: completedOperations,
                total: totalOperations,
              };
              setProgress(updatedProgress);

              // Update progress in database
              await supabase
                .from('companies')
                .update({ data_collection_progress: updatedProgress })
                .eq('id', companyId);

            } catch (error) {
              console.error(`Error testing ${model.name}:`, error);
              completedOperations++;
            }
          }
        }
      };

      // Run AI prompts
      await runAIPrompts();

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

      // Now close the modal
      handleClose();

    } catch (error) {
      console.error('Error analyzing company:', error);
      toast.error('Failed to analyze company');
      setIsAnalyzing(false);
      setIsCollectingSearchInsights(false);
      
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
              We're collecting traditional search results first
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
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

  // Loading state - LLM analysis phase
  if (isAnalyzing && progress.total > 0) {
    const progressPercent = (progress.completed / progress.total) * 100;
    
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
            <DialogTitle>Analyzing {companyName}</DialogTitle>
            <DialogDescription>
              Please wait while we analyze {companyName} across multiple AI platforms
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex justify-center">
              <AIModelLogo modelName={progress.currentModel} size="lg" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{progress.currentModel}</span>
                <span className="text-gray-600">{progress.completed} / {progress.total}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-gray-500 text-center">
                {progress.currentPrompt || 'Analyzing responses...'}
              </p>
            </div>

            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-blue-700 text-center">
                This may take 2-3 minutes. We're gathering insights from multiple AI sources.
              </p>
            </div>
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
              ? 'Add a new location for this company. We\'ll scan AI to uncover what people really think about working there in this location.'
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
              disabled={isAnalyzing || mode === 'add-location'}
              className={mode === 'add-location' ? 'bg-gray-100 cursor-not-allowed' : ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country" className="flex items-center gap-2">
              {mode === 'add-location' ? 'Country/Location *' : 'Country'}
              <Lock className="h-4 w-4 opacity-50" />
            </Label>
            <Select value={country} onValueChange={setCountry} disabled={true}>
              <SelectTrigger id="country" className={mode === 'add-location' ? 'cursor-not-allowed opacity-50' : 'cursor-not-allowed opacity-50'}>
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
              disabled={isAnalyzing || isCollectingSearchInsights || !companyName.trim() || !industry.trim()}
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