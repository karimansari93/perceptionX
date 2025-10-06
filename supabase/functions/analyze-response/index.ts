import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// TalentX Analysis Service removed - focusing on ai-themes only

const supabase = createClient(
  // @ts-ignore: Deno.env.get() is not recognized by TypeScript but is available in Deno runtime
  Deno.env.get('SUPABASE_URL') ?? '',
  // @ts-ignore: Deno.env.get() is not recognized by TypeScript but is available in Deno runtime
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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
  talentx_analysis: any[];
  talentx_scores: {
    overall_score: number;
    top_attributes: string[];
    attribute_scores: Record<string, number>;
  };
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    const body = await req.json();
    const { response, companyName, promptType, perplexityCitations, confirmed_prompt_id, ai_model, company_id } = body;
    
    // Handle citations from different LLMs
    let llmCitations = perplexityCitations || [];
    if (ai_model === 'google-ai-overviews' && body.citations) {
      llmCitations = body.citations;
    }



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
    if (!response) {
      console.error("Missing response in request body");
      return new Response(
        JSON.stringify({ error: "response is required and was not provided." }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (!companyName) {
      console.error("Missing companyName in request body");
      return new Response(
        JSON.stringify({ error: "companyName is required and was not provided." }),
        { status: 400, headers: corsHeaders }
      );
    }



    const result = await analyzeResponse(response, companyName, promptType);

    // Prepare data for insert
    const insertData = {
      confirmed_prompt_id,
      ai_model,
      response_text: response,
      sentiment_score: result.sentiment_score,
      sentiment_label: result.sentiment_label,
      citations: llmCitations,
      company_mentioned: result.company_mentioned,
      mention_ranking: result.mention_ranking,
      competitor_mentions: result.competitor_mentions,
      first_mention_position: result.first_mention_position,
      total_words: result.total_words,
      visibility_score: result.visibility_score,
      competitive_score: result.competitive_score,
      detected_competitors: result.detected_competitors,
      company_id: company_id
      // Removed talentx_analysis and talentx_scores as they don't exist in the table
    };





    // TalentX functionality has been deprecated - removed for ai-themes focus

    // Continue with regular processing
    try {
      // Check if a response already exists for this prompt and model (avoid 406 on zero rows)
      const { data: existingResponse, error: checkError } = await supabase
        .from('prompt_responses')
        .select('id')
        .eq('confirmed_prompt_id', confirmed_prompt_id)
        .eq('ai_model', ai_model)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing response:', checkError);
        return new Response(
          JSON.stringify({ error: 'Failed to check existing response', details: checkError }),
          { status: 500, headers: corsHeaders }
        );
      }

      let promptResponse;
      if (existingResponse) {
        const { data: updated, error: updateError } = await supabase
          .from('prompt_responses')
          .update(insertData)
          .eq('id', existingResponse.id)
          .select()
          .single();
        if (updateError) {
          console.error('Error updating existing response:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update existing response', details: updateError }),
            { status: 500, headers: corsHeaders }
          );
        }
        promptResponse = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
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
        promptResponse = inserted;

        // Trigger AI thematic analysis for new responses during onboarding
        try {
          // First, get the onboarding_id from the confirmed prompt
          const { data: promptData, error: promptError } = await supabase
            .from('confirmed_prompts')
            .select('onboarding_id')
            .eq('id', confirmed_prompt_id)
            .single();

          if (promptError) {
            console.warn('Error fetching prompt data:', promptError);
            return;
          }

          // Then get the company name from user_onboarding
          const { data: onboardingData, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('company_name')
            .eq('id', promptData.onboarding_id)
            .single();

          if (!onboardingError && onboardingData?.company_name) {
            console.log(`🚀 Triggering AI thematic analysis for response ${inserted.id} (${ai_model})`);
            // Trigger AI thematic analysis asynchronously (don't wait for completion)
            supabase.functions.invoke('ai-thematic-analysis', {
              body: {
                response_id: inserted.id,
                company_name: onboardingData.company_name,
                response_text: insertData.response_text,
                ai_model: ai_model
              }
            }).catch(error => {
              // Log error but don't fail the response storage
              console.warn('❌ Failed to trigger AI thematic analysis:', error);
            });
          } else {
            console.warn('⚠️ Cannot trigger AI thematic analysis: missing company name or onboarding data');
          }
        } catch (analysisError) {
          // Log error but don't fail the response storage
          console.warn('Error triggering AI thematic analysis:', analysisError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          analysis: result,
          promptResponse
        }),
        { headers: corsHeaders }
      );
    } catch (insertError) {
      console.error('Error in database insert:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to store analysis', details: insertError }),
        { status: 500, headers: corsHeaders }
      );
    }
  } catch (error) {
    console.error('Error analyzing response:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to analyze response', details: error }),
      { status: 500, headers: corsHeaders }
    );
  }
});

async function analyzeResponse(text: string, companyName: string, promptType: string = 'visibility'): Promise<AnalysisResult> {
  // Add null checks
  if (!text) {
    throw new Error('Text is required for analysis');
  }
  
  if (!companyName) {
    throw new Error('Company name is required for analysis');
  }

  // Get basic analysis
  const basicAnalysis = performEnhancedBasicAnalysis(text, companyName, promptType);
  
  // Get sentiment analysis
  const sentimentData = analyzeSentiment(text);
  
  // Get company mention data
  const companyMentionData = detectCompanyMention(text, companyName);

  // Competitor detection: use LLM edge function output only
  let detectedCompetitors = '';
  let competitorMentions: CompetitorMention[] = [];

  try {
    const competitorResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/detect-competitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify({ response: text, companyName })
    });

    if (competitorResponse.ok) {
      const competitorData = await competitorResponse.json();
      const raw = (competitorData.detectedCompetitors || '') as string;
      // Parse names and filter out obvious non-company tokens
      const stopwords = new Set([
        'other', 'others', 'equal', 'training', 'development', 'skills', 'school', 'its', 'the', 'and', 'or',
        'companies', 'company', 'co', 'inc', 'llc', 'ltd'
      ]);
      const names = raw
        .split(',')
        .map(n => n.trim())
        .filter(n => n.length >= 2)
        // Remove phrases like "other companies in the"
        .filter(n => !/\bother\b/i.test(n) || /\bother\b/i.test(companyName) === false)
        // Keep tokens that look like proper names (has uppercase letter)
        .filter(n => /[A-Z]/.test(n))
        // Remove generic words
        .filter(n => !stopwords.has(n.toLowerCase()));

      const uniqueLower = Array.from(new Set(names.map(n => n.toLowerCase())));
      const llmMentions: CompetitorMention[] = uniqueLower.map(lower => {
        const original = names.find(n => n.toLowerCase() === lower) || lower;
        return {
          name: original,
          ranking: detectEnhancedRanking(text, original),
          context: extractContext(text, original)
        } as CompetitorMention;
      });

      competitorMentions = llmMentions;
      detectedCompetitors = competitorMentions.map(m => m.name).join(', ');
    } else {
      // Edge function failed; do not fallback to local
      competitorMentions = [];
      detectedCompetitors = '';
    }
  } catch (err) {
    // Network/edge error; do not fallback to local
    console.error('detect-competitors failed:', err);
    competitorMentions = [];
    detectedCompetitors = '';
  }
  
  // Calculate visibility score based on company mention position and frequency
  const totalWords = text.split(/\s+/).length;
  const firstMentionPosition = basicAnalysis.first_mention_position ?? null;
  const visibilityScore = firstMentionPosition !== null 
    ? Math.max(0, 100 - (firstMentionPosition / totalWords) * 100)
    : 0;
  
  // Calculate competitive score based on competitor mentions
  const competitorCount = competitorMentions.length;
  const competitiveScore = Math.min(100, competitorCount * 20); // 20 points per competitor, max 100

  // TalentX analysis removed - focus on ai-themes only

  return {
    sentiment_score: sentimentData.sentiment_score,
    sentiment_label: sentimentData.sentiment_label,
    citations: basicAnalysis.citations,
    company_mentioned: companyMentionData.mentioned,
    mention_ranking: companyMentionData.ranking,
    competitor_mentions: competitorMentions,
    first_mention_position: firstMentionPosition,
    total_words: totalWords,
    visibility_score: visibilityScore,
    competitive_score: competitiveScore,
    detected_competitors: detectedCompetitors,
    talentx_analysis: [],
    talentx_scores: {
      overall_score: 0,
      top_attributes: [],
      attribute_scores: {}
    }
  };
}

function performEnhancedBasicAnalysis(responseText: string, companyName: string, promptType: string): AnalysisResult {
  // Add null checks
  if (!responseText || !companyName) {
    return {
      sentiment_score: 0,
      sentiment_label: 'neutral',
      citations: [],
      company_mentioned: false,
      mention_ranking: null,
      competitor_mentions: [],
      first_mention_position: null,
      total_words: 0,
      visibility_score: 0,
      competitive_score: 0,
      detected_competitors: "",
      talentx_analysis: [],
      talentx_scores: {
        overall_score: 0,
        top_attributes: [],
        attribute_scores: {}
      }
    };
  }
  
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

  // Extract citations from the response text
  const citations = extractCitationsFromText(responseText);
  
  return {
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    citations: citations,
    company_mentioned: companyDetection.mentioned,
    mention_ranking: mentionRanking,
    competitor_mentions: competitorMentions,
    total_words: totalWords,
    first_mention_position: companyDetection.first_mention_position,
    visibility_score: visibilityScore,
    competitive_score: competitiveScore,
    detected_competitors: "",
    talentx_analysis: [],
    talentx_scores: {
      overall_score: 0,
      top_attributes: [],
      attribute_scores: {}
    }
  }
}

function detectEnhancedCompanyMention(text: string, companyName: string) {
  // Add null checks
  if (!text || !companyName) {
    return {
      mentioned: false,
      mentions: 0,
      first_mention_position: null
    };
  }

  // Lowercase for case-insensitive matching
  const lowerText = text.toLowerCase();
  const lowerCompany = companyName.toLowerCase();

  // Split text into words
  const words = lowerText.split(/\s+/);
  let firstMentionWordIndex: number | null = null;
  for (let i = 0; i < words.length; i++) {
    if (words[i].includes(lowerCompany)) {
      firstMentionWordIndex = i;
      break;
    }
  }



  return {
    mentioned: firstMentionWordIndex !== null,
    mentions: firstMentionWordIndex !== null ? 1 : 0,
    first_mention_position: firstMentionWordIndex !== null ? firstMentionWordIndex : null
  };
}

function detectEnhancedRanking(text: string, companyName: string): number | null {
  if (!text || !companyName) {
    return null;
  }
  
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
  if (!text || !companyName) {
    return [];
  }
  
  const mentions: CompetitorMention[] = [];
  const lowerCompany = companyName.toLowerCase();
  
  // Excluded competitors and words
  const excludedCompetitors = new Set([
    'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
    'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
  ]);
  
  const excludedWords = new Set(['none', 'n/a', 'na']);
  
  // Common company suffixes and patterns
  const companyPatterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Company|Technologies|Systems|Solutions|Software|Group|International|Global|Games|Entertainment|Studios)\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:&|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:AI|ML|Cloud|Digital|Data|Analytics|Security|Network|Media|Health|Finance|Bank|Insurance|Games|Gaming)\b/g
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

      // Skip if it's an excluded competitor or word
      if (excludedCompetitors.has(lowerCompanyName) || excludedWords.has(lowerCompanyName)) {
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

      // Skip if it's an excluded competitor or word
      if (excludedCompetitors.has(lowerCompanyName) || excludedWords.has(lowerCompanyName)) {
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

  return mentions;
}

function extractCitationsFromText(text: string): Citation[] {
  const citations: Citation[] = [];
  
  // Look for URLs in the text
  const urlPattern = /https?:\/\/([^\s]+)/g;
  let match;
  
  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[0];
    const domain = new URL(url).hostname.replace('www.', '');
    
    citations.push({
      domain: domain,
      url: url,
      title: `Source from ${domain}`
    });
  }
  
  // Look for Perplexity citation patterns like [1], [2], [3], etc.
  const perplexityCitationPattern = /\[(\d+)\]/g;
  const localPerplexityCitations = new Set<number>();
  
  while ((match = perplexityCitationPattern.exec(text)) !== null) {
    const citationNumber = parseInt(match[1]);
    localPerplexityCitations.add(citationNumber);
  }
  
  // Add Perplexity citations
  localPerplexityCitations.forEach(citationNumber => {
    citations.push({
      domain: 'perplexity.ai',
      title: `Perplexity Citation [${citationNumber}]`,
      url: undefined
    });
  });
  
  // Look for common citation patterns like "According to [Company]" or "as reported by [Company]"
  const citationPatterns = [
    /(?:according to|as reported by|as stated by|per|via)\s+([A-Z][a-zA-Z\s&]+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Company|Technologies|Systems|Solutions|Software|Group|International|Global))/gi,
    /(?:source|reference|cited from)\s*:\s*([A-Z][a-zA-Z\s&]+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Company|Technologies|Systems|Solutions|Software|Group|International|Global))/gi
  ];
  
  citationPatterns.forEach(pattern => {
    let citationMatch;
    while ((citationMatch = pattern.exec(text)) !== null) {
      const companyName = citationMatch[1].trim();
      if (companyName.length > 3) { // Filter out very short matches
        citations.push({
          domain: companyName.toLowerCase().replace(/\s+/g, ''),
          title: `Cited from ${companyName}`,
          url: undefined
        });
      }
    }
  });
  
  return citations;
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
