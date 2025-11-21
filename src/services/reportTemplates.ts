import { DashboardMetrics, PromptResponse, SentimentTrendData, CitationCount, PromptData } from '@/types/dashboard';

interface ReportData {
  companyName: string;
  metrics: DashboardMetrics;
  responses: PromptResponse[];
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
  promptsData: PromptData[];
  answerGaps?: {
    contentScore: number;
    actionableTasks: any[];
    websiteMetadata: any;
  };
}

export class ReportTemplates {
  static generateMethodology(data: ReportData): string {
    const { responses, promptsData } = data;
    return `We analyzed how AI models (GPT-4, Claude, Gemini, Perplexity) perceive your company by testing ${responses.length} strategic prompts across employment, leadership, and culture topics. Our AI analyzed responses to identify themes, sentiment, competitors, and citation sources.`;
  }

  static generateOnboardingExecutiveSummary(data: ReportData): string {
    const { companyName, metrics, responses } = data;
    
    const mentionRate = ((responses.filter(r => r.company_mentioned).length / responses.length) * 100).toFixed(1);
    const avgSentiment = metrics.averageSentiment;
    const sentimentLabel = metrics.sentimentLabel;
    
    let summary = `${companyName} appears in ${mentionRate}% of AI responses with ${sentimentLabel.toLowerCase()} sentiment (${avgSentiment.toFixed(1)}/10). `;
    
    if (mentionRate < 30) {
      summary += `Low visibility suggests content optimization needed. `;
    } else if (mentionRate < 60) {
      summary += `Moderate visibility with room for improvement. `;
    } else {
      summary += `Strong AI visibility established. `;
    }
    
    if (avgSentiment < -0.2) {
      summary += `Negative sentiment indicates reputation management required.`;
    } else if (avgSentiment > 0.2) {
      summary += `Positive sentiment shows strong brand perception.`;
    } else {
      summary += `Neutral sentiment suggests opportunity for positive positioning.`;
    }
    
    return summary;
  }

  static generateCompetitorInsights(data: ReportData): string {
    const { responses } = data;
    
    // Extract competitor mentions from responses
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
    
    const topCompetitors = Object.entries(competitorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    if (topCompetitors.length === 0) {
      return "No competitors identified in AI responses - suggests strong differentiation or limited competitive visibility.";
    }
    
    let insights = `Top Competitors:\n`;
    topCompetitors.forEach(([competitor, count], index) => {
      insights += `• ${competitor}: ${count} mentions\n`;
    });
    
    return insights;
  }

  static generateKeyThemes(data: ReportData): string {
    const { aiThemes } = data;
    
    if (!aiThemes || aiThemes.length === 0) {
      return "No AI themes data available for analysis.";
    }
    
    // Group themes by name and calculate sentiment
    const themeCounts = aiThemes.reduce((acc: Record<string, {count: number, sentiment: string[], scores: number[]}>, theme) => {
      if (!acc[theme.theme_name]) {
        acc[theme.theme_name] = { count: 0, sentiment: [], scores: [] };
      }
      acc[theme.theme_name].count++;
      acc[theme.theme_name].sentiment.push(theme.sentiment);
      acc[theme.theme_name].scores.push(theme.sentiment_score);
      return acc;
    }, {});
    
    const topThemes = Object.entries(themeCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgSentiment: data.scores.reduce((sum, score) => sum + score, 0) / data.scores.length,
        dominantSentiment: this.getMostCommonValue(data.sentiment) || 'neutral'
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    let themes = `Key Themes:\n`;
    topThemes.forEach((theme, index) => {
      const sentimentEmoji = theme.dominantSentiment === 'positive' ? '✅' : 
                           theme.dominantSentiment === 'negative' ? '❌' : '➖';
      themes += `• ${sentimentEmoji} ${theme.name}: ${theme.count} mentions\n`;
    });
    
    return themes;
  }

  static generateImprovementOpportunities(data: ReportData): string {
    const { metrics, topCitations, responses, aiThemes, topCompetitors } = data;
    
    let opportunities = `Strategic Recommendations:\n\n`;
    
    const mentionRate = (responses.filter(r => r.company_mentioned).length / responses.length) * 100;
    const avgSentiment = metrics.averageSentiment;
    
    // 1. Sentiment-based recommendations
    if (avgSentiment < -0.2) {
      const negativeThemes = aiThemes?.filter(t => t.sentiment === 'negative') || [];
      const topNegativeTheme = this.getMostCommonValue(negativeThemes.map(t => t.theme_name)) || 'leadership issues';
      
      opportunities += `• Monitor negative ${topNegativeTheme} perception on employer review sites. `;
      
      // Get top review sites from sources
      const reviewSites = topCitations.filter(c => 
        c.domain.includes('glassdoor') || 
        c.domain.includes('indeed') || 
        c.domain.includes('careerbuilder')
      ).slice(0, 2);
      
      if (reviewSites.length > 0) {
        opportunities += `Focus on ${reviewSites.map(s => s.domain).join(' and ')}.\n\n`;
      } else {
        opportunities += `Focus on Glassdoor and Indeed.\n\n`;
      }
    }
    
    // 2. Visibility-based recommendations
    if (mentionRate < 50) {
      opportunities += `• Improve visibility for competitive prompts. `;
      
      if (topCompetitors && topCompetitors.length > 0) {
        const topCompetitor = topCompetitors[0];
        opportunities += `Track what ${topCompetitor.name} is doing online to get mentioned alongside them or instead of them.\n\n`;
      } else {
        opportunities += `Develop content that positions you as the go-to solution in your industry.\n\n`;
      }
    }
    
    // 3. Source-based recommendations
    const ownedMedia = topCitations.filter(c => c.mediaType === 'owned').length;
    const influencedMedia = topCitations.filter(c => c.mediaType === 'influenced').length;
    
    if (ownedMedia < influencedMedia) {
      opportunities += `• Increase owned media content. `;
      const topInfluencedSites = topCitations
        .filter(c => c.mediaType === 'influenced')
        .slice(0, 2)
        .map(c => c.domain);
      
      if (topInfluencedSites.length > 0) {
        opportunities += `Create content that can be cited on ${topInfluencedSites.join(' and ')}.\n\n`;
      } else {
        opportunities += `Develop authoritative content for LinkedIn and industry publications.\n\n`;
      }
    }
    
    // 4. Theme-based recommendations
    if (aiThemes && aiThemes.length > 0) {
      const positiveThemes = aiThemes.filter(t => t.sentiment === 'positive');
      const negativeThemes = aiThemes.filter(t => t.sentiment === 'negative');
      
      if (positiveThemes.length > 0) {
        const topPositiveTheme = this.getMostCommonValue(positiveThemes.map(t => t.theme_name));
        opportunities += `• Amplify your ${topPositiveTheme} messaging across all channels to reinforce positive perception.\n\n`;
      }
      
      if (negativeThemes.length > 0) {
        const topNegativeTheme = this.getMostCommonValue(negativeThemes.map(t => t.theme_name));
        opportunities += `• Address ${topNegativeTheme} concerns through targeted content and internal improvements.\n\n`;
      }
    }
    
    // 5. Competitive positioning
    if (topCompetitors && topCompetitors.length > 0) {
      opportunities += `• Monitor ${topCompetitors.slice(0, 2).map(c => c.name).join(' and ')} content strategy to identify gaps you can fill.\n\n`;
    }
    
    return opportunities;
  }

  static generateSources(data: ReportData): string {
    const { topCitations } = data;
    
    const topSources = topCitations.slice(0, 5);
    
    let sources = `Top Citation Sources:\n`;
    topSources.forEach((source, index) => {
      sources += `• ${source.domain}: ${source.count} citations\n`;
    });
    
    return sources;
  }

  static generateUpgradeSection(data: ReportData): string {
    const { companyName } = data;
    
    return `This mini report provides a snapshot of your AI perception. To unlock the full potential of your brand's AI visibility:

🚀 **PerceptionX Pro Features:**
• Complete analysis of all 30 TalentX attributes (leadership, culture, innovation, etc.)
• Weekly automated updates to track changes and improvements
• Advanced competitor monitoring and benchmarking
• Detailed sentiment trend analysis over time
• Custom prompt optimization recommendations
• Priority action items with impact scoring
• Export capabilities for stakeholder presentations

📈 **Track Your Progress:**
Monitor how your strategic improvements impact AI perception week over week. See which recommendations are working and adjust your strategy accordingly.

💼 **Perfect for:**
• HR teams tracking employer brand perception
• Marketing teams optimizing content strategy  
• Leadership teams monitoring reputation
• PR teams managing crisis communications

Ready to transform your AI visibility? Upgrade to PerceptionX Pro today and turn these insights into measurable results.`;
  }

  static generateExecutiveSummary(data: ReportData): string {
    const { companyName, metrics, answerGaps, responses } = data;
    
    // Calculate key insights
    const visibilityRate = data.responses.filter(r => r.company_mentioned).length / data.responses.length * 100;
    const avgRanking = data.responses
      .filter(r => r.mention_ranking)
      .reduce((sum, r) => sum + (r.mention_ranking || 0), 0) / 
      data.responses.filter(r => r.mention_ranking).length || 0;
    
    const competitorMentions = data.responses.reduce((acc, response) => {
      if (response.detected_competitors) {
        const mentions = response.detected_competitors
          .split(',')
          .map((comp: string) => comp.trim())
          .filter((comp: string) => comp.length > 0)
          .map((comp: string) => ({ name: comp }));
        mentions.forEach((mention: any) => {
          const name = typeof mention === 'string' ? mention : mention.name;
          if (name) {
            acc[name] = (acc[name] || 0) + 1;
          }
        });
      }
      return acc;
    }, {} as Record<string, number>);
    
    const topCompetitors = Object.entries(competitorMentions)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);

    return `${companyName} demonstrates ${visibilityRate > 50 ? 'strong' : 'limited'} recognition in AI responses with ${visibilityRate.toFixed(1)}% mention rate across ${data.responses.length} analyzed prompts. ${visibilityRate < 30 ? `The company is virtually invisible in ${(100 - visibilityRate).toFixed(0)}% of relevant queries, where competitors dominate the conversation.` : 'However, significant opportunities exist to improve positioning in competitive landscapes.'} 

${topCompetitors.length > 0 ? `Competitive analysis reveals ${topCompetitors[0][0]} leads with ${topCompetitors[0][1]} mentions across responses, followed by ${topCompetitors.slice(1).map(([name, count]) => `${name} (${count} mentions)`).join(' and ')}. ` : ''}${companyName}'s average ranking when mentioned is ${avgRanking ? avgRanking.toFixed(1) : 'not tracked'}, indicating ${avgRanking && avgRanking <= 3 ? 'strong positioning when visible' : 'room for improvement in prominence'}.

${answerGaps ? `Website content analysis shows a ${answerGaps.contentScore}% optimization score, with ${answerGaps.actionableTasks.filter(t => t.priority === 'HIGH').length} critical gaps identified. ` : ''}Sentiment analysis reveals ${metrics.sentimentLabel.toLowerCase()} overall perception (${metrics.averageSentiment.toFixed(2)} average score), with ${metrics.totalCitations} citations from ${metrics.uniqueDomains} unique sources supporting AI responses.

Strategic intervention targeting content optimization and competitive positioning could increase AI visibility by an estimated 40-60% within 90 days, potentially capturing ${Math.round(visibilityRate * 2)}% additional market mindshare in AI-driven discovery channels.`;
  }

  static generateDetailedFindings(data: ReportData): string {
    const { responses, metrics, topCitations } = data;
    
    // AI Model Analysis
    const modelBreakdown = responses.reduce((acc, r) => {
      acc[r.ai_model] = (acc[r.ai_model] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Prompt Category Analysis
    const categoryPerformance = responses.reduce((acc, r) => {
      const category = r.confirmed_prompts?.prompt_category || 'Unknown';
      if (!acc[category]) {
        acc[category] = { total: 0, mentioned: 0, avgSentiment: 0, sentimentSum: 0 };
      }
      acc[category].total++;
      if (r.company_mentioned) acc[category].mentioned++;
      acc[category].sentimentSum += r.sentiment_score || 0;
      acc[category].avgSentiment = acc[category].sentimentSum / acc[category].total;
      return acc;
    }, {} as Record<string, any>);

    return `**AI Model Response Pattern Analysis**

${Object.entries(modelBreakdown).map(([model, count]) => 
  `${model}: ${count} responses (${(count/responses.length*100).toFixed(1)}%)`
).join(', ')}. Analysis shows ${responses.filter(r => r.company_mentioned).length > 0 ? 'selective' : 'limited'} company recognition across different AI models, suggesting ${responses.filter(r => r.company_mentioned).length === 0 ? 'fundamental content discoverability issues' : 'model-specific optimization opportunities'}.

**Competitive Landscape Analysis**

Citation analysis reveals ${topCitations.slice(0, 5).map(c => `${c.domain} (${c.count} citations)`).join(', ')} as dominant information sources. ${topCitations.length > 0 ? `The prevalence of ${topCitations[0].domain} with ${topCitations[0].count} citations suggests AI models heavily weight ${topCitations[0].domain.includes('wikipedia') ? 'authoritative reference sources' : 'industry-specific content hubs'}.` : 'Limited citation diversity indicates potential for strategic content partnerships.'}

**Prompt Category Performance Analysis**

${Object.entries(categoryPerformance).map(([category, stats]) => 
  `${category}: ${stats.mentioned}/${stats.total} mentions (${(stats.mentioned/stats.total*100).toFixed(1)}% visibility), ${stats.avgSentiment.toFixed(2)} avg sentiment`
).join('\n')}

Categories with ${Object.values(categoryPerformance).some((s: any) => s.mentioned === 0) ? 'zero visibility indicate critical content gaps' : 'lower performance suggest optimization priorities'}.

**Sentiment Distribution Analysis**

${metrics.positiveCount} positive responses (${(metrics.positiveCount/metrics.totalResponses*100).toFixed(1)}%), ${metrics.neutralCount} neutral (${(metrics.neutralCount/metrics.totalResponses*100).toFixed(1)}%), and ${metrics.negativeCount} negative (${(metrics.negativeCount/metrics.totalResponses*100).toFixed(1)}%) across the dataset. ${metrics.averageSentiment > 0.1 ? 'Strong positive sentiment when mentioned indicates good brand perception.' : metrics.averageSentiment < -0.1 ? 'Negative sentiment suggests reputation management needs.' : 'Neutral sentiment indicates opportunity for stronger brand differentiation.'}`;
  }

  static generateActionableRecommendations(data: ReportData): string {
    const { answerGaps, metrics, responses } = data;
    
    if (!answerGaps) {
      return `**Content Optimization Roadmap**

Based on analysis of ${responses.length} AI responses, immediate priorities include:

1. **Content Authority Building**: Develop authoritative, citation-worthy content addressing key industry topics
2. **Competitive Positioning**: Create comparison content highlighting unique value propositions
3. **Technical SEO**: Implement structured data markup to improve AI model recognition
4. **Thought Leadership**: Establish regular content publication schedule with expert insights

**Monitoring & Measurement Framework**

Implement quarterly AI visibility audits tracking mention rates, sentiment scores, and competitive positioning across major AI models.`;
    }

    const highPriorityTasks = answerGaps.actionableTasks.filter(t => t.priority === 'HIGH');
    const mediumPriorityTasks = answerGaps.actionableTasks.filter(t => t.priority === 'MEDIUM');

    return `**AI-Optimized Implementation Roadmap**

**Phase 1 (0-30 days): Critical Gap Resolution**
${highPriorityTasks.slice(0, 3).map((task, i) => 
  `${i + 1}. ${task.fixType}: ${task.suggestedAction.substring(0, 100)}...`
).join('\n')}

**Phase 2 (30-60 days): Content Enhancement**
${mediumPriorityTasks.slice(0, 3).map((task, i) => 
  `${i + 1}. ${task.fixType}: ${task.suggestedAction.substring(0, 100)}...`
).join('\n')}

**Phase 3 (60-90 days): Competitive Positioning**
- Develop comprehensive competitor comparison resources
- Implement advanced schema markup for better AI recognition
- Launch thought leadership content series targeting identified gaps

**Success Metrics & Monitoring**

Target improvements: ${answerGaps.contentScore < 50 ? '50-70%' : '75-85%'} content score, ${Math.round((1 - responses.filter(r => r.company_mentioned).length / responses.length) * 50)}% increase in mention rate, sentiment score improvement to ${metrics.averageSentiment < 0 ? '0.3+' : metrics.averageSentiment + 0.2}.

**ROI Projection**

Conservative estimates suggest ${Math.round(answerGaps.actionableTasks.length * 0.6)} implemented improvements could increase AI visibility by 40-60%, translating to enhanced brand authority and competitive positioning in AI-driven discovery channels.`;
  }

  static generateCitations(data: ReportData): string {
    const { responses, promptsData, metrics } = data;
    
    return `**Data Sources & Methodology**

Analysis based on ${responses.length} AI model responses across ${promptsData.length} unique prompts, collected between ${responses.length > 0 ? new Date(responses[responses.length - 1].created_at).toLocaleDateString() : 'N/A'} and ${responses.length > 0 ? new Date(responses[0].created_at).toLocaleDateString() : 'N/A'}.

Citation data sourced from ${metrics.totalCitations} references across ${metrics.uniqueDomains} unique domains. Sentiment analysis performed using standardized scoring methodology with [-1, 1] range.

${data.answerGaps ? `Website analysis conducted on ${data.answerGaps.websiteMetadata?.title || 'target domain'} with ${data.answerGaps.actionableTasks.length} specific recommendations generated.` : ''}

**AI Visibility Dashboard** - Generated ${new Date().toLocaleDateString()}`;
  }
}
