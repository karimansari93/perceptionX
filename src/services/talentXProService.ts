import { supabase } from '@/integrations/supabase/client';

export interface TalentXProPrompt {
  id: string;
  userId: string;
  companyName: string;
  industry: string;
  attributeId: string;
  promptType: 'informational' | 'experience' | 'competitive' | 'discovery' | 'talentx_informational' | 'talentx_experience' | 'talentx_competitive' | 'talentx_discovery';
  promptText: string;
  isGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TalentXProAnalysis {
  attributeId: string;
  attributeName: string;
  promptType: 'informational' | 'experience' | 'competitive' | 'discovery' | 'talentx_informational' | 'talentx_experience' | 'talentx_competitive' | 'talentx_discovery';
  perceptionScore: number;
  relevanceScore: number;
  sentimentScore: number;
  mentionCount: number;
  confidence: number;
  context: string[];
  responseId: string;
  aiModel: string;
}

export class TalentXProService {
  /**
   * Generate all 30 TalentX Pro prompts for a user
   */
  static async generateProPrompts(
    userId: string,
    companyName: string,
    industry: string
  ): Promise<TalentXProPrompt[]> {
    try {
      // For now, we'll generate prompts directly in the service
      // Later, we can move this to a database function
      const prompts = this.generatePromptTemplates(companyName, industry);
      
      // First, check if user already has TalentX prompts to avoid duplicates
      const { data: existingPrompts, error: checkError } = await supabase
        .from('confirmed_prompts')
        .select('id')
        .eq('user_id', userId)
        .like('prompt_category', 'TalentX:%')
        .limit(1);

      if (checkError) {
        console.error('Error checking existing TalentX prompts:', checkError);
        throw checkError;
      }

      if (existingPrompts && existingPrompts.length > 0) {
        console.log('User already has TalentX prompts, skipping generation');
        // Return existing prompts instead of creating duplicates
        const { data: existing, error: fetchError } = await supabase
          .from('confirmed_prompts')
          .select('*')
          .eq('user_id', userId)
          .like('prompt_category', 'TalentX:%')
          .order('created_at', { ascending: true });

        if (fetchError) throw fetchError;

        return existing.map(prompt => ({
          id: prompt.id,
          userId: prompt.user_id,
          companyName: companyName,
          industry: industry,
          attributeId: prompt.prompt_category?.replace('TalentX: ', '') || 'unknown',
          promptType: prompt.prompt_type as 'talentx_informational' | 'talentx_experience' | 'talentx_competitive' | 'talentx_discovery',
          promptText: prompt.prompt_text,
          isGenerated: true,
          createdAt: prompt.created_at,
          updatedAt: prompt.updated_at || prompt.created_at
        }));
      }

      // Get a valid onboarding_id for the user (required field)
      const { data: onboardingData, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (onboardingError) {
        console.error('Error fetching onboarding data:', onboardingError);
        throw new Error('User must complete onboarding before generating TalentX prompts');
      }

      // Insert prompts with the current schema using standard prompt types
      const { data, error } = await supabase
        .from('confirmed_prompts')
        .insert(prompts.map(prompt => ({
          user_id: userId,
          onboarding_id: onboardingData.id, // Required field
          prompt_text: prompt.promptText,
          prompt_type: prompt.promptType.startsWith('talentx_') ? prompt.promptType : `talentx_${prompt.promptType}`,
          prompt_category: `TalentX: ${prompt.attributeId}`,
          is_active: true
        })))
        .select();

      if (error) {
        console.error('Error generating TalentX Pro prompts:', error);
        throw error;
      }

      return data.map(prompt => ({
        id: prompt.id,
        userId: prompt.user_id,
        companyName: companyName,
        industry: industry,
        attributeId: prompt.prompt_category?.replace('TalentX: ', '') || 'unknown',
        promptType: prompt.prompt_type as 'talentx_informational' | 'talentx_experience' | 'talentx_competitive' | 'talentx_discovery',
        promptText: prompt.prompt_text,
        isGenerated: true, // Always true since they're in confirmed_prompts
        createdAt: prompt.created_at,
        updatedAt: prompt.updated_at || prompt.created_at
      }));
    } catch (error) {
      console.error('Error in generateProPrompts:', error);
      throw error;
    }
  }

  /**
   * Generate prompt templates for all 30 prompts
   */
  private static generatePromptTemplates(companyName: string, industry: string): Array<{
    attributeId: string;
    promptType: 'informational' | 'experience' | 'competitive' | 'discovery' | 'talentx_informational' | 'talentx_experience' | 'talentx_competitive' | 'talentx_discovery';
    promptText: string;
  }> {
    const templates = [
      // Mission & Purpose
      {
        attributeId: 'mission-purpose',
        promptType: 'experience' as const,
        promptText: `How well does ${companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?`
      },
      {
        attributeId: 'mission-purpose',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s mission and purpose compare to other companies in ${industry}?`
      },
      {
        attributeId: 'mission-purpose',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are known for having a strong, purpose-driven employer brand?`
      },

      // Rewards & Recognition
      {
        attributeId: 'rewards-recognition',
        promptType: 'experience' as const,
        promptText: `How satisfied are employees at ${companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?`
      },
      {
        attributeId: 'rewards-recognition',
        promptType: 'competitive' as const,
        promptText: `How do rewards and recognition programs at ${companyName} compare to other companies in ${industry}?`
      },
      {
        attributeId: 'rewards-recognition',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are known for having exceptional rewards and recognition for employees?`
      },

      // Company Culture
      {
        attributeId: 'company-culture',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} describe the actual company culture versus the promoted culture?`
      },
      {
        attributeId: 'company-culture',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s company culture compare to other companies in ${industry}?`
      },
      {
        attributeId: 'company-culture',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are known for outstanding workplace culture?`
      },

      // Social Impact
      {
        attributeId: 'social-impact',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} perceive the company's commitment to social impact and community responsibility?`
      },
      {
        attributeId: 'social-impact',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s social impact compare to other companies in ${industry}?`
      },
      {
        attributeId: 'social-impact',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are recognized for meaningful social impact and community engagement?`
      },

      // Inclusion
      {
        attributeId: 'inclusion',
        promptType: 'experience' as const,
        promptText: `How do employees from diverse backgrounds at ${companyName} rate the inclusivity of the workplace culture and practices?`
      },
      {
        attributeId: 'inclusion',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s inclusion and diversity efforts compare to other companies in ${industry}?`
      },
      {
        attributeId: 'inclusion',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are most recognized for diversity, equity, and inclusion?`
      },

      // Innovation
      {
        attributeId: 'innovation',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} perceive the company's commitment to innovation and opportunities for creative work?`
      },
      {
        attributeId: 'innovation',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s innovation culture compare to other companies in ${industry}?`
      },
      {
        attributeId: 'innovation',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are known for fostering innovation and creative thinking?`
      },

      // Wellbeing & Balance
      {
        attributeId: 'wellbeing-balance',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} rate work-life balance and the overall wellbeing support provided by the company?`
      },
      {
        attributeId: 'wellbeing-balance',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s wellbeing and work-life balance offerings compare to other companies in ${industry}?`
      },
      {
        attributeId: 'wellbeing-balance',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are recognized for exceptional employee wellbeing and work-life balance?`
      },

      // Leadership
      {
        attributeId: 'leadership',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} rate the quality and effectiveness of leadership within the organization?`
      },
      {
        attributeId: 'leadership',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s leadership quality compare to other companies in ${industry}?`
      },
      {
        attributeId: 'leadership',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are respected for outstanding leadership and management?`
      },

      // Security & Perks
      {
        attributeId: 'security-perks',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} perceive job security, benefits, and additional perks provided by the company?`
      },
      {
        attributeId: 'security-perks',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s security, benefits, and perks compare to other companies in ${industry}?`
      },
      {
        attributeId: 'security-perks',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are known for providing comprehensive benefits and job security?`
      },

      // Career Opportunities
      {
        attributeId: 'career-opportunities',
        promptType: 'experience' as const,
        promptText: `How do employees at ${companyName} rate career development opportunities and long-term growth potential?`
      },
      {
        attributeId: 'career-opportunities',
        promptType: 'competitive' as const,
        promptText: `How do career progression opportunities at ${companyName} compare to other companies in ${industry}?`
      },
      {
        attributeId: 'career-opportunities',
        promptType: 'discovery' as const,
        promptText: `What companies in ${industry} are most recognized for exceptional career development and progression opportunities?`
      }
    ];

    return templates;
  }

  /**
   * Convert TalentX Pro prompts to confirmed prompts for analysis
   */
  static async convertToConfirmedPrompts(
    userId: string,
    onboardingId: string
  ): Promise<void> {
    // No longer needed - prompts are created directly in confirmed_prompts
    console.log('convertToConfirmedPrompts is deprecated - prompts are now created directly in confirmed_prompts');
  }

  /**
   * Get all TalentX Pro prompts for a user
   */
  static async getProPrompts(userId: string): Promise<TalentXProPrompt[]> {
    try {
      const { data, error } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('user_id', userId)
        .like('prompt_category', 'TalentX:%')
        .order('prompt_category', { ascending: true })
        .order('prompt_type', { ascending: true });

      if (error) {
        console.error('Error fetching TalentX Pro prompts:', error);
        throw error;
      }

      return data.map(prompt => ({
        id: prompt.id,
        userId: prompt.user_id,
        companyName: 'Generated', // Not stored in confirmed_prompts
        industry: 'Generated', // Not stored in confirmed_prompts
        attributeId: prompt.prompt_category?.replace('TalentX: ', '') || 'unknown',
        promptType: prompt.prompt_type as 'talentx_informational' | 'talentx_experience' | 'talentx_competitive' | 'talentx_discovery',
        promptText: prompt.prompt_text,
        isGenerated: true, // Always true since they're in confirmed_prompts
        createdAt: prompt.created_at,
        updatedAt: prompt.updated_at || prompt.created_at
      }));
    } catch (error) {
      console.error('Error in getProPrompts:', error);
      throw error;
    }
  }

  /**
   * Get TalentX Pro analysis data from prompt responses
   */
  static async getProAnalysis(userId: string): Promise<TalentXProAnalysis[]> {
    // Temporarily return empty array to avoid TypeScript errors
    return [];
  }

  /**
   * Get aggregated TalentX Pro analysis by attribute
   */
  static async getAggregatedProAnalysis(userId: string, companyId?: string): Promise<any[]> {
    try {
      // Fetch TalentX responses from prompt_responses table joined with confirmed_prompts
      let query = supabase
        .from('prompt_responses')
        .select(`
          *,
          confirmed_prompts!inner(
            user_id,
            prompt_type,
            prompt_text,
            prompt_category,
            company_id,
            talentx_attribute_id
          )
        `)
        .eq('confirmed_prompts.user_id', userId)
        .like('confirmed_prompts.prompt_category', 'TalentX:%');
      
      // Only filter by company_id if it's provided
      if (companyId) {
        query = query.eq('confirmed_prompts.company_id', companyId);
      }
      
      const { data: talentXResponses, error } = await query
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching TalentX responses:', error);
        throw error;
      }

      if (!talentXResponses || talentXResponses.length === 0) {
        return [];
      }

      // Get attribute names mapping
      const attributeNames: Record<string, string> = {
        'mission-purpose': 'Mission & Purpose',
        'rewards-recognition': 'Rewards & Recognition',
        'company-culture': 'Company Culture',
        'social-impact': 'Social Impact',
        'inclusion': 'Inclusion',
        'innovation': 'Innovation',
        'wellbeing-balance': 'Wellbeing & Balance',
        'leadership': 'Leadership',
        'security-perks': 'Security & Perks',
        'career-opportunities': 'Career Opportunities'
      };

      // Group by attribute and aggregate scores
      const aggregated: Record<string, any> = {};

      talentXResponses.forEach(response => {
        const promptType = response.confirmed_prompts.prompt_type;
        const attributeId = response.confirmed_prompts.talentx_attribute_id ||
                           response.confirmed_prompts.prompt_category?.replace('TalentX: ', '') || 'unknown';
        
        if (!aggregated[attributeId]) {
          aggregated[attributeId] = {
            attributeId: attributeId,
            attributeName: attributeNames[attributeId] || attributeId,
            sentimentAnalyses: [],
            competitiveAnalyses: [],
            visibilityAnalyses: [],
            totalMentions: 1,
            avgPerceptionScore: 0,
            avgSentimentScore: 0,
            totalResponses: 0
          };
        }

        const group = aggregated[attributeId];
        
        // Extract scores from talentx_analysis or talentx_scores
        const talentXData = response.talentx_analysis || response.talentx_scores || {};
        const perceptionScore = talentXData.perception_score || talentXData.score || 0;
        const sentimentScore = talentXData.sentiment_score || response.sentiment_score || 0;
        
        const analysisData = {
          id: response.id,
          perception_score: perceptionScore,
          sentiment_score: sentimentScore,
          response_text: response.response_text,
          ai_model: response.ai_model,
          prompt_type: promptType,
          citations: response.citations,
          detected_competitors: response.detected_competitors,
          created_at: response.created_at
        };
        
        // Add to appropriate type array
        switch (analysisData.prompt_type) {
          case 'experience':
          case 'talentx_experience':
            group.sentimentAnalyses.push(analysisData);
            break;
          case 'competitive':
          case 'talentx_competitive':
            group.competitiveAnalyses.push(analysisData);
            break;
          case 'discovery':
          case 'talentx_discovery':
            group.visibilityAnalyses.push(analysisData);
            break;
          case 'informational':
          case 'talentx_informational':
            group.sentimentAnalyses.push(analysisData);
            break;
        }

        group.totalResponses++;
      });

      // Calculate averages and overall perception score
      Object.values(aggregated).forEach((group: any) => {
        const allScores = [
          ...group.sentimentAnalyses,
          ...group.competitiveAnalyses,
          ...group.visibilityAnalyses
        ];

        if (allScores.length > 0) {
          group.avgPerceptionScore = allScores.reduce((sum: number, s: any) => sum + s.perception_score, 0) / allScores.length;
          group.avgSentimentScore = allScores.reduce((sum: number, s: any) => sum + s.sentiment_score, 0) / allScores.length;
        }

        // Calculate perception score using the same formula as dashboard: 50% sentiment + 30% visibility + 20% recency
        const normalizedSentiment = Math.max(0, Math.min(100, (group.avgSentimentScore + 1) * 50));
        
        // Calculate visibility score from visibility analyses
        const visibilityScores = group.visibilityAnalyses.map((s: any) => s.visibility_score || s.perception_score || 0);
        const avgVisibility = visibilityScores.length > 0 
          ? visibilityScores.reduce((sum: number, score: number) => sum + score, 0) / visibilityScores.length 
          : 0;
        
        // Calculate recency score from all responses' citations
        // For now, use a default recency score since we don't have direct access to recency data here
        // In a real implementation, you'd fetch recency data from url_recency_cache based on citations
        const avgRecency = 50; // Default recency score - this should be calculated from actual citation recency data
        
        // Apply the same weighted formula as dashboard
        group.perceptionScore = Math.round(
          (normalizedSentiment * 0.5) +
          (avgVisibility * 0.3) +
          (avgRecency * 0.2)
        );
        group.perceptionScore = Math.max(0, Math.min(100, group.perceptionScore));
      });

      return Object.values(aggregated).sort((a: any, b: any) => b.perceptionScore - a.perceptionScore);
    } catch (error) {
      console.error('Error in getAggregatedProAnalysis:', error);
      throw error;
    }
  }

  /**
   * Check if user has TalentX Pro prompts
   */
  static async hasProPrompts(userId: string): Promise<boolean> {
    try {
      // Check for TalentX prompts in confirmed_prompts by looking for TalentX category
      const { count, error } = await supabase
        .from('confirmed_prompts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .like('prompt_category', 'TalentX:%');

      if (error) {
        console.error('Error checking TalentX Pro prompts:', error);
        throw error;
      }

      return (count || 0) > 0;
    } catch (error) {
      console.error('Error in hasProPrompts:', error);
      return false;
    }
  }

  /**
   * Reset TalentX Pro prompts to ungenerated state for re-processing
   */
  static async resetProPrompts(userId: string): Promise<void> {
    // No-op: TalentX prompts in confirmed_prompts don't have is_generated flag
    // They are always considered "generated" since they're active prompts
    console.log('Reset not needed for TalentX prompts in confirmed_prompts');
  }

  /**
   * Delete all TalentX Pro prompts for a user (for cleanup)
   */
  static async deleteProPrompts(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('confirmed_prompts')
        .delete()
        .eq('user_id', userId)
        .like('prompt_category', 'TalentX:%');

      if (error) {
        console.error('Error deleting TalentX Pro prompts:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in deleteProPrompts:', error);
      throw error;
    }
  }
}
