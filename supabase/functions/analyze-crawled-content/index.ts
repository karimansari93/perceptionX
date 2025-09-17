import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { content, url, userId } = await req.json();
    if (!content) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Content is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!userId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'User ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    // Analyze the content
    const analysis = analyzeCareerSiteContent(content, url);
    // Try to store the analysis result (optional)
    try {
      const { error: dbError } = await supabaseClient.from('career_site_analyses').insert({
        user_id: userId,
        url: url,
        content_length: content.length,
        analysis: analysis,
        created_at: new Date().toISOString()
      });
      if (dbError) {
        console.error('Database error:', dbError);
      // Continue even if database storage fails
      }
    } catch (dbError) {
      console.error('Database operation failed:', dbError);
    // Continue even if database storage fails
    }
    return new Response(JSON.stringify({
      success: true,
      analysis: analysis
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
function analyzeCareerSiteContent(content, url) {
  const analysis = {
    keyFindings: [],
    recommendations: [],
    contentMetrics: {},
    careerKeywords: {},
    missingElements: []
  };
  const lowerContent = content.toLowerCase();
  // Content metrics
  analysis.contentMetrics = {
    totalLength: content.length,
    wordCount: content.split(/\s+/).length,
    sentenceCount: content.split(/[.!?]+/).length,
    paragraphCount: content.split(/\n\s*\n/).length
  };
  // Check for career-related keywords
  const careerKeywords = [
    'career',
    'job',
    'employment',
    'work',
    'position',
    'role',
    'opportunity',
    'benefits',
    'salary',
    'compensation',
    'culture',
    'team',
    'growth',
    'development',
    'training',
    'remote',
    'hybrid',
    'office',
    'location',
    'requirements',
    'qualifications',
    'experience',
    'skills',
    'responsibilities',
    'perks',
    'health',
    'dental',
    'vision',
    'insurance',
    '401k',
    'pto',
    'vacation',
    'holiday',
    'flexible',
    'work-life',
    'balance'
  ];
  careerKeywords.forEach((keyword)=>{
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      analysis.careerKeywords[keyword] = matches.length;
    }
  });
  // Key findings
  if (analysis.contentMetrics.wordCount < 500) {
    analysis.keyFindings.push('Content appears to be minimal - consider adding more detailed information about your company and career opportunities.');
  }
  if (analysis.careerKeywords['benefits'] && analysis.careerKeywords['benefits'] > 0) {
    analysis.keyFindings.push('Benefits information is present, which is good for attracting talent.');
  } else {
    analysis.missingElements.push('Benefits information');
  }
  if (analysis.careerKeywords['culture'] && analysis.careerKeywords['culture'] > 0) {
    analysis.keyFindings.push('Company culture is mentioned, which helps candidates understand your work environment.');
  } else {
    analysis.missingElements.push('Company culture information');
  }
  if (analysis.careerKeywords['growth'] && analysis.careerKeywords['growth'] > 0) {
    analysis.keyFindings.push('Career growth opportunities are mentioned, which is attractive to potential candidates.');
  } else {
    analysis.missingElements.push('Career growth opportunities');
  }
  // Check for specific career site elements
  const hasJobListings = /job|position|opening|vacancy|hiring|apply/i.test(content);
  const hasCompanyInfo = /about|company|organization|mission|vision|values/i.test(content);
  const hasContactInfo = /contact|email|phone|address|location/i.test(content);
  if (hasJobListings) {
    analysis.keyFindings.push('Job listings or career opportunities are mentioned.');
  } else {
    analysis.missingElements.push('Job listings or career opportunities');
  }
  if (hasCompanyInfo) {
    analysis.keyFindings.push('Company information is present, helping candidates understand your organization.');
  } else {
    analysis.missingElements.push('Company information');
  }
  if (hasContactInfo) {
    analysis.keyFindings.push('Contact information is available for candidates.');
  } else {
    analysis.missingElements.push('Contact information');
  }
  // Recommendations based on analysis
  if (analysis.missingElements.length > 0) {
    analysis.recommendations.push(`Consider adding: ${analysis.missingElements.join(', ')}`);
  }
  if (analysis.contentMetrics.wordCount < 1000) {
    analysis.recommendations.push('Expand your career site content to provide more comprehensive information about working at your company.');
  }
  if (!analysis.careerKeywords['remote'] && !analysis.careerKeywords['hybrid']) {
    analysis.recommendations.push('Consider mentioning remote work or flexible work arrangements if applicable.');
  }
  if (!analysis.careerKeywords['diversity'] && !analysis.careerKeywords['inclusion']) {
    analysis.recommendations.push('Consider highlighting your commitment to diversity and inclusion.');
  }
  if (analysis.careerKeywords['salary'] < 2) {
    analysis.recommendations.push('Consider providing more information about compensation and benefits.');
  }
  // Overall assessment
  const score = calculateContentScore(analysis);
  analysis.overallScore = score;
  analysis.assessment = getAssessment(score);
  return analysis;
}
function calculateContentScore(analysis) {
  let score = 0;
  const maxScore = 100;
  // Content length (up to 20 points)
  const wordCount = analysis.contentMetrics.wordCount;
  if (wordCount >= 2000) score += 20;
  else if (wordCount >= 1000) score += 15;
  else if (wordCount >= 500) score += 10;
  else if (wordCount >= 200) score += 5;
  // Career keywords coverage (up to 30 points)
  const keywordCount = Object.keys(analysis.careerKeywords).length;
  if (keywordCount >= 20) score += 30;
  else if (keywordCount >= 15) score += 25;
  else if (keywordCount >= 10) score += 20;
  else if (keywordCount >= 5) score += 15;
  else if (keywordCount >= 3) score += 10;
  // Missing elements penalty (up to 30 points deducted)
  const missingPenalty = analysis.missingElements.length * 5;
  score = Math.max(0, score - missingPenalty);
  // Bonus for comprehensive content (up to 20 points)
  if (analysis.careerKeywords['benefits'] > 0) score += 5;
  if (analysis.careerKeywords['culture'] > 0) score += 5;
  if (analysis.careerKeywords['growth'] > 0) score += 5;
  if (analysis.careerKeywords['remote'] > 0 || analysis.careerKeywords['hybrid'] > 0) score += 5;
  return Math.min(maxScore, Math.round(score));
}
function getAssessment(score) {
  if (score >= 80) return 'Excellent - Your career site provides comprehensive information for potential candidates.';
  if (score >= 60) return 'Good - Your career site covers most important aspects but could be enhanced.';
  if (score >= 40) return 'Fair - Your career site has basic information but needs significant improvement.';
  return 'Needs Improvement - Your career site lacks essential information for attracting talent.';
}
