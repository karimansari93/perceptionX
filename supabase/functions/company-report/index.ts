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

interface CompanyReportData {
  companyName: string;
  industry: string;
  totalResponses: number;
  averageSentiment: number;
  visibilityScore: number;
  competitivePosition: number;
  executiveSummary: {
    overallSentiment: string;
    keyStrengths: string[];
    keyChallenges: string[];
    geographicReach: string;
    topMarkets: string[];
    competitivePosition: string;
  };
  themeSummary: {
    topPositiveThemes: Array<{
      theme: string;
      attribute: string;
      strength: string;
    }>;
    topNegativeThemes: Array<{
      theme: string;
      attribute: string;
      concern: string;
    }>;
    overallThemeSentiment: string;
  };
  geographicSummary: {
    primaryMarkets: string[];
    marketDiversity: string;
    regionalInsights: string[];
  };
  competitiveSummary: {
    topCompetitors: string[];
    competitiveAdvantage: string;
    marketPosition: string;
  };
  keyInsights: string[];
  recommendations: string[];
  reportDate: string;
}

interface ComparisonData {
  companies: CompanyReportData[];
  comparisonInsights: string[];
  competitiveAnalysis: {
    bestPerforming: string;
    mostVisible: string;
    strongestThemes: string;
    areasForImprovement: string[];
  };
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

    // Generate reports for each company
    const companyReports: CompanyReportData[] = [];
    
    for (const companyId of companyIds) {
      const report = await generateCompanyReport(companyId);
      if (report) {
        companyReports.push(report);
      }
    }

    if (companyReports.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid company data found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    if (comparisonMode) {
      const comparisonData = await generateComparisonReport(companyReports);
      return new Response(
        JSON.stringify(comparisonData),
        { headers: corsHeaders }
      );
    } else {
      return new Response(
        JSON.stringify(companyReports[0]),
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

async function generateCompanyReport(companyId: string): Promise<CompanyReportData | null> {
  try {
    // Get company information from companies table
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('name, industry')
      .eq('id', companyId)
      .single();

    if (companyError || !companyData) {
      console.error('Error fetching company data:', companyError);
      return null;
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
      console.error('Error fetching responses:', responsesError);
      return null;
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
          theme_description: theme.theme_description,
          sentiment: theme.sentiment,
          sentiment_score: theme.sentiment_score,
          talentx_attribute_id: theme.talentx_attribute_id,
          talentx_attribute_name: theme.talentx_attribute_name,
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
      if (response.detected_competitors && response.detected_competitors.trim()) {
        const competitors = response.detected_competitors.split(',').map(c => c.trim()).filter(c => c.length > 0);
        competitors.forEach((competitor: string) => {
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
      .slice(0, 10);

    // Analyze AI model performance
    const modelMap = new Map();
    responses.forEach(response => {
      const model = response.ai_model;
      if (!modelMap.has(model)) {
        modelMap.set(model, {
          model,
          responses: 0,
          totalSentiment: 0,
          mentions: 0
        });
      }
      const modelData = modelMap.get(model);
      modelData.responses++;
      modelData.totalSentiment += response.sentiment_score || 0;
      if (response.company_mentioned) {
        modelData.mentions++;
      }
    });

    const aiModelPerformance = Array.from(modelMap.values())
      .map(model => ({
        model: model.model,
        responses: model.responses,
        averageSentiment: model.totalSentiment / model.responses,
        mentionRate: model.mentions / model.responses
      }))
      .sort((a, b) => b.responses - a.responses);

    // Generate geographic analysis
    const geographicAnalysis = generateGeographicAnalysis(responses);

    // Generate executive summaries
    const executiveSummary = generateExecutiveSummary(
      companyData.company_name,
      averageSentiment,
      visibilityScore,
      competitivePosition,
      geographicAnalysis
    );

    const themeSummary = generateThemeSummary(topThemes);
    const geographicSummary = generateGeographicSummary(geographicAnalysis);
    const competitiveSummary = generateCompetitiveSummary(competitorMentions, averageSentiment);

    // Generate AI insights and recommendations
    const { keyInsights, recommendations } = await generateAIInsights(
      companyData.company_name,
      companyData.industry,
      averageSentiment,
      visibilityScore,
      topThemes,
      competitorMentions,
      aiModelPerformance,
      geographicAnalysis
    );

    return {
      companyName: companyData.company_name,
      industry: companyData.industry,
      totalResponses,
      averageSentiment,
      visibilityScore,
      competitivePosition,
      executiveSummary,
      themeSummary,
      geographicSummary,
      competitiveSummary,
      keyInsights,
      recommendations,
      reportDate: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error generating company report:', error);
    return null;
  }
}

async function generateComparisonReport(companyReports: CompanyReportData[]): Promise<ComparisonData> {
  // Find best performing company in each metric
  const bestPerforming = companyReports.reduce((best, current) => 
    current.averageSentiment > best.averageSentiment ? current : best
  ).companyName;

  const mostVisible = companyReports.reduce((best, current) => 
    current.visibilityScore > best.visibilityScore ? current : best
  ).companyName;

  // Find strongest themes across all companies
  const allThemes = companyReports.flatMap(report => report.topThemes);
  const themeFrequency = new Map();
  allThemes.forEach(theme => {
    const key = theme.talentx_attribute_name;
    themeFrequency.set(key, (themeFrequency.get(key) || 0) + theme.frequency);
  });
  const strongestThemes = Array.from(themeFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme, freq]) => theme)
    .join(', ');

  // Generate comparison insights
  const comparisonInsights = await generateComparisonInsights(companyReports);

  // Identify areas for improvement
  const areasForImprovement = companyReports
    .filter(report => report.averageSentiment < 0.1)
    .map(report => `${report.companyName}: Low sentiment (${report.averageSentiment.toFixed(2)})`);

  return {
    companies: companyReports,
    comparisonInsights,
    competitiveAnalysis: {
      bestPerforming,
      mostVisible,
      strongestThemes,
      areasForImprovement
    }
  };
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
        } else if (citation.url) {
          // Prefer extracting domain from URL (more reliable)
          domain = extractDomainFromUrl(citation.url);
        } else if (citation.source) {
          // Only use source name if URL is not available
          const sourceName = citation.source.toLowerCase().trim();
          // Only create domain if source name is valid (not empty)
          if (sourceName && sourceName.length > 0) {
            domain = sourceName + '.com';
          }
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

  // Generate insights
  const geographicInsights = generateGeographicInsights(countries, regions, totalSources);

  return {
    totalSources,
    countries,
    regions,
    topCountries,
    geographicInsights
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

function generateGeographicInsights(
  countries: Array<{ country: string; sources: number; percentage: number; flag: string }>,
  regions: Array<{ region: string; sources: number; percentage: number }>,
  totalSources: number
): string[] {
  const insights: string[] = [];

  if (countries.length === 0) {
    insights.push('No geographic data available from sources');
    return insights;
  }

  const topCountry = countries[0];
  const topRegion = regions[0];

  // Top country insight
  if (topCountry.percentage > 50) {
    insights.push(`${topCountry.flag} ${topCountry.country} dominates the data with ${topCountry.percentage.toFixed(1)}% of all sources`);
  } else if (topCountry.percentage > 25) {
    insights.push(`${topCountry.flag} ${topCountry.country} is the primary source region with ${topCountry.percentage.toFixed(1)}% of all sources`);
  }

  // Regional distribution
  if (regions.length > 1) {
    const regionDiversity = regions.length;
    if (regionDiversity >= 3) {
      insights.push(`Data shows good geographic diversity across ${regionDiversity} regions`);
    } else if (regionDiversity === 2) {
      insights.push(`Data is concentrated in ${regionDiversity} regions: ${regions.map(r => r.region).join(' and ')}`);
    }
  }

  // Specific platform insights
  const indiaSources = countries.find(c => c.country === 'India');
  const usSources = countries.find(c => c.country === 'United States');
  const europeSources = countries.find(c => c.region === 'Europe');

  if (indiaSources && indiaSources.percentage > 10) {
    insights.push(`🇮🇳 Strong presence from Indian platforms (${indiaSources.percentage.toFixed(1)}%) - likely includes AmbitionBox, Naukri, and other India-focused job sites`);
  }

  if (usSources && usSources.percentage > 30) {
    insights.push(`🇺🇸 US-based platforms dominate (${usSources.percentage.toFixed(1)}%) - primarily Glassdoor, Indeed, and LinkedIn`);
  }

  if (europeSources && europeSources.percentage > 15) {
    insights.push(`🇪🇺 European sources contribute ${europeSources.percentage.toFixed(1)}% of data - includes platforms like Kununu (Germany) and UK job sites`);
  }

  return insights;
}

function generateExecutiveSummary(
  companyName: string,
  averageSentiment: number,
  visibilityScore: number,
  competitivePosition: number,
  geographicAnalysis: any
): any {
  const overallSentiment = averageSentiment > 0.1 ? 'Positive' : 
                          averageSentiment < -0.1 ? 'Negative' : 'Neutral';
  
  const keyStrengths = [];
  const keyChallenges = [];
  
  if (averageSentiment > 0.1) {
    keyStrengths.push('Strong positive sentiment in talent perception');
  }
  if (visibilityScore > 0.7) {
    keyStrengths.push('High visibility in search results');
  }
  if (competitivePosition < 3) {
    keyStrengths.push('Strong competitive positioning');
  }
  
  if (averageSentiment < -0.1) {
    keyChallenges.push('Negative sentiment requires attention');
  }
  if (visibilityScore < 0.3) {
    keyChallenges.push('Low visibility in search results');
  }
  if (competitivePosition > 5) {
    keyChallenges.push('Weak competitive positioning');
  }
  
  const topMarkets = geographicAnalysis.topCountries.slice(0, 3).map(c => c.country);
  const geographicReach = geographicAnalysis.regions.length > 2 ? 'Global' : 
                         geographicAnalysis.regions.length === 2 ? 'Multi-regional' : 'Regional';
  
  const competitivePositionText = competitivePosition < 2 ? 'Market Leader' :
                                 competitivePosition < 4 ? 'Strong Position' :
                                 competitivePosition < 6 ? 'Competitive' : 'Needs Improvement';

  return {
    overallSentiment,
    keyStrengths: keyStrengths.length > 0 ? keyStrengths : ['No significant strengths identified'],
    keyChallenges: keyChallenges.length > 0 ? keyChallenges : ['No major challenges identified'],
    geographicReach,
    topMarkets,
    competitivePosition: competitivePositionText
  };
}

function generateThemeSummary(topThemes: any[]): any {
  const positiveThemes = topThemes
    .filter(theme => theme.sentiment_score > 0.1)
    .slice(0, 3)
    .map(theme => ({
      theme: theme.theme_name,
      attribute: theme.talentx_attribute_name,
      strength: `${theme.theme_name} is a key strength in ${theme.talentx_attribute_name}`
    }));

  const negativeThemes = topThemes
    .filter(theme => theme.sentiment_score < -0.1)
    .slice(0, 3)
    .map(theme => ({
      theme: theme.theme_name,
      attribute: theme.talentx_attribute_name,
      concern: `${theme.theme_name} is a concern in ${theme.talentx_attribute_name}`
    }));

  const avgThemeSentiment = topThemes.length > 0 
    ? topThemes.reduce((sum, theme) => sum + theme.sentiment_score, 0) / topThemes.length
    : 0;

  const overallThemeSentiment = avgThemeSentiment > 0.1 ? 'Positive themes dominate' :
                               avgThemeSentiment < -0.1 ? 'Negative themes are concerning' :
                               'Mixed theme sentiment';

  return {
    topPositiveThemes: positiveThemes.length > 0 ? positiveThemes : [],
    topNegativeThemes: negativeThemes.length > 0 ? negativeThemes : [],
    overallThemeSentiment
  };
}

function generateGeographicSummary(geographicAnalysis: any): any {
  const primaryMarkets = geographicAnalysis.topCountries.slice(0, 3).map(c => c.country);
  
  const marketDiversity = geographicAnalysis.regions.length > 2 ? 'High diversity across regions' :
                         geographicAnalysis.regions.length === 2 ? 'Moderate regional diversity' :
                         'Limited to single region';

  const regionalInsights = geographicAnalysis.geographicInsights.slice(0, 3);

  return {
    primaryMarkets,
    marketDiversity,
    regionalInsights
  };
}

function generateCompetitiveSummary(competitorMentions: any[], averageSentiment: number): any {
  const topCompetitors = competitorMentions.slice(0, 3).map(comp => comp.competitor);
  
  const competitiveAdvantage = averageSentiment > 0.1 ? 'Positive perception advantage' :
                              averageSentiment < -0.1 ? 'Perception disadvantage' :
                              'Neutral competitive position';

  const marketPosition = competitorMentions.length > 5 ? 'Highly competitive market' :
                        competitorMentions.length > 2 ? 'Moderately competitive' :
                        'Less competitive market';

  return {
    topCompetitors,
    competitiveAdvantage,
    marketPosition
  };
}

async function generateAIInsights(
  companyName: string,
  industry: string,
  averageSentiment: number,
  visibilityScore: number,
  topThemes: any[],
  competitorMentions: any[],
  aiModelPerformance: any[],
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
You are an expert in employer branding and talent perception analysis. Analyze the following data for ${companyName} (${industry}) and provide actionable insights and recommendations.

COMPANY DATA:
- Average Sentiment: ${averageSentiment.toFixed(2)}
- Visibility Score: ${visibilityScore.toFixed(2)}
- Total Themes Identified: ${topThemes.length}

TOP THEMES:
${topThemes.map(theme => `- ${theme.talentx_attribute_name}: ${theme.theme_name} (${theme.sentiment}, frequency: ${theme.frequency})`).join('\n')}

COMPETITOR MENTIONS:
${competitorMentions.map(comp => `- ${comp.competitor}: ${comp.frequency} mentions, sentiment: ${comp.sentiment.toFixed(2)}`).join('\n')}

AI MODEL PERFORMANCE:
${aiModelPerformance.map(model => `- ${model.model}: ${model.responses} responses, sentiment: ${model.averageSentiment.toFixed(2)}, mention rate: ${(model.mentionRate * 100).toFixed(1)}%`).join('\n')}

GEOGRAPHIC DISTRIBUTION:
- Total Sources: ${geographicAnalysis.totalSources}
- Top Countries: ${geographicAnalysis.topCountries.map(c => `${c.flag} ${c.country} (${c.percentage.toFixed(1)}%)`).join(', ')}
- Regional Distribution: ${geographicAnalysis.regions.map(r => `${r.region} (${r.percentage.toFixed(1)}%)`).join(', ')}

GEOGRAPHIC INSIGHTS:
${geographicAnalysis.geographicInsights.map(insight => `- ${insight}`).join('\n')}

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

    const parsed = JSON.parse(content);
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

async function generateComparisonInsights(companyReports: CompanyReportData[]): Promise<string[]> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openaiApiKey) {
    return ["AI comparison analysis not available - OpenAI API key missing"];
  }

  const companiesData = companyReports.map(report => ({
    name: report.companyName,
    industry: report.industry,
    sentiment: report.averageSentiment,
    visibility: report.visibilityScore,
    themes: report.topThemes.slice(0, 3).map(t => t.talentx_attribute_name),
    competitors: report.competitorMentions.slice(0, 3).map(c => c.competitor)
  }));

  const prompt = `
You are an expert in competitive analysis for employer branding. Compare these companies and provide insights:

${companiesData.map(company => `
${company.name} (${company.industry}):
- Sentiment: ${company.sentiment.toFixed(2)}
- Visibility: ${company.visibility.toFixed(2)}
- Top Themes: ${company.themes.join(', ')}
- Competitors: ${company.competitors.join(', ')}
`).join('\n')}

Provide 5 key insights about how these companies compare in terms of talent perception and employer branding.

Return your response as JSON with this exact structure:
{
  "insights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"]
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
        max_tokens: 800
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

    const parsed = JSON.parse(content);
    return parsed.insights || ["Comparison analysis failed"];

  } catch (error) {
    console.error('Error generating comparison insights:', error);
    return ["AI comparison analysis failed - using fallback insights"];
  }
}
