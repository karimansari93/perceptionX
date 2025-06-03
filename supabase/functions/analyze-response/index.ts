import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { EMPLOYMENT_SOURCES, SourceConfig } from '../../src/utils/sourceConfig';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface WorkplaceTheme {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  context: string;
  sentiment: 'positive' | 'neutral' | 'negative';
}

interface InformationSource {
  domain: string;
  type: string;
  confidence: string;
  title: string;
  categories: string[];
  url?: string | null;
}

interface CompetitorMention {
  company: string;
  ranking: number | null;
  context: string;
}

interface AnalysisResult {
  sentiment_score: number;
  sentiment_label: string;
  citations: any[];
  company_mentions: number;
  key_themes: string[];
  information_sources: InformationSource[];
  workplace_themes: WorkplaceTheme[];
  company_mentioned: boolean;
  mention_ranking: number | null;
  competitor_mentions: CompetitorMention[];
  total_words?: number;
  first_mention_position?: number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { response, companyName, promptType, competitors = [], perplexityCitations } = await req.json()

    console.log('=== ANALYZE RESPONSE DEBUG ===')
    console.log('Company Name:', companyName)
    console.log('Prompt Type:', promptType)
    console.log('Competitors:', competitors)
    console.log('Response length:', response.length)
    console.log('Response preview:', response.substring(0, 500))

    const analysisPrompt = `
    Analyze the following AI response for sentiment, sources, and visibility metrics related to the company "${companyName}".
    Prompt type: ${promptType}
    Known competitors: ${competitors.join(', ')}

    Response to analyze:
    "${response}"

    Please provide a JSON response with:
    1. sentiment_score: A decimal between -1.0 (very negative) and 1.0 (very positive)
    2. sentiment_label: Either "positive", "neutral", or "negative"
    3. citations: An array of objects containing any sources, references, or information types mentioned
    4. company_mentions: Number of times the company is mentioned
    5. key_themes: Array of main topics discussed
    6. information_sources: Array of inferred source types
    7. workplace_themes: Array of workplace-related themes found in the response, including:
       - culture: Company culture, values, work environment
       - leadership: Management style, leadership approach
       - growth: Career development, learning opportunities
       - benefits: Compensation, perks, work-life balance
       - innovation: R&D, technology, product development
       - diversity: Inclusion, diversity initiatives
       - sustainability: Environmental impact, social responsibility
       - collaboration: Teamwork, cross-functional work
       Each theme should include:
       - name: Theme name
       - confidence: "high", "medium", or "low"
       - context: Brief description of how the theme appears
       - sentiment: "positive", "neutral", or "negative"
    
    For VISIBILITY prompts, also analyze:
    8. company_mentioned: Boolean - is "${companyName}" explicitly mentioned in the response?
    9. mention_ranking: If the response contains a ranked list and "${companyName}" appears in it, what position is it? (1-based indexing, null if not in a ranked list)
    10. competitor_mentions: Array of objects for each competitor mentioned, with:
        - company: Company name (match exactly from the known competitors list)
        - ranking: Position in list if applicable (1-based indexing)
        - context: Brief description of how the company was mentioned

    CRITICAL VISIBILITY ANALYSIS INSTRUCTIONS:
    - Search for "${companyName}" in ALL variations and case-insensitive: "${companyName}", "${companyName.toLowerCase()}", "${companyName} Inc", "${companyName} Systems", etc.
    - Look for EXACT MATCHES of competitors in case-insensitive manner: ${competitors.map(c => `"${c}"`).join(', ')}
    - Pay attention to numbered lists (1., 2., 3.), bullet points (-, •, *), and ranking phrases
    - Extract the exact position number where each company appears in any list
    - Be thorough in identifying all competitor mentions, even if they appear in different contexts
    `

    const analysis = await performEnhancedBasicAnalysis(response, companyName, promptType, competitors)

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function performEnhancedBasicAnalysis(responseText: string, companyName: string, promptType: string, competitors: string[]): AnalysisResult {
  console.log('=== PERFORMING ENHANCED BASIC ANALYSIS ===')
  
  // Basic sentiment analysis based on keywords
  const positiveWords = ['excellent', 'great', 'good', 'strong', 'successful', 'leader', 'innovative', 'quality', 'best', 'top', 'outstanding', 'superior', 'leading']
  const negativeWords = ['poor', 'bad', 'weak', 'failed', 'struggle', 'decline', 'issues', 'problems', 'worst', 'inferior', 'lacking']
  
  const lowerResponse = responseText.toLowerCase()
  const positiveCount = positiveWords.filter(word => lowerResponse.includes(word)).length
  const negativeCount = negativeWords.filter(word => lowerResponse.includes(word)).length
  
  let sentimentScore = 0
  if (positiveCount > negativeCount) sentimentScore = Math.min(0.7, positiveCount * 0.1)
  else if (negativeCount > positiveCount) sentimentScore = Math.max(-0.7, -negativeCount * 0.1)
  
  const sentimentLabel = sentimentScore > 0.1 ? 'positive' : sentimentScore < -0.1 ? 'negative' : 'neutral'
  
  // Enhanced company mention detection
  const companyDetection = detectEnhancedCompanyMention(responseText, companyName)
  
  // Enhanced ranking detection for visibility prompts
  let mentionRanking: number | null = null
  if (promptType === 'visibility') {
    mentionRanking = detectEnhancedRanking(responseText, companyName)
  }
  
  // Enhanced competitor detection
  const competitorMentions: CompetitorMention[] = detectEnhancedCompetitors(responseText, competitors, companyName)
  
  // Enhanced source inference
  const inferredSources: InformationSource[] = detectSources(responseText)

  // Workplace theme detection
  const workplaceThemes: WorkplaceTheme[] = detectWorkplaceThemes(responseText)

  return {
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    citations: [],
    company_mentions: companyDetection.mentions,
    key_themes: [],
    information_sources: inferredSources,
    workplace_themes: workplaceThemes,
    company_mentioned: companyDetection.mentioned,
    mention_ranking: mentionRanking,
    competitor_mentions: competitorMentions,
    total_words: responseText.split(/\s+/).length,
    first_mention_position: companyDetection.firstMentionPosition
  }
}

function detectWorkplaceThemes(text: string): WorkplaceTheme[] {
  const themes: WorkplaceTheme[] = []
  const lowerText = text.toLowerCase()

  // Culture theme detection
  if (lowerText.includes('culture') || lowerText.includes('values') || lowerText.includes('work environment')) {
    themes.push({
      name: 'culture',
      confidence: 'high',
      context: 'Company culture and values mentioned',
      sentiment: determineThemeSentiment(text, ['culture', 'values', 'environment'])
    })
  }

  // Leadership theme detection
  if (lowerText.includes('leadership') || lowerText.includes('management') || lowerText.includes('executive')) {
    themes.push({
      name: 'leadership',
      confidence: 'medium',
      context: 'Leadership and management approach discussed',
      sentiment: determineThemeSentiment(text, ['leadership', 'management', 'executive'])
    })
  }

  // Growth theme detection
  if (lowerText.includes('career') || lowerText.includes('development') || lowerText.includes('growth')) {
    themes.push({
      name: 'growth',
      confidence: 'medium',
      context: 'Career development and growth opportunities mentioned',
      sentiment: determineThemeSentiment(text, ['career', 'development', 'growth'])
    })
  }

  // Benefits theme detection
  if (lowerText.includes('benefits') || lowerText.includes('compensation') || lowerText.includes('perks')) {
    themes.push({
      name: 'benefits',
      confidence: 'medium',
      context: 'Employee benefits and compensation discussed',
      sentiment: determineThemeSentiment(text, ['benefits', 'compensation', 'perks'])
    })
  }

  // Innovation theme detection
  if (lowerText.includes('innovation') || lowerText.includes('technology') || lowerText.includes('research')) {
    themes.push({
      name: 'innovation',
      confidence: 'high',
      context: 'Innovation and technology focus mentioned',
      sentiment: determineThemeSentiment(text, ['innovation', 'technology', 'research'])
    })
  }

  // Diversity theme detection
  if (lowerText.includes('diversity') || lowerText.includes('inclusion') || lowerText.includes('equity')) {
    themes.push({
      name: 'diversity',
      confidence: 'medium',
      context: 'Diversity and inclusion initiatives discussed',
      sentiment: determineThemeSentiment(text, ['diversity', 'inclusion', 'equity'])
    })
  }

  // Sustainability theme detection
  if (lowerText.includes('sustainability') || lowerText.includes('environmental') || lowerText.includes('social responsibility')) {
    themes.push({
      name: 'sustainability',
      confidence: 'medium',
      context: 'Environmental and social responsibility mentioned',
      sentiment: determineThemeSentiment(text, ['sustainability', 'environmental', 'social responsibility'])
    })
  }

  // Collaboration theme detection
  if (lowerText.includes('collaboration') || lowerText.includes('teamwork') || lowerText.includes('cross-functional')) {
    themes.push({
      name: 'collaboration',
      confidence: 'medium',
      context: 'Teamwork and collaboration emphasized',
      sentiment: determineThemeSentiment(text, ['collaboration', 'teamwork', 'cross-functional'])
    })
  }

  return themes
}

function determineThemeSentiment(text: string, keywords: string[]): 'positive' | 'neutral' | 'negative' {
  const positiveWords = ['excellent', 'great', 'strong', 'innovative', 'leading', 'outstanding']
  const negativeWords = ['poor', 'weak', 'lacking', 'issues', 'problems', 'challenges']
  
  const lowerText = text.toLowerCase()
  let positiveCount = 0
  let negativeCount = 0
  
  // Check for positive and negative words near the theme keywords
  keywords.forEach(keyword => {
    const index = lowerText.indexOf(keyword)
    if (index !== -1) {
      const context = lowerText.substring(Math.max(0, index - 50), Math.min(lowerText.length, index + 50))
      positiveWords.forEach(word => {
        if (context.includes(word)) positiveCount++
      })
      negativeWords.forEach(word => {
        if (context.includes(word)) negativeCount++
      })
    }
  })
  
  if (positiveCount > negativeCount) return 'positive'
  if (negativeCount > positiveCount) return 'negative'
  return 'neutral'
}

function detectEnhancedCompanyMention(text: string, companyName: string) {
  const lowerText = text.toLowerCase()
  const lowerCompany = companyName.toLowerCase()
  
  // Check for various company name variations
  const variations = [
    lowerCompany,
    `${lowerCompany} inc`,
    `${lowerCompany} systems`,
    `${lowerCompany} technologies`,
    `${lowerCompany} company`
  ]
  
  let mentioned = false
  let mentions = 0
  let firstMentionPosition: number | null = null
  
  variations.forEach(variation => {
    let position = lowerText.indexOf(variation)
    while (position !== -1) {
      mentioned = true
      mentions++
      if (firstMentionPosition === null) {
        firstMentionPosition = position
      }
      position = lowerText.indexOf(variation, position + 1)
    }
  })
  
  return {
    mentioned,
    mentions,
    firstMentionPosition
  }
}

function detectEnhancedRanking(text: string, companyName: string): number | null {
  const lowerText = text.toLowerCase()
  const lowerCompany = companyName.toLowerCase()
  
  // Look for numbered lists
  const listPattern = /(\d+)\.\s+([^.\n]+)/g
  let match
  let ranking: number | null = null
  
  while ((match = listPattern.exec(lowerText)) !== null) {
    if (match[2].includes(lowerCompany)) {
      ranking = parseInt(match[1])
      break
    }
  }
  
  return ranking
}

function detectEnhancedCompetitors(text: string, competitors: string[], companyName: string): CompetitorMention[] {
  const lowerText = text.toLowerCase()
  const mentions: CompetitorMention[] = []
  
  competitors.forEach(competitor => {
    const lowerCompetitor = competitor.toLowerCase()
    if (lowerText.includes(lowerCompetitor)) {
      const ranking = detectEnhancedRanking(text, competitor)
      mentions.push({
        company: competitor,
        ranking,
        context: extractCompetitorContext(text, competitor)
      })
    }
  })
  
  return mentions
}

function extractCompetitorContext(text: string, competitor: string): string {
  const lowerText = text.toLowerCase()
  const lowerCompetitor = competitor.toLowerCase()
  const index = lowerText.indexOf(lowerCompetitor)
  
  if (index === -1) return ''
  
  const start = Math.max(0, index - 50)
  const end = Math.min(text.length, index + competitor.length + 50)
  return text.substring(start, end).trim()
}

function detectSources(text: string): InformationSource[] {
  const sources: InformationSource[] = [];
  const lowerText = text.toLowerCase();
  
  // Check for mentions of known employment sources
  Object.values(EMPLOYMENT_SOURCES).forEach((source: SourceConfig) => {
    if (lowerText.includes(source.displayName.toLowerCase()) || 
        lowerText.includes(source.domain)) {
      sources.push({
        domain: source.domain,
        type: source.type,
        confidence: 'medium',
        title: source.displayName,
        categories: source.categories,
        url: source.baseUrl
      });
    }
  });
  
  // Add general source detection
  if (lowerText.includes('according to') || lowerText.includes('reports indicate') || lowerText.includes('studies show')) {
    sources.push({
      domain: 'industry-report',
      type: 'industry-knowledge',
      confidence: 'medium',
      title: 'Industry Report or Analysis',
      categories: ['general-knowledge'],
      url: null
    });
  }
  
  return sources;
}
