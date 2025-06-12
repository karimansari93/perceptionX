import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  // @ts-ignore: Deno.env.get() is not recognized by TypeScript but is available in Deno runtime
  Deno.env.get('SUPABASE_URL') ?? '',
  // @ts-ignore: Deno.env.get() is not recognized by TypeScript but is available in Deno runtime
  Deno.env.get('SUPABASE_ANON_KEY') ?? ''
);



interface CompetitorMention {
  name: string;
  ranking: number | null;
  context: string;
}

interface Citation {
  domain?: string;
  title?: string;
  url?: string;
}

interface AnalysisResult {
  sentiment_score: number;
  sentiment_label: string;
  citations: Citation[];
  company_mentioned: boolean;
  mention_ranking: number | null;
  competitor_mentions: CompetitorMention[];
  first_mention_position: number | null;
  total_words: number;
  visibility_score: number;
  competitive_score: number;
  detected_competitors: string;
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse and log the request body
    const body = await req.json();
    console.log("Request body received:", body);
    const { response, companyName, promptType, perplexityCitations, confirmed_prompt_id, ai_model } = body;

    // Check for required fields
    if (!confirmed_prompt_id) {
      console.error("Missing confirmed_prompt_id in request body");
      return new Response(
        JSON.stringify({ error: "confirmed_prompt_id is required and was not provided." }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (!ai_model) {
      console.error("Missing ai_model in request body");
      return new Response(
        JSON.stringify({ error: "ai_model is required and was not provided." }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.log('=== ANALYZE RESPONSE DEBUG ===');
    console.log('Company Name:', companyName);
    console.log('Prompt Type:', promptType);
    console.log('Response length:', response.length);
    console.log('Response preview:', response.substring(0, 500));

    const result = await analyzeResponse(response, companyName);
    console.log('Analysis result:', JSON.stringify(result, null, 2));

    // Prepare data for insert
    const insertData = {
      confirmed_prompt_id,
      ai_model,
      response_text: response,
      sentiment_score: result.sentiment_score,
      sentiment_label: result.sentiment_label,
      citations: perplexityCitations || [],
      company_mentioned: result.company_mentioned,
      mention_ranking: result.mention_ranking,
      competitor_mentions: result.competitor_mentions,
      first_mention_position: result.first_mention_position,
      total_words: result.total_words,
      visibility_score: result.visibility_score,
      competitive_score: result.competitive_score,
      detected_competitors: result.detected_competitors
    };

    // Log the insert data
    console.log("Insert data:", insertData);

    const { data: promptResponse, error: insertError } = await supabase
      .from('prompt_responses')
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error('Error storing analysis:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to store analysis', details: insertError }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis: result,
        promptResponse
      }),
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error analyzing response:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to analyze response', details: error }),
      { status: 500, headers: corsHeaders }
    );
  }
})

async function analyzeResponse(text: string, companyName: string): Promise<AnalysisResult> {
  // Get basic analysis
  const basicAnalysis = performEnhancedBasicAnalysis(text, companyName, 'visibility');
  
  // Get sentiment analysis
  const sentimentData = analyzeSentiment(text);
  
  // Get company mention data
  const companyMentionData = detectCompanyMention(text, companyName);
  
  // Get competitor mentions using the new function
  let detectedCompetitors = '';
  try {
    const competitorResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/detect-competitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify({
        response: text,
        companyName: companyName
      })
    });

    const competitorData = await competitorResponse.json();
    detectedCompetitors = competitorData.detectedCompetitors || '';
  } catch (error) {
    console.error('Error detecting competitors:', error);
  }
  
  // Calculate visibility score based on company mention position and frequency
  const totalWords = text.split(/\s+/).length;
  const firstMentionPosition = basicAnalysis.first_mention_position ?? null;
  const visibilityScore = firstMentionPosition !== null 
    ? Math.max(0, 100 - (firstMentionPosition / totalWords) * 100)
    : 0;
  
  // Calculate competitive score based on competitor mentions
  const competitorCount = detectedCompetitors.split(',').filter(Boolean).length;
  const competitiveScore = Math.min(100, competitorCount * 20); // 20 points per competitor, max 100

  return {
    sentiment_score: sentimentData.sentiment_score,
    sentiment_label: sentimentData.sentiment_label,
    citations: basicAnalysis.citations,
    company_mentioned: companyMentionData.mentioned,
    mention_ranking: companyMentionData.ranking,
    competitor_mentions: [], // Keep empty array for backward compatibility
    first_mention_position: firstMentionPosition,
    total_words: totalWords,
    visibility_score: visibilityScore,
    competitive_score: competitiveScore,
    detected_competitors: detectedCompetitors // Add the new field
  };
}

function performEnhancedBasicAnalysis(responseText: string, companyName: string, promptType: string): AnalysisResult {
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
  const competitorMentions: CompetitorMention[] = detectEnhancedCompetitors(responseText, companyName)
  
  // Calculate visibility score
  const totalWords = responseText.split(/\s+/).length;
  const visibilityScore = companyDetection.first_mention_position !== null 
    ? Math.max(0, 100 - (companyDetection.first_mention_position / totalWords) * 100)
    : 0;
  
  // Calculate competitive score
  const competitiveScore = competitorMentions.reduce((score, mention) => {
    if (mention.ranking !== null) {
      return score + (100 - (mention.ranking * 10));
    }
    return score;
  }, 0) / Math.max(1, competitorMentions.length);

  return {
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    citations: [],
    company_mentioned: companyDetection.mentioned,
    mention_ranking: mentionRanking,
    competitor_mentions: competitorMentions,
    total_words: totalWords,
    first_mention_position: companyDetection.first_mention_position,
    visibility_score: visibilityScore,
    competitive_score: competitiveScore,
    detected_competitors: ""
  }
}

function detectEnhancedCompanyMention(text: string, companyName: string) {
  // Lowercase for case-insensitive matching
  const lowerText = text.toLowerCase();
  const lowerCompany = companyName.toLowerCase();

  // Split text into words
  const words = lowerText.split(/\s+/);
  let firstMentionWordIndex = null;
  for (let i = 0; i < words.length; i++) {
    if (words[i].includes(lowerCompany)) {
      firstMentionWordIndex = i;
      break;
    }
  }

  // Debug logging
  console.log('Debug - Original text:', text);
  console.log('Debug - Company name:', companyName);
  console.log('Debug - First mention word index:', firstMentionWordIndex);

  return {
    mentioned: firstMentionWordIndex !== null,
    mentions: firstMentionWordIndex !== null ? 1 : 0,
    first_mention_position: firstMentionWordIndex !== null ? firstMentionWordIndex : null
  };
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

function detectEnhancedCompetitors(text: string, companyName: string): CompetitorMention[] {
  const mentions: CompetitorMention[] = [];
  const lowerCompany = companyName.toLowerCase();
  
  // Common company suffixes and patterns
  const companyPatterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Company|Technologies|Systems|Solutions|Software|Group|International|Global)\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:&|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:AI|ML|Cloud|Digital|Data|Analytics|Security|Network|Media|Health|Finance|Bank|Insurance)\b/g
  ];

  // Track found companies to avoid duplicates
  const foundCompanies = new Set<string>();

  // Extract company names using patterns
  companyPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Get the full company name
      const companyName = match[0].trim();
      const lowerCompanyName = companyName.toLowerCase();

      // Skip if it's the main company or already found
      if (lowerCompanyName === lowerCompany || foundCompanies.has(lowerCompanyName)) {
        continue;
      }

      // Skip if it's a common word or too short
      if (companyName.length < 3 || /^(The|A|An)\s/i.test(companyName)) {
        continue;
      }

      foundCompanies.add(lowerCompanyName);

      // Get ranking and context
      const ranking = detectEnhancedRanking(text, companyName);
      const context = extractContext(text, companyName);

      mentions.push({
        name: companyName,
        ranking,
        context
      });
    }
  });

  // Additional check for companies mentioned in lists or comparisons
  const comparisonPatterns = [
    /(?:compared to|versus|vs\.?|like|similar to|such as)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    /(?:better than|worse than|more than|less than)\s+([A-Z][a-z]+(?:\s+[A-z]+)*)/gi
  ];

  comparisonPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const companyName = match[1].trim();
      const lowerCompanyName = companyName.toLowerCase();

      if (lowerCompanyName === lowerCompany || foundCompanies.has(lowerCompanyName)) {
        continue;
      }

      foundCompanies.add(lowerCompanyName);
      const ranking = detectEnhancedRanking(text, companyName);
      const context = extractContext(text, companyName);

      mentions.push({
        name: companyName,
        ranking,
        context
      });
    }
  });

  console.log('Detected competitors:', mentions);
  return mentions;
}

function extractContext(text: string, competitor: string): string {
  const lowerText = text.toLowerCase()
  const lowerCompetitor = competitor.toLowerCase()
  const index = lowerText.indexOf(lowerCompetitor)
  
  if (index === -1) return ''
  
  const start = Math.max(0, index - 50)
  const end = Math.min(text.length, index + competitor.length + 50)
  return text.substring(start, end).trim()
}

function analyzeSentiment(text: string): { sentiment_score: number; sentiment_label: string } {
  // Basic sentiment analysis implementation
  const positiveWords = ['excellent', 'great', 'good', 'strong', 'successful', 'leader', 'innovative', 'quality', 'best', 'top', 'outstanding', 'superior', 'leading']
  const negativeWords = ['poor', 'bad', 'weak', 'failed', 'struggle', 'decline', 'issues', 'problems', 'worst', 'inferior', 'lacking']
  
  const lowerText = text.toLowerCase()
  const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length
  const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length
  
  let sentimentScore = 0
  if (positiveCount > negativeCount) sentimentScore = Math.min(0.7, positiveCount * 0.1)
  else if (negativeCount > positiveCount) sentimentScore = Math.max(-0.7, -negativeCount * 0.1)
  
  const sentimentLabel = sentimentScore > 0.1 ? 'positive' : sentimentScore < -0.1 ? 'negative' : 'neutral'
  
  return { sentiment_score: sentimentScore, sentiment_label: sentimentLabel }
}

function detectCompanyMention(text: string, companyName: string): { mentioned: boolean; ranking: number | null } {
  // Basic company mention detection implementation
  const mentioned = text.toLowerCase().includes(companyName.toLowerCase())
  const ranking = detectEnhancedRanking(text, companyName)
  
  return { mentioned, ranking }
}
