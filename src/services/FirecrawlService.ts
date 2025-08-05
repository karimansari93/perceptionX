interface CrawlResult {
  success: boolean;
  data?: {
    content: string;
    markdown: string;
    metadata: {
      title: string;
      description?: string;
      keywords?: string[];
      ogTitle?: string;
      ogDescription?: string;
    };
  }[];
  error?: string;
}

interface GapAnalysisResult {
  criticalGaps: string[];
  improvementAreas: string[];
  competitorAdvantages: string[];
  recommendations: string[];
  contentScore: number;
}

export class FirecrawlService {
  private static API_BASE_URL = 'https://api.firecrawl.dev/v0';

  static async scrapeWebsite(url: string, apiKey: string): Promise<CrawlResult> {
    try {
      const response = await fetch(`${this.API_BASE_URL}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: url,
          formats: ['markdown', 'html'],
          includeTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'div'],
          onlyMainContent: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Firecrawl API error:', response.status, errorText);
        return {
          success: false,
          error: `API request failed: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      
      return {
        success: true,
        data: [result.data],
      };
    } catch (error) {
      console.error('Error scraping website:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  static analyzeContentGaps(
    scrapedContent: string,
    aiResponses: any[],
    companyName: string
  ): GapAnalysisResult {
    const content = scrapedContent.toLowerCase();
    const criticalGaps: string[] = [];
    const improvementAreas: string[] = [];
    const competitorAdvantages: string[] = [];
    const recommendations: string[] = [];

    // Key topics that should be covered on career pages
    const keyTopics = [
      { term: 'work-life balance', importance: 'critical' },
      { term: 'remote work', importance: 'critical' },
      { term: 'benefits', importance: 'critical' },
      { term: 'company culture', importance: 'critical' },
      { term: 'career development', importance: 'improvement' },
      { term: 'training', importance: 'improvement' },
      { term: 'diversity', importance: 'improvement' },
      { term: 'inclusion', importance: 'improvement' },
      { term: 'employee experience', importance: 'improvement' },
      { term: 'compensation', importance: 'critical' },
      { term: 'flexible schedule', importance: 'improvement' },
      { term: 'professional growth', importance: 'improvement' },
    ];

    // Check for missing key topics
    keyTopics.forEach(topic => {
      if (!content.includes(topic.term)) {
        if (topic.importance === 'critical') {
          criticalGaps.push(`Missing content about ${topic.term}`);
          recommendations.push(`Add detailed information about ${topic.term} to improve AI response relevance`);
        } else {
          improvementAreas.push(`Limited content about ${topic.term}`);
        }
      }
    });

    // Analyze competitor mentions in AI responses
    const competitorMentions = new Set<string>();
    aiResponses.forEach(response => {
      if (response.competitor_mentions) {
        const mentions = Array.isArray(response.competitor_mentions) 
          ? response.competitor_mentions 
          : JSON.parse(response.competitor_mentions as string || '[]');
        mentions.forEach((mention: any) => {
          const name = typeof mention === 'string' ? mention : mention.name;
          if (name && name !== companyName) {
            competitorMentions.add(name);
          }
        });
      }
    });

    if (competitorMentions.size > 0) {
      competitorAdvantages.push(`Competitors frequently mentioned: ${Array.from(competitorMentions).join(', ')}`);
      recommendations.push('Consider highlighting unique value propositions that differentiate from mentioned competitors');
    }

    // Calculate content score based on gaps
    const totalTopics = keyTopics.length;
    const missingCritical = criticalGaps.length;
    const missingImprovement = improvementAreas.length;
    const contentScore = Math.max(0, Math.round(((totalTopics - missingCritical * 2 - missingImprovement) / totalTopics) * 100));

    // Add general recommendations
    if (criticalGaps.length > 0) {
      recommendations.push('Focus on addressing critical content gaps first to improve AI response quality');
    }
    if (improvementAreas.length > 0) {
      recommendations.push('Enhance existing content with more detailed information on improvement areas');
    }

    return {
      criticalGaps,
      improvementAreas,
      competitorAdvantages,
      recommendations,
      contentScore,
    };
  }
}
