import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Refreshes the company metric tables.
//
// Body (all optional):
//   { "companyId": "<uuid>" }  -> incrementally refresh just that organization
//                                 (fast, indexed, the normal path)
//   { }                         -> full rebuild of every organization
//
// Per-org refresh is the hot path and is what collect-company-responses calls
// directly. A full rebuild (no companyId) is heavy and is better run over a
// direct connection; invoking it here is supported but may approach the
// function's wall-clock limit on large datasets.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }
    const supabase = createClient(supabaseUrl, supabaseKey)

    // companyId may arrive in the body; tolerate an empty/no body.
    let companyId: string | null = null
    try {
      const body = await req.json()
      companyId = body?.companyId ?? null
    } catch (_) {
      // no body -> full refresh
    }

    let refreshError
    if (companyId) {
      console.log(`🔄 Refreshing company metrics for organization ${companyId}...`)
      ;({ error: refreshError } = await supabase.rpc('refresh_company_metrics', {
        p_company_id: companyId,
      }))
    } else {
      console.log('🔄 Full rebuild of company metrics (all organizations)...')
      ;({ error: refreshError } = await supabase.rpc('refresh_all_company_metrics'))
    }

    if (refreshError) {
      console.error('❌ Error refreshing company metrics:', refreshError)
      return new Response(
        JSON.stringify({
          success: false,
          scope: companyId ? 'company' : 'all',
          companyId,
          error: refreshError.message,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('✅ Successfully refreshed company metrics')
    return new Response(
      JSON.stringify({
        success: true,
        scope: companyId ? 'company' : 'all',
        companyId,
        message: companyId
          ? `Refreshed company metrics for organization ${companyId}`
          : 'Refreshed company metrics for all organizations',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('❌ Error refreshing company metrics:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to refresh company metrics',
        details: error.toString(),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
