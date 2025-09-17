import { TALENTX_ATTRIBUTES } from '@/config/talentXAttributes';
import { PromptResponse } from '@/types/dashboard';
import { TalentXAnalysis } from '@/types/talentX';

export interface Theme {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  sentiment: number; // -1 to 1
  frequency: number;
  confidence: number; // 0 to 1
  context: string[];
  attributeId: string;
  attributeName: string;
}

export interface ThematicAnalysisResult {
  companyName: string;
  totalThemes: number;
  themes: Theme[];
  attributeMapping: Record<string, Theme[]>;
  overallSentiment: number;
  topThemes: Theme[];
  analysisDate: string;
}

export class ThematicAnalysisService {
  /**
   * Analyze responses to extract key themes and map them to TalentX attributes
   */
  static analyzeThemes(responses: PromptResponse[], companyName: string): ThematicAnalysisResult {
    const allText = responses.map(r => r.response_text).join(' ').toLowerCase();
    const themes: Theme[] = [];
    
    // Extract themes for each TalentX attribute
    TALENTX_ATTRIBUTES.forEach(attribute => {
      const attributeThemes = this.extractThemesForAttribute(
        responses, 
        attribute, 
        companyName
      );
      themes.push(...attributeThemes);
    });

    // Group themes by attribute
    const attributeMapping: Record<string, Theme[]> = {};
    TALENTX_ATTRIBUTES.forEach(attr => {
      attributeMapping[attr.id] = themes.filter(theme => theme.attributeId === attr.id);
    });

    // Calculate overall sentiment
    const overallSentiment = themes.length > 0 
      ? themes.reduce((sum, theme) => sum + theme.sentiment, 0) / themes.length 
      : 0;

    // Get top themes (highest frequency and confidence)
    const topThemes = themes
      .sort((a, b) => (b.frequency * b.confidence) - (a.frequency * a.confidence))
      .slice(0, 10);

    return {
      companyName,
      totalThemes: themes.length,
      themes,
      attributeMapping,
      overallSentiment,
      topThemes,
      analysisDate: new Date().toISOString()
    };
  }

  /**
   * Extract themes for a specific TalentX attribute
   */
  private static extractThemesForAttribute(
    responses: PromptResponse[], 
    attribute: any, 
    companyName: string
  ): Theme[] {
    const themes: Theme[] = [];
    const companyNameLower = companyName.toLowerCase();
    
    // Enhanced keyword patterns for each attribute
    const enhancedKeywords = this.getEnhancedKeywords(attribute);
    
    // Find all mentions of this attribute across responses
    const relevantResponses = responses.filter(response => 
      this.isResponseRelevant(response, attribute, companyNameLower)
    );

    if (relevantResponses.length === 0) return themes;

    // Extract specific themes within this attribute
    const attributeThemes = this.identifySpecificThemes(
      relevantResponses, 
      attribute, 
      companyNameLower
    );

    // Process each theme
    attributeThemes.forEach(themeData => {
      const theme: Theme = {
        id: `${attribute.id}-${themeData.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: themeData.name,
        description: themeData.description,
        keywords: themeData.keywords,
        sentiment: themeData.sentiment,
        frequency: themeData.frequency,
        confidence: themeData.confidence,
        context: themeData.context,
        attributeId: attribute.id,
        attributeName: attribute.name
      };
      themes.push(theme);
    });

    return themes;
  }

  /**
   * Check if a response is relevant to a specific attribute
   */
  private static isResponseRelevant(
    response: PromptResponse, 
    attribute: any, 
    companyName: string
  ): boolean {
    const text = response.response_text.toLowerCase();
    
    // Check for attribute keywords
    const hasKeywords = attribute.keywords.some((keyword: string) => 
      text.includes(keyword.toLowerCase())
    );

    // Check for company mentions
    const hasCompanyMention = text.includes(companyName);

    return hasKeywords && hasCompanyMention;
  }

  /**
   * Identify specific themes within an attribute
   */
  private static identifySpecificThemes(
    responses: PromptResponse[], 
    attribute: any, 
    companyName: string
  ): any[] {
    const themes: any[] = [];
    const allText = responses.map(r => r.response_text).join(' ');

    // Define theme patterns for each attribute
    const themePatterns = this.getThemePatterns(attribute.id);

    themePatterns.forEach(pattern => {
      const matches = this.findThemeMatches(allText, pattern, companyName);
      if (matches.length > 0) {
        const sentiment = this.calculateThemeSentiment(matches);
        const frequency = matches.length;
        const confidence = this.calculateThemeConfidence(matches, pattern);

        themes.push({
          name: pattern.name,
          description: pattern.description,
          keywords: pattern.keywords,
          sentiment,
          frequency,
          confidence,
          context: matches.map(m => m.context)
        });
      }
    });

    return themes;
  }

  /**
   * Get enhanced keywords for better theme detection
   */
  private static getEnhancedKeywords(attribute: any): string[] {
    const baseKeywords = attribute.keywords;
    const enhanced = [...baseKeywords];

    // Add synonyms and related terms
    const synonyms: Record<string, string[]> = {
      'mission-purpose': ['purpose-driven', 'mission statement', 'company values', 'core values', 'vision statement'],
      'rewards-recognition': ['compensation package', 'salary range', 'bonus structure', 'employee benefits', 'total rewards'],
      'company-culture': ['work environment', 'team culture', 'organizational culture', 'workplace atmosphere', 'company values'],
      'social-impact': ['corporate responsibility', 'community involvement', 'sustainability initiatives', 'social responsibility'],
      'inclusion': ['diversity initiatives', 'inclusive workplace', 'equity programs', 'diverse workforce', 'inclusion efforts'],
      'innovation': ['cutting-edge technology', 'research and development', 'innovative solutions', 'tech innovation', 'breakthrough technology'],
      'wellbeing-balance': ['work-life integration', 'flexible work', 'remote work', 'employee wellness', 'mental health support'],
      'leadership': ['management style', 'executive team', 'leadership development', 'senior leadership', 'company leadership'],
      'security-perks': ['job stability', 'career security', 'workplace amenities', 'office perks', 'employee perks'],
      'career-opportunities': ['career growth', 'professional development', 'advancement opportunities', 'career progression', 'learning opportunities']
    };

    const additionalKeywords = synonyms[attribute.id] || [];
    return [...enhanced, ...additionalKeywords];
  }

  /**
   * Get theme patterns for specific attributes
   */
  private static getThemePatterns(attributeId: string): any[] {
    const patterns: Record<string, any[]> = {
      'mission-purpose': [
        {
          name: 'Clear Mission Statement',
          description: 'Company has a well-defined and communicated mission',
          keywords: ['mission', 'purpose', 'vision', 'values', 'meaningful work'],
          patterns: [/mission is to/i, /purpose is to/i, /vision is to/i, /values include/i]
        },
        {
          name: 'Social Impact Focus',
          description: 'Company emphasizes making a positive social impact',
          keywords: ['impact', 'change the world', 'make a difference', 'social good'],
          patterns: [/make a difference/i, /change the world/i, /social impact/i, /positive impact/i]
        }
      ],
      'rewards-recognition': [
        {
          name: 'Competitive Compensation',
          description: 'Company offers competitive salary and benefits',
          keywords: ['competitive salary', 'good pay', 'excellent benefits', 'compensation package'],
          patterns: [/competitive salary/i, /good pay/i, /excellent benefits/i, /compensation package/i]
        },
        {
          name: 'Recognition Programs',
          description: 'Company has formal recognition and reward programs',
          keywords: ['recognition', 'rewards', 'incentives', 'bonus', 'awards'],
          patterns: [/recognition program/i, /reward system/i, /incentive program/i, /bonus structure/i]
        }
      ],
      'company-culture': [
        {
          name: 'Collaborative Environment',
          description: 'Company promotes teamwork and collaboration',
          keywords: ['collaborative', 'teamwork', 'team-oriented', 'cooperative'],
          patterns: [/collaborative environment/i, /teamwork/i, /team-oriented/i, /cooperative culture/i]
        },
        {
          name: 'Innovation Culture',
          description: 'Company encourages innovation and creativity',
          keywords: ['innovative', 'creative', 'forward-thinking', 'cutting-edge'],
          patterns: [/innovative culture/i, /creative environment/i, /forward-thinking/i, /cutting-edge/i]
        }
      ],
      'social-impact': [
        {
          name: 'Community Involvement',
          description: 'Company actively participates in community initiatives',
          keywords: ['community', 'volunteering', 'charity', 'giving back'],
          patterns: [/community involvement/i, /volunteering/i, /charity work/i, /giving back/i]
        },
        {
          name: 'Sustainability Focus',
          description: 'Company prioritizes environmental sustainability',
          keywords: ['sustainability', 'environmental', 'green', 'eco-friendly'],
          patterns: [/sustainability initiatives/i, /environmental focus/i, /green practices/i, /eco-friendly/i]
        }
      ],
      'inclusion': [
        {
          name: 'Diversity Programs',
          description: 'Company has active diversity and inclusion programs',
          keywords: ['diversity', 'inclusion', 'equity', 'DEI'],
          patterns: [/diversity program/i, /inclusion initiative/i, /equity program/i, /DEI efforts/i]
        },
        {
          name: 'Inclusive Workplace',
          description: 'Company creates an inclusive work environment',
          keywords: ['inclusive', 'welcoming', 'accepting', 'supportive'],
          patterns: [/inclusive workplace/i, /welcoming environment/i, /accepting culture/i, /supportive atmosphere/i]
        }
      ],
      'innovation': [
        {
          name: 'Technology Leadership',
          description: 'Company is a leader in technology innovation',
          keywords: ['technology leader', 'innovative technology', 'cutting-edge tech'],
          patterns: [/technology leader/i, /innovative technology/i, /cutting-edge tech/i, /tech innovation/i]
        },
        {
          name: 'Research & Development',
          description: 'Company invests heavily in R&D',
          keywords: ['research', 'development', 'R&D', 'innovation lab'],
          patterns: [/research and development/i, /R&D investment/i, /innovation lab/i, /development team/i]
        }
      ],
      'wellbeing-balance': [
        {
          name: 'Work-Life Balance',
          description: 'Company supports work-life balance',
          keywords: ['work-life balance', 'flexible work', 'work-life integration'],
          patterns: [/work-life balance/i, /flexible work/i, /work-life integration/i, /balanced lifestyle/i]
        },
        {
          name: 'Employee Wellness',
          description: 'Company prioritizes employee health and wellness',
          keywords: ['wellness', 'health', 'mental health', 'wellbeing'],
          patterns: [/employee wellness/i, /health programs/i, /mental health support/i, /wellbeing initiatives/i]
        }
      ],
      'leadership': [
        {
          name: 'Strong Leadership',
          description: 'Company has strong and effective leadership',
          keywords: ['strong leadership', 'effective management', 'good leaders'],
          patterns: [/strong leadership/i, /effective management/i, /good leaders/i, /leadership team/i]
        },
        {
          name: 'Leadership Development',
          description: 'Company invests in developing leaders',
          keywords: ['leadership development', 'management training', 'leadership programs'],
          patterns: [/leadership development/i, /management training/i, /leadership programs/i, /developing leaders/i]
        }
      ],
      'security-perks': [
        {
          name: 'Job Security',
          description: 'Company provides stable employment',
          keywords: ['job security', 'stable', 'secure', 'long-term'],
          patterns: [/job security/i, /stable employment/i, /secure position/i, /long-term career/i]
        },
        {
          name: 'Workplace Perks',
          description: 'Company offers attractive workplace amenities',
          keywords: ['perks', 'amenities', 'benefits', 'office perks'],
          patterns: [/workplace perks/i, /office amenities/i, /employee benefits/i, /company perks/i]
        }
      ],
      'career-opportunities': [
        {
          name: 'Career Growth',
          description: 'Company offers clear career advancement paths',
          keywords: ['career growth', 'advancement', 'promotion', 'career development'],
          patterns: [/career growth/i, /advancement opportunities/i, /promotion path/i, /career development/i]
        },
        {
          name: 'Learning Opportunities',
          description: 'Company provides learning and development opportunities',
          keywords: ['learning', 'training', 'development', 'education'],
          patterns: [/learning opportunities/i, /training programs/i, /development opportunities/i, /education support/i]
        }
      ]
    };

    return patterns[attributeId] || [];
  }

  /**
   * Find theme matches in text
   */
  private static findThemeMatches(text: string, pattern: any, companyName: string): any[] {
    const matches: any[] = [];
    
    pattern.patterns.forEach((regex: RegExp) => {
      const regexMatches = text.match(regex);
      if (regexMatches) {
        regexMatches.forEach(match => {
          const contextStart = Math.max(0, text.indexOf(match) - 100);
          const contextEnd = Math.min(text.length, text.indexOf(match) + match.length + 100);
          const context = text.substring(contextStart, contextEnd).trim();
          
          matches.push({
            match,
            context,
            pattern: pattern.name
          });
        });
      }
    });

    return matches;
  }

  /**
   * Calculate sentiment for a theme
   */
  private static calculateThemeSentiment(matches: any[]): number {
    const positiveWords = ['excellent', 'great', 'good', 'strong', 'positive', 'amazing', 'outstanding', 'impressive'];
    const negativeWords = ['poor', 'bad', 'weak', 'negative', 'terrible', 'awful', 'disappointing', 'lacking'];

    let positiveCount = 0;
    let negativeCount = 0;

    matches.forEach(match => {
      const text = match.context.toLowerCase();
      positiveWords.forEach(word => {
        if (text.includes(word)) positiveCount++;
      });
      negativeWords.forEach(word => {
        if (text.includes(word)) negativeCount++;
      });
    });

    if (positiveCount === 0 && negativeCount === 0) return 0;
    
    const total = positiveCount + negativeCount;
    return (positiveCount - negativeCount) / total;
  }

  /**
   * Calculate confidence for a theme
   */
  private static calculateThemeConfidence(matches: any[], pattern: any): number {
    const frequency = matches.length;
    const keywordMatches = pattern.keywords.filter((keyword: string) => 
      matches.some(match => match.context.toLowerCase().includes(keyword.toLowerCase()))
    ).length;
    
    const keywordRatio = keywordMatches / pattern.keywords.length;
    const frequencyScore = Math.min(1, frequency / 5); // Normalize frequency
    
    return (keywordRatio + frequencyScore) / 2;
  }

  /**
   * Convert thematic analysis to TalentX format
   */
  static convertToTalentXFormat(thematicResult: ThematicAnalysisResult): TalentXAnalysis[] {
    const talentXAnalyses: TalentXAnalysis[] = [];

    TALENTX_ATTRIBUTES.forEach(attribute => {
      const themes = thematicResult.attributeMapping[attribute.id] || [];
      
      if (themes.length === 0) return;

      const avgSentiment = themes.reduce((sum, theme) => sum + theme.sentiment, 0) / themes.length;
      const avgPerception = themes.reduce((sum, theme) => sum + (theme.confidence * 100), 0) / themes.length;
      const totalMentions = themes.reduce((sum, theme) => sum + theme.frequency, 0);
      const context = themes.flatMap(theme => theme.context);

      const analysis: TalentXAnalysis = {
        attributeId: attribute.id,
        attributeName: attribute.name,
        perceptionScore: Math.round(avgPerception),
        avgPerceptionScore: avgPerception,
        avgSentimentScore: avgSentiment,
        totalResponses: themes.length,
        sentimentAnalyses: themes.map(theme => ({
          theme: theme.name,
          sentiment: theme.sentiment,
          confidence: theme.confidence
        })),
        competitiveAnalyses: [],
        visibilityAnalyses: [],
        totalMentions,
        context: context.slice(0, 5) // Limit to 5 contexts
      };

      talentXAnalyses.push(analysis);
    });

    return talentXAnalyses.sort((a, b) => b.perceptionScore - a.perceptionScore);
  }
}
