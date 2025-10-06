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
import { Star } from 'lucide-react';

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

export const AddCompanyModal = ({ open, onOpenChange, alwaysMounted = false }: AddCompanyModalProps) => {
  const { user } = useAuth();
  const { refreshCompanies, switchCompany } = useCompany();
  const { isPro } = useSubscription();
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [country, setCountry] = useState('GLOBAL');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo>({
    currentPrompt: '',
    currentModel: '',
    completed: 0,
    total: 0,
  });
  
  // No need for company limit checks here - the modal should only be opened when user is allowed to add a company

  const handleClose = () => {
    // Prevent closing during analysis
    if (isAnalyzing) {
      toast.error('Please wait for the analysis to complete before closing.');
      return;
    }
    
    setCompanyName('');
    setIndustry('');
    setCountry('GLOBAL');
    setIsAnalyzing(false);
    setProgress({
      currentPrompt: '',
      currentModel: '',
      completed: 0,
      total: 0,
    });
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    // ONLY prevent closing during analysis - everything else is user intent
    if (!newOpen && isAnalyzing) {
      toast.error('Please wait for the analysis to complete before closing.');
      return;
    }
    
    // Allow ALL other user actions - no more "smart" detection
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

    try {
      // 1. Create onboarding record
      const { data: onboardingData, error: onboardingError } = await supabase
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

      // 2. Wait for company creation
      const companyId = await waitForCompany(onboardingData.id);
      const newCompany = { id: companyId };

      // 3. Generate prompts
      const generatedPrompts = generatePromptsFromData({
        companyName,
        industry,
        country
      }, isPro);

      // 4. Insert prompts
      const promptsToInsert = generatedPrompts.map(prompt => ({
        onboarding_id: onboardingData.id,
        user_id: user.id,
        company_id: newCompany.id,
        prompt_text: prompt.text,
        prompt_category: prompt.category,
        prompt_type: prompt.type,
        is_active: true
      }));

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
        { name: 'google-ai-overviews', functionName: 'test-prompt-google-ai-overviews', displayName: 'Google AI' },
      ];

      const totalOperations = confirmedPrompts.length * models.length + 1;
      let completedOperations = 0;

      setProgress({
        currentPrompt: 'Starting analysis...',
        currentModel: '',
        completed: 0,
        total: totalOperations,
      });

      // 7. Run AI analysis
      const runAIPrompts = async () => {
        for (const prompt of confirmedPrompts) {
          for (const model of models) {
            try {
              setProgress({
                currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
                currentModel: model.displayName,
                completed: completedOperations,
                total: totalOperations,
              });

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
              setProgress(prev => ({ ...prev, completed: completedOperations }));

            } catch (error) {
              console.error(`Error testing ${model.name}:`, error);
              completedOperations++;
            }
          }
        }
      };

      // Run search insights (silently in background)
      const runSearchInsights = async () => {
        try {
          const { error: searchError } = await supabase.functions.invoke('search-insights', {
            body: {
              companyName: companyName,
              company_id: newCompany.id
            }
          });

          if (searchError) {
            console.error('❌ Search insights error:', searchError);
          }
          
          completedOperations++;
          setProgress(prev => ({ ...prev, completed: completedOperations }));
          
        } catch (searchException) {
          console.error('Exception during search insights:', searchException);
          completedOperations++;
          setProgress(prev => ({ ...prev, completed: completedOperations }));
        }
      };

      // Run both in parallel
      await Promise.all([runAIPrompts(), runSearchInsights()]);

      // 8. Success
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
    }
  };

  // Loading state
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
          if (isAnalyzing) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add New Company</DialogTitle>
          <DialogDescription>
            We'll scan AI to uncover what people really think about working there.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Company limit checks are handled before opening the modal */}

          <div className="space-y-2">
            <Label htmlFor="company">Company *</Label>
            <Input
              id="company"
              placeholder="e.g., Tesla"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={isAnalyzing}
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Select value={country} onValueChange={setCountry} disabled={isAnalyzing}>
              <SelectTrigger id="country">
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
              disabled={isAnalyzing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isAnalyzing || !companyName.trim() || !industry.trim()}
              className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
            >
              {isAnalyzing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Analyzing...
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