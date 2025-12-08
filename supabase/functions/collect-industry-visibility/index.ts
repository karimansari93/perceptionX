import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Visibility prompt templates for Employee Experience and Candidate Experience
const VISIBILITY_PROMPTS = {
  'Employee Experience': [
    { theme: 'Mission & Purpose', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are known for having a strong, purpose-driven employer brand?`;
    }},
    { theme: 'Rewards & Recognition', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are known for having exceptional rewards and recognition for employees?`;
    }},
    { theme: 'Company Culture', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are known for outstanding workplace culture?`;
    }},
    { theme: 'Social Impact', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are recognized for meaningful social impact and community engagement?`;
    }},
    { theme: 'Inclusion', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are most recognized for diversity, equity, and inclusion?`;
    }},
    { theme: 'Innovation', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are known for fostering innovation and creative thinking?`;
    }},
    { theme: 'Wellbeing & Balance', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are recognized for exceptional employee wellbeing and work-life balance?`;
    }},
    { theme: 'Leadership', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are respected for outstanding leadership and management?`;
    }},
    { theme: 'Security & Perks', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are known for providing comprehensive benefits and job security?`;
    }},
    { theme: 'Career Opportunities', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are most recognized for exceptional career development and progression opportunities?`;
    }},
  ],
  'Candidate Experience': [
    { theme: 'Application Process', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} have the best application process?`;
    }},
    { theme: 'Candidate Communication', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are recognized for strong candidate communication?`;
    }},
    { theme: 'Interview Experience', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} have the best interview experience?`;
    }},
    { theme: 'Candidate Feedback', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} are known for providing valuable candidate feedback?`;
    }},
    { theme: 'Onboarding Experience', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} have the best onboarding experience?`;
    }},
    { theme: 'Overall Candidate Experience', text: (industry: string, country?: string) => {
      const location = country && country !== 'GLOBAL' ? ` in ${country}` : '';
      return `What companies in ${industry}${location} have the best overall candidate reputation?`;
    }},
  ]
}

serve(async (req) => {
  console.log('collect-industry-visibility function called', {
    method: req.method,
    url: req.url
  });

  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders
    })
  }

  try {
    const body = await req.json();
    console.log('Request body:', body);
    const { industry, companyId, country = 'US' } = body;

    if (!industry) {
      console.error('Industry is required but not provided');
      return new Response(
        JSON.stringify({ error: 'Industry is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Starting collection for industry:', industry, 'country:', country);

    // Initialize Supabase with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get or create a system user for these prompts (or use first admin user)
    const { data: adminUser, error: adminUserError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single()

    if (adminUserError) {
      console.error('Error fetching admin user:', adminUserError);
      throw new Error(`Failed to get admin user: ${adminUserError.message}`);
    }

    if (!adminUser) {
      console.error('No admin user found');
      throw new Error('No user found to associate prompts with')
    }

    console.log('Using admin user:', adminUser.id);

    const results = {
      promptsCreated: 0,
      responsesCollected: 0,
      errors: [] as string[]
    }

    // Create industry-wide prompts (NOT tied to specific companies)
    // These prompts ask the AI which companies are visible in the industry/market
    const allPrompts: Array<{ category: string; theme: string; text: string }> = []
    
    // Add Employee Experience prompts
    for (const prompt of VISIBILITY_PROMPTS['Employee Experience']) {
      allPrompts.push({
        category: 'Employee Experience',
        theme: prompt.theme,
        text: prompt.text(industry, country)
      })
    }

    // Add Candidate Experience prompts
    for (const prompt of VISIBILITY_PROMPTS['Candidate Experience']) {
      allPrompts.push({
        category: 'Candidate Experience',
        theme: prompt.theme,
        text: prompt.text(industry, country)
      })
    }

    // Process each prompt (industry-wide, not per company)
    for (const promptData of allPrompts) {
      try {
        // Check if industry-wide prompt already exists (company_id is NULL for industry-wide prompts)
        const { data: existingPrompt, error: promptCheckError } = await supabase
          .from('confirmed_prompts')
          .select('id')
          .is('company_id', null) // Industry-wide prompts have no company_id
          .eq('prompt_type', 'visibility')
          .eq('prompt_category', promptData.category)
          .eq('prompt_theme', promptData.theme)
          .eq('industry_context', industry)
          .maybeSingle()

        if (promptCheckError && promptCheckError.code !== 'PGRST116') {
          // PGRST116 means no rows found, which is fine - we'll create the prompt
          console.error(`Error checking for existing prompt: ${promptCheckError.message}`)
          results.errors.push(`Error checking prompt for ${promptData.theme}: ${promptCheckError.message}`)
          continue
        }

        let promptId = existingPrompt?.id

        if (!promptId) {
          // Create new industry-wide prompt (company_id = NULL)
          console.log(`Creating industry-wide prompt for ${industry} - ${promptData.theme}`)
          const { data: newPrompt, error: promptError } = await supabase
            .from('confirmed_prompts')
            .insert({
              user_id: adminUser.id,
              company_id: null, // Industry-wide prompt, not tied to a specific company
              onboarding_id: null, // No onboarding_id for industry-wide prompts (used by trigger to identify them)
              prompt_text: promptData.text,
              prompt_type: 'visibility',
              prompt_category: promptData.category,
              prompt_theme: promptData.theme,
              industry_context: industry
            })
            .select('id')
            .single()

          if (promptError) {
            console.error(`Failed to create prompt: ${promptError.message}`)
            results.errors.push(`Failed to create prompt for ${promptData.theme}: ${promptError.message}`)
            continue
          }

          promptId = newPrompt.id
          results.promptsCreated++
          console.log(`Created industry-wide prompt ${promptId} for ${industry} - ${promptData.theme}`)
        } else {
          console.log(`Using existing industry-wide prompt ${promptId} for ${industry} - ${promptData.theme}`)
        }

          // Check if we already have responses for each model
          const { data: existingResponseGPT, error: responseCheckErrorGPT } = await supabase
            .from('prompt_responses')
            .select('id, ai_model, tested_at')
            .eq('confirmed_prompt_id', promptId)
            .eq('ai_model', 'gpt-5-nano')
            .maybeSingle()

          const { data: existingResponsePerplexity, error: responseCheckErrorPerplexity } = await supabase
            .from('prompt_responses')
            .select('id, ai_model, tested_at')
            .eq('confirmed_prompt_id', promptId)
            .eq('ai_model', 'perplexity')
            .maybeSingle()

          const { data: existingResponseGoogle, error: responseCheckErrorGoogle } = await supabase
            .from('prompt_responses')
            .select('id, ai_model, tested_at')
            .eq('confirmed_prompt_id', promptId)
            .eq('ai_model', 'google-ai-overviews')
            .maybeSingle()

          // Collect responses for each model that doesn't exist yet
          const modelsToCollect = [
            { 
              name: 'gpt-5-nano', 
              exists: !!existingResponseGPT,
              type: 'openai' 
            },
            { 
              name: 'perplexity', 
              exists: !!existingResponsePerplexity,
              type: 'perplexity' 
            },
            { 
              name: 'google-ai-overviews', 
              exists: !!existingResponseGoogle,
              type: 'google' 
            }
          ].filter(m => !m.exists)

          for (const model of modelsToCollect) {
            try {
              let responseText = ''
              let citations: any[] = []

              if (model.type === 'openai') {
                // OpenAI API call
                const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'gpt-5-nano',
                    messages: [
                      {
                        role: 'user',
                        content: promptData.text
                      }
                    ],
                    max_tokens: 1000,
                    temperature: 0.7
                  }),
                })

                const openaiData = await openaiResponse.json()

                if (!openaiResponse.ok) {
                  console.error(`${model.name} API error: ${openaiData.error?.message || 'Unknown error'}`)
                  results.errors.push(`${model.name} API error for ${promptData.theme}: ${openaiData.error?.message || 'Unknown error'}`)
                  continue
                }

                responseText = openaiData.choices?.[0]?.message?.content || ''
              } else if (model.type === 'perplexity') {
                // Perplexity edge function
                const perplexityResponse = await fetch(`${supabaseUrl}/functions/v1/test-prompt-perplexity`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ prompt: promptData.text })
                })

                if (!perplexityResponse.ok) {
                  const errorData = await perplexityResponse.json()
                  console.error(`Perplexity error: ${errorData.error || 'Unknown error'}`)
                  results.errors.push(`Perplexity error for ${promptData.theme}: ${errorData.error || 'Unknown error'}`)
                  continue
                }

                const perplexityData = await perplexityResponse.json()
                responseText = perplexityData.response || ''
                citations = perplexityData.citations || []
              } else if (model.type === 'google') {
                // Google AI Overviews edge function
                const googleResponse = await fetch(`${supabaseUrl}/functions/v1/test-prompt-google-ai-overviews`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ prompt: promptData.text })
                })

                if (!googleResponse.ok) {
                  const errorData = await googleResponse.json()
                  console.error(`Google AI error: ${errorData.error || 'Unknown error'}`)
                  results.errors.push(`Google AI error for ${promptData.theme}: ${errorData.error || 'Unknown error'}`)
                  continue
                }

                const googleData = await googleResponse.json()
                responseText = googleData.response || ''
                citations = googleData.citations || []
              }

              if (!responseText) {
                results.errors.push(`No response from ${model.name} for ${promptData.theme}`)
                continue
              }

              console.log(`Received response from ${model.name} for ${promptData.theme} (${responseText.length} chars)`)

              // For industry-wide prompts, we don't analyze for a specific company
              // We store the response and later check which companies are mentioned
              // Store response with company_id = NULL and for_index = true
              const { data: insertedResponse, error: insertError } = await supabase
                .from('prompt_responses')
                .insert({
                  confirmed_prompt_id: promptId,
                  ai_model: model.name,
                  response_text: responseText,
                  citations: model.type === 'perplexity' ? citations : (model.type === 'google' ? citations : []),
                  company_id: null, // Industry-wide response, not tied to a specific company
                  company_mentioned: false, // Will be calculated later when matching to companies
                  detected_competitors: '', // Will be extracted later
                  for_index: true // Mark for visibility rankings
                })
                .select()
                .single()

              if (insertError) {
                console.error(`Error storing response: ${insertError.message}`)
                results.errors.push(`Error storing ${model.name} response for ${promptData.theme}: ${insertError.message}`)
                continue
              }

              // Extract ALL companies mentioned from the response
              // For industry-wide visibility rankings, we extract all companies, not just competitors
              let detectedCompetitors = ''
              try {
                const competitorResponse = await fetch(`${supabaseUrl}/functions/v1/detect-competitors`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    response: responseText,
                    companyName: '' // Empty string signals industry-wide extraction - get ALL companies mentioned
                  })
                })

                if (competitorResponse.ok) {
                  const competitorData = await competitorResponse.json()
                  detectedCompetitors = competitorData.detectedCompetitors || ''
                }
              } catch (compError) {
                console.warn('Error detecting competitors:', compError)
                // Continue without competitors - not critical
              }

              // Update the response with detected competitors
              if (detectedCompetitors) {
                await supabase
                  .from('prompt_responses')
                  .update({ detected_competitors: detectedCompetitors })
                  .eq('id', insertedResponse.id)
              }

              console.log(`Successfully collected ${model.name} response for ${promptData.theme} (${responseText.length} chars, ${detectedCompetitors ? detectedCompetitors.split(',').length : 0} competitors detected)`)
              results.responsesCollected++
            } catch (error: any) {
              results.errors.push(`Error collecting ${model.name} response for ${promptData.theme}: ${error.message}`)
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200))
          }
      } catch (error: any) {
        results.errors.push(`Error processing prompt ${promptData.theme}: ${error.message}`)
      }
    }

    console.log('Collection complete:', results);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Created ${results.promptsCreated} industry-wide prompts, collected ${results.responsesCollected} responses for ${industry}${country && country !== 'GLOBAL' ? ` in ${country}` : ''}`,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error collecting industry visibility:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      cause: error.cause
    });
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to collect visibility responses',
        details: process.env.DENO_ENV === 'development' ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

