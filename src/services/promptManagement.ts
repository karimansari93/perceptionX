import { supabase } from '@/integrations/supabase/client';

import { generatePromptsFromData, formatCountryForPrompt } from '@/hooks/usePromptsLogic';

type PromptVariant = 'industry' | 'job-function' | 'location';

interface AddCustomPromptParams {
  companyId: string;
  companyName: string;
  userId: string;
  isProUser: boolean;
  variant: {
    type: PromptVariant;
    value: string;
  };
  selectedLocation?: string | null;
}

interface AddCustomPromptResult {
  insertedPromptIds: string[];
  alreadyExists: boolean;
}

const normalizeInput = (value: string) => value.trim();

export const addCustomPrompts = async ({
  companyId,
  companyName,
  userId,
  isProUser,
  variant,
  selectedLocation,
}: AddCustomPromptParams): Promise<AddCustomPromptResult> => {
  const normalizedValue = normalizeInput(variant.value);

  if (!normalizedValue) {
    throw new Error('Please provide a value before adding prompts.');
  }

  if (variant.type !== 'industry' && !isProUser) {
    throw new Error('This prompt type is available for Pro plans only.');
  }

  const { data: companyData, error: companyError } = await supabase
    .from('companies')
    .select('industry')
    .eq('id', companyId)
    .maybeSingle();

  if (companyError) {
    throw companyError;
  }

  const { data: onboardingRecord, error: onboardingError } = await supabase
    .from('user_onboarding')
    .select('id, country, industry, job_function')
    .eq('company_name', companyName)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (onboardingError) {
    throw onboardingError;
  }

  let onboardingId: string | null = onboardingRecord?.id ?? null;

  if (!onboardingId) {
    const { data: referencePrompt } = await supabase
      .from('confirmed_prompts')
      .select('onboarding_id')
      .eq('company_id', companyId)
      .not('onboarding_id', 'is', null)
      .limit(1)
      .maybeSingle();

    onboardingId = referencePrompt?.onboarding_id ?? null;
  }

  const baseIndustry =
    companyData?.industry ||
    onboardingRecord?.industry ||
    normalizedValue ||
    'General';

  let industryForPrompts = baseIndustry;
  let jobFunctionForPrompts: string | undefined;
  let customLocationForPrompts: string | undefined;

  switch (variant.type) {
    case 'industry':
      industryForPrompts = normalizedValue;
      break;
    case 'job-function':
      jobFunctionForPrompts = normalizedValue;
      break;
    case 'location':
      customLocationForPrompts = normalizedValue;
      break;
  }

  if (variant.type === 'industry') {
    const { error: industryError } = await supabase
      .from('company_industries')
      .upsert(
        {
          company_id: companyId,
          industry: normalizedValue,
          created_by: userId,
        },
        {
          onConflict: 'company_id,industry',
          ignoreDuplicates: true,
        }
      );

    if (industryError) {
      throw industryError;
    }
  }

  // For job function and industry, use selectedLocation if provided so prompt text and translation match the dashboard selection.
  // Otherwise fall back to onboarding country.
  let countryForPrompts: string | undefined;
  let locationForPrompts: string | undefined;

  if (variant.type === 'location') {
    // Location variant uses customLocation, no country
    countryForPrompts = undefined;
    locationForPrompts = customLocationForPrompts;
  } else if (
    (variant.type === 'job-function' || variant.type === 'industry') &&
    selectedLocation &&
    selectedLocation !== 'GLOBAL'
  ) {
    // Use dashboard-selected location so generated prompt text says e.g. "in Poland", then we translate to Polish
    locationForPrompts = formatCountryForPrompt(selectedLocation);
    countryForPrompts = undefined;
  } else {
    // Default: use onboarding country
    countryForPrompts = onboardingRecord?.country || undefined;
    locationForPrompts = customLocationForPrompts;
  }

  let generatedPrompts = generatePromptsFromData(
    {
      companyName,
      industry: industryForPrompts,
      country: countryForPrompts,
      jobFunction: jobFunctionForPrompts,
      customLocation: locationForPrompts,
    },
    isProUser
  );

  // When adding an industry, only create discovery prompts (industry is only used in discovery)
  if (variant.type === 'industry') {
    generatedPrompts = generatedPrompts.filter(p => p.type === 'discovery');
  }

  // Translate prompts for non-English countries:
  // - Job function: when a location filter is selected (e.g. Poland → Polish).
  // - Industry: when a location filter is selected, or when onboarding country is non-GLOBAL (e.g. Netflix Poland → Polish).
  let countryCodeForTranslation: string | undefined;
  if (variant.type === 'job-function' && selectedLocation && selectedLocation !== 'GLOBAL') {
    countryCodeForTranslation = selectedLocation;
  } else if (variant.type === 'industry') {
    countryCodeForTranslation =
      selectedLocation && selectedLocation !== 'GLOBAL'
        ? selectedLocation
        : onboardingRecord?.country && onboardingRecord.country !== 'GLOBAL'
          ? onboardingRecord.country
          : undefined;
  } else {
    countryCodeForTranslation = undefined;
  }

  // Translate prompts if country is not GLOBAL and language is not English
  // CRITICAL: Translation is REQUIRED for non-English countries - cannot proceed without it
  if (countryCodeForTranslation) {
    // Check if country uses English (no translation needed)
    const englishSpeakingCountries = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'ZA', 'IN', 'SG', 'MY', 'PH', 'HK', 'AE', 'SA'];
    const needsTranslation = !englishSpeakingCountries.includes(countryCodeForTranslation);
    
    if (needsTranslation) {
      try {
        console.log(`🌍 Translating ${generatedPrompts.length} prompts for country: ${countryCodeForTranslation}`);
        const promptTexts = generatedPrompts.map(p => p.text);

        const invokeTranslate = () =>
          supabase.functions.invoke('translate-prompts', {
            body: { prompts: promptTexts, countryCode: countryCodeForTranslation },
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
            throw new Error(`Translation incomplete for ${countryCodeForTranslation}. All prompts must be translated to ${targetLanguage}.`);
          }
        } else {
          // Translation failed - fail the process
          const errorMessage = translationError?.message || 'Unknown error';
          throw new Error(`Failed to translate prompts for ${countryCodeForTranslation}. Translation service error: ${errorMessage}`);
        }
      } catch (translationException: any) {
        // Translation is REQUIRED - cannot proceed without it
        const errorMsg = translationException?.message || translationException?.toString() || 'Translation service unavailable';
        console.error(`❌ Translation failed for ${countryCodeForTranslation}:`, errorMsg);
        throw new Error(`Cannot proceed: Translation to ${countryCodeForTranslation}'s language is required but failed. ${errorMsg}`);
      }
    } else {
      console.log(`✅ Country ${countryCodeForTranslation} uses English, skipping translation`);
    }
  }

  const promptsToInsert = generatedPrompts.map(prompt => {
      let talentxAttributeId: string | null = null;

      if (prompt.id.startsWith('talentx-')) {
        const parts = prompt.id.replace('talentx-', '').split('-');
        parts.pop();
        talentxAttributeId = parts.join('-');
      }

      // Ensure we use the correct values - prioritize what's on the prompt object,
      // but fall back to our calculated values if needed
      // Use nullish coalescing (??) instead of || to properly handle empty strings
      const finalJobFunctionContext = prompt.jobFunctionContext ?? jobFunctionForPrompts ?? null;
      const finalLocationContext = prompt.locationContext ?? locationForPrompts ?? null;
      const finalIndustryContext = prompt.industryContext ?? industryForPrompts;

      return {
        onboarding_id: onboardingId,
        company_id: companyId,
        user_id: userId,
        created_by: userId,
        prompt_text: prompt.text,
        prompt_category: prompt.promptCategory,
        prompt_theme: prompt.promptTheme,
        prompt_type: prompt.type,
        industry_context: finalIndustryContext,
        job_function_context: finalJobFunctionContext,
        location_context: finalLocationContext,
        is_active: true,
        talentx_attribute_id: talentxAttributeId,
      };
    });

  if (promptsToInsert.length === 0) {
    return {
      insertedPromptIds: [],
      alreadyExists: true,
    };
  }

  // Just insert - no duplicate checking, users have full control
  const { data: insertedPrompts, error: insertError } = await supabase
    .from('confirmed_prompts')
    .insert(promptsToInsert)
    .select('id');

  if (insertError) {
    // If it's a duplicate error, some prompts might have been inserted before
    // Just throw the error and let the UI handle it
    throw insertError;
  }

  return {
    insertedPromptIds: insertedPrompts?.map(prompt => prompt.id) || [],
    alreadyExists: false,
  };
};

