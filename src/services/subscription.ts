import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { TalentXProService } from './talentXProService';

type SubscriptionType = Database['public']['Enums']['subscription_type'];

export class SubscriptionService {
  static async getUserSubscription(userId: string) {
    // First try to get from profiles table
    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_type, prompts_used, subscription_start_date')
      .eq('id', userId)
      .single();
    
    if (error) {
      // Fallback to user_onboarding table for backward compatibility
      const { data: onboardingData, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('subscription_type, prompts_used, subscription_start_date')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (onboardingError) throw onboardingError;
      return onboardingData;
    }
    
    return data;
  }

  static async incrementPromptsUsed(userId: string) {
    // First get current value
    const { data: currentData, error: fetchError } = await supabase
      .from('profiles')
      .select('prompts_used')
      .eq('id', userId)
      .single();
    
    if (fetchError) throw fetchError;

    // Then update with incremented value
    const { data, error } = await supabase
      .from('profiles')
      .update({
        prompts_used: (currentData.prompts_used || 0) + 1
      })
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async canAddPrompt(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_type, prompts_used')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    
    // Pro users have unlimited prompts, free users limited to 3
    if (data.subscription_type === 'pro') {
      return true;
    }
    
    return (data.prompts_used || 0) < 3;
  }

  static async upgradeToPro(userId: string): Promise<void> {
    try {
      // 1. Update user subscription status
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          subscription_type: 'pro',
          subscription_start_date: new Date().toISOString()
        })
        .eq('id', userId);
      
      if (updateError) throw updateError;

      // 2. Get user's onboarding data for company info
      const { data: onboardingData, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('company_name, industry')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (onboardingError) {
        console.warn('Could not fetch onboarding data for TalentX Pro prompts:', onboardingError);
        return; // Continue with upgrade even if we can't generate prompts
      }

      // 3. Generate TalentX Pro prompts
      try {
        await TalentXProService.generateProPrompts(
          userId,
          onboardingData.company_name || 'Your Company',
          onboardingData.industry || 'Technology'
        );
      } catch (promptError) {
        console.error('Error generating TalentX Pro prompts:', promptError);
        // Don't fail the upgrade if prompt generation fails
      }

    } catch (error) {
      console.error('Error during Pro upgrade:', error);
      throw error;
    }
  }

  static async canUpdateData(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_type')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    
    return data.subscription_type === 'pro';
  }

  /**
   * Check if user has TalentX Pro prompts and generate them if needed
   */
  static async ensureTalentXProPrompts(userId: string): Promise<void> {
    try {
      const hasPrompts = await TalentXProService.hasProPrompts(userId);
      
      if (!hasPrompts) {
        // Get user's onboarding data
        const { data: onboardingData, error: onboardingError } = await supabase
          .from('user_onboarding')
          .select('company_name, industry')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (!onboardingError && onboardingData) {
          await TalentXProService.generateProPrompts(
            userId,
            onboardingData.company_name || 'Your Company',
            onboardingData.industry || 'Technology'
          );
        }
      }
    } catch (error) {
      console.error('Error ensuring TalentX Pro prompts:', error);
    }
  }
} 