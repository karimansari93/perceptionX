import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateTalentXPrompts } from "../../../src/config/talentXAttributes.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Admin upgrading user to Pro:', userId);

    // Initialize Supabase with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Update user subscription status
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        subscription_type: 'pro',
        subscription_start_date: new Date().toISOString()
      })
      .eq('id', userId);
    
    if (updateError) {
      console.error('Error updating subscription status:', updateError);
      throw updateError;
    }

    console.log('Successfully updated user to Pro subscription');

    // 2. Get user's onboarding data for company info
    const { data: onboardingData, error: onboardingError } = await supabase
      .from('user_onboarding')
      .select('id, company_name, industry')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (onboardingError) {
      console.warn('Could not fetch onboarding data for TalentX Pro prompts:', onboardingError);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'User upgraded to Pro but TalentX prompts not generated (missing onboarding data)' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Onboarding data found:', onboardingData);

    // 3. Get user's default company for company-specific prompts
    const { data: companyMember, error: companyError } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();

    if (companyError) {
      console.warn('Could not fetch default company, prompts will be auto-linked:', companyError);
    }

    const companyId = companyMember?.company_id || null;

    // 4. Check if user already has TalentX prompts and clean them up if they exist
    const { data: existingPrompts, error: checkError } = await supabase
      .from('confirmed_prompts')
      .select('id')
      .eq('user_id', userId)
      .eq('is_pro_prompt', true);

    if (checkError) {
      console.error('Error checking existing TalentX prompts:', checkError);
      throw checkError;
    }

    // If user already has TalentX prompts, delete them first to avoid constraint violations
    if (existingPrompts && existingPrompts.length > 0) {
      console.log(`User has ${existingPrompts.length} existing TalentX prompts, deleting them first`);
      
      const { error: deleteError } = await supabase
        .from('confirmed_prompts')
        .delete()
        .in('id', existingPrompts.map(p => p.id));
      
      if (deleteError) {
        console.error('Error deleting existing TalentX prompts:', deleteError);
        throw deleteError;
      }
      
      console.log('Successfully deleted existing TalentX prompts');
    }

    // 5. Generate all TalentX Pro prompts (48 total: 30 Employee Experience + 18 Candidate Experience)
    const companyName = onboardingData.company_name || 'Your Company';
    const industry = onboardingData.industry || 'Technology';
    
    // Use generateTalentXPrompts to get all 48 prompts with proper attribute mapping
    const generatedPrompts = generateTalentXPrompts(companyName, industry);
    
    // Map prompts to the correct database structure with prompt_category and prompt_theme
    const candidateThemeOverrides: Record<string, string> = {
      'candidate-communication': 'Candidate Communication',
      'interview-experience': 'Interview Experience',
      'application-process': 'Application Process',
      'onboarding-experience': 'Onboarding Experience',
      'candidate-feedback': 'Candidate Feedback',
      'overall-candidate-experience': 'Overall Candidate Experience',
    };

    const promptsToInsert = generatedPrompts.map(template => {
      const attribute = template.attribute;
      const isCandidateExperience = attribute?.category === 'Candidate Experience';

      const theme = attribute
        ? isCandidateExperience
          ? candidateThemeOverrides[template.attributeId] || attribute.name || 'Candidate Experience'
          : attribute.category || attribute.name || 'Employee Experience'
        : 'General';

      const promptCategory: 'Employee Experience' | 'Candidate Experience' | 'General' =
        isCandidateExperience ? 'Candidate Experience' : 'Employee Experience';

      return {
        user_id: userId,
        onboarding_id: onboardingData.id,
        company_id: companyId, // Set company_id for company-specific prompts
        prompt_text: template.prompt,
        prompt_type: template.type as 'sentiment' | 'competitive' | 'visibility',
        prompt_category: promptCategory,
        prompt_theme: theme,
        talentx_attribute_id: template.attributeId,
        industry_context: industry,
        is_pro_prompt: true,
        is_active: true
      };
    });
    
    // Insert prompts with service role key (bypasses RLS)
    const { data, error: insertError } = await supabase
      .from('confirmed_prompts')
      .insert(promptsToInsert)
      .select();

    if (insertError) {
      console.error('Error generating TalentX Pro prompts:', insertError);
      throw insertError;
    }

    console.log(`Successfully generated ${promptsToInsert.length} TalentX Pro prompts for user ${userId} (including ${generatedPrompts.filter(p => p.attribute?.category === 'Candidate Experience').length} Candidate Experience prompts)`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `User upgraded to Pro and ${promptsToInsert.length} TalentX prompts generated (including Candidate Experience prompts)` 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in admin-upgrade-user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: errorMessage 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

