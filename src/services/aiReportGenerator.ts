import { supabase } from '@/integrations/supabase/client';

interface AIReportData {
  companyName: string;
  metrics: any;
  responses: any[];
  topCompetitors?: any[];
  aiThemes?: any[];
  topCitations: any[];
  searchInsights?: any[];
}

export class AIReportGenerator {
  static async generateIntelligentReport(data: AIReportData): Promise<{
    methodology: string;
    executiveSummary: string;
    competitorAnalysis: string;
    keyThemes: string;
    sources: string;
    strategicRecommendations: string;
    upgradeSection: string;
  }> {
    try {
      // Prepare comprehensive data for AI analysis
      const analysisData = this.prepareAnalysisData(data);
      
      // Generate all sections using AI
      const [
        methodology,
        executiveSummary,
        competitorAnalysis,
        keyThemes,
        sources,
        strategicRecommendations,
        upgradeSection
      ] = await Promise.all([
        this.generateMethodology(analysisData),
        this.generateExecutiveSummary(analysisData),
        this.generateCompetitorAnalysis(analysisData),
        this.generateKeyThemes(analysisData),
        this.generateSources(analysisData),
        this.generateStrategicRecommendations(analysisData),
        this.generateUpgradeSection(analysisData)
      ]);

      return {
        methodology,
        executiveSummary,
        competitorAnalysis,
        keyThemes,
        sources,
        strategicRecommendations,
        upgradeSection
      };
    } catch (error) {
      console.error('Error generating AI report:', error);
      // Fallback to static templates if AI fails
      return this.getFallbackContent(data);
    }
  }

  private static prepareAnalysisData(data: AIReportData) {
    const mentionRate = (data.responses.filter(r => r.company_mentioned).length / data.responses.length) * 100;
    const avgSentiment = data.metrics.averageSentiment;
    const sentimentLabel = data.metrics.sentimentLabel;
    
    // Enhanced theme analysis using ai_themes data
    const themeAnalysis = (data.aiThemes || []).reduce((acc, theme) => {
      if (!acc[theme.theme_name]) {
        acc[theme.theme_name] = { 
          count: 0, 
          sentiments: [], 
          scores: [],
          descriptions: [],
          keywords: [],
          confidenceScores: [],
          talentxAttribute: theme.talentx_attribute_name
        };
      }
      acc[theme.theme_name].count++;
      acc[theme.theme_name].sentiments.push(theme.sentiment);
      acc[theme.theme_name].scores.push(theme.sentiment_score);
      if (theme.theme_description) acc[theme.theme_name].descriptions.push(theme.theme_description);
      if (theme.keywords) acc[theme.theme_name].keywords.push(...theme.keywords);
      acc[theme.theme_name].confidenceScores.push(theme.confidence_score);
      return acc;
    }, {} as Record<string, { 
      count: number, 
      sentiments: string[], 
      scores: number[],
      descriptions: string[],
      keywords: string[],
      confidenceScores: number[],
      talentxAttribute: string
    }>);

    const topThemes = Object.entries(themeAnalysis)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgSentiment: data.scores.reduce((sum, score) => sum + score, 0) / data.scores.length,
        avgConfidence: data.confidenceScores.reduce((sum, score) => sum + score, 0) / data.confidenceScores.length,
        dominantSentiment: this.getMostCommonValue(data.sentiments) || 'neutral',
        talentxAttribute: data.talentxAttribute,
        topKeywords: [...new Set(data.keywords)].slice(0, 5),
        description: data.descriptions[0] || ''
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Group themes by TalentX attribute for better analysis
    const themesByAttribute = this.groupThemesByAttribute(topThemes);

    return {
      companyName: data.companyName,
      mentionRate: mentionRate.toFixed(1),
      avgSentiment: avgSentiment.toFixed(2),
      sentimentLabel,
      totalResponses: data.responses.length,
      totalThemes: data.aiThemes?.length || 0,
      topThemes,
      themesByAttribute,
      competitors: (data.topCompetitors || []).slice(0, 5),
      topSources: data.topCitations.slice(0, 5),
      searchInsights: (data.searchInsights || []).slice(0, 3),
      metrics: data.metrics,
      // Additional analysis
      positiveThemes: topThemes.filter(t => t.avgSentiment > 0.2),
      negativeThemes: topThemes.filter(t => t.avgSentiment < -0.2),
      highConfidenceThemes: topThemes.filter(t => t.avgConfidence > 0.7)
    };
  }

  private static async generateMethodology(data: any): Promise<string> {
    const prompt = `Create a professional methodology section for an AI perception analysis report.

COMPANY: ${data.companyName}
ANALYSIS SCOPE: ${data.totalResponses} AI responses tested across employment, leadership, and culture topics
AI MODELS: GPT-4, Claude, Gemini, Perplexity
THEMES ANALYZED: ${data.totalThemes} distinct themes identified from ai_themes analysis
TALENTX ATTRIBUTES: Themes mapped to 30 comprehensive employer branding attributes

Write 1-2 paragraphs that cover:
- Data collection approach and AI model selection
- Theme extraction methodology using ai_themes analysis
- Sentiment analysis framework and TalentX attribute mapping

Make it professional and credible but concise.`;

    return await this.callOpenAI(prompt);
  }

  private static async generateExecutiveSummary(data: any): Promise<string> {
    // Calculate competitor percentages for better insights
    const totalMentions = data.competitors.reduce((sum: number, comp: any) => sum + comp.count, 0);
    const companyMentions = data.responses.filter((r: any) => r.company_mentioned).length;
    const competitorPercentages = data.competitors.slice(0, 5).map((comp: any) => ({
      name: comp.name,
      percentage: totalMentions > 0 ? ((comp.count / totalMentions) * 100).toFixed(1) : '0.0'
    }));

    // Analyze positive sentiment themes in detail
    const positiveThemeDetails = data.positiveThemes.map((theme: any) => 
      `"${theme.name}" (${theme.count} mentions, confidence: ${theme.avgConfidence.toFixed(2)})`
    ).join(', ');

    // Analyze missed opportunities (sources where company is not mentioned)
    const missedOpportunities = data.topSources.filter((source: any) => {
      // This would need to be enhanced with actual mention analysis per source
      return source.count > 0; // Placeholder logic
    }).slice(0, 3);

    const prompt = `Write a comprehensive executive summary for ${data.companyName}'s AI perception analysis that provides deep strategic insights.

KEY PERFORMANCE METRICS:
- Mention Rate: ${data.mentionRate}% across all AI responses
- Overall Sentiment: ${data.sentimentLabel} (${data.avgSentiment}/10)
- Total Responses Analyzed: ${data.totalResponses}
- Themes Identified: ${data.totalThemes}
- Positive Themes: ${data.positiveThemes.length}
- Negative Themes: ${data.negativeThemes.length}
- High-Confidence Insights: ${data.highConfidenceThemes.length}

DETAILED POSITIVE SENTIMENT ANALYSIS:
The positive sentiment (${data.avgSentiment.toFixed(2)}/10) is driven by these key themes: ${positiveThemeDetails || 'Limited positive themes identified'}. These themes represent the core strengths that AI systems recognize about ${data.companyName}.

COMPETITIVE VISIBILITY BREAKDOWN:
${competitorPercentages.map((comp: any) => `- ${comp.name}: ${comp.percentage}% visibility`).join('\n')}

TOP PERFORMING TALENTX ATTRIBUTES:
${data.themesByAttribute.slice(0, 5).map(attr => `- ${attr.name}: ${attr.themeCount} themes, avg sentiment ${attr.avgSentiment.toFixed(2)}`).join('\n')}

IMPROVEMENT OPPORTUNITIES:
- To reach 100% visibility: ${data.companyName} needs to improve positioning in ${(100 - parseFloat(data.mentionRate)).toFixed(1)}% of relevant queries
- Sources with highest missed opportunities: ${missedOpportunities.map(s => s.domain).join(', ')}
- Competitive gap: ${competitorPercentages.length > 0 ? `Top competitor ${competitorPercentages[0].name} has ${competitorPercentages[0].percentage}% visibility vs ${data.mentionRate}%` : 'No direct competitors identified'}

Write 3-4 detailed paragraphs that include:
1. **Strategic Performance Assessment**: What the ${data.mentionRate}% mention rate means, what positive themes drive sentiment, and specific improvement opportunities
2. **Competitive Intelligence**: How ${data.companyName} compares to top competitors, what specific competitors are dominating visibility, and why they're winning
3. **Source Analysis**: Which sources are missing ${data.companyName} mentions, what content gaps exist, and how to capture those opportunities
4. **Actionable Path to 100%**: Specific steps to increase visibility from ${data.mentionRate}% to 100%, including content strategy, source engagement, and competitive positioning

Use executive-level language with specific data points, competitive insights, and clear strategic recommendations. Focus on actionable intelligence rather than generic statements.`;

    return await this.callOpenAI(prompt);
  }

  private static async generateCompetitorAnalysis(data: any): Promise<string> {
    // Calculate competitor percentages for the simple list format
    const totalMentions = data.competitors.reduce((sum: number, comp: any) => sum + comp.count, 0);
    const competitorPercentages = data.competitors.slice(0, 5).map((comp: any) => ({
      name: comp.name,
      count: comp.count,
      percentage: totalMentions > 0 ? ((comp.count / totalMentions) * 100).toFixed(1) : '0.0'
    }));

    // Find the most consistently appearing competitor
    const topCompetitor = competitorPercentages.length > 0 ? competitorPercentages[0] : null;
    
    const prompt = `Conduct a comprehensive competitive analysis for ${data.companyName} based on AI perception data.

COMPETITIVE VISIBILITY RANKINGS (Top 5):
${competitorPercentages.map((comp: any, index: number) => `${index + 1}. ${comp.name} (${comp.percentage}%)`).join('\n')}

COMPANY PERFORMANCE:
- Mention Rate: ${data.mentionRate}%
- Sentiment Score: ${data.avgSentiment}/10
- Total Responses: ${data.totalResponses}

COMPETITIVE INTELLIGENCE:
${topCompetitor ? `- Top competitor ${topCompetitor.name} appears in ${topCompetitor.percentage}% of responses, ${topCompetitor.percentage > parseFloat(data.mentionRate) ? 'outperforming' : 'underperforming'} ${data.companyName}'s ${data.mentionRate}% visibility` : 'No direct competitors identified'}
- Competitive gap: ${topCompetitor ? `${Math.abs(parseFloat(topCompetitor.percentage) - parseFloat(data.mentionRate)).toFixed(1)}% visibility difference` : 'No benchmark available'}

THEME-BASED COMPETITIVE INSIGHTS:
${data.topThemes.slice(0, 6).map(t => `- ${t.name}: ${t.count} mentions (${t.dominantSentiment}, confidence: ${t.avgConfidence.toFixed(2)})`).join('\n')}

Write 3-4 detailed paragraphs that cover:
1. **Competitive Landscape Overview**: Analyze the ${competitorPercentages.length} top competitors and their visibility percentages
2. **Performance Benchmarking**: How ${data.companyName}'s ${data.mentionRate}% visibility compares to the competitive landscape
3. **Strategic Competitive Analysis**: Why specific competitors are showing up consistently in AI responses and what ${data.companyName} can learn
4. **Competitive Positioning Strategy**: Specific recommendations to improve competitive visibility and market positioning

Focus on actionable competitive intelligence with specific data points and strategic recommendations.`;

    return await this.callOpenAI(prompt);
  }

  private static async generateKeyThemes(data: any): Promise<string> {
    const themes = data.topThemes.map((t: any) => 
      `${t.name} (${t.talentxAttribute}): ${t.count} mentions, ${t.dominantSentiment} sentiment (${t.avgSentiment.toFixed(2)}), confidence: ${t.avgConfidence.toFixed(2)}`
    ).join('\n');

    const prompt = `Analyze the key themes for ${data.companyName} based on comprehensive ai_themes analysis.

DETAILED THEME ANALYSIS:
${themes}

THEME CATEGORIZATION:
- Positive Themes (${data.positiveThemes.length}): ${data.positiveThemes.map(t => t.name).join(', ')}
- Negative Themes (${data.negativeThemes.length}): ${data.negativeThemes.map(t => t.name).join(', ')}
- High-Confidence Themes (${data.highConfidenceThemes.length}): ${data.highConfidenceThemes.map(t => t.name).join(', ')}

TALENTX ATTRIBUTE PERFORMANCE:
${data.themesByAttribute.map(attr => `- ${attr.name}: ${attr.themeCount} themes, avg sentiment ${attr.avgSentiment.toFixed(2)}, total mentions ${attr.totalMentions}`).join('\n')}

Write 2-3 paragraphs that include:
- Overall theme landscape and sentiment distribution
- Top-performing themes and their business implications
- Content strategy recommendations based on theme performance
- Actionable steps for theme optimization

Use emojis strategically (✅ for positive, ❌ for negative, ➖ for neutral, 🎯 for high-confidence).`;

    return await this.callOpenAI(prompt);
  }

  private static async generateSources(data: any): Promise<string> {
    // Calculate source percentages and analyze missed opportunities
    const totalCitations = data.topSources.reduce((sum: number, source: any) => sum + source.count, 0);
    const sourcePercentages = data.topSources.slice(0, 5).map((source: any) => ({
      domain: source.domain,
      count: source.count,
      percentage: totalCitations > 0 ? ((source.count / totalCitations) * 100).toFixed(1) : '0.0'
    }));

    // Identify top sources where company might be missing
    const topSource = sourcePercentages.length > 0 ? sourcePercentages[0] : null;
    
    const prompt = `Analyze the citation sources for ${data.companyName} with focus on missed opportunities and content strategy.

TOP SOURCES BY CITATIONS (Top 5):
${sourcePercentages.map((source: any, index: number) => `${index + 1}. ${source.domain} (${source.percentage}%)`).join('\n')}

SOURCE ECOSYSTEM ANALYSIS:
- Total citations analyzed: ${totalCitations}
- Primary source: ${topSource ? `${topSource.domain} dominates with ${topSource.percentage}% of citations` : 'No sources identified'}
- Source diversity: ${sourcePercentages.length} unique high-performing sources
- Company visibility in top sources: ${data.mentionRate}% mention rate across all sources

SEARCH INSIGHTS:
${data.searchInsights.map(insight => `- "${insight.term}": ${insight.volume} monthly searches`).join('\n')}

MISSED OPPORTUNITY ANALYSIS:
${topSource ? `- ${topSource.domain} is the dominant source (${topSource.percentage}%) but ${data.companyName} may not be optimally positioned there` : 'Limited source data available'}
- Content gap analysis: Sources with high citation counts but potential low company visibility
- Platform-specific optimization opportunities in top-performing domains

Write 3-4 detailed paragraphs that cover:
1. **Source Ecosystem Overview**: Analyze the ${sourcePercentages.length} top sources and their citation percentages
2. **Content Distribution Strategy**: How ${data.companyName} can better engage with top-performing sources like ${topSource ? topSource.domain : 'key platforms'}
3. **Missed Opportunity Analysis**: Which sources are appearing frequently in AI responses but may lack ${data.companyName} content, and how to capture those opportunities
4. **Platform-Specific Recommendations**: Specific content strategies for each top source to improve visibility and citation frequency

Focus on actionable content strategy insights with specific platform recommendations and engagement tactics.`;

    return await this.callOpenAI(prompt);
  }

  private static async generateStrategicRecommendations(data: any): Promise<string> {
    // Calculate specific improvement targets
    const currentVisibility = parseFloat(data.mentionRate);
    const targetVisibility = 100;
    const visibilityGap = targetVisibility - currentVisibility;
    
    // Identify top competitor for benchmarking
    const topCompetitor = data.competitors.length > 0 ? data.competitors[0] : null;
    const competitorVisibility = topCompetitor ? (topCompetitor.count / data.totalResponses) * 100 : 0;
    
    // Identify top source for content strategy
    const topSource = data.topSources.length > 0 ? data.topSources[0] : null;
    
    // Identify strongest positive theme for amplification
    const strongestPositiveTheme = data.positiveThemes.length > 0 ? data.positiveThemes[0] : null;
    
    const prompt = `Create highly specific, actionable strategic recommendations for ${data.companyName} to improve AI visibility from ${data.mentionRate}% to 100%.

COMPANY PERFORMANCE ANALYSIS:
- Current Visibility: ${data.mentionRate}% (${visibilityGap.toFixed(1)}% gap to 100%)
- Sentiment Score: ${data.sentimentLabel} (${data.avgSentiment}/10)
- Total Responses Analyzed: ${data.totalResponses}
- Themes Identified: ${data.totalThemes}
- Strongest Positive Theme: ${strongestPositiveTheme ? `"${strongestPositiveTheme.name}" (${strongestPositiveTheme.count} mentions, ${strongestPositiveTheme.avgSentiment.toFixed(2)} sentiment)` : 'Limited positive themes'}

COMPETITIVE BENCHMARK:
- Top Competitor: ${topCompetitor ? `${topCompetitor.name} with ${competitorVisibility.toFixed(1)}% visibility` : 'No direct competitors identified'}
- Competitive Gap: ${topCompetitor ? `${Math.abs(competitorVisibility - currentVisibility).toFixed(1)}% visibility difference` : 'No benchmark available'}

TOP PERFORMING SOURCES:
${data.topSources.slice(0, 3).map((s: any) => `- ${s.domain}: ${s.count} citations`).join('\n')}

TOP THEMES FOR AMPLIFICATION:
${data.topThemes.slice(0, 5).map(t => `- ${t.name}: ${t.count} mentions, ${t.avgSentiment.toFixed(2)} sentiment, ${t.avgConfidence.toFixed(2)} confidence`).join('\n')}

Create 6-8 highly specific, data-driven strategic recommendations organized by priority:

🎯 IMMEDIATE ACTIONS (0-30 days):
- 2 urgent recommendations with exact steps to capture ${(visibilityGap * 0.3).toFixed(1)}% visibility improvement
- Focus on quick wins with existing content and top-performing themes

📈 SHORT-TERM STRATEGY (1-3 months):
- 3 medium-term initiatives to capture ${(visibilityGap * 0.5).toFixed(1)}% additional visibility
- Platform-specific content optimization for top sources like ${topSource ? topSource.domain : 'key platforms'}
- Competitive positioning against ${topCompetitor ? topCompetitor.name : 'market leaders'}

🚀 LONG-TERM POSITIONING (3-12 months):
- 3 long-term strategic initiatives to achieve 100% visibility
- Comprehensive content ecosystem development
- Market leadership positioning strategy

Each recommendation must:
- Reference specific data points (mention rates, sentiment scores, theme counts)
- Include exact platforms, content types, or engagement tactics
- Provide measurable outcomes and timelines
- Address specific sources, competitors, or themes from the analysis
- Be immediately actionable with clear next steps

Use bullet points with emojis, include specific percentages and metrics, and make each recommendation highly valuable and immediately implementable.`;

    return await this.callOpenAI(prompt);
  }

  private static async generateUpgradeSection(data: any): Promise<string> {
    const prompt = `Create a compelling upgrade section for PerceptionX Pro based on ${data.companyName}'s current analysis.

CURRENT ANALYSIS SUMMARY:
- Responses Analyzed: ${data.totalResponses}
- Themes Identified: ${data.totalThemes}
- Mention Rate: ${data.mentionRate}%
- Sentiment Score: ${data.avgSentiment}/10
- Competitors Tracked: ${data.competitors.length}
- Sources Analyzed: ${data.topSources.length}

POTENTIAL WITH PRO:
- 30 comprehensive TalentX attributes (vs current limited analysis)
- Weekly tracking and trend analysis
- Advanced competitive intelligence
- Historical trend tracking
- Custom reporting and alerts
- Priority support and consultation

Write 2-3 paragraphs that:
- Acknowledge the value they've already received
- Highlight the significant additional value of Pro features
- Use their specific data to show untapped potential
- End with a strong, compelling call to action

Use their actual data to demonstrate the potential value and make it feel personalized.`;

    return await this.callOpenAI(prompt);
  }

  private static async callOpenAI(prompt: string): Promise<string> {
    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-report', {
        body: { prompt }
      });

      if (error) {
        console.error('Error calling AI function:', error);
        throw error;
      }

      return data.response || 'Analysis not available.';
    } catch (error) {
      console.error('Error in callOpenAI:', error);
      throw error;
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

  private static groupThemesByAttribute(themes: any[]): any[] {
    const attributeMap = themes.reduce((acc, theme) => {
      const attr = theme.talentxAttribute || 'Other';
      if (!acc[attr]) {
        acc[attr] = {
          name: attr,
          themes: [],
          totalMentions: 0,
          avgSentiment: 0,
          themeCount: 0
        };
      }
      acc[attr].themes.push(theme);
      acc[attr].totalMentions += theme.count;
      acc[attr].themeCount += 1;
      return acc;
    }, {} as Record<string, any>);

    return Object.values(attributeMap).map(attr => ({
      ...attr,
      avgSentiment: attr.themes.reduce((sum: number, t: any) => sum + t.avgSentiment, 0) / attr.themeCount
    })).sort((a, b) => b.totalMentions - a.totalMentions);
  }

  private static getFallbackContent(data: AIReportData) {
    // Fallback to static templates if AI fails
    return {
      methodology: `We analyzed how AI models perceive ${data.companyName} by testing ${data.responses.length} strategic prompts across employment, leadership, and culture topics.`,
      executiveSummary: `${data.companyName} appears in ${((data.responses.filter(r => r.company_mentioned).length / data.responses.length) * 100).toFixed(1)}% of AI responses with ${data.metrics.sentimentLabel.toLowerCase()} sentiment.`,
      competitorAnalysis: data.topCompetitors.length > 0 ? `Top competitors: ${data.topCompetitors.slice(0, 3).map(c => c.name).join(', ')}` : 'No competitors identified.',
      keyThemes: 'Theme analysis not available.',
      sources: `Top sources: ${data.topCitations.slice(0, 3).map(s => s.domain).join(', ')}`,
      strategicRecommendations: 'Focus on improving AI visibility through content optimization and brand positioning.',
      upgradeSection: 'Upgrade to PerceptionX Pro for complete analysis and weekly updates.'
    };
  }
}
