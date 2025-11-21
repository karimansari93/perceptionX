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



// Sentiment analysis is now handled by AI themes - no need for basic keyword analysis

interface Citation {
  domain?: string;
  title?: string;
  url?: string;
}

interface AnalysisResult {
  citations: Citation[];
  company_mentioned: boolean;
  detected_competitors: string;
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
    if ((ai_model === 'google-ai-overviews' || ai_model === 'bing-copilot') && body.citations) {
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
      citations: llmCitations,
      company_mentioned: result.company_mentioned,
      detected_competitors: result.detected_competitors,
      company_id: company_id
      // Removed all unnecessary columns: sentiment_score, sentiment_label, visibility_score, 
      // first_mention_position, total_words, competitive_score, detected_competitors, mention_ranking,
      // talentx_* columns
    };





    // TalentX functionality has been deprecated - removed for ai-themes focus

    // Continue with regular processing
    try {
      // ALWAYS INSERT new responses to preserve historical data
      // This allows tracking changes over time and comparing different refresh periods
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
      
      const promptResponse = inserted;

      // Trigger AI thematic analysis for new responses
      try {
        // First, get the onboarding_id from the confirmed prompt
        const { data: promptData, error: promptError } = await supabase
          .from('confirmed_prompts')
          .select('onboarding_id')
          .eq('id', confirmed_prompt_id)
          .single();

        if (promptError) {
          console.warn('Error fetching prompt data:', promptError);
        } else {
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
        }
      } catch (analysisError) {
        // Log error but don't fail the response storage
        console.warn('Error triggering AI thematic analysis:', analysisError);
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

  // Get company mention data
  const companyMentionData = detectCompanyMention(text, companyName);

  // Competitor detection: use LLM edge function output only
  let detectedCompetitors = '';

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
        .filter(n => !stopwords.has(n.toLowerCase()))
        .slice(0, 5); // Limit to 5 competitors

      detectedCompetitors = names.join(', ');
    } else {
      // Edge function failed; do not fallback to local
      detectedCompetitors = '';
    }
  } catch (err) {
    // Network/edge error; do not fallback to local
    console.error('detect-competitors failed:', err);
    detectedCompetitors = '';
  }

  // Extract citations from the response text
  const citations = extractCitationsFromText(text);

  return {
    citations: citations,
    company_mentioned: companyMentionData.mentioned,
    detected_competitors: detectedCompetitors
  };
}

// Sentiment analysis is now handled by AI themes - no need for basic keyword analysis

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

// Sentiment analysis is now handled by AI themes - no need for basic keyword analysis

function detectCompanyMention(text: string, companyName: string): { mentioned: boolean; ranking: number | null } {
  // Basic company mention detection implementation
  const mentioned = text.toLowerCase().includes(companyName.toLowerCase())
  const ranking = null // We don't calculate ranking anymore
  
  return { mentioned, ranking }
}
