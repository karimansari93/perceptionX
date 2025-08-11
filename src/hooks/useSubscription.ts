import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type SubscriptionType = Database['public']['Enums']['subscription_type'];

interface SubscriptionData {
  subscription_type: SubscriptionType;
  prompts_used: number;
  subscription_start_date: string | null;
}

export const useSubscription = () => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // First, try to get the existing profile
      const { data, error } = await supabase
        .from('profiles')
        .select('subscription_type, prompts_used, subscription_start_date')
        .eq('id', user.id)
        .single();

      if (error) {
        // If profile doesn't exist, create one with default values
        if (error.code === 'PGRST116') { // No rows returned
          // Profile not found, create new profile for user
          const { data: newProfile, error: createError } = await supabase
            .from('profiles')
            .insert([
              {
                id: user.id,
                email: user.email,
                subscription_type: 'free',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
            ])
            .select()
            .single();

          if (createError) {
            console.error('Error creating profile:', createError);
            // Set default values if profile creation fails
            setSubscription({
              subscription_type: 'free',
              prompts_used: 0,
              subscription_start_date: null
            });
          } else {
            setSubscription({
              subscription_type: newProfile.subscription_type || 'free',
              prompts_used: newProfile.prompts_used || 0,
              subscription_start_date: newProfile.subscription_start_date
            });
          }
        } else {
          console.error('Error fetching profile:', error);
          throw error;
        }
      } else {
        setSubscription({
          subscription_type: data.subscription_type || 'free',
          prompts_used: data.prompts_used || 0,
          subscription_start_date: data.subscription_start_date
        });
      }
    } catch (error) {
      console.error('Error fetching subscription from profiles:', error);
      // Set default values on any error
      setSubscription({
        subscription_type: 'free',
        prompts_used: 0,
        subscription_start_date: null
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, [user]);

  const isPro = subscription?.subscription_type === 'pro';
  const isFree = subscription?.subscription_type === 'free';

  const canUpdateData = isPro; // Pro users can update their data
  const canAddPrompt = isPro || (subscription?.prompts_used || 0) < 3;
  const canRefreshData = isPro; // Pro users can refresh data
  const canAccessAdvancedFeatures = isPro;

  const getLimits = () => {
    if (isPro) {
      return {
        prompts: -1, // unlimited
        teamMembers: 5,
        projects: 10,
        features: ['Unlimited prompts', 'Advanced analytics', 'Priority support', 'Team collaboration']
      };
    }
    return {
      prompts: 3,
      teamMembers: 1,
      projects: 1,
      features: ['Basic prompts', 'Dashboard access']
    };
  };

  return {
    subscription,
    loading,
    isPro,
    isFree,
    canUpdateData,
    canAddPrompt,
    canRefreshData,
    canAccessAdvancedFeatures,
    getLimits,
    refetch: fetchSubscription
  };
}; 