
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
        metadata: scrapeResult.data?.metadata || {}
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

  // Key topics that should be covered on career pages
  const keyTopics = [
    { term: 'work-life balance', importance: 'critical' },
    { term: 'remote work', importance: 'critical' },
    { term: 'benefits', importance: 'critical' },
    { term: 'company culture', importance: 'critical' },
    { term: 'career development', importance: 'improvement' },
    { term: 'training', importance: 'improvement' },
    { term: 'diversity', importance: 'improvement' },
    { term: 'inclusion', importance: 'improvement' },
    { term: 'compensation', importance: 'critical' },
    { term: 'flexible schedule', importance: 'improvement' },
  ]

  // Check for missing key topics
  keyTopics.forEach(topic => {
    if (!content.includes(topic.term)) {
      if (topic.importance === 'critical') {
        criticalGaps.push(`Missing content about ${topic.term}`)
        recommendations.push(`Add detailed information about ${topic.term} to improve AI response relevance`)
      } else {
        improvementAreas.push(`Limited content about ${topic.term}`)
      }
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

  // Calculate content score
  const totalTopics = keyTopics.length
  const missingCritical = criticalGaps.length
  const missingImprovement = improvementAreas.length
  const contentScore = Math.max(0, Math.round(((totalTopics - missingCritical * 2 - missingImprovement) / totalTopics) * 100))

  // Add general recommendations
  if (criticalGaps.length > 0) {
    recommendations.push('Focus on addressing critical content gaps first to improve AI response quality')
  }
  if (improvementAreas.length > 0) {
    recommendations.push('Enhance existing content with more detailed information on improvement areas')
  }

  return {
    criticalGaps,
    improvementAreas,
    competitorAdvantages,
    recommendations,
    contentScore,
  }
}
