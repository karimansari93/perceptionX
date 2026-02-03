import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// TalentX Attributes for theme mapping
const TALENTX_ATTRIBUTES = [
  {
    id: 'mission-purpose',
    name: 'Mission & Purpose',
    description: 'Company mission, values, and sense of purpose',
    keywords: ['mission', 'purpose', 'values', 'vision', 'meaningful', 'impact', 'change the world', 'make a difference']
  },
  {
    id: 'rewards-recognition',
    name: 'Rewards & Recognition',
    description: 'Compensation, benefits, and employee recognition',
    keywords: ['salary', 'compensation', 'benefits', 'bonus', 'recognition', 'rewards', 'incentives', 'perks']
  },
  {
    id: 'company-culture',
    name: 'Company Culture',
    description: 'Workplace culture, values, and environment',
    keywords: ['culture', 'workplace', 'environment', 'atmosphere', 'values', 'team', 'collaboration', 'fun']
  },
  {
    id: 'social-impact',
    name: 'Social Impact',
    description: 'Social responsibility and community impact',
    keywords: ['social impact', 'community', 'charity', 'volunteering', 'sustainability', 'environmental', 'giving back']
  },
  {
    id: 'inclusion',
    name: 'Inclusion',
    description: 'Diversity, equity, and inclusion practices',
    keywords: ['diversity', 'inclusion', 'equity', 'DEI', 'minority', 'women', 'LGBTQ', 'accessible']
  },
  {
    id: 'innovation',
    name: 'Innovation',
    description: 'Innovation culture and cutting-edge technology',
    keywords: ['innovation', 'innovative', 'technology', 'cutting-edge', 'research', 'development', 'breakthrough']
  },
  {
    id: 'wellbeing-balance',
    name: 'Wellbeing & Balance',
    description: 'Work-life balance and employee wellbeing',
    keywords: ['work-life balance', 'wellbeing', 'wellness', 'flexible', 'remote', 'mental health', 'stress']
  },
  {
    id: 'leadership',
    name: 'Leadership',
    description: 'Leadership quality and management style',
    keywords: ['leadership', 'management', 'executives', 'CEO', 'directors', 'managers', 'decision-making']
  },
  {
    id: 'security-perks',
    name: 'Security & Perks',
    description: 'Job security and additional perks',
    keywords: ['job security', 'stability', 'perks', 'amenities', 'office', 'food', 'gym', 'transportation']
  },
  {
    id: 'career-opportunities',
    name: 'Career Opportunities',
    description: 'Career growth and development opportunities',
    keywords: ['career', 'growth', 'development', 'advancement', 'promotion', 'learning', 'training', 'mentorship']
  },
  {
    id: 'application-process',
    name: 'Application Process',
    description: 'Candidate experience during the application and hiring workflow',
    keywords: ['application', 'apply', 'job application', 'application process', 'hiring process', 'recruitment', 'applying', 'ATS', 'screening']
  },
  {
    id: 'candidate-communication',
    name: 'Candidate Communication',
    description: 'Quality and cadence of communication with candidates',
    keywords: ['communication', 'recruiter', 'updates', 'candidate communication', 'recruiter communication', 'feedback', 'response', 'status updates', 'follow-up']
  },
  {
    id: 'interview-experience',
    name: 'Interview Experience',
    description: 'Structure and quality of candidate interviews',
    keywords: ['interview', 'interviewing', 'interview process', 'interview experience', 'interviewer', 'interview questions', 'panel interview', 'technical interview']
  },
  {
    id: 'candidate-feedback',
    name: 'Candidate Feedback',
    description: 'Feedback provided to candidates after interviews or applications',
    keywords: ['feedback', 'candidate feedback', 'interview feedback', 'application feedback', 'response', 'rejection', 'offer feedback', 'communication outcome']
  },
  {
    id: 'onboarding-experience',
    name: 'Onboarding Experience',
    description: 'New hire onboarding and orientation experience',
    keywords: ['onboarding', 'new hire', 'orientation', 'onboarding process', 'first day', 'new employee', 'training', 'welcome', 'orientation program']
  },
  {
    id: 'overall-candidate-experience',
    name: 'Overall Candidate Experience',
    description: 'End-to-end perception of the candidate journey',
    keywords: ['candidate experience', 'candidate journey', 'recruitment experience', 'hiring experience', 'overall experience', 'candidate reputation', 'talent brand']
  }
];

interface AITheme {
  theme_name: string;
  theme_description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  talentx_attribute_id: string;
  talentx_attribute_name: string;
  confidence_score: number;
  keywords: string[];
  context_snippets: string[];
}

interface ResponseData {
  response_id: string;
  response_text: string;
  ai_model: string;
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { responses, company_name, clear_existing = true } = body;

    // Validate required fields
    if (!responses || !Array.isArray(responses) || responses.length === 0) {
      return new Response(
        JSON.stringify({ error: "responses array is required and must not be empty" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!company_name) {
      return new Response(
        JSON.stringify({ error: "company_name is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const responseIds = responses.map((r: ResponseData) => r.response_id);

    // Clear existing themes if requested
    if (clear_existing && responseIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('ai_themes')
        .delete()
        .in('response_id', responseIds);

      if (deleteError) {
        console.warn('Error clearing existing themes:', deleteError);
      }
    }

    // Process responses in parallel with rate limiting
    const results = [];
    const batchSize = 3;
    
    for (let i = 0; i < responses.length; i += batchSize) {
      const batch = responses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (response: ResponseData) => {
        try {
          // Check if themes already exist for this response
          const { data: existingThemes } = await supabase
            .from('ai_themes')
            .select('id')
            .eq('response_id', response.response_id);

          if (existingThemes && existingThemes.length > 0) {
            console.log(`Themes already exist for response ${response.response_id}. Skipping.`);
            return {
              response_id: response.response_id,
              success: true,
              message: 'Themes already exist',
              themes_count: existingThemes.length
            };
          }

          // Analyze themes using OpenAI
          const themes = await analyzeThemesWithOpenAI(response.response_text, company_name);

          if (themes.length === 0) {
            return {
              response_id: response.response_id,
              success: true,
              message: 'No themes identified',
              themes_count: 0
            };
          }

          // Store themes in database
          const themeInserts = themes.map(theme => ({
            response_id: response.response_id,
            theme_name: theme.theme_name,
            theme_description: theme.theme_description,
            sentiment: theme.sentiment,
            sentiment_score: theme.sentiment_score,
            talentx_attribute_id: theme.talentx_attribute_id,
            talentx_attribute_name: theme.talentx_attribute_name,
            confidence_score: theme.confidence_score,
            keywords: theme.keywords,
            context_snippets: theme.context_snippets
          }));

          const { data: insertedThemes, error: insertError } = await supabase
            .from('ai_themes')
            .insert(themeInserts)
            .select();

          if (insertError) {
            console.error(`Error inserting themes for response ${response.response_id}:`, insertError);
            return {
              response_id: response.response_id,
              success: false,
              error: insertError.message,
              themes_count: 0
            };
          }

          return {
            response_id: response.response_id,
            success: true,
            themes: insertedThemes,
            themes_count: insertedThemes.length,
            positive_themes: themes.filter(t => t.sentiment === 'positive').length,
            negative_themes: themes.filter(t => t.sentiment === 'negative').length,
            neutral_themes: themes.filter(t => t.sentiment === 'neutral').length
          };

        } catch (error) {
          console.error(`Error processing response ${response.response_id}:`, error);
          return {
            response_id: response.response_id,
            success: false,
            error: error.message,
            themes_count: 0
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add a small delay between batches to avoid overwhelming the API
      if (i + batchSize < responses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Calculate summary statistics
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const totalThemes = successful.reduce((sum, r) => sum + (r.themes_count || 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total_responses: responses.length,
          successful_responses: successful.length,
          failed_responses: failed.length,
          total_themes: totalThemes
        },
        results: results
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Error in bulk AI thematic analysis:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to analyze themes', details: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});

async function analyzeThemesWithOpenAI(responseText: string, companyName: string): Promise<AITheme[]> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const prompt = `
You are an expert in analyzing company responses to extract meaningful themes about employer branding and talent perception. 

Analyze the following response about "${companyName}" and identify specific themes that relate to talent attraction and employer branding. For each theme you identify:

1. Provide a clear, concise theme name
2. Write a brief description of the theme
3. Determine if the sentiment is positive, negative, or neutral
4. Assign a sentiment score from -1 (very negative) to 1 (very positive)
5. Map the theme to the most relevant TalentX attribute from this list:
   - mission-purpose: Mission & Purpose
   - rewards-recognition: Rewards & Recognition  
   - company-culture: Company Culture
   - social-impact: Social Impact
   - inclusion: Inclusion
   - innovation: Innovation
   - wellbeing-balance: Wellbeing & Balance
   - leadership: Leadership
   - security-perks: Security & Perks
   - career-opportunities: Career Opportunities
   - application-process: Application Process
   - candidate-communication: Candidate Communication
   - interview-experience: Interview Experience
   - candidate-feedback: Candidate Feedback
   - onboarding-experience: Onboarding Experience
   - overall-candidate-experience: Overall Candidate Experience
6. Provide a confidence score from 0 to 1
7. Extract relevant keywords
8. Provide 1-2 context snippets from the response that support this theme

Focus on themes that would be relevant to potential employees or candidates evaluating this company. Look for both positive and negative themes.

Response to analyze:
"${responseText}"

Return your analysis as a JSON array of theme objects with this exact structure:
[
  {
    "theme_name": "string",
    "theme_description": "string", 
    "sentiment": "positive|negative|neutral",
    "sentiment_score": number,
    "talentx_attribute_id": "string",
    "talentx_attribute_name": "string",
    "confidence_score": number,
    "keywords": ["string"],
    "context_snippets": ["string"]
  }
]

CRITICAL: You must return ONLY a valid JSON array. Do not include:
- Markdown code blocks (backticks)
- Any explanatory text before or after the JSON
- Any formatting or comments
- Any other text whatsoever

Return ONLY the raw JSON array starting with [ and ending with ].`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_completion_tokens: 3000 // GPT-5.2 uses tokens for reasoning + content
        // Note: GPT-5.2 doesn't support custom temperature, uses default (1)
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content returned from OpenAI API');
    }

    // Clean the content to extract JSON (remove markdown code blocks if present)
    let cleanedContent = content.trim();
    
    // Remove markdown code blocks more aggressively
    cleanedContent = cleanedContent.replace(/^```json\s*/g, '');
    cleanedContent = cleanedContent.replace(/^```\s*/g, '');
    cleanedContent = cleanedContent.replace(/\s*```$/g, '');
    cleanedContent = cleanedContent.replace(/```$/g, '');
    
    // Also handle cases where there might be extra text before or after
    const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanedContent = jsonMatch[0];
    }

    // Parse the JSON response
    let themes;
    try {
      themes = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Cleaned content:', cleanedContent);
      console.error('Original content:', content);
      throw new Error(`Failed to parse JSON response: ${parseError.message}`);
    }

    // Validate and clean the themes
    return themes.map((theme: any) => ({
      theme_name: theme.theme_name || 'Unnamed Theme',
      theme_description: theme.theme_description || '',
      sentiment: ['positive', 'negative', 'neutral'].includes(theme.sentiment) ? theme.sentiment : 'neutral',
      sentiment_score: Math.max(-1, Math.min(1, parseFloat(theme.sentiment_score) || 0)),
      talentx_attribute_id: theme.talentx_attribute_id || 'unknown',
      talentx_attribute_name: theme.talentx_attribute_name || 'Unknown Attribute',
      confidence_score: Math.max(0, Math.min(1, parseFloat(theme.confidence_score) || 0)),
      keywords: Array.isArray(theme.keywords) ? theme.keywords : [],
      context_snippets: Array.isArray(theme.context_snippets) ? theme.context_snippets : []
    }));

  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    throw error;
  }
}
