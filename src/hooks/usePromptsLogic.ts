import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getLLMDisplayName } from '@/config/llmLogos';
import { TALENTX_ATTRIBUTES, getProOnlyAttributes, getFreeAttributes, generateTalentXPrompts } from '@/config/talentXAttributes';
import { useSubscription } from '@/hooks/useSubscription';
import { logger, sanitizeInput, safeStorePromptResponse, checkExistingPromptResponse } from '@/lib/utils';
import { extractSourceUrl, extractDomain } from '@/utils/citationUtils';

interface OnboardingData {
  companyName: string;
  industry: string;
  country?: string;
  job_function?: string;
  jobFunction?: string;
  customLocation?: string;
}

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'informational' | 'experience' | 'competitive' | 'discovery' | 'talentx';
  industryContext?: string;
  jobFunctionContext?: string;
  locationContext?: string;
  promptCategory: 'General' | 'Employee Experience' | 'Candidate Experience';
  promptTheme: string;
}

export interface ProgressInfo {
  currentModel?: string;
  currentPrompt?: string;
  completed: number;
  total: number;
}

export const usePromptsLogic = (onboardingData?: OnboardingData) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const [prompts, setPrompts] = useState<GeneratedPrompt[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [onboardingRecord, setOnboardingRecord] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo>({
    currentModel: '',
    currentPrompt: '',
    completed: 0,
    total: 0
  });

  useEffect(() => {
    if (onboardingData && (onboardingData as any).id) {
      setOnboardingRecord(onboardingData);
    } else {
      const checkOnboarding = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) {
            setError('Please sign in to continue');
            return;
          }

          const { data, error } = await supabase
            .from('user_onboarding')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (error) throw error;

          if (!data || data.length === 0) {
            setError('Please complete onboarding first');
            return;
          }

          // Check if the onboarding record has the required fields
          const onboardingRecord = data[0];
          if (!onboardingRecord.company_name || !onboardingRecord.industry) {
            setError('Onboarding data is incomplete. Please complete onboarding first.');
            return;
          }

          setOnboardingRecord(onboardingRecord);
        } catch (error) {
          logger.error('Error checking onboarding:', error);
          setError('Failed to check onboarding status');
        }
      };
      checkOnboarding();
    }
  }, [onboardingData]);

  useEffect(() => {
    // Always generate fresh prompts with location support when onboarding data is available
    if (onboardingData) {
      generatePrompts();
    }
  }, [onboardingData]);

  const generatePrompts = () => {
    if (!onboardingData) {
      return;
    }
    const generated = generatePromptsFromData(
      {
        companyName: onboardingData.companyName,
        industry: onboardingData.industry,
        country: onboardingData.country,
        jobFunction: onboardingData.jobFunction || onboardingData.job_function,
      },
      isPro
    );

    // For onboarding preview we only need the core prompts
    setPrompts(generated.slice(0, 3));
  };

  const confirmAndStartMonitoring = async () => {
    if (!user || !onboardingRecord) {
      console.error('Missing user or onboardingRecord:', { user, onboardingRecord });
      toast.error('Missing user or onboarding data. Please try again.');
      return;
    }
    
    // Check if onboarding record has required fields
    if (!onboardingRecord.company_name || !onboardingRecord.industry) {
      console.error('Onboarding record missing required fields:', onboardingRecord);
      toast.error('Onboarding data is incomplete. Please complete onboarding first.');
      return;
    }
    
    // Check if prompts are already completed to prevent duplicate processing
    if (onboardingRecord.prompts_completed) {
      console.log('Prompts already completed, navigating to dashboard');
      navigate('/dashboard', { 
        state: { 
          shouldRefresh: true,
          onboardingData: {
            companyName: onboardingRecord.companyName,
            industry: onboardingRecord.industry,
            id: onboardingRecord.id
          }
        },
        replace: true 
      });
      return;
    }
    
    setIsConfirming(true);
    try {
      // Use subscription status from useSubscription hook
      const isProUser = isPro;

      // Use the new generateAndInsertPrompts function
      const onboardingData = {
        companyName: onboardingRecord.companyName,
        industry: onboardingRecord.industry
      };

      const confirmedPrompts = await generateAndInsertPrompts(
        user, 
        onboardingRecord, 
        onboardingData, 
        setProgress,
        isProUser
      );

      // Clear any existing responses for these prompts
      const promptIds = confirmedPrompts.map(p => p.id);
      const { error: deleteError } = await supabase
        .from('prompt_responses')
        .delete()
        .in('confirmed_prompt_id', promptIds);

      if (deleteError) {
        console.error('Error clearing existing responses:', deleteError);
        throw deleteError;
      }

      // Define which models to test based on subscription status
      const modelsToTest = [
        { name: 'openai', displayName: 'ChatGPT', functionName: 'test-prompt-openai' },
        { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
        { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' }
        // Bing Copilot temporarily disabled - not working
      ];

      // Now run the testing/monitoring process for all prompts
      const totalOperations = (confirmedPrompts?.length || 0) * modelsToTest.length;
      setProgress({ completed: 0, total: totalOperations });
      let completedOperations = 0;

      for (const confirmedPrompt of confirmedPrompts || []) {
        try {
          for (const model of modelsToTest) {
            setProgress(prev => ({ 
              ...prev, 
              currentModel: model.displayName,
              currentPrompt: confirmedPrompt.prompt_text
            }));
            
            try {
              await testWithModel(confirmedPrompt, model.functionName, model.name);
              completedOperations++;
              setProgress(prev => ({ ...prev, completed: completedOperations }));
            } catch (modelError) {
              console.error(`Error with ${model.name}:`, modelError);
              
              // Show error toast but continue with other models
              if (modelError.message?.includes('overloaded')) {
                toast.error(`${model.displayName} is currently overloaded. Skipping to next model.`);
              } else if (modelError.message?.includes('quota')) {
                toast.error(`${model.displayName} quota exceeded. Skipping to next model.`);
              } else {
                toast.error(`${model.displayName} failed: ${modelError.message}. Skipping to next model.`);
              }
              
              // Continue with next model instead of failing completely
              continue;
            }
          }
        } catch (error) {
          console.error('Error testing prompt:', error);
          
          // Provide specific error messages for common issues
          if (error.message?.includes('overloaded')) {
            toast.error(`The AI model is currently overloaded. Please try again in a few minutes.`);
          } else if (error.message?.includes('quota')) {
            toast.error(`API quota exceeded. Please try again later.`);
          } else if (error.message?.includes('authentication')) {
            toast.error(`Authentication error. Please contact support.`);
          } else {
            toast.error(`Error testing prompt: ${error.message}`);
          }
          
          // Continue with next prompt instead of failing completely
          continue;
        }
      }

              // Prompts confirmed and monitoring started - no toast needed
      
      // Ensure we're in a valid state before navigating
      if (completedOperations > 0) {
        try {
          // Update the onboarding record to mark prompts as completed (gracefully handle missing field)
          const { error: updateError } = await supabase
            .from('user_onboarding')
            .update({ prompts_completed: true })
            .eq('id', onboardingRecord.id);
          
          if (updateError) {
            console.warn('Could not update prompts_completed field (may not exist in database):', updateError);
            // Continue without failing the process
          }

          setTimeout(() => {
            navigate('/dashboard', { 
              state: { 
                shouldRefresh: true,
                onboardingData: {
                  companyName: onboardingRecord.companyName,
                  industry: onboardingRecord.industry,
                  id: onboardingRecord.id
                }
              },
              replace: true 
            });
          }, 1500);
        } catch (error) {
          console.error('Error in final update:', error);
          // Still navigate even if the update fails
          // The migration will handle setting prompts_completed later
          setTimeout(() => {
            navigate('/dashboard', { 
              state: { 
                shouldRefresh: true,
                onboardingData: {
                  companyName: onboardingRecord.companyName,
                  industry: onboardingRecord.industry,
                  id: onboardingRecord.id
                }
              },
              replace: true 
            });
          }, 1500);
        }
      } else {
        throw new Error('No operations were completed successfully');
      }
    } catch (error) {
      console.error('Error confirming prompts:', error);
      toast.error(error.message || 'Failed to confirm prompts. Please try again.');
      setIsConfirming(false);
    }
  };

  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
        console.error('Error details:', functionError.details);
        console.error('Error context:', functionError.context);
        
        // Handle specific error cases
        if (functionError.message?.includes('overloaded') || functionError.message?.includes('quota')) {
          throw new Error(`The ${modelName} model is currently overloaded. Please try again later.`);
        }
        
        if (functionError.message?.includes('API key') || functionError.message?.includes('unauthorized')) {
          throw new Error(`Authentication error with ${modelName}. Please contact support.`);
        }
        
        if (functionError.message?.includes('invalid')) {
          throw new Error(`Invalid request to ${modelName}. Please check your prompt.`);
        }
        
        // Check if there are additional error details
        if (functionError.details) {
          throw new Error(`API Error: ${functionError.message}. ${functionError.details}`);
        }
        
        throw new Error(`API Error: ${functionError.message}`);
      }

      if (!responseData) {
        throw new Error(`No response data from ${modelName}`);
      }

      if (!responseData.response) {
        throw new Error(`Invalid response format from ${modelName}`);
      }
      
      // Handle citations from Perplexity and Google AI Overviews responses
      const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
      const googleAICitations = functionName === 'test-prompt-google-ai-overviews' ? responseData.citations : null;
      
      // Check if response already exists for this prompt and model
      const responseExists = await checkExistingPromptResponse(
        supabase,
        confirmedPrompt.id,
        modelName
      );

      if (responseExists) {
        return;
      }

      // Analyze sentiment and extract citations with enhanced visibility support
      
      const { data: sentimentData, error: sentimentError } = await supabase.functions
        .invoke('analyze-response', {
          body: { 
            response: responseData.response,
            companyName: onboardingRecord?.company_name || onboardingData?.companyName,
            promptType: confirmedPrompt.prompt_type,
            perplexityCitations: perplexityCitations,
            citations: googleAICitations, // Pass Google AI citations
            confirmed_prompt_id: confirmedPrompt.id,
            ai_model: modelName,
            company_id: confirmedPrompt.company_id
          }
        });

      if (sentimentError) {
        throw new Error(`Sentiment Analysis Error: ${sentimentError.message}`);
      }

      if (!sentimentData) {
        throw new Error('No sentiment analysis data received');
      }
    } catch (error) {
      // Provide user-friendly error messages
      if (error.message?.includes('overloaded')) {
        throw new Error(`The ${modelName} model is currently experiencing high demand. Please try again in a few minutes.`);
      }
      
      if (error.message?.includes('quota')) {
        throw new Error(`API quota exceeded for ${modelName}. Please try again later.`);
      }
      
      throw error; // Re-throw to be handled by the caller
    }
  };

  return {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring,
    setIsConfirming
  };
};

// New utility function to generate and insert prompts
export const generateAndInsertPrompts = async (user: any, onboardingRecord: any, onboardingData: OnboardingData, setProgress: (progress: ProgressInfo) => void, isProUser: boolean = false) => {
  if (!user || !onboardingRecord) {
    throw new Error('Missing user or onboarding data');
  }

  // Check if prompts already exist for this onboarding record
  const { data: existingPrompts, error: existingError } = await supabase
    .from('confirmed_prompts')
    .select('*')
    .eq('onboarding_id', onboardingRecord.id);

  if (existingError) {
    console.error('Error checking existing prompts:', existingError);
  }

  if (existingPrompts && existingPrompts.length > 0) {
    return existingPrompts;
  }

  // Generate prompts based on onboarding data and subscription status
  let generatedPrompts = generatePromptsFromData(onboardingData, isProUser);
  
  // Translate prompts if country is not GLOBAL and language is not English
  // CRITICAL: Translation is REQUIRED for non-English countries - cannot proceed without it
  if (onboardingData.country && onboardingData.country !== 'GLOBAL') {
    // Check if country uses English (no translation needed)
    const englishSpeakingCountries = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'ZA', 'IN', 'SG', 'MY', 'PH', 'HK', 'AE', 'SA'];
    const needsTranslation = !englishSpeakingCountries.includes(onboardingData.country);
    
    if (needsTranslation) {
      try {
        console.log(`🌍 Translating ${generatedPrompts.length} prompts for country: ${onboardingData.country}`);
        const promptTexts = generatedPrompts.map(p => p.text);

        const invokeTranslate = () =>
          supabase.functions.invoke('translate-prompts', {
            body: { prompts: promptTexts, countryCode: onboardingData.country },
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
            generatedPrompts = generatedPrompts.map((prompt, index) => ({
              ...prompt,
              text: translationData.translatedPrompts[index] || prompt.text
            }));
            console.log(`✅ Translated prompts to ${translationData.targetLanguage || 'target language'}`);
          } else {
            // Translation incomplete - fail the process
            const targetLanguage = translationData?.targetLanguage || 'the local language';
            throw new Error(`Translation incomplete for ${onboardingData.country}. All prompts must be translated to ${targetLanguage}.`);
          }
        } else {
          // Translation failed - fail the process
          const errorMessage = translationError?.message || 'Unknown error';
          throw new Error(`Failed to translate prompts for ${onboardingData.country}. Translation service error: ${errorMessage}`);
        }
      } catch (translationException: any) {
        // Translation is REQUIRED - cannot proceed without it
        const errorMsg = translationException?.message || translationException?.toString() || 'Translation service unavailable';
        console.error(`❌ Translation failed for ${onboardingData.country}:`, errorMsg);
        throw new Error(`Cannot proceed: Translation to ${onboardingData.country}'s language is required but failed. ${errorMsg}`);
      }
    } else {
      console.log(`✅ Country ${onboardingData.country} uses English, skipping translation`);
    }
  }
  
  const promptsToInsert = generatedPrompts.map(prompt => {
    // Extract talentx_attribute_id if this is a TalentX prompt
    // Format: talentx-{attributeId}-{type}
    let talentxAttributeId = null;
    if (prompt.id.startsWith('talentx-')) {
      // Remove 'talentx-' prefix and get the attributeId (everything before the last '-')
      const parts = prompt.id.replace('talentx-', '').split('-');
      // Remove the last part (which is the type: informational/experience/competitive/discovery)
      parts.pop();
      talentxAttributeId = parts.join('-');
    }

    return {
      onboarding_id: onboardingRecord.id,
      user_id: user.id,
      prompt_text: prompt.text,
      prompt_category: prompt.promptCategory,
      prompt_theme: prompt.promptTheme,
      prompt_type: talentxAttributeId ? `talentx_${prompt.type}` : prompt.type,
      talentx_attribute_id: talentxAttributeId,
      industry_context: prompt.industryContext || onboardingData.industry,
      job_function_context: prompt.jobFunctionContext || null,
      location_context: prompt.locationContext || null,
      is_active: true
    };
  });

  const { data: confirmedPrompts, error: insertError } = await supabase
    .from('confirmed_prompts')
    .insert(promptsToInsert)
    .select();

  if (insertError) {
    console.error('Failed to insert prompts:', insertError);
    throw insertError;
  }

  // Get company_id from prompts (should be set by trigger)
  let companyId = confirmedPrompts?.[0]?.company_id;
  
  if (!companyId) {
    console.warn('No company_id found in prompts, attempting to fetch from user...');
    // Fallback: try to get company from user's companies
    const { data: companyData } = await supabase
      .from('companies')
      .select('id')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (companyData?.id) {
      companyId = companyData.id;
      console.log('Using fetched company_id:', companyId);
    } else {
      throw new Error('Could not determine company_id for batch collection');
    }
  }
  
  // Use batch collection function
  const promptIds = confirmedPrompts?.map(p => p.id) || [];
  const modelNames = ['openai', 'perplexity', 'google-ai-overviews'];
  
  setProgress({ 
    currentModel: 'Batch Processing',
    currentPrompt: `Processing ${promptIds.length} prompts...`,
    completed: 0,
    total: promptIds.length * modelNames.length
  });

  const { data: batchData, error: batchError } = await supabase.functions.invoke('collect-company-responses', {
    body: {
      companyId,
      promptIds,
      models: modelNames,
      batchSize: 5,
      skipExisting: true
    }
  });

  if (batchError) {
    throw new Error(`Batch collection failed: ${batchError.message}`);
  }

  if (!batchData?.success) {
    throw new Error(batchData?.error || 'Batch collection failed');
  }

  setProgress({ 
    currentModel: 'Complete',
    currentPrompt: 'All prompts processed',
    completed: batchData.summary?.totalOperations || 0,
    total: batchData.summary?.totalOperations || 0
  });

  console.log('Batch collection completed:', batchData.summary);

  // ✅ BATCHED RECENCY EXTRACTION - After all responses are stored
  console.log('🎯 All responses stored, now extracting recency scores in one batch...');
  
  try {
    // Fetch all citations from all responses for this onboarding
    const { data: allResponses } = await supabase
      .from('prompt_responses')
      .select('citations')
      .in('confirmed_prompt_id', confirmedPrompts.map(p => p.id));

    // Extract and flatten all citations with URLs
    const allCitations = allResponses?.flatMap(r => {
      if (!r.citations || !Array.isArray(r.citations)) return [];
      
      return r.citations
        .filter((citation: any) => {
          // Filter citations that have URLs
          if (typeof citation === 'string') {
            return citation.startsWith('http');
          } else if (citation && typeof citation === 'object') {
            return citation.url && citation.url.startsWith('http');
          }
          return false;
        })
        .map((citation: any) => {
          // Normalize citation format
          if (typeof citation === 'string') {
            const sourceUrl = extractSourceUrl(citation);
            return {
              url: sourceUrl,
              domain: extractDomain(sourceUrl),
              title: `Source from ${extractDomain(sourceUrl)}`
            };
          } else if (citation && typeof citation === 'object') {
            const sourceUrl = citation.url ? extractSourceUrl(citation.url) : '';
            return {
              url: sourceUrl,
              domain: citation.domain || (sourceUrl ? extractDomain(sourceUrl) : ''),
              title: citation.title || `Source from ${citation.domain || (sourceUrl ? extractDomain(sourceUrl) : 'unknown')}`,
              sourceType: citation.sourceType || 'unknown'
            };
          }
          return null;
        })
        .filter(Boolean);
    }) || [];

    console.log(`📊 Batched extraction: Found ${allCitations.length} total citations from all responses`);

    if (allCitations.length > 0) {
      // Trigger recency extraction ONCE for all citations (async, non-blocking)
      supabase.functions.invoke('extract-recency-scores', {
        body: { citations: allCitations }
      }).then(response => {
        console.log('✅ Batched recency extraction completed:', response.data?.summary);
      }).catch(error => {
        console.warn('❌ Batched recency extraction failed:', error);
      });
    } else {
      console.log('⚠️ No citations with URLs found in onboarding responses');
    }
  } catch (batchError) {
    console.warn('Error in batched recency extraction:', batchError);
    // Don't fail onboarding if recency extraction fails
  }

  return confirmedPrompts;
};

// Helper function to format country names properly
export const formatCountryForPrompt = (countryCode: string): string => {
  // Countries that need "the" article
  const countriesWithThe = [
    'US', 'AE', 'GB', 'NL', 'PH', 'VA', 'CZ', 'DO', 'GA', 'GM',
    'IO', 'KY', 'MH', 'NP', 'SB', 'TC', 'TF', 'VG', 'VI'
  ];
  
  // Country code to display name mapping
  const countryNames: { [key: string]: string } = {
    'US': 'United States',
    'GB': 'United Kingdom', 
    'AE': 'United Arab Emirates',
    'NL': 'Netherlands',
    'PH': 'Philippines',
    'VA': 'Vatican City',
    'DO': 'Dominican Republic',
    'GA': 'Gambia',
    'GM': 'Gambia',
    'IO': 'British Indian Ocean Territory',
    'KY': 'Cayman Islands',
    'MH': 'Marshall Islands',
    'NP': 'Nepal',
    'SB': 'Solomon Islands',
    'TC': 'Turks and Caicos Islands',
    'TF': 'French Southern Territories',
    'VG': 'British Virgin Islands',
    'VI': 'Virgin Islands',
    // Add more country mappings as needed
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'JP': 'Japan',
    'BR': 'Brazil',
    'IN': 'India',
    'CN': 'China',
    'MX': 'Mexico',
    'RU': 'Russia',
    'KR': 'South Korea',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'BE': 'Belgium',
    'IE': 'Ireland',
    'PT': 'Portugal',
    'GR': 'Greece',
    'PL': 'Poland',
    'HU': 'Hungary',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'HR': 'Croatia',
    'BG': 'Bulgaria',
    'RO': 'Romania',
    'EE': 'Estonia',
    'LV': 'Latvia',
    'LT': 'Lithuania',
    'AR': 'Argentina',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'NZ': 'New Zealand',
    'SG': 'Singapore',
    'MY': 'Malaysia',
    'TH': 'Thailand',
    'ID': 'Indonesia',
    'VN': 'Vietnam',
    'SA': 'Saudi Arabia',
    'ZA': 'South Africa',
    'TR': 'Turkey',
    'IL': 'Israel'
  };
  
  const countryName = countryNames[countryCode] || countryCode;
  const needsThe = countriesWithThe.includes(countryCode);
  
  return needsThe ? `the ${countryName}` : countryName;
};

const appendPromptContext = (text: string, jobFunction?: string, location?: string, promptType?: 'informational' | 'experience' | 'competitive' | 'discovery' | 'talentx') => {
  const trimmedText = text.trim();
  const lowerText = trimmedText.toLowerCase();
  
  // Special handling for competitive prompts with job functions
  if (promptType === 'competitive' && jobFunction) {
    // Remove industry context and replace with "hiring {jobFunction}"
    // Pattern: "in {industry}" -> "hiring {jobFunction}"
    // Pattern: "in the {industry} industry" -> "hiring {jobFunction}"
    
    // Handle "Does {companyName} stand out for X in {industry}?" -> "among companies hiring {jobFunction}"
    if (lowerText.includes('stand out') && lowerText.includes(' in ')) {
      const industryMatch = trimmedText.match(/ in ([^?]+)\?/i);
      if (industryMatch) {
        return trimmedText.replace(/ in [^?]+\?/i, ` among companies hiring ${jobFunction}?`);
      }
    }
    
    // Handle "How does X compare to other companies/employers/organizations in {industry}?"
    // Replace "in {industry}" or "in the {industry} industry" with "hiring {jobFunction}"
    const industryPatterns = [
      / in the [^?]+\?/gi,  // "in the {industry} industry?"
      / in [^?]+\?/gi,       // "in {industry}?"
    ];
    
    let result = trimmedText;
    for (const pattern of industryPatterns) {
      if (pattern.test(result)) {
        // Replace the industry part with "hiring {jobFunction}"
        result = result.replace(pattern, ` hiring ${jobFunction}?`);
        break;
      }
    }
    
    // If location is also provided, add it after the job function
    if (location) {
      const locationLower = location.toLowerCase();
      if (!result.toLowerCase().includes(locationLower)) {
        result = result.replace(/\?$/, ` in ${location}?`);
      }
    }
    
    return result;
  }
  
  // Special handling for discovery prompts with job functions
  if (promptType === 'discovery' && jobFunction) {
    // Remove industry context from discovery prompts when job function is present
    // Pattern: "What companies in {industry} are known for X?" -> "What companies are known for X for {jobFunction}?"
    // Pattern: "What companies in the {industry} industry are known for X?" -> "What companies are known for X for {jobFunction}?"
    
    let result = trimmedText;
    
    // Pattern 1: Remove "in the {industry} industry" (more specific, handle first)
    // Match: "in the Technology industry" -> remove it
    result = result.replace(/\s+in\s+the\s+[a-zA-Z\s]+\s+industry/gi, '');
    
    // Pattern 2: Remove "in {industry}" - be very specific to only match industry names
    // Look for "companies in {word(s)}" followed by "are" or "have"
    // Use a more precise pattern that captures the structure: "companies in X are/have"
    const companiesInPattern = /(companies)\s+in\s+([a-zA-Z\s]+?)\s+(are|have|is|were|was|do|does|can|could|will|would)\s+/i;
    const match = result.match(companiesInPattern);
    if (match) {
      // Reconstruct: "companies" + "are/have" + rest
      result = result.replace(companiesInPattern, `$1 $3 `);
    } else {
      // Fallback: try simpler pattern if the above didn't match
      // Match "in {word}" that appears before common verbs (limit to 1-3 words for industry name)
      result = result.replace(/\s+in\s+([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})\s+(are|have|is|were|was|do|does|can|could|will|would)\s+/gi, ' $2 ');
    }
    
    // Clean up any double spaces
    result = result.replace(/\s+/g, ' ').trim();
    
    // Ensure we still have a question mark at the end
    if (!result.endsWith('?')) {
      result = result + '?';
    }
    
    // Add "for {jobFunction}" if not already present
    const jobLower = jobFunction.toLowerCase();
    if (!result.toLowerCase().includes(jobLower)) {
      // Insert "for {jobFunction}" before the final question mark
      result = result.replace(/\?$/, ` for ${jobFunction}?`);
    }
    
    // If location is also provided, add it after the job function
    if (location) {
      const locationLower = location.toLowerCase();
      if (!result.toLowerCase().includes(locationLower)) {
        result = result.replace(/\?$/, ` in ${location}?`);
      }
    }
    
    return result.trim();
  }
  
  // Default behavior for non-competitive/discovery prompts or prompts without job functions
  const contextParts: string[] = [];

  if (jobFunction) {
    const jobLower = jobFunction.toLowerCase();
    if (!lowerText.includes(jobLower)) {
      contextParts.push(`for ${jobFunction}`);
    }
  }

  if (location) {
    const locationLower = location.toLowerCase();
    if (!lowerText.includes(locationLower)) {
      contextParts.push(`in ${location}`);
    }
  }

  if (contextParts.length === 0) {
    return text;
  }

  const contextSuffix = ` ${contextParts.join(' ')}`;

  if (trimmedText.endsWith('?')) {
    return trimmedText.replace(/\?$/, `${contextSuffix}?`);
  }

  if (trimmedText.endsWith('.')) {
    return trimmedText.replace(/\.$/, `${contextSuffix}.`);
  }

  return `${trimmedText}${contextSuffix}`;
};

// Helper function to generate prompts from onboarding data
export const generatePromptsFromData = (onboardingData: OnboardingData, isProUser: boolean = false): GeneratedPrompt[] => {
  const { companyName, industry, country } = onboardingData;
  const jobFunction = onboardingData.jobFunction || onboardingData.job_function || undefined;
  const customLocation = onboardingData.customLocation;

  const hasCountryLocation = country && country !== 'GLOBAL';
  const formattedCountry = hasCountryLocation ? formatCountryForPrompt(country) : '';

  const locationForBasePrompts = customLocation || (hasCountryLocation ? formattedCountry : undefined);
  const locationContextValue = customLocation || undefined;

  const basePrompts: GeneratedPrompt[] = [
    {
      id: 'experience-1',
      text: `How is ${companyName} as an employer?`,
      category: 'General',
      type: 'experience' as const,
      industryContext: industry,
      jobFunctionContext: jobFunction,
      locationContext: locationContextValue,
      promptCategory: 'General' as const,
      promptTheme: 'General'
    },
    {
      id: 'discovery-1',
      text: `What is the best company to work for in the ${industry} industry?`,
      category: 'General',
      type: 'discovery' as const,
      industryContext: industry,
      jobFunctionContext: jobFunction,
      locationContext: locationContextValue,
      promptCategory: 'General' as const,
      promptTheme: 'General'
    },
    {
      id: 'competitive-1',
      text: `How does working at ${companyName} compare to other companies?`,
      category: 'General',
      type: 'competitive' as const,
      industryContext: industry,
      jobFunctionContext: jobFunction,
      locationContext: locationContextValue,
      promptCategory: 'General' as const,
      promptTheme: 'General'
    },
    {
      id: 'informational-1',
      text: `What are the job and employment details at ${companyName}?`,
      category: 'General',
      type: 'informational' as const,
      industryContext: industry,
      jobFunctionContext: jobFunction,
      locationContext: locationContextValue,
      promptCategory: 'General' as const,
      promptTheme: 'General'
    }
  ].map(prompt => ({
    ...prompt,
    text: appendPromptContext(prompt.text, jobFunction, locationForBasePrompts, prompt.type),
  }));

  // Only add TalentX prompts for Pro users
  if (isProUser) {
    const talentXPrompts: GeneratedPrompt[] = [];
    
    // Use the TALENTX_PROMPT_TEMPLATES system to generate all 64 prompts (4 per attribute)
    const templates = generateTalentXPrompts(companyName, industry);
    templates.forEach(template => {
      const attribute = template.attribute;
      const isCandidateExperience = attribute?.category === 'Candidate Experience';

      const candidateThemeOverrides: Record<string, string> = {
        'candidate-communication': 'Candidate Communication',
        'interview-experience': 'Interview Experience',
        'application-process': 'Application Process',
        'onboarding-experience': 'Onboarding Experience',
        'candidate-feedback': 'Candidate Feedback',
        'overall-candidate-experience': 'Overall Candidate Experience',
      };

      const theme = attribute
        ? isCandidateExperience
          ? candidateThemeOverrides[attribute.id] || attribute.name || 'Candidate Experience'
          : attribute.category || attribute.name || 'Employee Experience'
        : 'General';

      const promptCategoryValue: 'Employee Experience' | 'Candidate Experience' =
        isCandidateExperience ? 'Candidate Experience' : 'Employee Experience';

      const textWithContext = appendPromptContext(
        template.prompt,
        jobFunction,
        locationForBasePrompts, // Use locationForBasePrompts which includes formatted country
        template.type as 'informational' | 'experience' | 'competitive' | 'discovery'
      );

      talentXPrompts.push({
        id: `talentx-${template.attributeId}-${template.type}`,
        text: textWithContext,
        category: theme,
        type: template.type as 'informational' | 'experience' | 'competitive' | 'discovery',
        industryContext: industry,
        jobFunctionContext: jobFunction,
        locationContext: locationContextValue,
        promptCategory: promptCategoryValue,
        promptTheme: theme
      });
    });

    return [...basePrompts, ...talentXPrompts];
  }

  // For free users, only return the base prompts
  return basePrompts;
};
