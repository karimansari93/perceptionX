import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SOURCES_SECTION_REGEX } from "../_shared/citation-extraction.ts";

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
    const { response, companyName, promptType, perplexityCitations, confirmed_prompt_id, ai_model, company_id, for_index } = body;
    
    // Handle citations from different LLMs
    let llmCitations = perplexityCitations || [];
    if ((ai_model === 'google-ai-overviews' || ai_model === 'bing-copilot' || ai_model === 'openai') && body.citations) {
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

    // For OpenAI, if no citations provided in request, use extracted citations from text
    // Otherwise prefer provided citations (from collect-industry-visibility)
    let finalCitations = llmCitations;
    if (ai_model === 'openai' && (!llmCitations || llmCitations.length === 0)) {
      finalCitations = result.citations;
      console.log(`No citations provided for OpenAI, extracted ${finalCitations.length} from response text`);
    } else if (llmCitations && llmCitations.length > 0) {
      finalCitations = llmCitations;
      console.log(`Using provided citations: ${finalCitations.length} citations`);
    } else {
      finalCitations = result.citations;
      console.log(`Using extracted citations: ${finalCitations.length} citations`);
    }

    // Only persist citations with a valid url so DB and MVs (citation_url, recency) stay consistent
    const citationsForDb = (Array.isArray(finalCitations) ? finalCitations : [])
      .filter((c: Citation) => c && typeof c.url === 'string' && c.url.trim().length > 0)
      .map((c: Citation) => {
        const url = c.url!.trim();
        let domain = c.domain;
        if (!domain) {
          try {
            domain = new URL(url).hostname.replace('www.', '');
          } catch {
            domain = url;
          }
        }
        return {
          url,
          domain,
          title: c.title ?? `Source from ${domain}`,
        };
      });

    // Prepare data for insert
    const insertData: any = {
      confirmed_prompt_id,
      ai_model,
      response_text: response,
      citations: citationsForDb,
      company_mentioned: result.company_mentioned,
      detected_competitors: result.detected_competitors,
      company_id: company_id
      // Removed all unnecessary columns: sentiment_score, sentiment_label, visibility_score, 
      // first_mention_position, total_words, competitive_score, detected_competitors, mention_ranking,
      // talentx_* columns
    };

    // Add for_index if provided
    if (for_index !== undefined) {
      insertData.for_index = for_index;
    }





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
        .slice(0, 10); // Limit to 10 competitors

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

/**
 * Extracts the actual source URL from Google Translate URLs.
 * If the URL is a Google Translate URL, extracts the 'u' parameter value.
 * Otherwise, returns the original URL.
 */
function extractSourceUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  
  try {
    const urlObj = new URL(url.trim());
    
    // Check if this is a Google Translate URL
    if (urlObj.hostname.includes('translate.google') || 
        urlObj.hostname.includes('translate.googleusercontent')) {
      // Extract the 'u' parameter which contains the actual source URL
      const sourceUrl = urlObj.searchParams.get('u');
      if (sourceUrl) {
        // Decode the URL if it's encoded
        try {
          return decodeURIComponent(sourceUrl);
        } catch {
          return sourceUrl;
        }
      }
    }
    
    // Not a Google Translate URL, return original
    return url.trim();
  } catch {
    // If URL parsing fails, try to extract 'u' parameter manually
    const uParamMatch = url.match(/[?&]u=([^&]+)/);
    if (uParamMatch) {
      try {
        return decodeURIComponent(uParamMatch[1]);
      } catch {
        return uParamMatch[1];
      }
    }
    
    // Return original URL if we can't parse it
    return url.trim();
  }
}

// Enhanced citation extraction (same as test-prompt-openai) for better OpenAI citation detection
function extractCitationsFromTextEnhanced(text: string): Citation[] {
  const citations: Citation[] = [];
  const seenUrls = new Set<string>();
  
  // Extract URLs (most reliable)
  const urlPattern = /https?:\/\/([^\s\)]+)/g;
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    const originalUrl = match[0].replace(/[.,;:!?]+$/, ''); // Remove trailing punctuation
    // Extract actual source URL if it's a Google Translate URL
    const url = extractSourceUrl(originalUrl);
    if (!seenUrls.has(url)) {
      try {
        const domain = new URL(url).hostname.replace('www.', '');
        citations.push({
          url,
          domain,
          title: `Source from ${domain}`
        });
        seenUrls.add(url);
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }
  
  // Extract numbered citations [1], [2] with potential URLs nearby
  const citationPattern = /\[(\d+)\][\s]*([^\[]*?)(?:https?:\/\/[^\s\)]+)?/g;
  while ((match = citationPattern.exec(text)) !== null) {
    const num = match[1];
    const context = match[2]?.trim();
    // Try to find URL in nearby text (200 chars after citation)
    const nearbyText = text.substring(Math.max(0, match.index - 50), match.index + 200);
    const urlMatch = nearbyText.match(/https?:\/\/([^\s\)]+)/);
    const citationKey = `citation-${num}`;
    if (!seenUrls.has(citationKey)) {
      const url = urlMatch ? extractSourceUrl(urlMatch[0]) : undefined;
      citations.push({
        domain: context || 'unknown',
        title: `Citation [${num}]${context ? `: ${context}` : ''}`,
        url: url
      });
      seenUrls.add(citationKey);
    }
  }
  
  // Extract "Sources" section (all app languages: Fontes, Fuentes, Quellen, 出典, etc.)
  const sourcesMatch = text.match(SOURCES_SECTION_REGEX);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const sourceUrls = sourcesText.match(/https?:\/\/([^\s\n\)]+)/g) || [];
    sourceUrls.forEach(originalUrl => {
      const url = extractSourceUrl(originalUrl);
      if (!seenUrls.has(url)) {
        try {
          const domain = new URL(url).hostname.replace('www.', '');
          citations.push({ url, domain, title: `Source from ${domain}` });
          seenUrls.add(url);
        } catch (e) {}
      }
    });
  }
  
  return citations;
}

function extractCitationsFromText(text: string): Citation[] {
  // Use enhanced extraction for better results
  return extractCitationsFromTextEnhanced(text);
}

// Sentiment analysis is now handled by AI themes - no need for basic keyword analysis

function detectCompanyMention(text: string, companyName: string): { mentioned: boolean; ranking: number | null } {
  // Basic company mention detection implementation
  const mentioned = text.toLowerCase().includes(companyName.toLowerCase())
  const ranking = null // We don't calculate ranking anymore
  
  return { mentioned, ranking }
}
