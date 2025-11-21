import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-client-host, x-client-platform, x-client-language, apikey, content-type',
}

interface SearchTerm {
  id?: string;
  company_id: string;
  search_term: string;
  monthly_volume?: number;
  is_manual?: boolean;
  added_by?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with user's auth for validation
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the user from the JWT token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      console.error('Auth error:', userError)
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: userError?.message }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Create service role client to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { method } = req
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    switch (method) {
      case 'GET':
        return await handleGet(supabaseAdmin, url)
      case 'POST':
        return await handlePost(supabaseAdmin, user.id, await req.json())
      case 'PUT':
        return await handlePut(supabaseAdmin, user.id, await req.json())
      case 'DELETE':
        return await handleDelete(supabaseAdmin, user.id, url)
      default:
        return new Response(
          JSON.stringify({ error: 'Method not allowed' }),
          { 
            status: 405, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
    }
  } catch (error) {
    console.error('Error in manage-company-search-terms function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function listSearchTerms(
  supabaseAdmin: any,
  {
    companyId,
    searchTerm,
    isManual,
  }: { companyId?: string | null; searchTerm?: string | null; isManual?: string | null },
) {
  try {
    console.log('GET request params:', { companyId, searchTerm, isManual })

    let query = supabaseAdmin
      .from('company_search_terms')
      .select('*')
      .order('monthly_volume', { ascending: false })

    if (companyId) {
      query = query.eq('company_id', companyId)
    }

    if (searchTerm) {
      query = query.ilike('search_term', `%${searchTerm}%`)
    }

    if (isManual !== null) {
      query = query.eq('is_manual', isManual === 'true')
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching search terms:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch search terms', details: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('Fetched search terms:', data?.length || 0)

    return new Response(
      JSON.stringify({ search_terms: data || [] }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (error) {
    console.error('Error in handleGet:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
}

async function handleGet(supabaseAdmin: any, url: URL) {
  const companyId = url.searchParams.get('company_id')
  const searchTerm = url.searchParams.get('search_term')
  const isManual = url.searchParams.get('is_manual')

  return await listSearchTerms(supabaseAdmin, { companyId, searchTerm, isManual })
}

async function handlePost(supabaseAdmin: any, userId: string, body: any) {
  try {
    console.log('POST request body:', body)
    const action = body?.action

    if (action === 'list') {
      return await listSearchTerms(supabaseAdmin, {
        companyId: body.company_id ?? null,
        searchTerm: body.search_term ?? null,
        isManual: body.is_manual ?? null,
      })
    }

    if (action === 'list-all') {
      return await listSearchTerms(supabaseAdmin, { companyId: null, searchTerm: null, isManual: null })
    }

    if (action === 'search') {
      return await listSearchTerms(supabaseAdmin, {
        companyId: body.company_id ?? null,
        searchTerm: body.search_term ?? null,
        isManual: body.is_manual ?? null,
      })
    }

    if (action === 'delete') {
      return await handleDelete(supabaseAdmin, userId, new URL(`https://dummy.local?${new URLSearchParams({ id: body.id ?? '' }).toString()}`))
    }

    const { company_id, search_term } = body

    if (!company_id || !search_term) {
      return new Response(
        JSON.stringify({ error: 'Company ID and search term are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

  // Just check if company exists and allow any authenticated user
  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('id', company_id)
    .single()
  
  if (companyError || !company) {
    console.error('Company not found:', companyError)
    return new Response(
      JSON.stringify({ error: 'Company not found', details: companyError?.message }),
      { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
  
  console.log('Company found:', company)
  console.log('About to check for duplicates with:', { company_id, search_term, userId })

  // Check for duplicates
  const { data: existing, error: duplicateError } = await supabaseAdmin
    .from('company_search_terms')
    .select('id')
    .eq('company_id', company_id)
    .eq('search_term', search_term)
    .single()

  console.log('Duplicate check result:', { existing, duplicateError })

  if (duplicateError && duplicateError.code !== 'PGRST116') {
    console.error('Error checking for duplicates:', duplicateError)
    return new Response(
      JSON.stringify({ error: 'Failed to check for duplicates', details: duplicateError }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  if (existing) {
    console.log('Duplicate found!')
    return new Response(
      JSON.stringify({ error: 'Search term already exists for this company' }),
      { 
        status: 409, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  console.log('No duplicate, inserting new search term...')

  // Insert new search term
  const { data, error } = await supabaseAdmin
    .from('company_search_terms')
    .insert({
      company_id,
      search_term,
      monthly_volume: 0, // Will be updated when search insights runs
      is_manual: true,
      added_by: userId
    })
    .select()
    .single()

  console.log('Insert result:', { data, error })

  if (error) {
    console.error('Error creating search term:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to create search term' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

    return new Response(
      JSON.stringify({ search_term: data }),
      { 
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (error) {
    console.error('Error in handlePost:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
}

async function handlePut(supabaseAdmin: any, userId: string, body: any) {
  const { id, search_term, monthly_volume } = body

  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Search term ID is required' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  // Get the search term to check permissions
  const { data: existingTerm, error: fetchError } = await supabaseAdmin
    .from('company_search_terms')
    .select('company_id')
    .eq('id', id)
    .single()

  if (fetchError || !existingTerm) {
    return new Response(
      JSON.stringify({ error: 'Search term not found' }),
      { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  // Check permissions
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('company_members')
    .select('role')
    .eq('company_id', existingTerm.company_id)
    .eq('user_id', userId)
    .single()

  if (membershipError || !membership || !['admin', 'owner'].includes(membership.role)) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  // Update search term
  const updateData: any = {}
  if (search_term !== undefined) updateData.search_term = search_term
  if (monthly_volume !== undefined) updateData.monthly_volume = monthly_volume

  const { data, error } = await supabaseAdmin
    .from('company_search_terms')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating search term:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to update search term' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  return new Response(
    JSON.stringify({ search_term: data }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}

async function handleDelete(supabaseAdmin: any, userId: string, url: URL) {
  const id = url.searchParams.get('id')

  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Search term ID is required' }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  // Get the search term to check permissions
  const { data: existingTerm, error: fetchError } = await supabaseAdmin
    .from('company_search_terms')
    .select('company_id')
    .eq('id', id)
    .single()

  if (fetchError || !existingTerm) {
    return new Response(
      JSON.stringify({ error: 'Search term not found' }),
      { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  // Check permissions
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('company_members')
    .select('role')
    .eq('company_id', existingTerm.company_id)
    .eq('user_id', userId)
    .single()

  if (membershipError || !membership || !['admin', 'owner'].includes(membership.role)) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  // Delete search term
  const { error } = await supabaseAdmin
    .from('company_search_terms')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting search term:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to delete search term' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }

  return new Response(
    JSON.stringify({ success: true }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}
