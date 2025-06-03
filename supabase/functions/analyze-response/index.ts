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
  model_characteristics: {
    response_style: string;
    information_depth: string;
    citation_approach: string;
    bias_indicators: string[];
    factual_accuracy: string;
    response_structure: string;
    unique_perspectives: string[];
    confidence_level: string;
    temporal_relevance: string;
    comparative_analysis: string;
  };
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

async function performEnhancedBasicAnalysis(responseText: string, companyName: string, promptType: string, competitors: string[]): Promise<AnalysisResult> {
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
  
  // --- OpenAI competitor extraction (dynamic) ---
  const orgs = await extractOrganizationsWithOpenAI(responseText, companyName)
  orgs.forEach(org => {
    if (!competitorMentions.some(m => m.company.toLowerCase() === org.toLowerCase())) {
      competitorMentions.push({ company: org, ranking: null, context: '' });
    }
  });
  
  // Enhanced source inference
  const inferredSources: InformationSource[] = detectSources(responseText)

  // Workplace theme detection
  const workplaceThemes: WorkplaceTheme[] = detectWorkplaceThemes(responseText)

  // Model-specific characteristics analysis
  const modelCharacteristics = {
    response_style: analyzeResponseStyle(responseText),
    information_depth: analyzeInformationDepth(responseText),
    citation_approach: analyzeCitationApproach(responseText),
    bias_indicators: detectBiasIndicators(responseText),
    factual_accuracy: assessFactualAccuracy(responseText),
    response_structure: analyzeResponseStructure(responseText),
    unique_perspectives: identifyUniquePerspectives(responseText),
    confidence_level: assessConfidenceLevel(responseText),
    temporal_relevance: assessTemporalRelevance(responseText),
    comparative_analysis: generateComparativeAnalysis(responseText)
  }

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
    first_mention_position: companyDetection.firstMentionPosition,
    model_characteristics: modelCharacteristics
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

// Helper functions for model-specific analysis
function analyzeResponseStyle(text: string): string {
  const style = {
    formal: text.match(/\b(however|furthermore|moreover|consequently)\b/gi)?.length || 0,
    casual: text.match(/\b(like|you know|basically|actually)\b/gi)?.length || 0,
    technical: text.match(/\b(algorithm|implementation|architecture|framework)\b/gi)?.length || 0
  }
  
  if (style.technical > 5) return "Technical and specialized"
  if (style.formal > 5) return "Formal and academic"
  if (style.casual > 5) return "Conversational and casual"
  return "Balanced and professional"
}

function analyzeInformationDepth(text: string): string {
  const wordCount = text.split(/\s+/).length
  const sentenceCount = text.split(/[.!?]+/).length
  const avgWordsPerSentence = wordCount / sentenceCount
  
  if (avgWordsPerSentence > 25 && wordCount > 500) return "comprehensive"
  if (avgWordsPerSentence > 15 && wordCount > 200) return "moderate"
  return "basic"
}

function analyzeCitationApproach(text: string): string {
  const hasInlineCitations = text.match(/\[\d+\]|\(\d+\)/g)?.length || 0
  const hasUrlCitations = text.match(/https?:\/\/[^\s]+/g)?.length || 0
  const hasAcademicCitations = text.match(/\b(et al\.|et\. al\.|et al)\b/gi)?.length || 0
  
  if (hasAcademicCitations > 0) return "Academic citation style"
  if (hasInlineCitations > 0) return "Formal reference system"
  if (hasUrlCitations > 0) return "Web-based citations"
  return "General reference style"
}

function detectBiasIndicators(text: string): string[] {
  const biasIndicators: string[] = []
  
  if (text.match(/\b(always|never|everyone|nobody)\b/gi)) {
    biasIndicators.push("Absolute statements")
  }
  if (text.match(/\b(best|worst|perfect|terrible)\b/gi)) {
    biasIndicators.push("Extreme language")
  }
  if (text.match(/\b(obviously|clearly|undoubtedly)\b/gi)) {
    biasIndicators.push("Overconfidence")
  }
  
  return biasIndicators.length > 0 ? biasIndicators : ["No significant bias detected"]
}

function assessFactualAccuracy(text: string): string {
  const hasDates = text.match(/\b\d{4}\b/g)?.length || 0
  const hasNumbers = text.match(/\b\d+\b/g)?.length || 0
  const hasSpecifics = text.match(/\b(specifically|precisely|exactly)\b/gi)?.length || 0
  
  if (hasDates > 2 && hasNumbers > 5 && hasSpecifics > 2) return "High factual specificity"
  if (hasDates > 0 && hasNumbers > 2) return "Moderate factual content"
  return "General information"
}

function analyzeResponseStructure(text: string): string {
  const hasHeadings = text.match(/^#+\s|^[A-Z][^\n]+$/gm)?.length || 0
  const hasLists = text.match(/^[-*•]\s|^\d+\.\s/gm)?.length || 0
  const hasParagraphs = text.split(/\n\n/).length
  
  if (hasHeadings > 2 && hasLists > 2) return "Well-structured with clear hierarchy"
  if (hasLists > 0 || hasHeadings > 0) return "Basic structure with some organization"
  return "Free-flowing narrative"
}

function identifyUniquePerspectives(text: string): string[] {
  const perspectives: string[] = []
  
  if (text.match(/\b(innovative|novel|unique)\b/gi)) {
    perspectives.push("Innovation focus")
  }
  if (text.match(/\b(historical|tradition|legacy)\b/gi)) {
    perspectives.push("Historical context")
  }
  if (text.match(/\b(future|emerging|trend)\b/gi)) {
    perspectives.push("Forward-looking")
  }
  
  return perspectives.length > 0 ? perspectives : ["Standard industry perspective"]
}

function assessConfidenceLevel(text: string): string {
  const hasHedges = text.match(/\b(maybe|perhaps|possibly|might)\b/gi)?.length || 0
  const hasCertainty = text.match(/\b(certainly|definitely|absolutely)\b/gi)?.length || 0
  
  if (hasCertainty > hasHedges * 2) return "High confidence"
  if (hasHedges > hasCertainty * 2) return "Cautious"
  return "Balanced confidence"
}

function assessTemporalRelevance(text: string): string {
  const currentYear = new Date().getFullYear()
  const hasRecentYears = text.match(new RegExp(`\\b(${currentYear}|${currentYear-1}|${currentYear-2})\\b`, 'g'))?.length || 0
  const hasOldYears = text.match(new RegExp(`\\b(${currentYear-3}|${currentYear-4}|${currentYear-5})\\b`, 'g'))?.length || 0
  
  if (hasRecentYears > hasOldYears) return "Recent information"
  if (hasOldYears > 0) return "Somewhat dated"
  return "Timeless content"
}

function generateComparativeAnalysis(text: string): string {
  const wordCount = text.split(/\s+/).length
  const hasTechnicalTerms = text.match(/\b(algorithm|implementation|architecture|framework)\b/gi)?.length || 0
  const hasBusinessTerms = text.match(/\b(strategy|market|business|industry)\b/gi)?.length || 0
  
  if (wordCount > 500 && hasTechnicalTerms > 5) return "More technical and detailed than typical responses"
  if (wordCount > 500 && hasBusinessTerms > 5) return "More business-focused than typical responses"
  if (wordCount < 200) return "More concise than typical responses"
  return "Similar to typical model responses"
}

// --- OpenAI Organization Extraction ---
async function extractOrganizationsWithOpenAI(text: string, clientCompanyName: string): Promise<string[]> {
  // Deno compatibility: use globalThis.Deno.env to access environment variables
  const apiKey = globalThis.Deno?.env?.get('OPENAI_API_KEY') || '';
  if (!apiKey) return [];
  const prompt = `Extract all company or organization names mentioned in the following text, excluding "${clientCompanyName}". Return the result as a JSON array of strings.\n\nText:\n"""\n${text}\n"""`;
  const body = {
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 150
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) return [];
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const match = content.match(/\[.*\]/s);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  return [];
}
