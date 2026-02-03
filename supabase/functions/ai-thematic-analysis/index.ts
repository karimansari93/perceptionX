import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// TalentX Attributes for theme mapping
const TALENTX_ATTRIBUTES = [
  {
    id: 'mission-purpose',
    name: 'Mission & Purpose',
    description: 'Company mission, values, and sense of purpose',
    keywords: ['mission', 'purpose', 'values', 'vision', 'meaningful', 'impact', 'change the world', 'make a difference', 'company values', 'core values', 'principles', 'beliefs', 'why we exist']
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
    description: 'Workplace atmosphere, team dynamics, and cultural practices',
    keywords: ['workplace atmosphere', 'team dynamics', 'cultural practices', 'work environment', 'office culture', 'team collaboration', 'workplace vibe', 'company atmosphere']
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
    keywords: ['work-life balance', 'wellbeing', 'wellness', 'flexible', 'remote', 'mental health', 'stress', 'work environment', 'employee wellbeing', 'workplace wellness', 'flexible work', 'work flexibility']
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
    const { response_id, company_name, response_text, ai_model, force = false } = body;

    // Validate required fields
    if (!response_id) {
      return new Response(
        JSON.stringify({ error: "response_id is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!response_text) {
      return new Response(
        JSON.stringify({ error: "response_text is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!company_name) {
      return new Response(
        JSON.stringify({ error: "company_name is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Check if themes already exist for this response
    const { data: existingThemes, error: checkError } = await supabase
      .from('ai_themes')
      .select('id')
      .eq('response_id', response_id);

    if (checkError) {
      console.error('Error checking existing themes:', checkError);
      return new Response(
        JSON.stringify({ error: 'Failed to check existing themes', details: checkError }),
        { status: 500, headers: corsHeaders }
      );
    }

    // If themes already exist, optionally skip or replace
    if (existingThemes && existingThemes.length > 0 && !force) {
      console.log(`Themes already exist for response ${response_id}. Skipping analysis.`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Themes already exist for this response',
          existing_count: existingThemes.length
        }),
        { headers: corsHeaders }
      );
    }

    // If force is true and themes exist, delete them first
    if (existingThemes && existingThemes.length > 0 && force) {
      console.log(`Force mode: Deleting ${existingThemes.length} existing themes for response ${response_id}`);
      const { error: deleteError } = await supabase
        .from('ai_themes')
        .delete()
        .eq('response_id', response_id);
      
      if (deleteError) {
        console.error('Error deleting existing themes:', deleteError);
        return new Response(
          JSON.stringify({ error: 'Failed to delete existing themes', details: deleteError }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Analyze themes using OpenAI
    const themes = await analyzeThemesWithOpenAI(response_text, company_name);

    if (themes.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No themes identified in the response',
          themes: []
        }),
        { headers: corsHeaders }
      );
    }

    // Store themes in database
    const themeInserts = themes.map(theme => ({
      response_id,
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
      console.error('Error inserting themes:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to store themes', details: insertError }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        themes: insertedThemes,
        total_themes: insertedThemes.length,
        positive_themes: themes.filter(t => t.sentiment === 'positive').length,
        negative_themes: themes.filter(t => t.sentiment === 'negative').length,
        neutral_themes: themes.filter(t => t.sentiment === 'neutral').length
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Error in AI thematic analysis:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to analyze themes', details: error }),
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

Analyze the following response about "${companyName}" and identify specific themes that relate to talent attraction and employer branding. 

CRITICAL: Only extract themes about "${companyName}" itself. Do NOT extract themes about competitors or other companies mentioned in the response. Focus exclusively on themes, perceptions, and information about "${companyName}".

For each theme you identify:

1. Provide a clear, concise theme name
2. Write a brief description of the theme
3. Determine if the sentiment is positive, negative, or neutral
4. Assign a sentiment score from -1 (very negative) to 1 (very positive)
5. Map the theme to the most relevant TalentX attribute from this list. BE VERY SPECIFIC about Company Culture:
   - mission-purpose: Mission & Purpose (company mission, values, purpose, making a difference)
   - rewards-recognition: Rewards & Recognition (compensation, benefits, bonuses, recognition programs)
   - company-culture: Company Culture (ONLY workplace atmosphere, team dynamics, cultural practices, work environment - NOT general values, mission, or benefits)
   - social-impact: Social Impact (community involvement, charity, environmental responsibility, giving back)
   - inclusion: Inclusion (diversity, equity, accessibility, minority representation, LGBTQ+ support)
   - innovation: Innovation (cutting-edge technology, research, breakthrough products, R&D culture)
   - wellbeing-balance: Wellbeing & Balance (work-life balance, flexible work, mental health, wellness programs)
   - leadership: Leadership (management quality, executive decisions, leadership style, management practices)
   - security-perks: Security & Perks (job security, office amenities, food, gym, transportation benefits)
   - career-opportunities: Career Opportunities (growth, advancement, learning, training, mentorship, promotions)
   - application-process: Application Process (ease, clarity, and speed of applying or moving through the hiring funnel)
   - candidate-communication: Candidate Communication (responsiveness, clarity, and helpfulness of recruiter/company updates)
   - interview-experience: Interview Experience (structure, fairness, difficulty, panel behavior, logistics)
   - candidate-feedback: Candidate Feedback (quality and timeliness of interview or application feedback)
   - onboarding-experience: Onboarding Experience (new hire orientation, training, first-week experience)
   - overall-candidate-experience: Overall Candidate Experience (holistic perception of the end-to-end candidate journey)

IMPORTANT CLASSIFICATION RULES:
- Company Culture should ONLY be used for themes about workplace atmosphere, team dynamics, cultural practices, and work environment
- If a theme could fit multiple categories, choose the MORE SPECIFIC one (e.g., choose "Mission & Purpose" over "Company Culture" for values)
- Values and mission belong to "Mission & Purpose", not "Company Culture"
- Benefits and compensation belong to "Rewards & Recognition", not "Company Culture"
- Work-life balance belongs to "Wellbeing & Balance", not "Company Culture"
- Candidate journey topics (application steps, recruiter updates, interview logistics, feedback, onboarding, overall candidate perception) must use the dedicated candidate experience attributes above rather than employee experience categories
6. Provide a confidence score from 0 to 1
7. Extract relevant keywords
8. Provide 1-2 context snippets from the response that support this theme

Focus on themes that would be relevant to potential employees evaluating "${companyName}" as a workplace. Look for both positive and negative themes.

CRITICAL INSTRUCTIONS:
1. Only analyze themes about "${companyName}" - ignore any mentions of competitors or other companies
2. Be extremely careful with Company Culture classification. Only use it for themes specifically about workplace atmosphere, team dynamics, and cultural practices. When in doubt, choose a more specific category.
3. If the response primarily discusses competitors or other companies without substantial information about "${companyName}", return an empty array.

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
