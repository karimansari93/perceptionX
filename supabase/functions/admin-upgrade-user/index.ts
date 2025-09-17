import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TalentXPromptTemplate {
  attributeId: string;
  promptType: 'sentiment' | 'competitive' | 'visibility';  // Standard types
  promptText: string;
}

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

    // 3. Check if user already has TalentX prompts and clean them up if they exist
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

    // 4. Generate TalentX Pro prompts
    const companyName = onboardingData.company_name || 'Your Company';
    const industry = onboardingData.industry || 'Technology';
    
    const prompts = generatePromptTemplates(companyName, industry);
    
    // Insert prompts with service role key (bypasses RLS)
    const { data, error: insertError } = await supabase
      .from('confirmed_prompts')
      .insert(prompts.map(prompt => ({
        user_id: userId,
        onboarding_id: onboardingData.id,
        prompt_text: prompt.promptText,
        prompt_type: prompt.promptType,  // Use standard types: 'sentiment', 'competitive', 'visibility'
        prompt_category: prompt.attributeId,
        is_pro_prompt: true,  // This marks it as a TalentX prompt
        is_active: true
      })))
      .select();

    if (insertError) {
      console.error('Error generating TalentX Pro prompts:', insertError);
      throw insertError;
    }

    console.log(`Successfully generated ${prompts.length} TalentX Pro prompts for user ${userId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `User upgraded to Pro and ${prompts.length} TalentX prompts generated` 
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

/**
 * Generate prompt templates for all 30 TalentX prompts
 */
function generatePromptTemplates(companyName: string, industry: string): TalentXPromptTemplate[] {
  const templates: TalentXPromptTemplate[] = [
    // Mission & Purpose
    {
      attributeId: 'mission-purpose',
      promptType: 'sentiment',
      promptText: `How well does ${companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?`
    },
    {
      attributeId: 'mission-purpose',
      promptType: 'competitive',
      promptText: `How do ${companyName}'s mission and purpose compare to other companies in ${industry}?`
    },
    {
      attributeId: 'mission-purpose',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are known for having a strong, purpose-driven employer brand?`
    },

    // Rewards & Recognition
    {
      attributeId: 'rewards-recognition',
      promptType: 'sentiment',
      promptText: `How satisfied are employees at ${companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?`
    },
    {
      attributeId: 'rewards-recognition',
      promptType: 'competitive',
      promptText: `How do rewards and recognition programs at ${companyName} compare to other companies in ${industry}?`
    },
    {
      attributeId: 'rewards-recognition',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are known for having exceptional rewards and recognition for employees?`
    },

    // Company Culture
    {
      attributeId: 'company-culture',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} describe the actual company culture versus the promoted culture?`
    },
    {
      attributeId: 'company-culture',
      promptType: 'competitive',
      promptText: `How does ${companyName}'s company culture compare to other companies in ${industry}?`
    },
    {
      attributeId: 'company-culture',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are known for outstanding workplace culture?`
    },

    // Social Impact
    {
      attributeId: 'social-impact',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} perceive the company's commitment to social impact and community responsibility?`
    },
    {
      attributeId: 'social-impact',
      promptType: 'competitive',
      promptText: `How does ${companyName}'s social impact compare to other companies in ${industry}?`
    },
    {
      attributeId: 'social-impact',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are recognized for meaningful social impact and community engagement?`
    },

    // Inclusion
    {
      attributeId: 'inclusion',
      promptType: 'sentiment',
      promptText: `How do employees from diverse backgrounds at ${companyName} rate the inclusivity of the workplace culture and practices?`
    },
    {
      attributeId: 'inclusion',
      promptType: 'competitive',
      promptText: `How do ${companyName}'s inclusion and diversity efforts compare to other companies in ${industry}?`
    },
    {
      attributeId: 'inclusion',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are most recognized for diversity, equity, and inclusion?`
    },

    // Innovation
    {
      attributeId: 'innovation',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} perceive the company's commitment to innovation and opportunities for creative work?`
    },
    {
      attributeId: 'innovation',
      promptType: 'competitive',
      promptText: `How does ${companyName}'s innovation culture compare to other companies in ${industry}?`
    },
    {
      attributeId: 'innovation',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are known for fostering innovation and creative thinking?`
    },

    // Wellbeing & Balance
    {
      attributeId: 'wellbeing-balance',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} rate work-life balance and the overall wellbeing support provided by the company?`
    },
    {
      attributeId: 'wellbeing-balance',
      promptType: 'competitive',
      promptText: `How do ${companyName}'s wellbeing and work-life balance offerings compare to other companies in ${industry}?`
    },
    {
      attributeId: 'wellbeing-balance',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are recognized for exceptional employee wellbeing and work-life balance?`
    },

    // Leadership
    {
      attributeId: 'leadership',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} rate the quality and effectiveness of leadership within the organization?`
    },
    {
      attributeId: 'leadership',
      promptType: 'competitive',
      promptText: `How does ${companyName}'s leadership quality compare to other companies in ${industry}?`
    },
    {
      attributeId: 'leadership',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are respected for outstanding leadership and management?`
    },

    // Security & Perks
    {
      attributeId: 'security-perks',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} perceive job security, benefits, and additional perks provided by the company?`
    },
    {
      attributeId: 'security-perks',
      promptType: 'competitive',
      promptText: `How do ${companyName}'s security, benefits, and perks compare to other companies in ${industry}?`
    },
    {
      attributeId: 'security-perks',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are known for providing comprehensive benefits and job security?`
    },

    // Career Opportunities
    {
      attributeId: 'career-opportunities',
      promptType: 'sentiment',
      promptText: `How do employees at ${companyName} rate career development opportunities and long-term growth potential?`
    },
    {
      attributeId: 'career-opportunities',
      promptType: 'competitive',
      promptText: `How do career progression opportunities at ${companyName} compare to other companies in ${industry}?`
    },
    {
      attributeId: 'career-opportunities',
      promptType: 'visibility',
      promptText: `What companies in ${industry} are most recognized for exceptional career development and progression opportunities?`
    }
  ];

  return templates;
}
