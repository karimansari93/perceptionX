import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function needs to be public (no auth) for Stripe webhooks
serve(async (req) => {
  try {
    // Handle preflight request
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // Initialize environment variables
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    
    if (!stripeSecretKey || !webhookSecret) {
      console.error('Missing environment variables');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2022-11-15' });

    // Read the request body
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // Verify webhook signature
    if (signature) {
      try {
        const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        
        // Process the webhook event
        await processWebhookEvent(event);
        
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('Webhook signature verification failed:', err);
        return new Response(JSON.stringify({ error: 'Webhook signature verification failed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      // For development/testing, process without signature verification
      const event = JSON.parse(body);
      
      // Process the webhook event
      await processWebhookEvent(event);
      
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

async function processWebhookEvent(event: Stripe.Event) {
  // Initialize Supabase
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Handle different event types
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      
      if (userId) {
        await handleSubscriptionUpgrade(supabase, userId);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.supabase_user_id;
      
      if (userId && subscription.status === 'active') {
        await handleSubscriptionUpgrade(supabase, userId);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.supabase_user_id;
      
      if (userId) {
        await handleSubscriptionDowngrade(supabase, userId);
      }
      break;
    }

    default:
      // Unhandled event type
      break;
  }
}

async function handleSubscriptionUpgrade(supabase: any, userId: string) {
  try {
    // Update user subscription status
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        subscription_type: 'pro',
        subscription_start_date: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating subscription status:', updateError);
      return;
    }

    // Get user's onboarding data for company info
    const { data: onboardingData, error: onboardingError } = await supabase
      .from('user_onboarding')
      .select('company_name, industry')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (onboardingError) {
      console.warn('Could not fetch onboarding data for TalentX Pro prompts:', onboardingError);
      return;
    }

    if (onboardingData) {
      // Generate TalentX Pro prompts for the user
      const { error: promptError } = await supabase.functions.invoke('talentx-pro-service', {
        body: {
          action: 'generatePrompts',
          userId: userId,
          companyName: onboardingData.company_name,
          industry: onboardingData.industry
        }
      });

      if (promptError) {
        console.error('Error generating TalentX Pro prompts:', promptError);
      }
    }
  } catch (error) {
    console.error('Error during Pro upgrade:', error);
  }
}

async function handleSubscriptionDowngrade(supabase: any, userId: string) {
  try {
    // Update user subscription status
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        subscription_type: 'free',
        subscription_start_date: null
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating subscription status:', updateError);
      return;
    }

    // Remove TalentX Pro prompts
    const { error: deleteError } = await supabase
      .from('talentx_pro_prompts')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Error removing TalentX Pro prompts:', deleteError);
    }
  } catch (error) {
    console.error('Error during Pro downgrade:', error);
  }
} 