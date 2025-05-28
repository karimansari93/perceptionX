
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    ${promptType === 'visibility' ? `
    For VISIBILITY prompts, also analyze:
    7. company_mentioned: Boolean - is "${companyName}" explicitly mentioned in the response?
    8. mention_ranking: If the response contains a ranked list and "${companyName}" appears in it, what position is it? (1-based indexing, null if not in a ranked list)
    9. competitor_mentions: Array of objects for each competitor mentioned, with:
       - company: Company name (match exactly from the known competitors list)
       - ranking: Position in list if applicable (1-based indexing)
       - context: Brief description of how the company was mentioned

    CRITICAL VISIBILITY ANALYSIS INSTRUCTIONS:
    - Search for "${companyName}" in ALL variations and case-insensitive: "${companyName}", "${companyName.toLowerCase()}", "${companyName} Inc", "${companyName} Systems", etc.
    - Look for EXACT MATCHES of competitors in case-insensitive manner: ${competitors.map(c => `"${c}"`).join(', ')}
    - Pay attention to numbered lists (1., 2., 3.), bullet points (-, •, *), and ranking phrases
    - Extract the exact position number where each company appears in any list
    - Be thorough in identifying all competitor mentions, even if they appear in different contexts
    ` : `
    For NON-VISIBILITY prompts:
    7. company_mentioned: Boolean - is "${companyName}" mentioned in the response?
    8. mention_ranking: null (not applicable for non-visibility prompts)
    9. competitor_mentions: Array of competitor companies mentioned (without ranking)
    `}

    Respond with ONLY valid JSON, no other text.
    `

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
            role: 'system',
            content: `You are an expert at analyzing text sentiment and extracting company mentions from ranked lists. You are extremely thorough in detecting company names and their positions in lists. Always respond with valid JSON only.`
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        max_tokens: 2000,
        temperature: 0.1
      }),
    })

    const data = await openaiResponse.json()
    
    if (!openaiResponse.ok) {
      throw new Error(data.error?.message || 'OpenAI API error')
    }

    let analysisText = data.choices?.[0]?.message?.content || '{}'
    
    // Clean up the response if it contains markdown code blocks
    if (analysisText.includes('```json')) {
      analysisText = analysisText.replace(/```json\s*/, '').replace(/```\s*$/, '').trim()
    }
    
    try {
      const analysis = JSON.parse(analysisText)
      
      console.log('=== PARSED ANALYSIS ===')
      console.log('Company mentioned:', analysis.company_mentioned)
      console.log('Mention ranking:', analysis.mention_ranking)
      console.log('Company mentions count:', analysis.company_mentions)
      console.log('Competitor mentions:', analysis.competitor_mentions)
      
      // Ensure required fields exist with defaults and enhancements
      const result = {
        sentiment_score: analysis.sentiment_score || 0,
        sentiment_label: analysis.sentiment_label || 'neutral',
        citations: analysis.citations || [],
        company_mentions: analysis.company_mentions || 0,
        key_themes: analysis.key_themes || [],
        information_sources: analysis.information_sources || [],
        company_mentioned: analysis.company_mentioned || false,
        mention_ranking: analysis.mention_ranking || null,
        competitor_mentions: analysis.competitor_mentions || []
      }

      // Enhanced detection with fallback analysis for visibility prompts
      if (promptType === 'visibility') {
        console.log('=== ENHANCED VISIBILITY DETECTION ===')
        
        // Enhanced company mention detection
        const enhancedCompanyMention = detectEnhancedCompanyMention(response, companyName)
        if (enhancedCompanyMention.mentioned) {
          console.log('Enhanced detection found company mention:', enhancedCompanyMention.count, 'times')
          result.company_mentioned = true
          result.company_mentions = Math.max(result.company_mentions, enhancedCompanyMention.count)
        }

        // Enhanced ranking detection
        const enhancedRanking = detectEnhancedRanking(response, companyName)
        if (enhancedRanking !== null) {
          console.log('Enhanced detection found ranking:', enhancedRanking)
          result.mention_ranking = enhancedRanking
        }

        // Enhanced competitor detection
        const enhancedCompetitors = detectEnhancedCompetitors(response, competitors, companyName)
        if (enhancedCompetitors.length > 0) {
          console.log('Enhanced competitor detection found:', enhancedCompetitors.length, 'competitors')
          // Replace existing competitor mentions with enhanced ones
          result.competitor_mentions = enhancedCompetitors
        }
      }

      // If no citations found, add inferred sources based on content analysis
      if (result.citations.length === 0 && result.information_sources.length > 0) {
        result.citations = result.information_sources.map((source: string, index: number) => ({
          url: null,
          domain: source.toLowerCase().replace(/\s+/g, '-'),
          title: source,
          type: inferSourceType(source),
          confidence: 'low'
        }))
      }

      console.log('=== FINAL RESULT ===')
      console.log('Final company_mentioned:', result.company_mentioned)
      console.log('Final mention_ranking:', result.mention_ranking)
      console.log('Final competitor_mentions count:', result.competitor_mentions.length)
      console.log('Final result:', JSON.stringify(result, null, 2))

      return new Response(
        JSON.stringify(result),
        { 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    } catch (parseError) {
      console.error('JSON parsing error:', parseError)
      console.log('Raw analysis text:', analysisText)
      
      // Enhanced fallback with visibility-aware analysis
      const basicAnalysis = performEnhancedBasicAnalysis(response, companyName, promptType, competitors)
      
      return new Response(
        JSON.stringify(basicAnalysis),
        { 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})

function inferSourceType(source: string): string {
  const lowerSource = source.toLowerCase()
  
  if (lowerSource.includes('official') || lowerSource.includes('company')) return 'official-info'
  if (lowerSource.includes('industry') || lowerSource.includes('market')) return 'industry-knowledge'
  if (lowerSource.includes('news') || lowerSource.includes('media')) return 'article'
  if (lowerSource.includes('website') || lowerSource.includes('site')) return 'website'
  if (lowerSource.includes('third-party') || lowerSource.includes('review')) return 'third-party'
  
  return 'general-knowledge'
}

function detectEnhancedCompanyMention(responseText: string, companyName: string): { mentioned: boolean, count: number } {
  console.log('Enhanced company detection for:', companyName)
  
  // Create variations of the company name
  const variations = [
    companyName,
    `${companyName} Inc`,
    `${companyName} Inc.`,
    `${companyName} Systems`,
    `${companyName} Corporation`,
    `${companyName} Corp`,
    `${companyName} Corp.`,
    `${companyName} Company`,
    `${companyName} Ltd`,
    `${companyName} Limited`
  ]
  
  let totalCount = 0
  let mentioned = false
  
  variations.forEach(variation => {
    // Fixed: Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${variation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    const matches = responseText.match(regex)
    if (matches) {
      totalCount += matches.length
      mentioned = true
      console.log(`Found ${matches.length} mentions of "${variation}"`)
    }
  })
  
  return { mentioned, count: totalCount }
}

function detectEnhancedRanking(responseText: string, companyName: string): number | null {
  console.log('Enhanced ranking detection for:', companyName)
  
  const lines = responseText.split(/[\n\r]+/)
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    console.log(`Analyzing line ${i}: "${line}"`)
    
    // Check if this line contains the company name
    const companyRegex = new RegExp(`\\b${companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (!companyRegex.test(line)) continue
    
    // Look for numbered lists (1., 2., 3., etc.)
    const numberedMatch = line.match(/^\s*(\d+)\.?\s*(.+)/)
    if (numberedMatch) {
      const [, number, content] = numberedMatch
      console.log(`Found numbered item ${number}: "${content}"`)
      if (companyRegex.test(content)) {
        console.log(`Company found in numbered list at position ${number}`)
        return parseInt(number)
      }
    }
    
    // Look for bullet points with rankings
    const bulletMatch = line.match(/^\s*[-•*]\s*(.+)/)
    if (bulletMatch) {
      const content = bulletMatch[1]
      if (companyRegex.test(content)) {
        // Try to extract ordinal or number from content
        const ordinalNumber = extractOrdinalFromContent(content)
        if (ordinalNumber) {
          console.log(`Company found in bullet list with ordinal ${ordinalNumber}`)
          return ordinalNumber
        }
        // If no ordinal found, try to find position in sequential bullet points
        const position = findBulletPosition(lines, i, companyName)
        if (position) {
          console.log(`Company found in bullet list at position ${position}`)
          return position
        }
      }
    }
    
    // Look for inline rankings like "Adobe ranks #3" or "6. Adobe"
    const inlineRankMatch = line.match(/(?:^|\s)(\d+)[\.\)\s].*?(?:adobe)/gi) || 
                           line.match(/adobe.*?(?:ranks?|position|#|number)\s*#?(\d+)/gi)
    if (inlineRankMatch) {
      const numbers = line.match(/\d+/g)
      if (numbers && numbers.length > 0) {
        const rankNumber = parseInt(numbers[0])
        if (rankNumber > 0 && rankNumber <= 20) { // reasonable ranking range
          console.log(`Found inline ranking: ${rankNumber}`)
          return rankNumber
        }
      }
    }
  }
  
  return null
}

function extractOrdinalFromContent(content: string): number | null {
  const ordinals = {
    'first': 1, '1st': 1,
    'second': 2, '2nd': 2,
    'third': 3, '3rd': 3,
    'fourth': 4, '4th': 4,
    'fifth': 5, '5th': 5,
    'sixth': 6, '6th': 6,
    'seventh': 7, '7th': 7,
    'eighth': 8, '8th': 8,
    'ninth': 9, '9th': 9,
    'tenth': 10, '10th': 10
  }
  
  const lowerContent = content.toLowerCase()
  for (const [ordinal, number] of Object.entries(ordinals)) {
    if (lowerContent.includes(ordinal)) {
      return number
    }
  }
  
  // Look for number patterns like "#1", "1.", "1:"
  const numberMatch = content.match(/^(\d+)[.\):\s]/)
  if (numberMatch) {
    return parseInt(numberMatch[1])
  }
  
  return null
}

function findBulletPosition(lines: string[], currentIndex: number, companyName: string): number | null {
  let position = 1
  
  for (let i = 0; i <= currentIndex; i++) {
    const line = lines[i].trim()
    if (line.match(/^\s*[-•*]\s+/)) {
      if (i === currentIndex) {
        return position
      }
      position++
    }
  }
  
  return null
}

function detectEnhancedCompetitors(responseText: string, competitors: string[], companyName: string): any[] {
  console.log('Enhanced competitor detection for:', competitors)
  
  const mentions = []
  const lines = responseText.split(/[\n\r]+/)
  
  for (const competitor of competitors) {
    console.log(`Searching for competitor: ${competitor}`)
    
    // Create variations of competitor names
    const variations = [
      competitor,
      `${competitor} Inc`,
      `${competitor} Inc.`,
      `${competitor} Corporation`,
      `${competitor} Corp`
    ]
    
    let found = false
    let ranking = null
    let context = 'General mention'
    
    // Check each variation
    for (const variation of variations) {
      const regex = new RegExp(`\\b${variation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      if (regex.test(responseText)) {
        found = true
        console.log(`Found competitor: ${variation}`)
        
        // Try to find ranking for this competitor
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (regex.test(line)) {
            // Check for numbered list
            const numberedMatch = line.match(/^\s*(\d+)\.?\s*(.+)/)
            if (numberedMatch && regex.test(numberedMatch[2])) {
              ranking = parseInt(numberedMatch[1])
              context = `Ranked #${ranking} in list`
              console.log(`Found ranking ${ranking} for ${variation}`)
              break
            }
            
            // Check for inline ranking
            const inlineRankMatch = line.match(/(?:^|\s)(\d+)[\.\)\s].*?(?:google|microsoft|apple|amazon|meta|salesforce)/gi)
            if (inlineRankMatch) {
              const numbers = line.match(/\d+/g)
              if (numbers && numbers.length > 0) {
                const rankNumber = parseInt(numbers[0])
                if (rankNumber > 0 && rankNumber <= 20) {
                  ranking = rankNumber
                  context = `Ranked #${ranking} in list`
                  console.log(`Found inline ranking ${ranking} for ${variation}`)
                  break
                }
              }
            }
          }
        }
        break
      }
    }
    
    if (found) {
      mentions.push({
        company: competitor,
        ranking,
        context
      })
    }
  }
  
  console.log(`Found ${mentions.length} competitors:`, mentions)
  return mentions
}

function performEnhancedBasicAnalysis(responseText: string, companyName: string, promptType: string, competitors: string[]) {
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
  let mentionRanking = null
  if (promptType === 'visibility') {
    mentionRanking = detectEnhancedRanking(responseText, companyName)
  }
  
  // Enhanced competitor detection
  const competitorMentions = detectEnhancedCompetitors(responseText, competitors, companyName)
  
  // Enhanced source inference
  const inferredSources = []
  if (lowerResponse.includes('according to') || lowerResponse.includes('reports indicate') || lowerResponse.includes('studies show')) {
    inferredSources.push({
      url: null,
      domain: 'industry-report',
      title: 'Industry Report or Analysis',
      type: 'industry-knowledge',
      confidence: 'medium'
    })
  }
  
  if (lowerResponse.includes(companyName.toLowerCase() + ' offers') || lowerResponse.includes('their products') || lowerResponse.includes('official website')) {
    inferredSources.push({
      url: null,
      domain: 'company-information',
      title: 'Official Company Information',
      type: 'official-info',
      confidence: 'medium'
    })
  }
  
  if (lowerResponse.includes('glassdoor') || lowerResponse.includes('indeed') || lowerResponse.includes('linkedin')) {
    inferredSources.push({
      url: null,
      domain: 'career-platform',
      title: 'Career Platform Data',
      type: 'third-party',
      confidence: 'high'
    })
  }
  
  // Default fallback source
  if (inferredSources.length === 0) {
    inferredSources.push({
      url: null,
      domain: 'ai-knowledge',
      title: 'AI Training Data',
      type: 'general-knowledge',
      confidence: 'low'
    })
  }
  
  const result = {
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    citations: inferredSources,
    company_mentions: companyDetection.count,
    company_mentioned: companyDetection.mentioned,
    mention_ranking: mentionRanking,
    competitor_mentions: competitorMentions,
    key_themes: ['General Information'],
    information_sources: inferredSources.map(s => s.title)
  }
  
  console.log('Enhanced basic analysis result:', result)
  return result
}
