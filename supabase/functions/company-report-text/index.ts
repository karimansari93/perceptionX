import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Geographic source mapping
const GEOGRAPHIC_SOURCES: Record<string, any> = {
  'glassdoor.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'indeed.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'linkedin.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'comparably.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'teamblind.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'fishbowlapp.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'builtin.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'greatplacetowork.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'vault.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'themuse.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'kununu.com': { country: 'Germany', region: 'Europe', flag: '🇩🇪' },
  'stepstone.com': { country: 'Germany', region: 'Europe', flag: '🇩🇪' },
  'reed.co.uk': { country: 'United Kingdom', region: 'Europe', flag: '🇬🇧' },
  'totaljobs.com': { country: 'United Kingdom', region: 'Europe', flag: '🇬🇧' },
  'monster.co.uk': { country: 'United Kingdom', region: 'Europe', flag: '🇬🇧' },
  'weloveyourcompany.com': { country: 'France', region: 'Europe', flag: '🇫🇷' },
  'ambitionbox.com': { country: 'India', region: 'Asia-Pacific', flag: '🇮🇳' },
  'naukri.com': { country: 'India', region: 'Asia-Pacific', flag: '🇮🇳' },
  'timesjobs.com': { country: 'India', region: 'Asia-Pacific', flag: '🇮🇳' },
  'shine.com': { country: 'India', region: 'Asia-Pacific', flag: '🇮🇳' },
  'seek.com.au': { country: 'Australia', region: 'Asia-Pacific', flag: '🇦🇺' },
  'jobsdb.com': { country: 'Singapore', region: 'Asia-Pacific', flag: '🇸🇬' },
  'jobsdb.com.hk': { country: 'Hong Kong', region: 'Asia-Pacific', flag: '🇭🇰' },
  'jobsdb.com.my': { country: 'Malaysia', region: 'Asia-Pacific', flag: '🇲🇾' },
  'jobsdb.com.ph': { country: 'Philippines', region: 'Asia-Pacific', flag: '🇵🇭' },
  'jobsdb.com.sg': { country: 'Singapore', region: 'Asia-Pacific', flag: '🇸🇬' },
  'jobsdb.com.th': { country: 'Thailand', region: 'Asia-Pacific', flag: '🇹🇭' },
  'jobsdb.com.vn': { country: 'Vietnam', region: 'Asia-Pacific', flag: '🇻🇳' },
  'jobsdb.com.id': { country: 'Indonesia', region: 'Asia-Pacific', flag: '🇮🇩' },
  'bloomberg.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'reuters.com': { country: 'United Kingdom', region: 'Europe', flag: '🇬🇧' },
  'techcrunch.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'wired.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'forbes.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'fortune.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'wsj.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'nytimes.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'cnn.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'reddit.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'quora.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'stackoverflow.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'github.com': { country: 'United States', region: 'North America', flag: '🇺🇸' },
  'medium.com': { country: 'United States', region: 'North America', flag: '🇺🇸' }
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  console.log('🚀 Edge function called with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('📥 Request body:', body);
    
    const { companyIds, comparisonMode = false } = body;

    if (!companyIds || !Array.isArray(companyIds) || companyIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "companyIds array is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (comparisonMode && companyIds.length < 2) {
      return new Response(
        JSON.stringify({ error: "At least 2 companies required for comparison" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Generate text reports
    if (comparisonMode) {
      const report = await generateComparisonTextReport(companyIds);
      return new Response(
        JSON.stringify({ report }),
        { headers: corsHeaders }
      );
    } else {
      const report = await generateCompanyTextReport(companyIds[0]);
      return new Response(
        JSON.stringify({ report }),
        { headers: corsHeaders }
      );
    }

  } catch (error) {
    console.error('Error generating company report:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate company report', details: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});

async function generateCompanyTextReport(companyId: string): Promise<string> {
  try {
    // Get company information from companies table
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('name, industry')
      .eq('id', companyId)
      .single();

    if (companyError || !companyData) {
      return `Error: Could not find company data for ID ${companyId}`;
    }

    // Get all responses for this company using company_id
    const { data: responses, error: responsesError } = await supabase
      .from('prompt_responses')
      .select(`
        *,
        confirmed_prompts!inner(
          prompt_type,
          prompt_category
        )
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (responsesError || !responses || responses.length === 0) {
      return `Error: No response data found for ${companyData.name}`;
    }

    // Calculate metrics
    const totalResponses = responses.length;
    const averageSentiment = responses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / totalResponses;
    
    const visibilityScores = responses
      .map(r => r.visibility_score)
      .filter(score => typeof score === 'number');
    const visibilityScore = visibilityScores.length > 0 
      ? visibilityScores.reduce((sum, score) => sum + score, 0) / visibilityScores.length 
      : 0;

    const competitivePositions = responses
      .map(r => r.mention_ranking)
      .filter(ranking => typeof ranking === 'number');
    const competitivePosition = competitivePositions.length > 0
      ? competitivePositions.reduce((sum, ranking) => sum + ranking, 0) / competitivePositions.length
      : 0;

    // Get AI themes
    const responseIds = responses.map(r => r.id);
    const { data: themes, error: themesError } = await supabase
      .from('ai_themes')
      .select('*')
      .in('response_id', responseIds)
      .gte('confidence_score', 0.7);

    // Process themes
    const themeMap = new Map();
    themes?.forEach(theme => {
      const key = theme.talentx_attribute_id;
      if (!themeMap.has(key)) {
        themeMap.set(key, {
          theme_name: theme.theme_name,
          talentx_attribute_name: theme.talentx_attribute_name,
          sentiment_score: theme.sentiment_score,
          frequency: 0,
          confidence_score: theme.confidence_score
        });
      }
      themeMap.get(key).frequency++;
    });

    const topThemes = Array.from(themeMap.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    // Process competitor mentions
    const competitorMap = new Map();
    responses.forEach(response => {
      if (response.competitor_mentions && Array.isArray(response.competitor_mentions)) {
        response.competitor_mentions.forEach((competitor: string) => {
          if (!competitorMap.has(competitor)) {
            competitorMap.set(competitor, { competitor, frequency: 0, sentiment: 0 });
          }
          competitorMap.get(competitor).frequency++;
          competitorMap.get(competitor).sentiment += response.sentiment_score || 0;
        });
      }
    });

    const competitorMentions = Array.from(competitorMap.values())
      .map(comp => ({
        ...comp,
        sentiment: comp.sentiment / comp.frequency
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Generate geographic analysis
    const geographicAnalysis = generateGeographicAnalysis(responses);

    // Generate AI insights
    const { keyInsights, recommendations } = await generateAIInsights(
      companyData.name,
      companyData.industry,
      averageSentiment,
      visibilityScore,
      topThemes,
      competitorMentions,
      geographicAnalysis
    );

    // Generate the text report
    return generateTextReport(
      companyData.name,
      companyData.industry,
      totalResponses,
      averageSentiment,
      visibilityScore,
      competitivePosition,
      topThemes,
      competitorMentions,
      geographicAnalysis,
      keyInsights,
      recommendations
    );

  } catch (error) {
    console.error('Error generating company report:', error);
    return `Error generating report: ${error.message}`;
  }
}

async function generateComparisonTextReport(companyIds: string[]): Promise<string> {
  const companyReports = [];
  
  for (const companyId of companyIds) {
    const report = await generateCompanyTextReport(companyId);
    companyReports.push(report);
  }

  return `COMPARISON REPORT\n\n${companyReports.join('\n\n' + '='.repeat(50) + '\n\n')}`;
}

function generateGeographicAnalysis(responses: any[]): any {
  const domainCounts: Record<string, number> = {};
  const countryCounts: Record<string, { count: number; domains: Set<string>; region: string; flag: string }> = {};
  const regionCounts: Record<string, { count: number; countries: Set<string> }> = {};

  // Process responses to extract citations and domains
  responses.forEach(response => {
    const citations = response.citations || [];
    citations.forEach((citation: any) => {
      let domain = '';
      
      if (typeof citation === 'string') {
        domain = extractDomainFromUrl(citation);
      } else if (citation && typeof citation === 'object') {
        if (citation.domain) {
          domain = citation.domain;
        } else if (citation.source) {
          domain = citation.source.toLowerCase().trim() + '.com';
        } else if (citation.url) {
          domain = extractDomainFromUrl(citation.url);
        }
      }

      if (domain) {
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        
        const geoSource = GEOGRAPHIC_SOURCES[domain];
        if (geoSource) {
          const country = geoSource.country;
          const region = geoSource.region;
          const flag = geoSource.flag;
          
          if (!countryCounts[country]) {
            countryCounts[country] = { count: 0, domains: new Set(), region, flag };
          }
          countryCounts[country].count++;
          countryCounts[country].domains.add(domain);
          
          if (!regionCounts[region]) {
            regionCounts[region] = { count: 0, countries: new Set() };
          }
          regionCounts[region].count++;
          regionCounts[region].countries.add(country);
        }
      }
    });
  });

  const totalSources = Object.values(domainCounts).reduce((sum, count) => sum + count, 0);

  // Convert to arrays and calculate percentages
  const countries = Object.entries(countryCounts).map(([country, data]) => ({
    country,
    region: data.region,
    flag: data.flag,
    sources: data.count,
    percentage: totalSources > 0 ? (data.count / totalSources) * 100 : 0,
    domains: Array.from(data.domains)
  })).sort((a, b) => b.sources - a.sources);

  const regions = Object.entries(regionCounts).map(([region, data]) => ({
    region,
    sources: data.count,
    percentage: totalSources > 0 ? (data.count / totalSources) * 100 : 0,
    countries: Array.from(data.countries)
  })).sort((a, b) => b.sources - a.sources);

  const topCountries = countries.slice(0, 5);

  return {
    totalSources,
    countries,
    regions,
    topCountries
  };
}

function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function generateAIInsights(
  companyName: string,
  industry: string,
  averageSentiment: number,
  visibilityScore: number,
  topThemes: any[],
  competitorMentions: any[],
  geographicAnalysis: any
): Promise<{ keyInsights: string[]; recommendations: string[] }> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openaiApiKey) {
    return {
      keyInsights: ["AI analysis not available - OpenAI API key missing"],
      recommendations: ["Configure OpenAI API key for detailed insights"]
    };
  }

  const prompt = `
You are an expert in employer branding and talent perception analysis. Create a concise executive summary for ${companyName} (${industry}) based on the following data:

COMPANY DATA:
- Average Sentiment: ${averageSentiment.toFixed(2)}
- Visibility Score: ${visibilityScore.toFixed(2)}
- Total Themes Identified: ${topThemes.length}

TOP THEMES:
${topThemes.map(theme => `- ${theme.talentx_attribute_name}: ${theme.theme_name} (${theme.sentiment_score > 0 ? 'Positive' : theme.sentiment_score < 0 ? 'Negative' : 'Neutral'}, frequency: ${theme.frequency})`).join('\n')}

COMPETITOR MENTIONS:
${competitorMentions.map(comp => `- ${comp.competitor}: ${comp.frequency} mentions, sentiment: ${comp.sentiment.toFixed(2)}`).join('\n')}

GEOGRAPHIC DISTRIBUTION:
- Total Sources: ${geographicAnalysis.totalSources}
- Top Countries: ${geographicAnalysis.topCountries.map(c => `${c.flag} ${c.country} (${c.percentage.toFixed(1)}%)`).join(', ')}
- Regional Distribution: ${geographicAnalysis.regions.map(r => `${r.region} (${r.percentage.toFixed(1)}%)`).join(', ')}

Please provide:
1. 5 key insights about this company's talent perception (consider geographic distribution)
2. 5 specific recommendations for improvement (consider regional differences)

Focus on actionable insights that would help improve employer branding and talent attraction, taking into account the geographic distribution of sources and potential regional differences in perception.

Return your response as JSON with this exact structure:
{
  "keyInsights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3", "recommendation 4", "recommendation 5"]
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content returned from OpenAI API');
    }

    // Extract JSON from markdown code blocks if present
    let jsonContent = content.trim();
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonContent);
    return {
      keyInsights: parsed.keyInsights || [],
      recommendations: parsed.recommendations || []
    };

  } catch (error) {
    console.error('Error generating AI insights:', error);
    return {
      keyInsights: ["AI analysis failed - using fallback insights"],
      recommendations: ["Review data manually for insights"]
    };
  }
}

function generateTextReport(
  companyName: string,
  industry: string,
  totalResponses: number,
  averageSentiment: number,
  visibilityScore: number,
  competitivePosition: number,
  topThemes: any[],
  competitorMentions: any[],
  geographicAnalysis: any,
  keyInsights: string[],
  recommendations: string[]
): string {
  const sentimentLabel = averageSentiment > 0.1 ? 'Positive' : 
                        averageSentiment < -0.1 ? 'Negative' : 'Neutral';
  
  const visibilityLabel = visibilityScore > 0.7 ? 'High' : 
                         visibilityScore > 0.3 ? 'Moderate' : 'Low';
  
  const competitiveLabel = competitivePosition < 2 ? 'Market Leader' :
                          competitivePosition < 4 ? 'Strong Position' :
                          competitivePosition < 6 ? 'Competitive' : 'Needs Improvement';

  const topCountries = geographicAnalysis.topCountries.slice(0, 3);
  const primaryMarkets = topCountries.map(c => `${c.flag} ${c.country} (${c.percentage.toFixed(1)}%)`).join(', ');

  const positiveThemes = topThemes.filter(t => t.sentiment_score > 0.1).slice(0, 3);
  const negativeThemes = topThemes.filter(t => t.sentiment_score < -0.1).slice(0, 3);

  return `
# TALENT PERCEPTION REPORT
## ${companyName} (${industry})
*Generated on ${new Date().toLocaleDateString()}*

---

## EXECUTIVE SUMMARY

**Overall Sentiment:** ${sentimentLabel} (${averageSentiment.toFixed(2)})
**Visibility:** ${visibilityLabel} (${(visibilityScore * 100).toFixed(1)}%)
**Competitive Position:** ${competitiveLabel}
**Data Sources:** ${totalResponses} responses analyzed
**Primary Markets:** ${primaryMarkets}

---

## KEY METRICS

• **Sentiment Score:** ${averageSentiment.toFixed(2)} (${sentimentLabel})
• **Visibility Score:** ${(visibilityScore * 100).toFixed(1)}% (${visibilityLabel})
• **Competitive Ranking:** ${competitivePosition.toFixed(1)} (${competitiveLabel})
• **Geographic Reach:** ${geographicAnalysis.regions.length} regions
• **Total Sources:** ${geographicAnalysis.totalSources} citations

---

## TOP THEMES

### Positive Themes
${positiveThemes.length > 0 ? positiveThemes.map(theme => 
  `• **${theme.talentx_attribute_name}:** ${theme.theme_name} (${theme.frequency} mentions)`
).join('\n') : '• No significant positive themes identified'}

### Areas of Concern
${negativeThemes.length > 0 ? negativeThemes.map(theme => 
  `• **${theme.talentx_attribute_name}:** ${theme.theme_name} (${theme.frequency} mentions)`
).join('\n') : '• No significant negative themes identified'}

---

## COMPETITIVE LANDSCAPE

**Top Competitors Mentioned:**
${competitorMentions.length > 0 ? competitorMentions.map(comp => 
  `• ${comp.competitor} (${comp.frequency} mentions, sentiment: ${comp.sentiment.toFixed(2)})`
).join('\n') : '• No competitors identified'}

---

## GEOGRAPHIC DISTRIBUTION

**Primary Markets:**
${topCountries.map(country => 
  `• ${country.flag} ${country.country}: ${country.sources} sources (${country.percentage.toFixed(1)}%)`
).join('\n')}

**Regional Breakdown:**
${geographicAnalysis.regions.map(region => 
  `• ${region.region}: ${region.sources} sources (${region.percentage.toFixed(1)}%)`
).join('\n')}

---

## KEY INSIGHTS

${keyInsights.map((insight, index) => `${index + 1}. ${insight}`).join('\n')}

---

## RECOMMENDATIONS

${recommendations.map((rec, index) => `${index + 1}. ${rec}`).join('\n')}

---

*This report is based on AI analysis of ${totalResponses} responses across ${geographicAnalysis.totalSources} sources from ${geographicAnalysis.regions.length} regions.*
`;
}
