import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders
    })
  }

  try {
    // Initialize Supabase with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log('🔄 Starting refresh of company metrics materialized views...')

    // Call the refresh function
    const { data: refreshResults, error: refreshError } = await supabase
      .rpc('refresh_company_metrics')

    if (refreshError) {
      console.error('❌ Error refreshing company metrics:', refreshError)
      throw refreshError
    }

    if (!refreshResults || refreshResults.length === 0) {
      throw new Error('Refresh function returned no results')
    }

    // Check if all refreshes succeeded
    const allSucceeded = refreshResults.every((result: any) => result.success === true)
    const failedViews = refreshResults
      .filter((result: any) => result.success === false)
      .map((result: any) => `${result.view_name}: ${result.error_message}`)

    if (!allSucceeded) {
      console.error('⚠️ Some views failed to refresh:', failedViews)
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'Some materialized views failed to refresh',
          results: refreshResults,
          errors: failedViews
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('✅ Successfully refreshed all company metrics views')

    // Calculate summary statistics
    const sentimentCount = await supabase
      .from('company_sentiment_scores_mv')
      .select('company_id', { count: 'exact', head: true })

    const relevanceCount = await supabase
      .from('company_relevance_scores_mv')
      .select('company_id', { count: 'exact', head: true })

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Successfully refreshed company metrics materialized views',
        results: refreshResults,
        statistics: {
          sentiment_records: sentimentCount.count || 0,
          relevance_records: relevanceCount.count || 0
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('❌ Error refreshing company metrics:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to refresh company metrics',
        details: error.toString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
