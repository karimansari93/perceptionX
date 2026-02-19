import { supabase } from '@/integrations/supabase/client';
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData } from '@/types/dashboard';

interface AdminReportData {
  companyName: string;
  metrics: DashboardMetrics;
  responses: PromptResponse[];
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
  promptsData: PromptData[];
  topCompetitors?: any[];
  llmMentionRankings?: any[];
}

export class AdminReportService {
  static async getUserReportData(userId: string): Promise<AdminReportData | null> {
    try {
      // Fetch user's company information from user_onboarding table
      const { data: userData, error: userError } = await supabase
        .from('user_onboarding')
        .select('company_name')
        .eq('user_id', userId)
        .single();

      if (userError || !userData) {
        console.error('Error fetching user data:', userError);
        return null;
      }

      const companyName = userData.company_name;

      // First, get all confirmed prompts for the user
      const { data: userPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('id')
        .eq('user_id', userId);

      if (promptsError || !userPrompts || userPrompts.length === 0) {
        console.error('Error fetching user prompts:', promptsError);
        return null;
      }

      const promptIds = userPrompts.map(p => p.id);

      // Fetch all prompt responses for the user's prompts
      const { data: responses, error: responsesError } = await supabase
        .from('prompt_responses')
        .select(`
          *,
          confirmed_prompts (
            prompt_text,
            prompt_category,
            prompt_type
          )
        `)
        .in('confirmed_prompt_id', promptIds)
        .order('created_at', { ascending: false });

      if (responsesError) {
        console.error('Error fetching responses:', responsesError);
        return null;
      }

      if (!responses || responses.length === 0) {
        return null;
      }

      // Extract prompts data from responses
      const prompts = responses.map(r => r.confirmed_prompts).filter(Boolean);

      // Calculate metrics
      const metrics = this.calculateMetrics(responses);
      
      // Calculate sentiment trend
      const sentimentTrend = this.calculateSentimentTrend(responses);
      
      // Calculate top citations
      const topCitations = this.calculateTopCitations(responses);
      
      // Prepare prompts data
      const promptsData = this.preparePromptData(prompts, responses);
      
      // Calculate competitor mentions
      const topCompetitors = this.calculateTopCompetitors(responses);
      
      // Calculate LLM mention rankings
      const llmMentionRankings = this.calculateLLMMentionRankings(responses);

      // Fetch AI themes data
      const aiThemes = await this.getAIThemesData(promptIds);

      // Fetch search insights data
      const searchInsights = await this.getSearchInsightsData(userId);

      return {
        companyName,
        metrics,
        responses,
        sentimentTrend,
        topCitations,
        promptsData,
        topCompetitors,
        llmMentionRankings,
        aiThemes,
        searchInsights
      };

    } catch (error) {
      console.error('Error in getUserReportData:', error);
      return null;
    }
  }

  private static calculateMetrics(responses: any[]): DashboardMetrics {
    const totalResponses = responses.length;
    const companyMentionedResponses = responses.filter(r => r.company_mentioned);
    const mentionRate = companyMentionedResponses.length / totalResponses;

    // Calculate sentiment metrics
    const sentimentScores = responses
      .map(r => r.sentiment_score)
      .filter(score => typeof score === 'number');
    
    const averageSentiment = sentimentScores.length > 0 
      ? sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length 
      : 0;

    const sentimentLabel = averageSentiment > 0.1 ? 'Positive' : 
                          averageSentiment < -0.1 ? 'Negative' : 'Neutral';

    // Count sentiment categories
    const positiveCount = responses.filter(r => r.sentiment_label === 'positive').length;
    const neutralCount = responses.filter(r => r.sentiment_label === 'neutral').length;
    const negativeCount = responses.filter(r => r.sentiment_label === 'negative').length;

    // Calculate citations
    const allCitations = responses
      .map(r => r.citations)
      .filter(Boolean)
      .flat();
    
    const uniqueDomains = new Set(allCitations.map(c => c.domain)).size;
    const totalCitations = allCitations.length;

    // Calculate visibility metrics
    const visibilityScores = responses
      .map(r => r.visibility_score)
      .filter(score => typeof score === 'number');
    
    const averageVisibility = visibilityScores.length > 0
      ? visibilityScores.reduce((sum, score) => sum + score, 0) / visibilityScores.length
      : 0;

    // Calculate perception score (0-100)
    const perceptionScore = Math.round(
      (mentionRate * 40) + 
      ((averageSentiment + 1) / 2 * 30) + 
      (averageVisibility * 30)
    );

    const perceptionLabel = perceptionScore >= 80 ? 'Excellent' :
                           perceptionScore >= 60 ? 'Good' :
                           perceptionScore >= 40 ? 'Fair' : 'Poor';

    return {
      averageSentiment,
      sentimentLabel,
      sentimentTrendComparison: { value: 0, direction: 'neutral' as const },
      visibilityTrendComparison: { value: 0, direction: 'neutral' as const },
      citationsTrendComparison: { value: 0, direction: 'neutral' as const },
      totalCitations,
      uniqueDomains,
      totalResponses,
      averageVisibility,
      positiveCount,
      neutralCount,
      negativeCount,
      perceptionScore,
      perceptionLabel
    };
  }

  private static calculateSentimentTrend(responses: any[]): SentimentTrendData[] {
    // Group responses by date and calculate average sentiment
    const groupedByDate = responses.reduce((acc, response) => {
      const date = new Date(response.created_at).toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { scores: [], count: 0 };
      }
      if (typeof response.sentiment_score === 'number') {
        acc[date].scores.push(response.sentiment_score);
        acc[date].count++;
      }
      return acc;
    }, {} as Record<string, { scores: number[], count: number }>);

    return Object.entries(groupedByDate)
      .map(([date, data]) => ({
        date,
        sentiment: data.scores.reduce((sum, score) => sum + score, 0) / data.scores.length,
        count: data.count
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private static calculateTopCitations(responses: any[]): CitationCount[] {
    const citationCounts: Record<string, number> = {};
    
    responses.forEach(response => {
      if (response.citations && Array.isArray(response.citations)) {
        response.citations.forEach((citation: any) => {
          if (citation.domain) {
            citationCounts[citation.domain] = (citationCounts[citation.domain] || 0) + 1;
          }
        });
      }
    });

    return Object.entries(citationCounts)
      .map(([domain, count]) => ({
        domain,
        count,
        mediaType: this.determineMediaType(domain)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }

  private static determineMediaType(domain: string): 'owned' | 'influenced' | 'organic' | 'competitive' | 'irrelevant' {
    const ownedPatterns = ['company.com', 'corp.com', 'inc.com'];
    const influencedPatterns = ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com'];
    const organicPatterns = ['glassdoor.com', 'indeed.com', 'careerbuilder.com', 'monster.com'];
    const competitivePatterns = ['competitor.com', 'rival.com'];

    if (ownedPatterns.some(pattern => domain.includes(pattern))) return 'owned';
    if (influencedPatterns.some(pattern => domain.includes(pattern))) return 'influenced';
    if (organicPatterns.some(pattern => domain.includes(pattern))) return 'organic';
    if (competitivePatterns.some(pattern => domain.includes(pattern))) return 'competitive';
    
    return 'irrelevant';
  }

  private static preparePromptData(prompts: any[], responses: any[]): PromptData[] {
    return prompts.map(prompt => {
      const promptResponses = responses.filter(r => r.confirmed_prompt_id === prompt.id);
      const totalResponses = promptResponses.length;

      const totalSentiment = promptResponses.reduce((sum, r) => sum + (r.sentiment_score || 0), 0);
      const avgSentiment = totalResponses > 0 ? totalSentiment / totalResponses : 0;
      
      const sentimentLabels = promptResponses
        .map(r => r.sentiment_label)
        .filter(Boolean);
      const sentimentLabel = this.getMostCommonValue(sentimentLabels) || 'neutral';
      
      const visibilityScores = promptResponses
        .map(r => typeof r.visibility_score === 'number' ? r.visibility_score : undefined)
        .filter((v): v is number => typeof v === 'number');
      const averageVisibility = visibilityScores.length > 0 
        ? visibilityScores.reduce((sum, v) => sum + v, 0) / visibilityScores.length 
        : undefined;

      return {
        prompt: prompt.prompt_text,
        category: prompt.prompt_category,
        type: prompt.prompt_type || 'general',
        responses: totalResponses,
        avgSentiment,
        sentimentLabel,
        mentionRanking: undefined,
        competitivePosition: undefined,
        detectedCompetitors: promptResponses[0]?.detected_competitors,
        averageVisibility
      };
    });
  }

  private static calculateTopCompetitors(responses: any[]): any[] {
    const competitorMentions = responses
      .filter(r => r.detected_competitors)
      .map(r => r.detected_competitors)
      .flat();

    const competitorCounts = competitorMentions.reduce((acc: Record<string, number>, mention: any) => {
      if (mention && mention.name) {
        acc[mention.name] = (acc[mention.name] || 0) + 1;
      }
      return acc;
    }, {});

    return Object.entries(competitorCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private static calculateLLMMentionRankings(responses: any[]): any[] {
    const modelCounts = responses.reduce((acc: Record<string, number>, response) => {
      const model = response.ai_model;
      acc[model] = (acc[model] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(modelCounts)
      .map(([model, mentions]) => ({
        model,
        displayName: this.getModelDisplayName(model),
        mentions,
        logoUrl: null
      }))
      .sort((a, b) => b.mentions - a.mentions);
  }

  private static getModelDisplayName(model: string): string {
    const modelNames: Record<string, string> = {
      'openai': 'OpenAI GPT-4',
      'perplexity': 'Perplexity AI',
      'google-ai-overviews': 'Google AI',
      'bing-copilot': 'Bing Copilot',
      'search-insights': 'Search Insights',
      'claude': 'Claude AI',
      'gemini': 'Google Gemini'
    };
    return modelNames[model] || model;
  }

  private static async getAIThemesData(promptIds: string[]): Promise<any[]> {
    try {
      const { data: themes, error } = await supabase
        .from('ai_themes')
        .select(`
          theme_name,
          theme_description,
          sentiment,
          sentiment_score,
          confidence_score,
          talentx_attribute_name,
          keywords,
          context_snippets,
          prompt_responses!inner(confirmed_prompt_id)
        `)
        .in('prompt_responses.confirmed_prompt_id', promptIds);

      if (error) {
        console.error('Error fetching AI themes:', error);
        return [];
      }

      return themes || [];
    } catch (error) {
      console.error('Error in getAIThemesData:', error);
      return [];
    }
  }

  private static async getSearchInsightsData(userId: string): Promise<any[]> {
    try {
      const { data: searchInsights, error } = await supabase
        .from('search_insights')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching search insights:', error);
        return [];
      }

      return searchInsights || [];
    } catch (error) {
      console.error('Error in getSearchInsightsData:', error);
      return [];
    }
  }

  private static getMostCommonValue(arr: string[]): string | null {
    if (arr.length === 0) return null;
    
    const counts = arr.reduce((acc, val) => {
      acc[val] = (acc[val] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
}
