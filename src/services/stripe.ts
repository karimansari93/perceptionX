import { supabase } from '@/integrations/supabase/client';

export class StripeService {
  static async createCheckoutSession(priceId: string, successUrl?: string, cancelUrl?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          userId: user.id,
          priceId,
          successUrl,
          cancelUrl
        }
      });

      if (error) {
        console.error('Error creating checkout session:', error);
        throw new Error('Failed to create checkout session');
      }

      return data;
    } catch (error) {
      console.error('Stripe service error:', error);
      throw error;
    }
  }

  static async redirectToCheckout(priceId: string, successUrl?: string, cancelUrl?: string) {
    try {
      const { url } = await this.createCheckoutSession(priceId, successUrl, cancelUrl);
      
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (error) {
      console.error('Error redirecting to checkout:', error);
      throw error;
    }
  }

  static async openCheckoutInNewTab(priceId: string, successUrl?: string, cancelUrl?: string) {
    try {
      const { url } = await this.createCheckoutSession(priceId, successUrl, cancelUrl);
      
      if (url) {
        window.open(url, '_blank');
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (error) {
      console.error('Error opening checkout:', error);
      throw error;
    }
  }
} 