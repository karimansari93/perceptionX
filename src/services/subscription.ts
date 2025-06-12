import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

export class SubscriptionService {
  static async getUserSubscription(userId: string) {
    const { data, error } = await supabase
      .from('user_onboarding')
      .select('prompts_used')
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async incrementPromptsUsed(userId: string) {
    // First get current value
    const { data: currentData, error: fetchError } = await supabase
      .from('user_onboarding')
      .select('prompts_used')
      .eq('user_id', userId)
      .single();
    
    if (fetchError) throw fetchError;

    // Then update with incremented value
    const { data, error } = await supabase
      .from('user_onboarding')
      .update({
        prompts_used: (currentData.prompts_used || 0) + 1
      })
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  static async canAddPrompt(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('user_onboarding')
      .select('prompts_used')
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    
    return data.prompts_used < 3;
  }
} 