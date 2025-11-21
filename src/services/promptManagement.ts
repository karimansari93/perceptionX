import { supabase } from '@/integrations/supabase/client';

import { generatePromptsFromData } from '@/hooks/usePromptsLogic';

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

  const { data: existingPrompts, error: existingError } = await supabase
    .from('confirmed_prompts')
    .select('prompt_text')
    .eq('company_id', companyId);

  if (existingError) {
    throw existingError;
  }

  const existingPromptTexts = new Set(
    (existingPrompts || []).map(prompt => prompt.prompt_text)
  );

  const generatedPrompts = generatePromptsFromData(
    {
      companyName,
      industry: industryForPrompts,
      country:
        variant.type === 'location' ? undefined : onboardingRecord?.country || undefined,
      jobFunction: jobFunctionForPrompts,
      customLocation: customLocationForPrompts,
    },
    isProUser
  );

  const promptsToInsert = generatedPrompts
    .filter(prompt => !existingPromptTexts.has(prompt.text))
    .map(prompt => {
      let talentxAttributeId: string | null = null;

      if (prompt.id.startsWith('talentx-')) {
        const parts = prompt.id.replace('talentx-', '').split('-');
        parts.pop();
        talentxAttributeId = parts.join('-');
      }

      return {
        onboarding_id: onboardingId,
        company_id: companyId,
        user_id: userId,
        created_by: userId,
        prompt_text: prompt.text,
        prompt_category: prompt.promptCategory,
        prompt_theme: prompt.promptTheme,
        prompt_type: prompt.type,
        industry_context: prompt.industryContext || industryForPrompts,
        job_function_context: prompt.jobFunctionContext || jobFunctionForPrompts || null,
        location_context: prompt.locationContext || customLocationForPrompts || null,
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

  const { data: insertedPrompts, error: insertError } = await supabase
    .from('confirmed_prompts')
    .insert(promptsToInsert)
    .select('id');

  if (insertError) {
    throw insertError;
  }

  return {
    insertedPromptIds: insertedPrompts?.map(prompt => prompt.id) || [],
    alreadyExists: false,
  };
};

