import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders
    })
  }

  try {
    const { rankingPeriod } = await req.json()

    // Initialize Supabase with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Determine the ranking period (default to current month if not provided)
    const period = rankingPeriod || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    const periodStart = new Date(period)
    const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1)

    // Calculate rankings using the same logic as the SQL script
    const { data: responses, error: responsesError } = await supabase
      .from('prompt_responses')
      .select(`
        id,
        company_id,
        company_mentioned,
        detected_competitors,
        tested_at,
        confirmed_prompts!inner(
          prompt_type,
          prompt_category,
          prompt_theme
        ),
        companies!inner(
          id,
          name,
          industry
        )
      `)
      .in('confirmed_prompts.prompt_type', ['visibility', 'talentx_visibility'])
      .in('confirmed_prompts.prompt_category', ['Employee Experience', 'Candidate Experience'])
      .ilike('ai_model', '%gpt-4o-mini%')
      .gte('tested_at', periodStart.toISOString())
      .lt('tested_at', periodEnd.toISOString())

    if (responsesError) {
      throw responsesError
    }

    if (!responses || responses.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No visibility responses found for the selected period',
          rankings: [],
          summary: {}
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Group and calculate scores
    const companyScores = new Map<string, {
      company_id: string
      company_name: string
      industry: string
      experience_category: string
      theme: string
      total_responses: number
      mentioned_count: number
      detected_competitors: Set<string> // Use Set to collect unique competitors
    }>()

    for (const response of responses) {
      const key = `${response.company_id}-${response.confirmed_prompts.prompt_category}-${response.confirmed_prompts.prompt_theme}`
      
      if (!companyScores.has(key)) {
        companyScores.set(key, {
          company_id: response.company_id,
          company_name: response.companies.name,
          industry: response.companies.industry,
          experience_category: response.confirmed_prompts.prompt_category,
          theme: response.confirmed_prompts.prompt_theme || 'General',
          total_responses: 0,
          mentioned_count: 0,
          detected_competitors: new Set<string>()
        })
      }

      const score = companyScores.get(key)!
      score.total_responses++
      if (response.company_mentioned === true) {
        score.mentioned_count++
      }
      
      // Collect detected competitors from this response
      if (response.detected_competitors) {
        const competitors = response.detected_competitors
          .split(',')
          .map(c => c.trim())
          .filter(c => c.length > 0)
        competitors.forEach(comp => score.detected_competitors.add(comp))
      }
    }

    // Filter companies with at least 3 responses and calculate rankings
    const validScores = Array.from(companyScores.values())
      .filter(score => score.total_responses >= 3)

    // Group by industry, category, theme and rank
    const rankingsByGroup = new Map<string, typeof validScores>()
    
    for (const score of validScores) {
      const groupKey = `${score.industry}-${score.experience_category}-${score.theme}`
      if (!rankingsByGroup.has(groupKey)) {
        rankingsByGroup.set(groupKey, [])
      }
      rankingsByGroup.get(groupKey)!.push(score)
    }

    // Rank within each group
    const rankingsToInsert: any[] = []
    const summary: Record<string, any> = {}

    for (const [groupKey, scores] of rankingsByGroup.entries()) {
      // Sort by visibility ratio (mentioned_count / total_responses)
      scores.sort((a, b) => {
        const ratioA = a.mentioned_count / a.total_responses
        const ratioB = b.mentioned_count / b.total_responses
        return ratioB - ratioA
      })

      const totalCompanies = scores.length

      for (let i = 0; i < scores.length; i++) {
        const score = scores[i]
        // Convert Set to comma-separated string
        const competitorsList = Array.from(score.detected_competitors).join(', ')
        
        rankingsToInsert.push({
          ranking_period: period,
          company_id: score.company_id,
          industry: score.industry,
          country: 'US',
          experience_category: score.experience_category,
          theme: score.theme,
          visibility_score: null, // Frontend calculates
          detected_competitors: competitorsList || null,
          rank_position: i + 1,
          total_companies_in_ranking: totalCompanies
        })
      }

      // Store summary
      if (scores.length > 0) {
        summary[groupKey] = {
          industry: scores[0].industry,
          experience_category: scores[0].experience_category,
          theme: scores[0].theme,
          total_companies: totalCompanies,
          top_company: scores[0].company_name
        }
      }
    }

    // Insert/update rankings
    if (rankingsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('visibility_rankings')
        .upsert(rankingsToInsert, {
          onConflict: 'ranking_period,company_id,industry,country,experience_category,theme',
          ignoreDuplicates: false
        })

      if (insertError) {
        throw insertError
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully calculated rankings for ${rankingsToInsert.length} company-theme combinations`,
        rankings: rankingsToInsert.length,
        summary: Object.values(summary)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error calculating rankings:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to calculate rankings' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

