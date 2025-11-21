import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get authorization header for user context (optional, but good for logging)
    const authHeader = req.headers.get('Authorization')
    
    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SUPABASE_PROJECT_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing')
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { question, conversationHistory = [] } = await req.json()

    if (!question) {
      return new Response(
        JSON.stringify({ error: 'Question is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Query database to gather relevant context
    let databaseContext = ''

    try {
      // Get system statistics
      const [orgsResult, usersResult, companiesResult, promptsResult, responsesResult] = await Promise.all([
        supabase.from('organizations').select('id, name, created_at').limit(100),
        supabase.from('profiles').select('id, email, subscription_type, created_at').limit(100),
        supabase.from('companies').select('id, name, industry, created_at').limit(100),
        supabase.from('confirmed_prompts').select('id, prompt_text, company_id, prompt_category, created_at').order('created_at', { ascending: false }).limit(50),
        supabase.from('prompt_responses').select('id, ai_model, company_mentioned, sentiment_score, tested_at').order('tested_at', { ascending: false }).limit(50)
      ])

      // Build context string
      const stats = {
        totalOrganizations: orgsResult.data?.length || 0,
        totalUsers: usersResult.data?.length || 0,
        totalCompanies: companiesResult.data?.length || 0,
        totalPrompts: promptsResult.data?.length || 0,
        totalResponses: responsesResult.data?.length || 0,
      }

      // Get subscription breakdown
      const subscriptionBreakdown = usersResult.data?.reduce((acc: any, user: any) => {
        acc[user.subscription_type || 'free'] = (acc[user.subscription_type || 'free'] || 0) + 1
        return acc
      }, {}) || {}

      // Get industry breakdown
      const industryBreakdown = companiesResult.data?.reduce((acc: any, company: any) => {
        acc[company.industry || 'Unknown'] = (acc[company.industry || 'Unknown'] || 0) + 1
        return acc
      }, {}) || {}

      // Get recent activity
      const recentCompanies = companiesResult.data?.slice(0, 10).map((c: any) => ({
        name: c.name,
        industry: c.industry,
        created: c.created_at
      })) || []

      // Get response statistics
      const responseStats = {
        total: responsesResult.data?.length || 0,
        withMentions: responsesResult.data?.filter((r: any) => r.company_mentioned).length || 0,
        avgSentiment: responsesResult.data?.length > 0 
          ? (responsesResult.data?.reduce((sum: number, r: any) => sum + (r.sentiment_score || 0), 0) / responsesResult.data.length).toFixed(2)
          : 0,
        models: responsesResult.data?.reduce((acc: any, r: any) => {
          acc[r.ai_model] = (acc[r.ai_model] || 0) + 1
          return acc
        }, {}) || {}
      }

      databaseContext = `
DATABASE CONTEXT:
- Total Organizations: ${stats.totalOrganizations}
- Total Users: ${stats.totalUsers} (Free: ${subscriptionBreakdown.free || 0}, Pro: ${subscriptionBreakdown.pro || 0})
- Total Companies: ${stats.totalCompanies}
- Total Prompts: ${stats.totalPrompts}
- Total Responses: ${responseStats.total} (${responseStats.withMentions} with company mentions)
- Average Sentiment Score: ${responseStats.avgSentiment}

Industry Distribution:
${Object.entries(industryBreakdown).map(([industry, count]) => `  - ${industry}: ${count}`).join('\n')}

AI Model Distribution:
${Object.entries(responseStats.models).map(([model, count]) => `  - ${model}: ${count}`).join('\n')}

Recent Companies (last 10):
${recentCompanies.map((c: any) => `  - ${c.name} (${c.industry})`).join('\n')}

Recent Prompts (sample):
${promptsResult.data?.slice(0, 5).map((p: any) => `  - "${p.prompt_text.substring(0, 100)}..." (${p.prompt_category})`).join('\n') || 'None'}
      `.trim()

      // Helper function to extract company names from comparison queries
      const extractCompanyNames = (text: string): string[] => {
        const patterns = [
          /compare\s+(?:sources\s+for\s+)?([^vs]+?)\s+vs\s+(.+?)(?:\?|$)/i,
          /compare\s+(?:sources\s+for\s+)?([^and]+?)\s+and\s+(.+?)(?:\?|$)/i,
          /compare\s+(?:sources\s+for\s+)?([^&]+?)\s+&\s+(.+?)(?:\?|$)/i,
          /sources\s+for\s+([^vs]+?)\s+vs\s+(.+?)(?:\?|$)/i,
          /sources\s+for\s+([^and]+?)\s+and\s+(.+?)(?:\?|$)/i,
        ]
        
        for (const pattern of patterns) {
          const match = text.match(pattern)
          if (match) {
            return [match[1].trim(), match[2].trim()]
          }
        }
        return []
      }

      // Check if query contains a company ID (UUID pattern)
      const companyIdMatch = question.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
      const providedCompanyId = companyIdMatch ? companyIdMatch[1] : null

      // Check if this is a comparison query
      const isComparison = /compare|vs\.?|versus/i.test(question)
      const companyNames = extractCompanyNames(question)

      if (isComparison && companyNames.length === 2) {
        // This is a comparison query - get ALL companies with these names (may have multiple IDs per name)
        const [company1Name, company2Name] = companyNames
        
        // Get ALL companies with matching names (not just one - may have multiple IDs for different countries)
        const { data: company1All } = await supabase
          .from('companies')
          .select('id, name, industry, created_at')
          .ilike('name', `%${company1Name}%`)

        const { data: company2All } = await supabase
          .from('companies')
          .select('id, name, industry, created_at')
          .ilike('name', `%${company2Name}%`)

        if (company1All && company1All.length > 0 && company2All && company2All.length > 0) {
          // Get country data for each company ID from user_onboarding
          const company1Ids = company1All.map(c => c.id)
          const company2Ids = company2All.map(c => c.id)
          
          const [company1Onboarding, company2Onboarding] = await Promise.all([
            supabase
              .from('user_onboarding')
              .select('company_id, country')
              .in('company_id', company1Ids)
              .not('country', 'is', null),
            supabase
              .from('user_onboarding')
              .select('company_id, country')
              .in('company_id', company2Ids)
              .not('country', 'is', null)
          ])

          // Build map of company_id -> country
          const company1CountryMap = new Map<string, string>()
          company1Onboarding.data?.forEach((o: any) => {
            if (o.company_id && o.country) {
              company1CountryMap.set(o.company_id, o.country)
            }
          })

          const company2CountryMap = new Map<string, string>()
          company2Onboarding.data?.forEach((o: any) => {
            if (o.company_id && o.country) {
              company2CountryMap.set(o.company_id, o.country)
            }
          })

          // Identify if companies have multiple entries with different countries
          const company1Countries = new Set(company1CountryMap.values())
          const company2Countries = new Set(company2CountryMap.values())
          
          const company1IsMultiCountry = company1All.length > 1 || company1Countries.size > 1
          const company2IsMultiCountry = company2All.length > 1 || company2Countries.size > 1

          // For comparison, aggregate data across all company IDs for each name
          const company1Data = company1All[0] // Use first one as representative
          const company2Data = company2All[0] // Use first one as representative

          // Get responses with citations for ALL company IDs (aggregate across all entries)
          const [company1Responses, company2Responses] = await Promise.all([
            supabase
              .from('prompt_responses')
              .select('citations, ai_model, company_mentioned, sentiment_score, company_id')
              .in('company_id', company1Ids),
            supabase
              .from('prompt_responses')
              .select('citations, ai_model, company_mentioned, sentiment_score, company_id')
              .in('company_id', company2Ids)
          ])

          // Process citations for company 1
          const company1Citations = (company1Responses.data || []).flatMap((r: any) => {
            if (!r.citations || !Array.isArray(r.citations)) return []
            return r.citations.map((c: any) => {
              const domain = c.domain || (c.url ? (() => {
                try { return new URL(c.url).hostname.replace('www.', '') } catch { return 'unknown' }
              })() : 'unknown')
              return {
                domain,
                url: c.url || null,
                title: c.title || c.domain || 'Unknown source',
                sourceType: c.sourceType || 'unknown',
                companyId: r.company_id
              }
            })
          })

          // Process citations for company 2
          const company2Citations = (company2Responses.data || []).flatMap((r: any) => {
            if (!r.citations || !Array.isArray(r.citations)) return []
            return r.citations.map((c: any) => {
              const domain = c.domain || (c.url ? (() => {
                try { return new URL(c.url).hostname.replace('www.', '') } catch { return 'unknown' }
              })() : 'unknown')
              return {
                domain,
                url: c.url || null,
                title: c.title || c.domain || 'Unknown source',
                sourceType: c.sourceType || 'unknown',
                companyId: r.company_id
              }
            })
          })

          // Count sources by domain for each company
          const company1SourceCounts = company1Citations.reduce((acc: any, c: any) => {
            acc[c.domain] = (acc[c.domain] || 0) + 1
            return acc
          }, {})

          const company2SourceCounts = company2Citations.reduce((acc: any, c: any) => {
            acc[c.domain] = (acc[c.domain] || 0) + 1
            return acc
          }, {})

          // Get top sources for each
          const company1TopSources = Object.entries(company1SourceCounts)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 10)
            .map(([domain, count]: any) => ({ domain, count }))

          const company2TopSources = Object.entries(company2SourceCounts)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 10)
            .map(([domain, count]: any) => ({ domain, count }))

          // Find common and unique sources
          const company1Domains = new Set(Object.keys(company1SourceCounts))
          const company2Domains = new Set(Object.keys(company2SourceCounts))
          const commonDomains = [...company1Domains].filter(d => company2Domains.has(d))
          const company1OnlyDomains = [...company1Domains].filter(d => !company2Domains.has(d))
          const company2OnlyDomains = [...company2Domains].filter(d => !company1Domains.has(d))

          // Build detailed company entries info
          const company1EntriesInfo = company1All.map((c: any) => {
            const country = company1CountryMap.get(c.id) || 'Unknown'
            return `  - Company ID: ${c.id.substring(0, 8)}... | Country: ${country}`
          }).join('\n')

          const company2EntriesInfo = company2All.map((c: any) => {
            const country = company2CountryMap.get(c.id) || 'Unknown'
            return `  - Company ID: ${c.id.substring(0, 8)}... | Country: ${country}`
          }).join('\n')

          databaseContext += `\n\nCOMPARISON DATA: ${company1Data.name} vs ${company2Data.name}

${company1Data.name}:
- Industry: ${company1Data.industry}
- Company Entries: ${company1All.length} ${company1IsMultiCountry ? '(MULTI-COUNTRY - Multiple company IDs with different countries)' : ''}
${company1EntriesInfo}
- Countries: ${Array.from(company1Countries).join(', ') || 'None identified'}
- Total Citations: ${company1Citations.length}
- Unique Sources: ${company1Domains.size}
- Responses: ${company1Responses.data?.length || 0}
- Mention Rate: ${company1Responses.data?.length > 0 ? ((company1Responses.data.filter((r: any) => r.company_mentioned).length / company1Responses.data.length) * 100).toFixed(1) : 0}%
- Top Sources:
${company1TopSources.map((s: any, i: number) => `  ${i + 1}. ${s.domain}: ${s.count} citations`).join('\n')}

${company2Data.name}:
- Industry: ${company2Data.industry}
- Company Entries: ${company2All.length} ${company2IsMultiCountry ? '(MULTI-COUNTRY - Multiple company IDs with different countries)' : ''}
${company2EntriesInfo}
- Countries: ${Array.from(company2Countries).join(', ') || 'None identified'}
- Total Citations: ${company2Citations.length}
- Unique Sources: ${company2Domains.size}
- Responses: ${company2Responses.data?.length || 0}
- Mention Rate: ${company2Responses.data?.length > 0 ? ((company2Responses.data.filter((r: any) => r.company_mentioned).length / company2Responses.data.length) * 100).toFixed(1) : 0}%
- Top Sources:
${company2TopSources.map((s: any, i: number) => `  ${i + 1}. ${s.domain}: ${s.count} citations`).join('\n')}

COMPARISON INSIGHTS:
- Common Sources: ${commonDomains.length} (${commonDomains.slice(0, 10).join(', ')}${commonDomains.length > 10 ? '...' : ''})
- Sources only in ${company1Data.name}: ${company1OnlyDomains.length} (${company1OnlyDomains.slice(0, 10).join(', ')}${company1OnlyDomains.length > 10 ? '...' : ''})
- Sources only in ${company2Data.name}: ${company2OnlyDomains.length} (${company2OnlyDomains.slice(0, 10).join(', ')}${company2OnlyDomains.length > 10 ? '...' : ''})
- Common Countries: ${[...company1Countries].filter(c => company2Countries.has(c)).length} (${[...company1Countries].filter(c => company2Countries.has(c)).join(', ') || 'None'})
- Countries only in ${company1Data.name}: ${[...company1Countries].filter(c => !company2Countries.has(c)).length} (${[...company1Countries].filter(c => !company2Countries.has(c)).join(', ') || 'None'})
- Countries only in ${company2Data.name}: ${[...company2Countries].filter(c => !company1Countries.has(c)).length} (${[...company2Countries].filter(c => !company1Countries.has(c)).join(', ') || 'None'})
          `
        } else {
          databaseContext += `\n\nCOMPARISON QUERY DETECTED but could not find both companies. Looking for: "${company1Name}" and "${company2Name}"`
        }
      } else if (providedCompanyId) {
        // Query by specific company ID
        const { data: companyData } = await supabase
          .from('companies')
          .select('id, name, industry, created_at')
          .eq('id', providedCompanyId)
          .single()

        if (companyData) {
          // Get ALL companies with the same name (may have multiple IDs for different countries)
          const { data: allCompanies } = await supabase
            .from('companies')
            .select('id, name, industry, created_at')
            .ilike('name', companyData.name)

          if (allCompanies && allCompanies.length > 0) {
            const companyIds = allCompanies.map(c => c.id)
            
            // Get country data for each company ID
            const { data: onboardingData } = await supabase
              .from('user_onboarding')
              .select('company_id, country')
              .in('company_id', companyIds)
              .not('country', 'is', null)

            // Build map of company_id -> country
            const countryMap = new Map<string, string>()
            onboardingData?.forEach((o: any) => {
              if (o.company_id && o.country) {
                countryMap.set(o.company_id, o.country)
              }
            })

            // Get all unique countries
            const associatedCountries = new Set(countryMap.values())
            const isMultiCountry = allCompanies.length > 1 || associatedCountries.size > 1

            // Get responses for ALL company IDs
            const { data: companyResponses } = await supabase
              .from('prompt_responses')
              .select('id, citations, ai_model, company_mentioned, sentiment_score, response_text, company_id, detected_competitors')
              .in('company_id', companyIds)

            // Get themes for all responses
            const responseIds = (companyResponses || []).map(r => r.id)
            const { data: themesData } = await supabase
              .from('ai_themes')
              .select('response_id, theme_name, theme_description, sentiment, sentiment_score, talentx_attribute_name, confidence_score')
              .in('response_id', responseIds)
              .gte('confidence_score', 0.7)

            // Group themes by country
            const themesByCountry = new Map<string, any[]>()
            const sourcesByCountry = new Map<string, any[]>()
            const competitorsByCountry = new Map<string, Set<string>>()

            (companyResponses || []).forEach((response: any) => {
              const country = countryMap.get(response.company_id) || 'Unknown'
              
              // Group themes by country
              const responseThemes = themesData?.filter(t => t.response_id === response.id) || []
              if (!themesByCountry.has(country)) {
                themesByCountry.set(country, [])
              }
              themesByCountry.get(country)!.push(...responseThemes)

              // Group sources by country
              if (response.citations && Array.isArray(response.citations)) {
                if (!sourcesByCountry.has(country)) {
                  sourcesByCountry.set(country, [])
                }
                response.citations.forEach((c: any) => {
                  const domain = c.domain || (c.url ? (() => {
                    try { return new URL(c.url).hostname.replace('www.', '') } catch { return 'unknown' }
                  })() : 'unknown')
                  sourcesByCountry.get(country)!.push(domain)
                })
              }

              // Group competitors by country
              if (response.detected_competitors) {
                if (!competitorsByCountry.has(country)) {
                  competitorsByCountry.set(country, new Set())
                }
                const competitors = response.detected_competitors.split(',').map((c: string) => c.trim()).filter((c: string) => c.length > 0)
                competitors.forEach((comp: string) => {
                  competitorsByCountry.get(country)!.add(comp)
                })
              }
            })

            // Process themes by country
            const themesByCountrySummary: any = {}
            themesByCountry.forEach((themes, country) => {
              const themeCounts = new Map<string, number>()
              const themeSentiments = new Map<string, number[]>()
              
              themes.forEach((theme: any) => {
                const key = theme.theme_name || theme.talentx_attribute_name
                if (key) {
                  themeCounts.set(key, (themeCounts.get(key) || 0) + 1)
                  if (!themeSentiments.has(key)) {
                    themeSentiments.set(key, [])
                  }
                  themeSentiments.get(key)!.push(theme.sentiment_score || 0)
                }
              })

              themesByCountrySummary[country] = {
                totalThemes: themes.length,
                uniqueThemes: themeCounts.size,
                topThemes: Array.from(themeCounts.entries())
                  .sort(([, a]: any, [, b]: any) => b - a)
                  .slice(0, 10)
                  .map(([name, count]: any) => ({
                    name,
                    count,
                    avgSentiment: themeSentiments.get(name) 
                      ? (themeSentiments.get(name)!.reduce((a, b) => a + b, 0) / themeSentiments.get(name)!.length).toFixed(2)
                      : '0.00'
                  }))
              }
            })

            // Process sources by country
            const sourcesByCountrySummary: any = {}
            sourcesByCountry.forEach((sources, country) => {
              const sourceCounts = new Map<string, number>()
              sources.forEach((domain: string) => {
                sourceCounts.set(domain, (sourceCounts.get(domain) || 0) + 1)
              })
              
              sourcesByCountrySummary[country] = {
                totalSources: sources.length,
                uniqueSources: sourceCounts.size,
                topSources: Array.from(sourceCounts.entries())
                  .sort(([, a]: any, [, b]: any) => b - a)
                  .slice(0, 10)
                  .map(([domain, count]: any) => ({ domain, count }))
              }
            })

            // Process competitors by country
            const competitorsByCountrySummary: any = {}
            competitorsByCountry.forEach((competitors, country) => {
              competitorsByCountrySummary[country] = Array.from(competitors)
            })

            // Build company entries info
            const companyEntriesInfo = allCompanies.map((c: any) => {
              const country = countryMap.get(c.id) || 'Unknown'
              return `  - Company ID: ${c.id} | Country: ${country} | Created: ${c.created_at}`
            }).join('\n')

            // Build detailed country analysis
            let countryAnalysis = ''
            Array.from(associatedCountries).forEach(country => {
              const themes = themesByCountrySummary[country] || { totalThemes: 0, uniqueThemes: 0, topThemes: [] }
              const sources = sourcesByCountrySummary[country] || { totalSources: 0, uniqueSources: 0, topSources: [] }
              const competitors = competitorsByCountrySummary[country] || []
              
              countryAnalysis += `\n${country}:
- Themes: ${themes.totalThemes} total, ${themes.uniqueThemes} unique
- Top Themes: ${themes.topThemes.slice(0, 5).map((t: any) => `${t.name} (${t.count}x, sentiment: ${t.avgSentiment})`).join(', ') || 'None'}
- Sources: ${sources.totalSources} total, ${sources.uniqueSources} unique
- Top Sources: ${sources.topSources.slice(0, 5).map((s: any) => `${s.domain} (${s.count}x)`).join(', ') || 'None'}
- Competitors Mentioned: ${competitors.length > 0 ? competitors.join(', ') : 'None'}
              `
            })

            databaseContext += `\n\nDETAILED COMPANY ANALYSIS (${companyData.name}):
- Company ID: ${providedCompanyId}
- Industry: ${companyData.industry}
- Company Entries: ${allCompanies.length} ${isMultiCountry ? '(MULTI-COUNTRY - Multiple company IDs with different countries)' : ''}
${companyEntriesInfo}
- Countries: ${Array.from(associatedCountries).join(', ')}
- Total Responses: ${companyResponses?.length || 0}
- Total Themes: ${themesData?.length || 0}

COUNTRY-SPECIFIC ANALYSIS:${countryAnalysis}

COMPETITORS ACROSS ALL COUNTRIES:
${Object.entries(competitorsByCountrySummary).map(([country, comps]: any) => 
  `  ${country}: ${comps.length > 0 ? comps.join(', ') : 'None'}`
).join('\n')}
            `
          }
        }
      } else {
        // Single company query by name - check for multiple entries with same name
        const companyMatch = question.match(/company\s+([^?]+)|about\s+([^?]+)/i)
        if (companyMatch) {
          const companyName = (companyMatch[1] || companyMatch[2] || '').trim()
          if (companyName) {
            // Get ALL companies with this name (may have multiple IDs for different countries)
            const { data: allCompanies } = await supabase
              .from('companies')
              .select('id, name, industry, created_at')
              .ilike('name', `%${companyName}%`)

            if (allCompanies && allCompanies.length > 0) {
              const companyIds = allCompanies.map(c => c.id)
              
              // Get country data for each company ID
              const { data: onboardingData } = await supabase
                .from('user_onboarding')
                .select('company_id, country')
                .in('company_id', companyIds)
                .not('country', 'is', null)

              // Build map of company_id -> country
              const countryMap = new Map<string, string>()
              onboardingData?.forEach((o: any) => {
                if (o.company_id && o.country) {
                  countryMap.set(o.company_id, o.country)
                }
              })

              // Get all unique countries
              const associatedCountries = new Set(countryMap.values())
              const isMultiCountry = allCompanies.length > 1 || associatedCountries.size > 1

              // Get responses for ALL company IDs
              const { data: companyResponses } = await supabase
                .from('prompt_responses')
                .select('citations, ai_model, company_mentioned, sentiment_score, response_text, company_id')
                .in('company_id', companyIds)
                .limit(50)

              // Process citations
              const allCitations = (companyResponses || []).flatMap((r: any) => {
                if (!r.citations || !Array.isArray(r.citations)) return []
                return r.citations.map((c: any) => {
                  const domain = c.domain || (c.url ? (() => {
                    try { return new URL(c.url).hostname.replace('www.', '') } catch { return 'unknown' }
                  })() : 'unknown')
                  return {
                    domain,
                    url: c.url || null,
                    companyId: r.company_id
                  }
                })
              })

              const sourceCounts = allCitations.reduce((acc: any, c: any) => {
                acc[c.domain] = (acc[c.domain] || 0) + 1
                return acc
              }, {})

              const topSources = Object.entries(sourceCounts)
                .sort(([, a]: any, [, b]: any) => b - a)
                .slice(0, 10)
                .map(([domain, count]: any) => ({ domain, count }))

              // Build company entries info
              const companyEntriesInfo = allCompanies.map((c: any) => {
                const country = countryMap.get(c.id) || 'Unknown'
                return `  - Company ID: ${c.id.substring(0, 8)}... | Country: ${country} | Created: ${c.created_at}`
              }).join('\n')

              const companyData = allCompanies[0] // Use first as representative

              databaseContext += `\n\nSPECIFIC COMPANY DATA (${companyData.name}):
- Industry: ${companyData.industry}
- Company Entries Found: ${allCompanies.length} ${isMultiCountry ? '(MULTI-COUNTRY - This company has multiple entries with different company IDs, each associated with different countries)' : ''}
${companyEntriesInfo}
- Countries Associated: ${Array.from(associatedCountries).join(', ') || 'None identified'}
- Total Responses: ${companyResponses?.length || 0}
- Mentioned: ${companyResponses?.filter((r: any) => r.company_mentioned).length || 0}
- Avg Sentiment: ${companyResponses?.length > 0 ? (companyResponses.reduce((sum: number, r: any) => sum + (r.sentiment_score || 0), 0) / companyResponses.length).toFixed(2) : 'N/A'}
- Total Citations: ${allCitations.length}
- Top Sources:
${topSources.map((s: any, i: number) => `  ${i + 1}. ${s.domain}: ${s.count} citations`).join('\n')}
              `
            }
          }
        }
      }

    } catch (dbError) {
      console.error('Error querying database:', dbError)
      databaseContext = 'Database query encountered an error, but proceeding with available context.'
    }

    // Build messages for LLM
    const messages = [
      {
        role: 'system',
        content: `You are an expert data analyst assistant for PerceptionX, an AI perception analytics platform. You have access to a Supabase database containing:

TABLES AND DATA:
- organizations: Company organizations and their members
- profiles/users: User accounts with subscription types (free/pro)
- companies: Companies being tracked with industry information
- confirmed_prompts: Prompts/questions being tested
- prompt_responses: AI model responses to prompts, including sentiment scores, mention tracking, and citations (sources)
- ai_themes: Thematic analysis of responses
- user_onboarding: User onboarding data

CITATIONS/SOURCES DATA:
- Each prompt_response contains a 'citations' field (JSON array) with source information
- Citations include: domain, url, title, and sourceType
- Sources represent where AI models found information about companies
- You can compare sources between companies to identify content gaps and opportunities

Your role is to answer questions about this data accurately and helpfully. When answering:
1. Use the provided database context to give specific, accurate answers
2. If you don't have enough data, say so clearly
3. Provide insights and analysis when relevant
4. Reference specific numbers, companies, or metrics when available
5. Be concise but thorough
6. If asked about trends, use the data to identify patterns
7. For comparison questions, highlight key differences, similarities, and actionable insights
8. When comparing sources, analyze which sources are unique to each company, which are shared, and what this means strategically
9. IMPORTANT: When a company name has multiple entries (MULTI-COUNTRY), this means the same company name has multiple company IDs in the database, each associated with a different country. This indicates the company has been set up separately for different countries/regions. Always identify and explain this clearly when you see multiple company IDs for the same name.
10. When you see "Company Entries: X (MULTI-COUNTRY)", explain that this company has X separate database entries (different company IDs) for different countries, and list which countries each entry represents.
11. When analyzing thematic differences between countries, compare the themes (from ai_themes table) grouped by country. Highlight which themes are unique to each country and which are shared.
12. When analyzing regional source differences, compare the citation sources (domains) grouped by country. Identify which sources are unique to each region and which are common.
13. When asked about competitors, analyze the detected_competitors field from prompt_responses, grouped by country if it's a multi-country company.

Current database context:
${databaseContext}`
      },
      ...conversationHistory.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: 'user',
        content: question
      }
    ]

    // Call OpenAI API
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        max_tokens: 2000,
        temperature: 0.7,
        top_p: 0.9,
      }),
    })

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json()
      console.error('OpenAI API error:', errorData)
      throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`)
    }

    const openaiData = await openaiResponse.json()
    const response = openaiData.choices[0]?.message?.content || 'I apologize, but I could not generate a response.'

    return new Response(
      JSON.stringify({ 
        response,
        context: databaseContext.substring(0, 200) + '...' // Include a snippet for debugging
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in admin-chatbot function:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process question',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

