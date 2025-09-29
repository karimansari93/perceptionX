import { TalentXAttribute, TalentXAnalysis } from '@/types/talentX';
import { TALENTX_ATTRIBUTES } from '@/config/talentXAttributes';

export class TalentXAnalysisService {
  static analyzeResponse(text: string, companyName: string): TalentXAnalysis[] {
    const analyses: TalentXAnalysis[] = [];
    const lowerText = text.toLowerCase();
    const lowerCompany = companyName.toLowerCase();

    TALENTX_ATTRIBUTES.forEach(attribute => {
      const analysis = this.analyzeAttribute(text, lowerText, attribute, lowerCompany);
      if (analysis.perceptionScore > 10) { // Only include relevant attributes
        analyses.push(analysis);
      }
    });

    return analyses.sort((a, b) => b.perceptionScore - a.perceptionScore);
  }

  private static analyzeAttribute(
    originalText: string, 
    lowerText: string, 
    attribute: TalentXAttribute, 
    companyName: string
  ): TalentXAnalysis {
    // Calculate relevance score based on keyword matches
    const keywordMatches = attribute.keywords.filter(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
    const relevanceScore = Math.min(100, (keywordMatches.length / attribute.keywords.length) * 100);

    // Calculate sentiment score for this attribute
    const sentimentScore = this.calculateAttributeSentiment(lowerText, attribute);

    // Count mentions
    const mentionCount = keywordMatches.length;

    // Extract relevant context
    const context = this.extractAttributeContext(originalText, attribute.keywords);

    // Calculate confidence based on relevance and context quality
    const confidence = Math.min(1, (relevanceScore / 100) * (context.length > 0 ? 1 : 0.5));

    // Calculate perception score using the same formula as dashboard
    const perceptionScore = this.calculateAttributePerceptionScore(relevanceScore, sentimentScore, mentionCount, confidence);

    return {
      attributeId: attribute.id,
      attributeName: attribute.name,
      perceptionScore,
      avgPerceptionScore: perceptionScore,
      avgSentimentScore: sentimentScore,
      totalResponses: 1,
      sentimentAnalyses: [],
      competitiveAnalyses: [],
      visibilityAnalyses: [],
      totalMentions: mentionCount,
      context
    };
  }

  private static calculateAttributeSentiment(text: string, attribute: TalentXAttribute): number {
    // Attribute-specific sentiment analysis
    const positiveWords = ['excellent', 'great', 'good', 'strong', 'positive', 'amazing', 'outstanding'];
    const negativeWords = ['poor', 'bad', 'weak', 'negative', 'terrible', 'awful', 'disappointing'];

    let positiveCount = 0;
    let negativeCount = 0;

    // Look for sentiment words near attribute keywords
    attribute.keywords.forEach(keyword => {
      const keywordIndex = text.indexOf(keyword.toLowerCase());
      if (keywordIndex !== -1) {
        const contextStart = Math.max(0, keywordIndex - 100);
        const contextEnd = Math.min(text.length, keywordIndex + keyword.length + 100);
        const context = text.substring(contextStart, contextEnd);

        positiveWords.forEach(word => {
          if (context.includes(word)) positiveCount++;
        });
        negativeWords.forEach(word => {
          if (context.includes(word)) negativeCount++;
        });
      }
    });

    if (positiveCount === 0 && negativeCount === 0) return 0;
    
    const total = positiveCount + negativeCount;
    return (positiveCount - negativeCount) / total;
  }

  private static calculateAttributePerceptionScore(
    relevanceScore: number, 
    sentimentScore: number, 
    mentionCount: number, 
    confidence: number
  ): number {
    // Normalize sentiment score from -1 to 1 range to 0-100 range
    const normalizedSentiment = Math.max(0, Math.min(100, (sentimentScore + 1) * 50));
    
    // For regular TalentX analysis, we'll use relevance as a proxy for visibility
    // and use a default recency score since we don't have direct access to recency data here
    // This maintains consistency with the dashboard formula: 50% sentiment + 30% visibility + 20% recency
    const visibilityScore = relevanceScore; // Relevance indicates how visible/mentioned the attribute is
    const recencyScore = 50; // Default recency score - this should be calculated from actual citation recency data
    
    // Apply the same weighted formula as dashboard
    const perceptionScore = Math.round(
      (normalizedSentiment * 0.5) +
      (visibilityScore * 0.3) +
      (recencyScore * 0.2)
    );
    
    return Math.max(0, Math.min(100, perceptionScore));
  }

  private static extractAttributeContext(text: string, keywords: string[]): string[] {
    const contexts: string[] = [];
    const lowerText = text.toLowerCase();

    keywords.forEach(keyword => {
      const keywordIndex = lowerText.indexOf(keyword.toLowerCase());
      if (keywordIndex !== -1) {
        const start = Math.max(0, keywordIndex - 150);
        const end = Math.min(text.length, keywordIndex + keyword.length + 150);
        const context = text.substring(start, end).trim();
        if (context.length > 20) { // Only include substantial context
          contexts.push(context);
        }
      }
    });

    return contexts.slice(0, 3); // Limit to 3 contexts per attribute
  }

  static getOverallTalentXScore(analyses: TalentXAnalysis[]): number {
    if (analyses.length === 0) return 0;
    
    const weightedSum = analyses.reduce((sum, analysis) => {
      return sum + (analysis.perceptionScore * analysis.avgSentimentScore);
    }, 0);
    
    const totalPerception = analyses.reduce((sum, analysis) => sum + analysis.perceptionScore, 0);
    
    return totalPerception > 0 ? weightedSum / totalPerception : 0;
  }

  static getTopAttributes(analyses: TalentXAnalysis[], count: number = 3): string[] {
    return analyses
      .sort((a, b) => b.perceptionScore - a.perceptionScore)
      .slice(0, count)
      .map(analysis => analysis.attributeName);
  }

  // New methods for enhanced insights
  static getCategoryAnalysis(analyses: TalentXAnalysis[]): Record<string, any> {
    const categoryData: Record<string, any> = {};
    
    analyses.forEach(analysis => {
      const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === analysis.attributeId);
      if (!attribute) return;
      
      if (!categoryData[attribute.category]) {
        categoryData[attribute.category] = {
          attributes: [],
          avgSentiment: 0,
          avgPerception: 0,
          totalMentions: 0,
          count: 0
        };
      }
      
      categoryData[attribute.category].attributes.push(analysis);
      categoryData[attribute.category].avgSentiment += analysis.avgSentimentScore;
      categoryData[attribute.category].avgPerception += analysis.perceptionScore;
      categoryData[attribute.category].totalMentions += analysis.totalMentions;
      categoryData[attribute.category].count += 1;
    });

    // Calculate averages
    Object.keys(categoryData).forEach(category => {
      const data = categoryData[category];
      data.avgSentiment = data.avgSentiment / data.count;
      data.avgPerception = data.avgPerception / data.count;
    });

    return categoryData;
  }

  static getActionableInsights(analyses: TalentXAnalysis[]): string[] {
    const insights: string[] = [];
    
    if (analyses.length === 0) {
      insights.push("No TalentX data available yet. Consider adding more prompts that focus on talent attraction attributes.");
      return insights;
    }

    // Find strengths (high perception + positive sentiment)
    const strengths = analyses.filter(a => a.perceptionScore > 75 && a.avgSentimentScore > 0.3);
    if (strengths.length > 0) {
      const topStrength = strengths[0];
      const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === topStrength.attributeId);
      insights.push(`Strong performance in ${attribute?.name.toLowerCase()}. Consider highlighting this in your employer branding.`);
    }

    // Find areas for improvement (low perception + negative sentiment)
    const improvements = analyses.filter(a => a.perceptionScore < 50 && a.avgSentimentScore < -0.2);
    if (improvements.length > 0) {
      const topImprovement = improvements[0];
      const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === topImprovement.attributeId);
      insights.push(`Consider addressing perceptions around ${attribute?.name.toLowerCase()}. This area shows room for improvement.`);
    }

    // Find under-discussed areas (low mentions)
    const underDiscussed = analyses.filter(a => a.totalMentions < 3);
    if (underDiscussed.length > 0) {
      const topUnderDiscussed = underDiscussed[0];
      const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === topUnderDiscussed.attributeId);
      insights.push(`${attribute?.name} is rarely mentioned. Consider adding more content about this aspect of your company.`);
    }

    return insights;
  }

  static getTalentXTrends(analyses: TalentXAnalysis[], previousAnalyses?: TalentXAnalysis[]): any {
    if (!previousAnalyses || previousAnalyses.length === 0) {
      return {
        hasTrends: false,
        message: "Insufficient data to determine trends"
      };
    }

    const currentAvgSentiment = this.getOverallTalentXScore(analyses);
    const previousAvgSentiment = this.getOverallTalentXScore(previousAnalyses);
    const sentimentChange = currentAvgSentiment - previousAvgSentiment;

    return {
      hasTrends: true,
      sentimentChange,
      trendDirection: sentimentChange > 0.1 ? 'improving' : sentimentChange < -0.1 ? 'declining' : 'stable',
      message: sentimentChange > 0.1 
        ? 'TalentX sentiment is improving' 
        : sentimentChange < -0.1 
        ? 'TalentX sentiment is declining' 
        : 'TalentX sentiment is stable'
    };
  }

  static getCompetitiveAnalysis(analyses: TalentXAnalysis[], competitorAnalyses?: TalentXAnalysis[]): any {
    if (!competitorAnalyses || competitorAnalyses.length === 0) {
      return {
        hasComparison: false,
        message: "No competitor data available for comparison"
      };
    }

    const companyScore = this.getOverallTalentXScore(analyses);
    const competitorScore = this.getOverallTalentXScore(competitorAnalyses);
    const scoreDifference = companyScore - competitorScore;

    return {
      hasComparison: true,
      companyScore,
      competitorScore,
      scoreDifference,
      comparison: scoreDifference > 0.2 
        ? 'outperforming' 
        : scoreDifference < -0.2 
        ? 'underperforming' 
        : 'on par',
      message: scoreDifference > 0.2 
        ? 'Your company outperforms competitors in talent attraction attributes' 
        : scoreDifference < -0.2 
        ? 'Your company may need to improve talent attraction attributes to compete effectively' 
        : 'Your company is on par with competitors in talent attraction attributes'
    };
  }
} 