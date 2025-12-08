import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inline TalentX prompt templates and helper functions to avoid import alias issues
const TALENTX_PROMPT_TEMPLATES = [
  // Mission & Purpose (3 prompts)
  { attributeId: 'mission-purpose', type: 'sentiment', prompt: 'How well does {companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?' },
  { attributeId: 'mission-purpose', type: 'competitive', prompt: 'How do {companyName}\'s mission and purpose compare to other companies in {industry}?' },
  { attributeId: 'mission-purpose', type: 'visibility', prompt: 'What companies in {industry} are known for having a strong, purpose-driven employer brand?' },
  // Rewards & Recognition (3 prompts)
  { attributeId: 'rewards-recognition', type: 'sentiment', prompt: 'How satisfied are employees at {companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?' },
  { attributeId: 'rewards-recognition', type: 'competitive', prompt: 'How do rewards and recognition programs at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'rewards-recognition', type: 'visibility', prompt: 'What companies in {industry} are known for having exceptional rewards and recognition for employees?' },
  // Company Culture (3 prompts)
  { attributeId: 'company-culture', type: 'sentiment', prompt: 'How do employees at {companyName} describe the actual company culture versus the promoted culture?' },
  { attributeId: 'company-culture', type: 'competitive', prompt: 'How does {companyName}\'s company culture compare to other companies in {industry}?' },
  { attributeId: 'company-culture', type: 'visibility', prompt: 'What companies in {industry} are known for outstanding workplace culture?' },
  // Social Impact (3 prompts)
  { attributeId: 'social-impact', type: 'sentiment', prompt: 'How do employees at {companyName} perceive the company\'s commitment to social impact and community responsibility?' },
  { attributeId: 'social-impact', type: 'competitive', prompt: 'How does {companyName}\'s social impact compare to other companies in {industry}?' },
  { attributeId: 'social-impact', type: 'visibility', prompt: 'What companies in {industry} are recognized for meaningful social impact and community engagement?' },
  // Inclusion (3 prompts)
  { attributeId: 'inclusion', type: 'sentiment', prompt: 'How do employees from diverse backgrounds at {companyName} rate the inclusivity of the workplace culture and practices?' },
  { attributeId: 'inclusion', type: 'competitive', prompt: 'How do {companyName}\'s inclusion and diversity efforts compare to other companies in {industry}?' },
  { attributeId: 'inclusion', type: 'visibility', prompt: 'What companies in {industry} are most recognized for diversity, equity, and inclusion?' },
  // Innovation (3 prompts)
  { attributeId: 'innovation', type: 'sentiment', prompt: 'How do employees at {companyName} perceive the company\'s commitment to innovation and opportunities for creative work?' },
  { attributeId: 'innovation', type: 'competitive', prompt: 'How does {companyName}\'s innovation culture compare to other companies in {industry}?' },
  { attributeId: 'innovation', type: 'visibility', prompt: 'What companies in {industry} are known for fostering innovation and creative thinking?' },
  // Wellbeing & Balance (3 prompts)
  { attributeId: 'wellbeing-balance', type: 'sentiment', prompt: 'How do employees at {companyName} rate work-life balance and the overall wellbeing support provided by the company?' },
  { attributeId: 'wellbeing-balance', type: 'competitive', prompt: 'How do {companyName}\'s wellbeing and work-life balance offerings compare to other companies in {industry}?' },
  { attributeId: 'wellbeing-balance', type: 'visibility', prompt: 'What companies in {industry} are recognized for exceptional employee wellbeing and work-life balance?' },
  // Leadership (3 prompts)
  { attributeId: 'leadership', type: 'sentiment', prompt: 'How do employees at {companyName} rate the quality and effectiveness of leadership within the organization?' },
  { attributeId: 'leadership', type: 'competitive', prompt: 'How does {companyName}\'s leadership quality compare to other companies in {industry}?' },
  { attributeId: 'leadership', type: 'visibility', prompt: 'What companies in {industry} are respected for outstanding leadership and management?' },
  // Security & Perks (3 prompts)
  { attributeId: 'security-perks', type: 'sentiment', prompt: 'How do employees at {companyName} perceive job security, benefits, and additional perks provided by the company?' },
  { attributeId: 'security-perks', type: 'competitive', prompt: 'How do {companyName}\'s security, benefits, and perks compare to other companies in {industry}?' },
  { attributeId: 'security-perks', type: 'visibility', prompt: 'What companies in {industry} are known for providing comprehensive benefits and job security?' },
  // Career Opportunities (3 prompts)
  { attributeId: 'career-opportunities', type: 'sentiment', prompt: 'How do employees at {companyName} rate career development opportunities and long-term growth potential?' },
  { attributeId: 'career-opportunities', type: 'competitive', prompt: 'How do career progression opportunities at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'career-opportunities', type: 'visibility', prompt: 'What companies in {industry} are most recognized for exceptional career development and progression opportunities?' },
  // Application Process (3 prompts) - Candidate Experience
  { attributeId: 'application-process', type: 'sentiment', prompt: 'How is the application process at {companyName}?' },
  { attributeId: 'application-process', type: 'competitive', prompt: 'How does the application process at {companyName} compare to other employers in {industry}?' },
  { attributeId: 'application-process', type: 'visibility', prompt: 'What companies in {industry} have the best application process?' },
  // Communication (3 prompts) - Candidate Experience
  { attributeId: 'candidate-communication', type: 'sentiment', prompt: 'How do candidates feel about receiving updates from {companyName}?' },
  { attributeId: 'candidate-communication', type: 'competitive', prompt: 'How does recruiter communication at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'candidate-communication', type: 'visibility', prompt: 'What companies in {industry} are recognized for strong candidate communication?' },
  // Interview (3 prompts) - Candidate Experience
  { attributeId: 'interview-experience', type: 'sentiment', prompt: 'How do candidates describe their interview experience at {companyName}?' },
  { attributeId: 'interview-experience', type: 'competitive', prompt: 'How does the interview process at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'interview-experience', type: 'visibility', prompt: 'What companies in {industry} have the best interview experience?' },
  // Feedback (3 prompts) - Candidate Experience
  { attributeId: 'candidate-feedback', type: 'sentiment', prompt: 'How do candidates rate the feedback from {companyName} after interviews or applications?' },
  { attributeId: 'candidate-feedback', type: 'competitive', prompt: 'How does candidate feedback at {companyName} compare to other employers in {industry}?' },
  { attributeId: 'candidate-feedback', type: 'visibility', prompt: 'What companies in {industry} are known for providing valuable candidate feedback?' },
  // Onboarding (3 prompts) - Candidate Experience
  { attributeId: 'onboarding-experience', type: 'sentiment', prompt: 'How do new hires feel about onboarding at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'competitive', prompt: 'How does onboarding at {companyName} compare to other organizations in {industry}?' },
  { attributeId: 'onboarding-experience', type: 'visibility', prompt: 'What companies in {industry} have the best onboarding experience?' },
  // Overall Experience (3 prompts) - Candidate Experience
  { attributeId: 'overall-candidate-experience', type: 'sentiment', prompt: 'How do candidates perceive the overall journey at {companyName}?' },
  { attributeId: 'overall-candidate-experience', type: 'competitive', prompt: 'Does {companyName} stand out for candidate experience in {industry}?' },
  { attributeId: 'overall-candidate-experience', type: 'visibility', prompt: 'What companies in {industry} have the best overall candidate reputation?' }
];

// Map attribute IDs to their categories
const ATTRIBUTE_CATEGORIES: Record<string, string> = {
  'mission-purpose': 'Employee Experience',
  'rewards-recognition': 'Employee Experience',
  'company-culture': 'Employee Experience',
  'social-impact': 'Employee Experience',
  'inclusion': 'Employee Experience',
  'innovation': 'Employee Experience',
  'wellbeing-balance': 'Employee Experience',
  'leadership': 'Employee Experience',
  'security-perks': 'Employee Experience',
  'career-opportunities': 'Employee Experience',
  'application-process': 'Candidate Experience',
  'candidate-communication': 'Candidate Experience',
  'interview-experience': 'Candidate Experience',
  'candidate-feedback': 'Candidate Experience',
  'onboarding-experience': 'Candidate Experience',
  'overall-candidate-experience': 'Candidate Experience'
};

// Generate TalentX prompts for a company
const generateTalentXPrompts = (companyName: string, industry: string) => {
  return TALENTX_PROMPT_TEMPLATES.map(template => ({
    ...template,
    prompt: template.prompt
      .replace(/{companyName}/g, companyName)
      .replace(/{industry}/g, industry),
    attribute: {
      id: template.attributeId,
      category: ATTRIBUTE_CATEGORIES[template.attributeId] || 'Employee Experience'
    }
  }));
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { companyId } = await req.json();

    if (!companyId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: companyId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Admin adding candidate experience prompts for company:', companyId);

    // Initialize Supabase with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get company information
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name, industry')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      throw new Error(`Company not found: ${companyError?.message || 'Unknown error'}`);
    }

    // 2. Get user_id and onboarding_id from existing prompts or company_members
    let userId: string | null = null;
    let onboardingId: string | null = null;

    const { data: existingPrompts, error: promptsError } = await supabase
      .from('confirmed_prompts')
      .select('user_id, onboarding_id')
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle();

    if (!promptsError && existingPrompts) {
      userId = existingPrompts.user_id;
      onboardingId = existingPrompts.onboarding_id;
    }

    // If no existing prompts, get from company_members
    if (!userId) {
      const { data: companyMember, error: membersError } = await supabase
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle();

      if (membersError || !companyMember) {
        throw new Error(`No user found for company: ${membersError?.message || 'Company has no members'}`);
      }

      userId = companyMember.user_id;
    }

    // 3. Get onboarding data if we don't have onboarding_id
    let onboardingData: { id: string; country: string | null; job_function: string | null } | null = null;

    if (!onboardingId) {
      const { data: onboarding, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('id, country, job_function')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (onboardingError && onboardingError.code !== 'PGRST116') {
        console.warn('Could not fetch onboarding data:', onboardingError);
      } else if (onboarding) {
        onboardingId = onboarding.id;
        onboardingData = onboarding;
      }
    } else {
      // Fetch onboarding data for country and job_function
      const { data: onboarding, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('id, country, job_function')
        .eq('id', onboardingId)
        .maybeSingle();

      if (!onboardingError && onboarding) {
        onboardingData = onboarding;
      }
    }

    // 4. Check if candidate experience prompts already exist
    const { data: existingCandidatePrompts, error: checkError } = await supabase
      .from('confirmed_prompts')
      .select('talentx_attribute_id, prompt_type')
      .eq('company_id', companyId)
      .eq('prompt_category', 'Candidate Experience')
      .eq('is_active', true);

    if (checkError) {
      throw new Error(`Failed to check existing prompts: ${checkError.message}`);
    }

    const existingSet = new Set(
      (existingCandidatePrompts || []).map(p => `${p.talentx_attribute_id}-${p.prompt_type}`)
    );

    // 5. Generate all TalentX prompts and filter to candidate experience only
    const allPrompts = generateTalentXPrompts(company.name, company.industry);
    
    const candidateExperiencePrompts = allPrompts.filter(
      template => template.attribute?.category === 'Candidate Experience'
    );

    if (candidateExperiencePrompts.length === 0) {
      throw new Error('No candidate experience prompts found to add');
    }

    // 6. Map prompts to database structure
    const candidateThemeOverrides: Record<string, string> = {
      'candidate-communication': 'Candidate Communication',
      'interview-experience': 'Interview Experience',
      'application-process': 'Application Process',
      'onboarding-experience': 'Onboarding Experience',
      'candidate-feedback': 'Candidate Feedback',
      'overall-candidate-experience': 'Overall Candidate Experience',
    };

    const promptsToInsert = candidateExperiencePrompts
      .filter(template => {
        const key = `${template.attributeId}-${template.type}`;
        return !existingSet.has(key);
      })
      .map(template => {
        const attribute = template.attribute;
        const theme = candidateThemeOverrides[template.attributeId] || attribute?.name || 'Candidate Experience';

        return {
          user_id: userId,
          onboarding_id: onboardingId,
          company_id: companyId,
          prompt_text: template.prompt,
          prompt_type: template.type as 'sentiment' | 'competitive' | 'visibility',
          prompt_category: 'Candidate Experience' as const,
          prompt_theme: theme,
          talentx_attribute_id: template.attributeId,
          industry_context: company.industry,
          job_function_context: onboardingData?.job_function || null,
          location_context: onboardingData?.country || null,
          is_pro_prompt: true,
          is_active: true
        };
      });

    if (promptsToInsert.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'All candidate experience prompts already exist for this company',
          added: 0
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Insert prompts with service role key (bypasses RLS)
    const { data, error: insertError } = await supabase
      .from('confirmed_prompts')
      .insert(promptsToInsert)
      .select();

    if (insertError) {
      console.error('Error inserting candidate experience prompts:', insertError);
      throw insertError;
    }

    console.log(`Successfully added ${promptsToInsert.length} candidate experience prompts for company ${companyId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully added ${promptsToInsert.length} candidate experience prompts`,
        added: promptsToInsert.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in admin-add-candidate-prompts:', error);
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
