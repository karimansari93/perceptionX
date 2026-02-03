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
  const [subscription, setSubscription] = useState<SubscriptionData | null>(() => {
    // Initialize from cache if available to prevent flash
    try {
      const cached = sessionStorage.getItem('user_subscription');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
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
          console.log('Profile not found, creating new profile for user:', user.id);
          
          // Use upsert to prevent duplicates
          const { data: newProfile, error: createError } = await supabase
            .from('profiles')
            .upsert({
              id: user.id,
              email: user.email,
              subscription_type: 'free',
              prompts_used: 0,
              subscription_start_date: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'id', // Use upsert on primary key to prevent duplicates
              ignoreDuplicates: false
            })
            .select('subscription_type, prompts_used, subscription_start_date')
            .single();

          if (createError) {
            console.error('Error creating profile:', createError);
            // Set default values if profile creation fails
            const defaultSubscriptionData = {
              subscription_type: 'free' as SubscriptionType,
              prompts_used: 0,
              subscription_start_date: null
            };
            setSubscription(defaultSubscriptionData);
            // Cache the default subscription data
            try {
              sessionStorage.setItem('user_subscription', JSON.stringify(defaultSubscriptionData));
            } catch (error) {
              console.warn('Failed to cache default subscription data:', error);
            }
          } else {
            const subscriptionData = {
              subscription_type: newProfile.subscription_type || 'free',
              prompts_used: newProfile.prompts_used || 0,
              subscription_start_date: newProfile.subscription_start_date
            };
            setSubscription(subscriptionData);
            // Cache the subscription data
            try {
              sessionStorage.setItem('user_subscription', JSON.stringify(subscriptionData));
            } catch (error) {
              console.warn('Failed to cache subscription data:', error);
            }
          }
        } else {
          console.error('Error fetching profile:', error);
          throw error;
        }
      } else {
        const subscriptionData = {
          subscription_type: data.subscription_type || 'free',
          prompts_used: data.prompts_used || 0,
          subscription_start_date: data.subscription_start_date
        };
        setSubscription(subscriptionData);
        // Cache the subscription data
        try {
          sessionStorage.setItem('user_subscription', JSON.stringify(subscriptionData));
        } catch (error) {
          console.warn('Failed to cache subscription data:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching subscription from profiles:', error);
      // Set default values on any error
      const errorSubscriptionData = {
        subscription_type: 'free' as SubscriptionType,
        prompts_used: 0,
        subscription_start_date: null
      };
      setSubscription(errorSubscriptionData);
      // Cache the error subscription data
      try {
        sessionStorage.setItem('user_subscription', JSON.stringify(errorSubscriptionData));
      } catch (cacheError) {
        console.warn('Failed to cache error subscription data:', cacheError);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSubscription();
    } else {
      // Clear cache when user logs out
      try {
        sessionStorage.removeItem('user_subscription');
      } catch (error) {
        console.warn('Failed to clear subscription cache:', error);
      }
      setSubscription(null);
      setLoading(false);
    }
  }, [user]);

  const isPro = subscription?.subscription_type === 'pro';
  const isEnterprise = subscription?.subscription_type === 'enterprise';
  const isFree = subscription?.subscription_type === 'free';

  const canUpdateData = isPro || isEnterprise; // Pro and Enterprise users can update their data
  const canAddPrompt = isPro || isEnterprise || (subscription?.prompts_used || 0) < 5; // Updated to 5 for free tier
  const canRefreshData = isPro || isEnterprise; // Pro and Enterprise users can refresh data
  const canAccessAdvancedFeatures = isPro || isEnterprise;

  const getLimits = () => {
    if (isEnterprise) {
      return {
        prompts: -1, // unlimited
        companies: -1, // unlimited
        teamMembers: -1, // unlimited
        projects: -1, // unlimited
        features: [
          'Unlimited prompts',
          'Unlimited companies',
          'Unlimited users',
          'Monthly data updates',
          'Company reports & analytics',
          'All AI models',
          'Priority support',
          'Regular strategy calls',
          'Custom reporting',
          'Dedicated success manager'
        ]
      };
    }
    if (isPro) {
      return {
        prompts: -1, // unlimited
        companies: -1, // unlimited
        teamMembers: 5,
        projects: 10,
        features: [
          'Full company insights',
          'Unlimited companies',
          'Monthly data updates',
          'Company reports & analytics',
          'All AI models',
          'Priority support'
        ]
      };
    }
    return {
      prompts: 5,
      companies: 3,
      teamMembers: 1,
      projects: 1,
      features: [
        'Basic company insights',
        'Up to 5 prompts per month',
        'Up to 3 companies',
        'Dashboard access',
        'Basic analytics'
      ]
    };
  };

  return {
    subscription,
    loading,
    isPro,
    isEnterprise,
    isFree,
    canUpdateData,
    canAddPrompt,
    canRefreshData,
    canAccessAdvancedFeatures,
    getLimits,
    refetch: fetchSubscription
  };
}; 