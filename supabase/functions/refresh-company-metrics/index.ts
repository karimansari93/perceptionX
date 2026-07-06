import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Refreshes the company metric rollups.
//
// Body (optional):
//   { "companyId": "<uuid>" }  -> synchronously rebuild that ONE company's rows
//                                 in the 7 company-level rollup tables
//                                 (per-company incremental refresh — fast,
//                                 indexed). The 6 by-location rollups are
//                                 matviews and are picked up by the staleness
//                                 tick within minutes.
//   { }                         -> full refresh of all 13 rollups: force-flags
//                                 every entry in mv_refresh_state and lets the
//                                 pg_cron staleness tick drain them one per
//                                 minute. Never runs the heavy all-companies
//                                 rebuild synchronously here — that path is
//                                 what used to hit the edge/cron statement
//                                 timeout.
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
      // no body -> full refresh via the tick
    }

    if (companyId) {
      console.log(`🔄 Per-company refresh of company metrics for ${companyId}...`)
      const { error } = await supabase.rpc('refresh_company_metrics', {
        p_company_id: companyId,
      })
      if (error) {
        console.error('❌ Per-company refresh failed:', error)
        return new Response(
          JSON.stringify({ success: false, scope: 'company', companyId, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      console.log('✅ Per-company refresh complete')
      return new Response(
        JSON.stringify({
          success: true,
          scope: 'company',
          companyId,
          message:
            `Refreshed the 7 company-level rollups for ${companyId}. ` +
            'By-location rollups will be picked up by the staleness tick within minutes.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Full refresh: force-flag all rollups; the staleness tick drains them one
    // per minute with no statement timeout. (Same mechanism as the admin
    // "Refresh metrics" button / request_company_metrics_refresh.)
    console.log('🔄 Full refresh requested — force-flagging all rollups for the tick...')
    const { error: flagError } = await supabase
      .from('mv_refresh_state')
      .update({ force_refresh: true })
      .neq('mv_name', '')
    if (flagError) {
      console.error('❌ Failed to flag rollups:', flagError)
      return new Response(
        JSON.stringify({ success: false, scope: 'all', error: flagError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // Nudge the watermark so staleness comparisons see fresh data pending.
    await supabase
      .from('mv_refresh_watermark')
      .update({ data_changed_at: new Date().toISOString() })
      .eq('id', true)

    console.log('✅ All rollups flagged; tick will drain them (~1/min)')
    return new Response(
      JSON.stringify({
        success: true,
        scope: 'all',
        status: 'scheduled',
        message:
          'All 13 rollups force-flagged; the staleness tick refreshes one per minute. ' +
          'Track progress in the admin Data Health tab (mv_refresh_state).',
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
