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
    const { searchTerm, limit = 50, offset = 0, userId } = await req.json()

    if (!searchTerm || searchTerm.trim().length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Search term is required' 
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Check if user is admin
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()

    const isAdmin = userProfile?.email && (
      userProfile.email === 'karim@perceptionx.ai' || 
      userProfile.email.endsWith('@perceptionx.ai')
    )

    // Build search query
    let query = supabase
      .from('companies')
      .select(`
        id,
        name,
        industry,
        company_size,
        competitors,
        settings,
        created_at,
        updated_at,
        last_updated,
        created_by
      `)
      .ilike('name', `%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    // Execute query
    const { data: companies, error: companiesError } = await query

    if (companiesError) {
      throw companiesError
    }

    if (!companies || companies.length === 0) {
      return new Response(
        JSON.stringify({ 
          companies: [],
          total: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const companyIds = companies.map(c => c.id)

    // Fetch additional data in parallel
    const [industriesResult, countriesResult, orgsResult] = await Promise.all([
      supabase
        .from('company_industries')
        .select('company_id, industry')
        .in('company_id', companyIds),
      supabase
        .from('user_onboarding')
        .select('company_id, country')
        .in('company_id', companyIds)
        .not('company_id', 'is', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('organization_companies')
        .select('company_id, organization_id, organizations(name)')
        .in('company_id', companyIds)
    ])

    // Build maps for industries, countries, and organizations
    const industriesMap = new Map<string, Set<string>>()
    if (industriesResult.data) {
      industriesResult.data.forEach(row => {
        if (!industriesMap.has(row.company_id)) {
          industriesMap.set(row.company_id, new Set<string>())
        }
        industriesMap.get(row.company_id)!.add(row.industry)
      })
    }

    const countriesMap = new Map<string, string | null>()
    if (countriesResult.data) {
      countriesResult.data.forEach(row => {
        if (row.company_id && !countriesMap.has(row.company_id)) {
          countriesMap.set(row.company_id, row.country || null)
        }
      })
    }

    const orgMap = new Map<string, { id: string; name: string }>()
    if (orgsResult.data) {
      orgsResult.data.forEach(oc => {
        const org = Array.isArray(oc.organizations) ? oc.organizations[0] : oc.organizations
        if (org && oc.company_id) {
          orgMap.set(oc.company_id, { id: oc.organization_id, name: org.name })
        }
      })
    }

    // Enrich companies with additional data
    const enrichedCompanies = companies.map(company => {
      const industriesSet = industriesMap.get(company.id) || new Set<string>()
      if (company.industry) {
        industriesSet.add(company.industry)
      }
      const industries = Array.from(industriesSet)
      const country = countriesMap.get(company.id) || null
      const orgInfo = orgMap.get(company.id)

      return {
        ...company,
        industries,
        country,
        organization_id: orgInfo?.id,
        organization_name: orgInfo?.name
      }
    })

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .ilike('name', `%${searchTerm}%`)

    return new Response(
      JSON.stringify({ 
        companies: enrichedCompanies,
        total: totalCount || 0,
        limit,
        offset
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error searching companies:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to search companies',
        details: error.toString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
