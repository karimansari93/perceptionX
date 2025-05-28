
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
  static generateExecutiveSummary(data: ReportData): string {
    const { companyName, metrics, answerGaps } = data;
    
    // Calculate key insights
    const visibilityRate = data.responses.filter(r => r.company_mentioned).length / data.responses.length * 100;
    const avgRanking = data.responses
      .filter(r => r.mention_ranking)
      .reduce((sum, r) => sum + (r.mention_ranking || 0), 0) / 
      data.responses.filter(r => r.mention_ranking).length || 0;
    
    const competitorMentions = data.responses.reduce((acc, response) => {
      if (response.competitor_mentions) {
        const mentions = Array.isArray(response.competitor_mentions) 
          ? response.competitor_mentions 
          : JSON.parse(response.competitor_mentions as string || '[]');
        mentions.forEach((mention: any) => {
          acc[mention.company] = (acc[mention.company] || 0) + 1;
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
    return `**Data Sources & Methodology**

Analysis based on ${data.responses.length} AI model responses across ${data.promptsData.length} unique prompts, collected between ${data.responses.length > 0 ? new Date(data.responses[data.responses.length - 1].tested_at).toLocaleDateString() : 'N/A'} and ${data.responses.length > 0 ? new Date(data.responses[0].tested_at).toLocaleDateString() : 'N/A'}.

Citation data sourced from ${data.metrics.totalCitations} references across ${data.metrics.uniqueDomains} unique domains. Sentiment analysis performed using standardized scoring methodology with [-1, 1] range.

${data.answerGaps ? `Website analysis conducted on ${data.answerGaps.websiteMetadata?.title || 'target domain'} with ${data.answerGaps.actionableTasks.length} specific recommendations generated.` : ''}

**AI Visibility Dashboard** - Generated ${new Date().toLocaleDateString()}`;
  }
}
