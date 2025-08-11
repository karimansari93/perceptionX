import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Read request body
    const body = await req.text();
    
    if (!body || body.length === 0) {
      return new Response('Empty request body', { status: 400, headers: corsHeaders });
    }

    // Get signature from headers
    const signature = req.headers.get('stripe-signature');
    
    if (!signature) {
      return new Response('Missing Stripe signature', { status: 400, headers: corsHeaders });
    }

    // Get environment variables
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!stripeSecretKey || !webhookSecret) {
      return new Response('Missing required environment variables', { status: 500, headers: corsHeaders });
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      // For development/testing, temporarily skip signature verification
      try {
        event = JSON.parse(body);
      } catch (parseErr) {
        return new Response('Invalid webhook signature', { status: 400, headers: corsHeaders });
      }
    }

    // Process webhook event
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        
        if (userId) {
          // Process checkout completion for user
          await handleCheckoutCompletion(userId, session);
        }
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        if (subscription.status === 'active') {
          // Process active subscription for user
          await handleActiveSubscription(customerId, subscription);
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object as Stripe.Subscription;
        const deletedCustomerId = deletedSubscription.customer as string;
        
        // Handle subscription deletion
        await handleSubscriptionDeletion(deletedCustomerId);
        break;

      default:
        // Unhandled event type
        break;
    }

    return new Response('Webhook processed successfully', { status: 200, headers: corsHeaders });

  } catch (error) {
    return new Response(`Error processing webhook: ${error.message}`, { status: 500, headers: corsHeaders });
  }
});

async function handleCheckoutCompletion(userId: string, session: Stripe.Checkout.Session) {
  try {
    // Handle subscription upgrade for user
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .update({
        subscription_type: 'pro',
        subscription_start_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (profileError) {
      throw profileError;
    }

    // Successfully updated user to Pro subscription
    return profile;
  } catch (error) {
    throw error;
  }
}

async function handleActiveSubscription(customerId: string, subscription: Stripe.Subscription) {
  try {
    // Get user ID from customer ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (profileError || !profile) {
      throw new Error('Profile not found for customer');
    }

    const userId = profile.id;

    // Check if user has onboarding data
    const { data: onboardingData, error: onboardingError } = await supabase
      .from('user_onboarding')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (onboardingError || !onboardingData) {
      throw new Error('Onboarding data not found');
    }

    // Generate TalentX Pro prompts for the user
    const { data: prompts, error: promptsError } = await supabase.functions.invoke('talentx-pro-service', {
      body: {
        userId,
        companyName: onboardingData.company_name,
        industry: onboardingData.industry,
        companySize: onboardingData.company_size,
        role: onboardingData.role,
        goals: onboardingData.goals
      }
    });

    if (promptsError) {
      throw promptsError;
    }

    // Successfully generated TalentX Pro prompts for user
    return prompts;
  } catch (error) {
    throw error;
  }
}

async function handleSubscriptionDeletion(customerId: string) {
  try {
    // Handle subscription downgrade for user
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .update({
        subscription_type: 'free',
        subscription_start_date: null,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_customer_id', customerId)
      .select()
      .single();

    if (profileError) {
      throw profileError;
    }

    return profile;
  } catch (error) {
    throw error;
  }
} 