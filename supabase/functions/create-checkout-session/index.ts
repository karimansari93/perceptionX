import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    if (!userId || !priceId) {
      console.error('Missing required parameters:', { userId, priceId });
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: userId, priceId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase and Stripe clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    
    if (!supabaseUrl || !supabaseKey || !stripeSecretKey) {
      console.error('Missing environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl || `${req.headers.get('origin')}/dashboard?upgrade=success`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/dashboard?upgrade=cancelled`,
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