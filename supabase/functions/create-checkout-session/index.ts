import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, priceId, successUrl, cancelUrl } = await req.json();

    console.log('Creating checkout session for:', { userId, priceId });

    if (!userId) {
      console.error('Missing required parameter: userId');
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase and Stripe clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const configuredPriceId = Deno.env.get('STRIPE_PRO_PRICE_ID');
    const appBaseUrl = Deno.env.get('APP_BASE_URL');
    
    if (!stripeSecretKey) {
      console.error('Missing STRIPE_SECRET_KEY');
      return new Response(
        JSON.stringify({ error: 'Stripe not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Determine price to use (prefer server-side configuration)
    const priceToUse = configuredPriceId || priceId;
    if (!priceToUse) {
      console.error('No Stripe price configured (STRIPE_PRO_PRICE_ID) and none provided in request');
      return new Response(
        JSON.stringify({ error: 'Stripe price not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine success/cancel URLs
    const origin = req.headers.get('origin') || '';
    const isLocalOrigin = origin.includes('localhost') || origin.includes('127.0.0.1');
    const baseUrl = appBaseUrl || (isLocalOrigin ? '' : origin);
    const successUrlToUse = successUrl || (baseUrl ? `${baseUrl}/dashboard?upgrade=success` : undefined);
    const cancelUrlToUse = cancelUrl || (baseUrl ? `${baseUrl}/dashboard?upgrade=cancelled` : undefined);
    if (!successUrlToUse || !cancelUrlToUse) {
      console.error('No valid success/cancel URL. Set APP_BASE_URL for live usage or provide public URLs.');
      return new Response(
        JSON.stringify({ error: 'Missing success/cancel URLs. Configure APP_BASE_URL to your public site.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2022-11-15' });

    // Get user data from auth.users first, then profiles
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
    
    if (authError) {
      console.error('Error fetching auth user:', authError);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userEmail = authUser.user?.email;
    if (!userEmail) {
      console.error('User has no email:', userId);
      return new Response(
        JSON.stringify({ error: 'User email not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get profile data
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (userError && userError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching user profile:', userError);
      return new Response(
        JSON.stringify({ error: 'Error fetching user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let customerId = userData?.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      console.log('Creating new Stripe customer for user:', userId);
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          supabase_user_id: userId,
        },
      });
      
      customerId = customer.id;

      // Update user profile with Stripe customer ID
      const { error: updateError } = await supabase
        .from('profiles')
        .upsert({ 
          id: userId,
          email: userEmail,
          stripe_customer_id: customerId 
        });

      if (updateError) {
        console.error('Error updating profile with customer ID:', updateError);
        // Continue anyway, the customer was created successfully
      }
    }

    console.log('Creating checkout session with customer:', customerId);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceToUse,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      allow_promotion_codes: true,
      success_url: successUrlToUse,
      cancel_url: cancelUrlToUse,
      metadata: {
        supabase_user_id: userId,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
        },
      },
    });

    console.log('Checkout session created:', session.id);

    return new Response(
      JSON.stringify({ 
        sessionId: session.id,
        url: session.url 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error creating checkout session:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to create checkout session', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 