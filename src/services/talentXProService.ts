import { supabase } from '@/integrations/supabase/client';

export interface TalentXProPrompt {
  id: string;
  userId: string;
  companyName: string;
  industry: string;
  attributeId: string;
  promptType: 'sentiment' | 'competitive' | 'visibility';
  promptText: string;
  isGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TalentXProAnalysis {
  attributeId: string;
  attributeName: string;
  promptType: 'sentiment' | 'competitive' | 'visibility';
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
      
      // Insert prompts into database
      const { data, error } = await supabase
        .from('talentx_pro_prompts')
        .insert(prompts.map(prompt => ({
          user_id: userId,
          company_name: companyName,
          industry: industry,
          attribute_id: prompt.attributeId,
          prompt_type: prompt.promptType,
          prompt_text: prompt.promptText,
          is_generated: false
        })))
        .select();

      if (error) {
        console.error('Error generating TalentX Pro prompts:', error);
        throw error;
      }

      return data.map(prompt => ({
        id: prompt.id,
        userId: prompt.user_id,
        companyName: prompt.company_name,
        industry: prompt.industry,
        attributeId: prompt.attribute_id,
        promptType: prompt.prompt_type,
        promptText: prompt.prompt_text,
        isGenerated: prompt.is_generated,
        createdAt: prompt.created_at,
        updatedAt: prompt.updated_at
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
    promptType: 'sentiment' | 'competitive' | 'visibility';
    promptText: string;
  }> {
    const templates = [
      // Mission & Purpose
      {
        attributeId: 'mission-purpose',
        promptType: 'sentiment' as const,
        promptText: `How well does ${companyName} communicate its mission and purpose to employees, and how does this resonate with their personal values?`
      },
      {
        attributeId: 'mission-purpose',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s mission and purpose compare to other companies in ${industry}?`
      },
      {
        attributeId: 'mission-purpose',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are known for having a strong, purpose-driven employer brand?`
      },

      // Rewards & Recognition
      {
        attributeId: 'rewards-recognition',
        promptType: 'sentiment' as const,
        promptText: `How satisfied are employees at ${companyName} with the rewards and recognition programs, and what specific aspects drive positive or negative sentiment?`
      },
      {
        attributeId: 'rewards-recognition',
        promptType: 'competitive' as const,
        promptText: `How do rewards and recognition programs at ${companyName} compare to other companies in ${industry}?`
      },
      {
        attributeId: 'rewards-recognition',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are known for having exceptional rewards and recognition for employees?`
      },

      // Company Culture
      {
        attributeId: 'company-culture',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} describe the actual company culture versus the promoted culture?`
      },
      {
        attributeId: 'company-culture',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s company culture compare to other companies in ${industry}?`
      },
      {
        attributeId: 'company-culture',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are known for outstanding workplace culture?`
      },

      // Social Impact
      {
        attributeId: 'social-impact',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} perceive the company's commitment to social impact and community responsibility?`
      },
      {
        attributeId: 'social-impact',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s social impact compare to other companies in ${industry}?`
      },
      {
        attributeId: 'social-impact',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are recognized for meaningful social impact and community engagement?`
      },

      // Inclusion
      {
        attributeId: 'inclusion',
        promptType: 'sentiment' as const,
        promptText: `How do employees from diverse backgrounds at ${companyName} rate the inclusivity of the workplace culture and practices?`
      },
      {
        attributeId: 'inclusion',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s inclusion and diversity efforts compare to other companies in ${industry}?`
      },
      {
        attributeId: 'inclusion',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are most recognized for diversity, equity, and inclusion?`
      },

      // Innovation
      {
        attributeId: 'innovation',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} perceive the company's commitment to innovation and opportunities for creative work?`
      },
      {
        attributeId: 'innovation',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s innovation culture compare to other companies in ${industry}?`
      },
      {
        attributeId: 'innovation',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are known for fostering innovation and creative thinking?`
      },

      // Wellbeing & Balance
      {
        attributeId: 'wellbeing-balance',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} rate work-life balance and the overall wellbeing support provided by the company?`
      },
      {
        attributeId: 'wellbeing-balance',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s wellbeing and work-life balance offerings compare to other companies in ${industry}?`
      },
      {
        attributeId: 'wellbeing-balance',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are recognized for exceptional employee wellbeing and work-life balance?`
      },

      // Leadership
      {
        attributeId: 'leadership',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} rate the quality and effectiveness of leadership within the organization?`
      },
      {
        attributeId: 'leadership',
        promptType: 'competitive' as const,
        promptText: `How does ${companyName}'s leadership quality compare to other companies in ${industry}?`
      },
      {
        attributeId: 'leadership',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are respected for outstanding leadership and management?`
      },

      // Security & Perks
      {
        attributeId: 'security-perks',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} perceive job security, benefits, and additional perks provided by the company?`
      },
      {
        attributeId: 'security-perks',
        promptType: 'competitive' as const,
        promptText: `How do ${companyName}'s security, benefits, and perks compare to other companies in ${industry}?`
      },
      {
        attributeId: 'security-perks',
        promptType: 'visibility' as const,
        promptText: `What companies in ${industry} are known for providing comprehensive benefits and job security?`
      },

      // Career Opportunities
      {
        attributeId: 'career-opportunities',
        promptType: 'sentiment' as const,
        promptText: `How do employees at ${companyName} rate career development opportunities and long-term growth potential?`
      },
      {
        attributeId: 'career-opportunities',
        promptType: 'competitive' as const,
        promptText: `How do career progression opportunities at ${companyName} compare to other companies in ${industry}?`
      },
      {
        attributeId: 'career-opportunities',
        promptType: 'visibility' as const,
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
    try {
      // Get all ungenerated Pro prompts for the user
      const { data: proPrompts, error: fetchError } = await supabase
        .from('talentx_pro_prompts')
        .select('*')
        .eq('user_id', userId)
        .eq('is_generated', false);

      if (fetchError) {
        console.error('Error fetching Pro prompts:', fetchError);
        throw fetchError;
      }

      // Convert each prompt to a confirmed prompt
      for (const prompt of proPrompts) {
        const { error: insertError } = await supabase
          .from('confirmed_prompts')
          .insert({
            onboarding_id: onboardingId,
            prompt_text: prompt.prompt_text,
            prompt_type: `talentx_${prompt.prompt_type}`,
            talentx_attribute_id: prompt.attribute_id,
            // talentx_prompt_type: prompt.prompt_type, // This field doesn't exist in the schema
            is_pro_prompt: true
          });

        if (insertError) {
          console.error('Error inserting confirmed prompt:', insertError);
          throw insertError;
        }

        // Mark as generated
        const { error: updateError } = await supabase
          .from('talentx_pro_prompts')
          .update({ is_generated: true })
          .eq('id', prompt.id);

        if (updateError) {
          console.error('Error updating prompt status:', updateError);
          throw updateError;
        }
      }
    } catch (error) {
      console.error('Error in convertToConfirmedPrompts:', error);
      throw error;
    }
  }

  /**
   * Get all TalentX Pro prompts for a user
   */
  static async getProPrompts(userId: string): Promise<TalentXProPrompt[]> {
    try {
      const { data, error } = await supabase
        .from('talentx_pro_prompts')
        .select('*')
        .eq('user_id', userId)
        .order('attribute_id', { ascending: true })
        .order('prompt_type', { ascending: true });

      if (error) {
        console.error('Error fetching TalentX Pro prompts:', error);
        throw error;
      }

      return data.map(prompt => ({
        id: prompt.id,
        userId: prompt.user_id,
        companyName: prompt.company_name,
        industry: prompt.industry,
        attributeId: prompt.attribute_id,
        promptType: prompt.prompt_type,
        promptText: prompt.prompt_text,
        isGenerated: prompt.is_generated,
        createdAt: prompt.created_at,
        updatedAt: prompt.updated_at
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
  static async getAggregatedProAnalysis(userId: string): Promise<any[]> {
    try {
      // Fetch perception scores from the new table
      const { data: perceptionScores, error } = await supabase
        .from('talentx_perception_scores')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching TalentX perception scores:', error);
        throw error;
      }

      if (!perceptionScores || perceptionScores.length === 0) {
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

      perceptionScores.forEach(score => {
        if (!aggregated[score.attribute_id]) {
          aggregated[score.attribute_id] = {
            attributeId: score.attribute_id,
            attributeName: attributeNames[score.attribute_id] || score.attribute_id,
            sentimentAnalyses: [],
            competitiveAnalyses: [],
            visibilityAnalyses: [],
            totalMentions: 1, // Each score represents one mention
            avgPerceptionScore: 0,
            avgSentimentScore: 0,
            totalResponses: 0
          };
        }

        const group = aggregated[score.attribute_id];
        
        // Add to appropriate type array
        switch (score.prompt_type) {
          case 'sentiment':
            group.sentimentAnalyses.push(score);
            break;
          case 'competitive':
            group.competitiveAnalyses.push(score);
            break;
          case 'visibility':
            group.visibilityAnalyses.push(score);
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

        // Calculate perception score using the same formula as dashboard: 40% sentiment + 35% visibility + 25% competitive
        const normalizedSentiment = Math.max(0, Math.min(100, (group.avgSentimentScore + 1) * 50));
        
        // Calculate visibility score from visibility analyses
        const visibilityScores = group.visibilityAnalyses.map((s: any) => s.visibility_score || s.perception_score || 0);
        const avgVisibility = visibilityScores.length > 0 
          ? visibilityScores.reduce((sum: number, score: number) => sum + score, 0) / visibilityScores.length 
          : 0;
        
        // Calculate competitive score from competitive analyses
        const competitiveScores = group.competitiveAnalyses.map((s: any) => s.competitive_score || s.perception_score || 0);
        const avgCompetitive = competitiveScores.length > 0 
          ? competitiveScores.reduce((sum: number, score: number) => sum + score, 0) / competitiveScores.length 
          : 0;
        
        // Apply the same weighted formula as dashboard
        group.perceptionScore = Math.round(
          (normalizedSentiment * 0.4) +
          (avgVisibility * 0.35) +
          (avgCompetitive * 0.25)
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
      // First, let's see ALL prompts in the table to understand the data
      const { data: allPrompts, error: allError } = await supabase
        .from('talentx_pro_prompts')
        .select('user_id, company_name, industry, is_generated')
        .limit(10);

      if (allError) {
        console.error('Error fetching all prompts:', allError);
      }

      // Now check for specific user
      const { count, error } = await supabase
        .from('talentx_pro_prompts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

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
    try {
      // First, let's see what prompts exist for this user
      const { data: existingPrompts, error: fetchError } = await supabase
        .from('talentx_pro_prompts')
        .select('*')
        .eq('user_id', userId);

      if (fetchError) {
        console.error('Error fetching existing prompts:', fetchError);
        throw fetchError;
      }

      // Now reset them
      const { error } = await supabase
        .from('talentx_pro_prompts')
        .update({ is_generated: false })
        .eq('user_id', userId);

      if (error) {
        console.error('Error resetting TalentX Pro prompts:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in resetProPrompts:', error);
      throw error;
    }
  }

  /**
   * Delete all TalentX Pro prompts for a user (for cleanup)
   */
  static async deleteProPrompts(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('talentx_pro_prompts')
        .delete()
        .eq('user_id', userId);

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
