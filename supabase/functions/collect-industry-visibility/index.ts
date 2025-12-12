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
    const { 
      industry, 
      companyId, 
      country = 'US', 
      skipResponses = false,
      batchOffset = 0,
      batchSize = null
    } = body;

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
    console.log(`Adding Employee Experience prompts. Total in array: ${VISIBILITY_PROMPTS['Employee Experience'].length}`)
    for (const prompt of VISIBILITY_PROMPTS['Employee Experience']) {
      allPrompts.push({
        category: 'Employee Experience',
        theme: prompt.theme,
        text: prompt.text(industry, country)
      })
      console.log(`  - Added: ${prompt.theme}`)
    }
    console.log(`Employee Experience prompts added. allPrompts.length = ${allPrompts.length}`)

    // Add Candidate Experience prompts
    console.log(`Adding Candidate Experience prompts. Total in array: ${VISIBILITY_PROMPTS['Candidate Experience'].length}`)
    for (const prompt of VISIBILITY_PROMPTS['Candidate Experience']) {
      allPrompts.push({
        category: 'Candidate Experience',
        theme: prompt.theme,
        text: prompt.text(industry, country)
      })
      console.log(`  - Added: ${prompt.theme}`)
    }
    console.log(`All prompts added. Final allPrompts.length = ${allPrompts.length}`)
    console.log(`Prompt list:`, allPrompts.map(p => `${p.theme} (${p.category})`).join(', '))

    // PHASE 1: Create all prompts first (fast, no API calls)
    console.log(`PHASE 1: Creating all ${allPrompts.length} prompts (${allPrompts.filter(p => p.category === 'Employee Experience').length} Employee Experience + ${allPrompts.filter(p => p.category === 'Candidate Experience').length} Candidate Experience)`)
    console.log(`Starting loop. allPrompts.length = ${allPrompts.length}, will iterate ${allPrompts.length} times`)
    
    const promptsWithIds: Array<{ promptData: { category: string; theme: string; text: string }; promptId: string }> = []
    
    for (let i = 0; i < allPrompts.length; i++) {
      // Safety check - log every iteration start
      if (i === 0) console.log(`Loop started. First iteration.`)
      if (i === 5) console.log(`Loop at iteration 6 (Innovation). Continuing...`)
      if (i === 6) console.log(`Loop at iteration 7 (Wellbeing & Balance). Should continue past Innovation.`)
      if (i === 9) console.log(`Loop at iteration 10 (last Employee Experience). Should continue...`)
      if (i === 15) console.log(`Loop at iteration 16 (last prompt). Final iteration.`)
      
      const promptData = allPrompts[i]
      console.log(`[${i + 1}/${allPrompts.length}] Processing: ${promptData.theme} (${promptData.category})`)
      
      let promptId: string | null = null
      
      try {
        // Try to insert directly - faster than checking first
        // If it's a duplicate, we'll catch the error and get the existing ID
        console.log(`[${i + 1}/${allPrompts.length}] Attempting to create prompt: ${promptData.theme}...`)
        
        try {
          const { data: newPrompt, error: promptError } = await supabase
            .from('confirmed_prompts')
            .insert({
              user_id: adminUser.id,
              company_id: null,
              onboarding_id: null,
              prompt_text: promptData.text,
              prompt_type: 'visibility',
              prompt_category: promptData.category,
              prompt_theme: promptData.theme,
              industry_context: industry,
              location_context: null
            })
            .select('id')
            .single()

          if (promptError) {
            // If it's a unique constraint violation, the prompt already exists - get the existing ID
            if (promptError.code === '23505' || promptError.message?.includes('duplicate') || promptError.message?.includes('unique')) {
              console.log(`[${i + 1}/${allPrompts.length}] Prompt already exists, fetching existing ID...`)
              const { data: existingPrompts } = await supabase
                .from('confirmed_prompts')
                .select('id')
                .is('company_id', null)
                .eq('prompt_type', 'visibility')
                .eq('prompt_category', promptData.category)
                .eq('prompt_theme', promptData.theme)
                .eq('industry_context', industry)
                .is('location_context', null)
                .limit(1)
              
              if (existingPrompts && existingPrompts.length > 0) {
                promptId = existingPrompts[0].id
                console.log(`[${i + 1}/${allPrompts.length}] → Using existing prompt ${promptId} for ${promptData.theme}`)
              } else {
                console.error(`[${i + 1}/${allPrompts.length}] Duplicate error but couldn't find existing prompt`)
                results.errors.push(`Duplicate error for ${promptData.theme} but couldn't retrieve ID`)
              }
            } else {
              // Some other error
              console.error(`[${i + 1}/${allPrompts.length}] Failed to create prompt:`, {
                error: promptError.message,
                code: promptError.code
              })
              results.errors.push(`Failed to create prompt for ${promptData.theme}: ${promptError.message}`)
            }
          } else if (newPrompt && newPrompt.id) {
            promptId = newPrompt.id
            results.promptsCreated++
            console.log(`[${i + 1}/${allPrompts.length}] ✓ Created prompt ${promptId} for ${promptData.theme}`)
          } else {
            console.error(`[${i + 1}/${allPrompts.length}] Prompt creation returned no ID`)
            results.errors.push(`Prompt creation failed for ${promptData.theme}: No ID returned`)
          }
        } catch (insertError: any) {
          console.error(`[${i + 1}/${allPrompts.length}] Exception during prompt creation:`, insertError.message)
          results.errors.push(`Exception creating prompt ${promptData.theme}: ${insertError.message}`)
        }
      } catch (error: any) {
        console.error(`[${i + 1}/${allPrompts.length}] CRITICAL ERROR processing prompt ${promptData.theme}:`, error.message, error.stack)
        results.errors.push(`Critical error processing prompt ${promptData.theme}: ${error.message}`)
        // Continue to next prompt - don't let one failure stop the whole process
      }

      // Only add to promptsWithIds if we have a valid promptId
      if (promptId) {
        promptsWithIds.push({ promptData, promptId })
        console.log(`[${i + 1}/${allPrompts.length}] ✓ Added ${promptData.theme} to collection list (ID: ${promptId})`)
      } else {
        console.warn(`[${i + 1}/${allPrompts.length}] ⚠ Skipping ${promptData.theme} - no prompt ID available`)
      }
      
      // Log completion of this iteration
      console.log(`[${i + 1}/${allPrompts.length}] Iteration ${i + 1} COMPLETE. Total processed so far: ${promptsWithIds.length} prompts with IDs`)
      
      // Force a small delay to prevent overwhelming the database
      if (i < allPrompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    
    console.log(`✅ LOOP COMPLETE: Processed all ${allPrompts.length} prompts. Total with IDs: ${promptsWithIds.length}`)
    console.log(`Prompts processed:`, promptsWithIds.map(p => p.promptData.theme).join(', '))
    
    if (promptsWithIds.length < allPrompts.length) {
      const missing = allPrompts.filter(p => !promptsWithIds.find(pid => pid.promptData.theme === p.theme))
      console.warn(`⚠️ WARNING: Only ${promptsWithIds.length} of ${allPrompts.length} prompts were processed!`)
      console.warn(`Missing prompts:`, missing.map(p => p.theme).join(', '))
    }
    
    console.log(`PHASE 1 COMPLETE: Processed ${allPrompts.length} prompts, successfully created/found ${promptsWithIds.length} prompts`)
    console.log(`  - Prompts created: ${results.promptsCreated}`)
    console.log(`  - Errors encountered: ${results.errors.length}`)
    console.log(`  - Prompts ready for response collection: ${promptsWithIds.length}`)
    
    if (promptsWithIds.length === 0) {
      console.error('WARNING: No prompts were created or found!')
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No prompts were created or found',
          results,
          message: `Failed to create any prompts. Errors: ${results.errors.length}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Skip response collection if requested (to avoid timeouts)
    if (skipResponses) {
      console.log(`Skipping PHASE 2 (response collection) as requested. All ${promptsWithIds.length} prompts created successfully.`)
      return new Response(
        JSON.stringify({
          success: true,
          message: `Created ${results.promptsCreated} industry-wide prompts for ${industry}${country && country !== 'GLOBAL' ? ` in ${country}` : ''}. Response collection skipped.`,
          results: {
            ...results,
            skippedResponseCollection: true
          },
          summary: {
            totalPromptsProcessed: allPrompts.length,
            promptsCreated: results.promptsCreated,
            responsesCollected: 0,
            errorsCount: results.errors.length
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Determine batch range
    const totalPrompts = promptsWithIds.length;
    const startIndex = Math.min(Math.max(0, batchOffset), totalPrompts);
    const endIndex = batchSize && batchSize > 0 ? Math.min(totalPrompts, startIndex + batchSize) : totalPrompts;
    const batch = promptsWithIds.slice(startIndex, endIndex);
    console.log(`Starting PHASE 2: Response collection for batch ${startIndex + 1}-${endIndex} of ${totalPrompts} prompts (size: ${batch.length}).`)
    console.log(`⚠️ WARNING: This may timeout if processing too many prompts × 3 models = ${batch.length * 3} API calls`)

    // PHASE 2: Collect responses for the batch
    for (let i = 0; i < batch.length; i++) {
      const { promptData, promptId } = batch[i]
      const globalIndex = startIndex + i + 1
      console.log(`[${globalIndex}/${totalPrompts}] Collecting responses for: ${promptData.theme} (${promptData.category}) [batch ${i + 1}/${batch.length}]`)
      
      try {

          // Check if we already have responses for each model
          const { data: existingResponseGPT, error: responseCheckErrorGPT } = await supabase
            .from('prompt_responses')
            .select('id, ai_model, tested_at')
            .eq('confirmed_prompt_id', promptId)
            .eq('ai_model', 'gpt-4o-mini')
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
              name: 'gpt-4o-mini', 
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
                    model: 'gpt-4o-mini',
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
                console.log(`[${i + 1}/${promptsWithIds.length}] Calling detect-competitors for ${promptData.theme} (${model.name})...`)
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
                  console.log(`[${i + 1}/${promptsWithIds.length}] detect-competitors returned ${detectedCompetitors ? detectedCompetitors.split(',').length : 0} competitors for ${promptData.theme}`)
                } else {
                  const errorText = await competitorResponse.text()
                  console.warn(`[${i + 1}/${promptsWithIds.length}] detect-competitors returned error for ${promptData.theme}: ${competitorResponse.status} - ${errorText}`)
                }
              } catch (compError: any) {
                console.warn(`[${i + 1}/${promptsWithIds.length}] Error detecting competitors for ${promptData.theme}:`, compError.message)
                // Continue without competitors - not critical
              }

              // Update the response with detected competitors
              if (detectedCompetitors) {
                try {
                  console.log(`[${i + 1}/${promptsWithIds.length}] Updating detected_competitors for ${promptData.theme} (${model.name})...`)
                  const { error: updateError } = await supabase
                    .from('prompt_responses')
                    .update({ detected_competitors: detectedCompetitors })
                    .eq('id', insertedResponse.id)
                  
                  if (updateError) {
                    console.error(`[${i + 1}/${promptsWithIds.length}] Error updating competitors for ${promptData.theme}:`, updateError.message)
                  } else {
                    console.log(`[${i + 1}/${promptsWithIds.length}] Successfully updated competitors for ${promptData.theme}`)
                  }
                } catch (updateErr: any) {
                  console.error(`[${i + 1}/${promptsWithIds.length}] Exception updating competitors:`, updateErr.message)
                }
              }

              console.log(`[${i + 1}/${promptsWithIds.length}] Successfully collected ${model.name} response for ${promptData.theme} (${responseText.length} chars, ${detectedCompetitors ? detectedCompetitors.split(',').length : 0} competitors detected)`)
              results.responsesCollected++
              console.log(`[${i + 1}/${promptsWithIds.length}] Model loop iteration complete for ${model.name} on ${promptData.theme}`)
            } catch (error: any) {
              console.error(`[${i + 1}/${promptsWithIds.length}] ERROR in model loop for ${model.name} on ${promptData.theme}:`, error.message, error.stack)
              results.errors.push(`Error collecting ${model.name} response for ${promptData.theme}: ${error.message}`)
            }

            // Small delay to avoid rate limiting
            console.log(`[${i + 1}/${promptsWithIds.length}] Waiting 200ms before next model...`)
            await new Promise(resolve => setTimeout(resolve, 200))
            console.log(`[${i + 1}/${promptsWithIds.length}] Delay complete, continuing to next model`)
          }
          
          console.log(`[${i + 1}/${promptsWithIds.length}] All models processed for ${promptData.theme}. Moving to next prompt...`)
      } catch (error: any) {
        console.error(`[${globalIndex}/${totalPrompts}] ERROR collecting responses for ${promptData.theme}:`, error.message)
        results.errors.push(`Error collecting responses for ${promptData.theme}: ${error.message}`)
        // Continue to next prompt even if this one fails
      }
      
      console.log(`[${globalIndex}/${totalPrompts}] Completed response collection for: ${promptData.theme}`)
    }
    
    console.log(`PHASE 2 COMPLETE for batch ${startIndex + 1}-${endIndex} of ${totalPrompts}. Created: ${results.promptsCreated} prompts, Collected: ${results.responsesCollected} responses, Errors: ${results.errors.length}`)

    console.log('Collection complete:', results);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Created ${results.promptsCreated} prompts. Collected ${results.responsesCollected} responses for batch ${startIndex + 1}-${endIndex} of ${totalPrompts} in ${industry}${country && country !== 'GLOBAL' ? `, ${country}` : ''}.`,
        results,
        summary: {
          batchStart: startIndex + 1,
          batchEnd: endIndex,
          totalPrompts,
          promptsCreated: results.promptsCreated,
          responsesCollected: results.responsesCollected,
          errorsCount: results.errors.length,
          skippedResponseCollection: false
        }
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

