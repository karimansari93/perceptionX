import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inline attribute prompt templates — methodology v2 (52 prompts: 13 attributes
// x 4 types). Kept byte-consistent with src/config/attributes.ts. This function
// inserts only the Candidate Experience subset (filtered below).
const ATTRIBUTE_PROMPT_TEMPLATES = [
  { attributeId: 'mission-purpose-impact', type: 'informational', prompt: 'What should I know about {companyName}\'s mission, purpose, and social impact before applying?' },
  { attributeId: 'mission-purpose-impact', type: 'experience', prompt: 'What do employees say about the sense of purpose and impact of working at {companyName}?' },
  { attributeId: 'mission-purpose-impact', type: 'competitive', prompt: 'How does {companyName}\'s mission and impact compare to other companies in {industry}?' },
  { attributeId: 'mission-purpose-impact', type: 'discovery', prompt: 'Which companies in {industry} are known for a strong sense of purpose and positive impact?' },
  { attributeId: 'compensation', type: 'informational', prompt: 'How good is the pay at {companyName}, and how should I negotiate salary and benefits there?' },
  { attributeId: 'compensation', type: 'experience', prompt: 'What do employees say about pay, benefits, and perks at {companyName}?' },
  { attributeId: 'compensation', type: 'competitive', prompt: 'Does {companyName} pay better than other companies in {industry}?' },
  { attributeId: 'compensation', type: 'discovery', prompt: 'Which companies in {industry} pay the best and offer the best benefits and perks?' },
  { attributeId: 'company-culture', type: 'informational', prompt: 'What is the company culture really like at {companyName}?' },
  { attributeId: 'company-culture', type: 'experience', prompt: 'How do employees describe the culture at {companyName} — and do they feel valued and recognized?' },
  { attributeId: 'company-culture', type: 'competitive', prompt: 'How does the culture at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'company-culture', type: 'discovery', prompt: 'Which companies in {industry} have the best workplace culture?' },
  { attributeId: 'leadership', type: 'informational', prompt: 'What should I know about the leadership and management at {companyName} before joining?' },
  { attributeId: 'leadership', type: 'experience', prompt: 'What do employees say about managers and senior leadership at {companyName}?' },
  { attributeId: 'leadership', type: 'competitive', prompt: 'How does the quality of leadership at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'leadership', type: 'discovery', prompt: 'Which companies in {industry} are known for great leadership and management?' },
  { attributeId: 'job-security', type: 'informational', prompt: 'How stable and secure is a job at {companyName}?' },
  { attributeId: 'job-security', type: 'experience', prompt: 'How do employees feel about job security and stability at {companyName}?' },
  { attributeId: 'job-security', type: 'competitive', prompt: 'Is a job at {companyName} more secure than at other companies in {industry}?' },
  { attributeId: 'job-security', type: 'discovery', prompt: 'Which companies in {industry} offer the most stable and secure jobs?' },
  { attributeId: 'career-opportunities', type: 'informational', prompt: 'What career growth and progression can I expect at {companyName}?' },
  { attributeId: 'career-opportunities', type: 'experience', prompt: 'What do employees say about career development, learning, and promotions at {companyName}?' },
  { attributeId: 'career-opportunities', type: 'competitive', prompt: 'Will my career grow faster at {companyName} or at other companies in {industry}?' },
  { attributeId: 'career-opportunities', type: 'discovery', prompt: 'Which companies in {industry} are best for career growth and learning?' },
  { attributeId: 'wellbeing-balance', type: 'informational', prompt: 'What are the work-life balance, flexibility, and remote work options really like at {companyName}?' },
  { attributeId: 'wellbeing-balance', type: 'experience', prompt: 'How do employees rate work-life balance, flexibility, and wellbeing support at {companyName}?' },
  { attributeId: 'wellbeing-balance', type: 'competitive', prompt: 'Is work-life balance at {companyName} better than at other companies in {industry}?' },
  { attributeId: 'wellbeing-balance', type: 'discovery', prompt: 'Which companies in {industry} are best for work-life balance and flexible or remote work?' },
  { attributeId: 'inclusion', type: 'informational', prompt: 'How inclusive and diverse is the workplace at {companyName}?' },
  { attributeId: 'inclusion', type: 'experience', prompt: 'What do employees from diverse backgrounds say about working at {companyName}?' },
  { attributeId: 'inclusion', type: 'competitive', prompt: 'How does {companyName} compare to other companies in {industry} on diversity and inclusion?' },
  { attributeId: 'inclusion', type: 'discovery', prompt: 'Which companies in {industry} are most recognized for diversity, equity, and inclusion?' },
  { attributeId: 'innovation', type: 'informational', prompt: 'How innovative is {companyName}, and what would I get to work on there?' },
  { attributeId: 'innovation', type: 'experience', prompt: 'What do employees say about innovation and access to new technology at {companyName}?' },
  { attributeId: 'innovation', type: 'competitive', prompt: 'Is {companyName} a more innovative place to work than other companies in {industry}?' },
  { attributeId: 'innovation', type: 'discovery', prompt: 'Which companies in {industry} are the most innovative to work for?' },
  { attributeId: 'application-communication', type: 'informational', prompt: 'What should I expect from the application process and recruiter communication at {companyName}?' },
  { attributeId: 'application-communication', type: 'experience', prompt: 'How do candidates describe applying to {companyName} — the process, updates, and communication?' },
  { attributeId: 'application-communication', type: 'competitive', prompt: 'Is applying to {companyName} a better experience than applying to other employers in {industry}?' },
  { attributeId: 'application-communication', type: 'discovery', prompt: 'Which companies in {industry} have the best application process and candidate communication?' },
  { attributeId: 'candidate-feedback', type: 'informational', prompt: 'Will I get useful feedback after applying or interviewing at {companyName}?' },
  { attributeId: 'candidate-feedback', type: 'experience', prompt: 'What do candidates say about the feedback they get from {companyName} after interviews and applications?' },
  { attributeId: 'candidate-feedback', type: 'competitive', prompt: 'How does {companyName} compare to other employers in {industry} at giving candidates feedback?' },
  { attributeId: 'candidate-feedback', type: 'discovery', prompt: 'Which companies in {industry} are known for giving candidates valuable feedback?' },
  { attributeId: 'interview-experience', type: 'informational', prompt: 'How should I prepare for a job interview at {companyName}?' },
  { attributeId: 'interview-experience', type: 'experience', prompt: 'How do candidates describe the interview experience at {companyName}?' },
  { attributeId: 'interview-experience', type: 'competitive', prompt: 'How does the interview process at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'interview-experience', type: 'discovery', prompt: 'Which companies in {industry} have the best interview experience?' },
  { attributeId: 'onboarding-experience', type: 'informational', prompt: 'What should I expect when I first start working at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'experience', prompt: 'How do new hires describe their onboarding and first months at {companyName}?' },
  { attributeId: 'onboarding-experience', type: 'competitive', prompt: 'How does onboarding at {companyName} compare to other companies in {industry}?' },
  { attributeId: 'onboarding-experience', type: 'discovery', prompt: 'Which companies in {industry} have the best onboarding for new hires?' }
];

// Map attribute IDs to their categories (v2)
const ATTRIBUTE_CATEGORIES: Record<string, string> = {
  'mission-purpose-impact': 'Employee Experience',
  'compensation': 'Employee Experience',
  'company-culture': 'Employee Experience',
  'leadership': 'Employee Experience',
  'job-security': 'Employee Experience',
  'career-opportunities': 'Employee Experience',
  'wellbeing-balance': 'Employee Experience',
  'inclusion': 'Employee Experience',
  'innovation': 'Employee Experience',
  'application-communication': 'Candidate Experience',
  'candidate-feedback': 'Candidate Experience',
  'interview-experience': 'Candidate Experience',
  'onboarding-experience': 'Candidate Experience'
};

// Generate attribute prompts for a company
const generateAttributePrompts = (companyName: string, industry: string) => {
  return ATTRIBUTE_PROMPT_TEMPLATES.map(template => ({
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

    // If no existing prompts, get a user via the company's organization
    // (company_members retired — membership lives on organization_members).
    if (!userId) {
      const { data: orgCompany, error: membersError } = await supabase
        .from('organization_companies')
        .select('organization_id, organization_members:organization_id!inner(user_id)')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle();

      const orgMembers = (orgCompany as any)?.organization_members;
      const fallbackUserId = Array.isArray(orgMembers)
        ? orgMembers[0]?.user_id
        : orgMembers?.user_id;

      if (membersError || !fallbackUserId) {
        throw new Error(`No user found for company: ${membersError?.message || 'Company has no members'}`);
      }

      userId = fallbackUserId;
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
      .select('attribute_id, prompt_type')
      .eq('company_id', companyId)
      .eq('prompt_category', 'Candidate Experience')
      .eq('is_active', true);

    if (checkError) {
      throw new Error(`Failed to check existing prompts: ${checkError.message}`);
    }

    const existingSet = new Set(
      (existingCandidatePrompts || []).map(p => `${p.attribute_id}-${p.prompt_type}`)
    );

    // 5. Generate all attribute prompts and filter to candidate experience only
    const allPrompts = generateAttributePrompts(company.name, company.industry);
    
    const candidateExperiencePrompts = allPrompts.filter(
      template => template.attribute?.category === 'Candidate Experience'
    );

    if (candidateExperiencePrompts.length === 0) {
      throw new Error('No candidate experience prompts found to add');
    }

    // 6. Map prompts to database structure (v2 candidate-experience display names)
    const candidateThemeOverrides: Record<string, string> = {
      'application-communication': 'Application & Communication',
      'candidate-feedback': 'Candidate Feedback',
      'interview-experience': 'Interview Experience',
      'onboarding-experience': 'Onboarding',
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
          prompt_type: template.type as 'informational' | 'experience' | 'competitive' | 'discovery',
          prompt_category: 'Candidate Experience' as const,
          prompt_theme: theme,
          attribute_id: template.attributeId,
          industry_context: company.industry,
          job_function_context: onboardingData?.job_function || null,
          location_context: onboardingData?.country || null,
          is_active: true,
          prompt_version: 2
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


















