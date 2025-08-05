import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Test webhook received:', req.method, req.url);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    console.log('Request body:', body);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Test webhook working',
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Test webhook error:', error);
    return new Response(
      JSON.stringify({ error: 'Test webhook failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 