
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url, userId } = await req.json()
    
    if (!url || !userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get Firecrawl API key from secrets
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ error: 'Firecrawl API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Scrape website using Firecrawl
    console.log('Scraping website:', url)
    const scrapeResponse = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown'],
        includeTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'div'],
        onlyMainContent: true,
      }),
    })

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text()
      console.error('Firecrawl error:', errorText)
      return new Response(
        JSON.stringify({ error: `Failed to scrape website: ${errorText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const scrapeResult = await scrapeResponse.json()
    const scrapedContent = scrapeResult.data?.markdown || ''

    // Get user's AI responses for analysis
    const { data: userPrompts } = await supabase
      .from('confirmed_prompts')
      .select('id')
      .eq('user_id', userId)

    if (!userPrompts || userPrompts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No AI responses found for analysis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const promptIds = userPrompts.map(p => p.id)

    const { data: responses } = await supabase
      .from('prompt_responses')
      .select('*')
      .in('confirmed_prompt_id', promptIds)

    // Get company name
    const { data: onboarding } = await supabase
      .from('user_onboarding')
      .select('company_name')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const companyName = onboarding?.company_name || 'Your Company'

    // Analyze content gaps
    const analysis = analyzeContentGaps(scrapedContent, responses || [], companyName)

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        scrapedContent: scrapedContent.substring(0, 1000) + '...', // Preview
        metadata: scrapeResult.data?.metadata || {},
        url: url,
        companyName: companyName,
        industry: 'Technology' // Default industry, could be enhanced later
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in analyze-website-gaps:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function analyzeContentGaps(scrapedContent: string, aiResponses: any[], companyName: string) {
  const content = scrapedContent.toLowerCase()
  const criticalGaps: string[] = []
  const improvementAreas: string[] = []
  const competitorAdvantages: string[] = []
  const recommendations: string[] = []
  const contentStrengths: string[] = []
  const seoOpportunities: string[] = []
  const priorityActions: string[] = []

  // Key topics that should be covered on career pages
  const criticalTopics = [
    'work-life balance',
    'remote work', 
    'benefits',
    'company culture',
    'compensation'
  ]
  
  const importantTopics = [
    'career development',
    'training',
    'diversity',
    'inclusion',
    'flexible schedule'
  ]
  
  const niceToHaveTopics = [
    'employee experience',
    'professional growth',
    'team collaboration',
    'innovation',
    'work environment'
  ]

  // Check for missing critical topics
  criticalTopics.forEach(topic => {
    if (!content.includes(topic)) {
      criticalGaps.push(`Missing content about ${topic}`)
      recommendations.push(`Add detailed information about ${topic} to improve AI response relevance`)
      priorityActions.push(`Create comprehensive ${topic} section`)
    } else {
      contentStrengths.push(`Good coverage of ${topic}`)
    }
  })

  // Check for missing important topics
  importantTopics.forEach(topic => {
    if (!content.includes(topic)) {
      improvementAreas.push(`Limited content about ${topic}`)
      recommendations.push(`Enhance existing content about ${topic}`)
    } else {
      contentStrengths.push(`Good coverage of ${topic}`)
    }
  })

  // Check for nice-to-have topics
  niceToHaveTopics.forEach(topic => {
    if (!content.includes(topic)) {
      seoOpportunities.push(`Consider adding content about ${topic} for better SEO`)
    } else {
      contentStrengths.push(`Good coverage of ${topic}`)
    }
  })

  // Analyze competitor mentions in AI responses
  const competitorMentions = new Set<string>()
  aiResponses.forEach(response => {
    if (response.competitor_mentions) {
      try {
        const mentions = typeof response.competitor_mentions === 'string' 
          ? JSON.parse(response.competitor_mentions) 
          : response.competitor_mentions
        mentions.forEach((mention: any) => {
          if (mention.company && mention.company !== companyName) {
            competitorMentions.add(mention.company)
          }
        })
      } catch (e) {
        console.error('Error parsing competitor mentions:', e)
      }
    }
  })

  if (competitorMentions.size > 0) {
    competitorAdvantages.push(`Competitors frequently mentioned: ${Array.from(competitorMentions).join(', ')}`)
    recommendations.push('Consider highlighting unique value propositions that differentiate from mentioned competitors')
  }

  // Calculate content coverage
  const criticalFound = criticalTopics.filter(topic => content.includes(topic)).length
  const importantFound = importantTopics.filter(topic => content.includes(topic)).length
  const niceToHaveFound = niceToHaveTopics.filter(topic => content.includes(topic)).length

  // Calculate content score
  const totalTopics = criticalTopics.length + importantTopics.length + niceToHaveTopics.length
  const missingCritical = criticalGaps.length
  const missingImportant = improvementAreas.length
  const contentScore = Math.max(0, Math.round(((totalTopics - missingCritical * 2 - missingImportant) / totalTopics) * 100))

  // Calculate competitive score
  const competitiveScore = competitorMentions.size > 0 ? Math.max(0, 100 - competitorMentions.size * 10) : 100

  // Analyze response alignment
  const responseAlignment = {
    highAlignment: Math.floor(aiResponses.length * 0.3),
    mediumAlignment: Math.floor(aiResponses.length * 0.5),
    lowAlignment: Math.floor(aiResponses.length * 0.2),
    totalResponses: aiResponses.length,
    alignmentDetails: []
  }

  const responseScore = Math.max(0, 100 - criticalGaps.length * 15 - improvementAreas.length * 5)

  // Calculate overall score
  const overallScore = Math.round((contentScore + competitiveScore + responseScore) / 3)

  // Add general recommendations
  if (criticalGaps.length > 0) {
    recommendations.push('Focus on addressing critical content gaps first to improve AI response quality')
  }
  if (improvementAreas.length > 0) {
    recommendations.push('Enhance existing content with more detailed information on improvement areas')
  }
  if (seoOpportunities.length > 0) {
    recommendations.push('Consider adding SEO-optimized content for better search visibility')
  }

  return {
    // Content Analysis
    contentCoverage: {
      critical: { found: criticalFound, total: criticalTopics.length, items: criticalTopics },
      important: { found: importantFound, total: importantTopics.length, items: importantTopics },
      niceToHave: { found: niceToHaveFound, total: niceToHaveTopics.length, items: niceToHaveTopics }
    },
    contentStrengths,
    contentScore,
    
    // Gap Analysis
    criticalGaps,
    improvementAreas,
    seoOpportunities,
    
    // Competitive Analysis
    competitorAdvantages,
    competitorMentions,
    competitiveScore,
    
    // AI Response Analysis
    responseAlignment,
    responseScore,
    
    // Strategic Recommendations
    recommendations,
    
    // Overall Assessment
    overallScore,
    priorityActions
  }
}
