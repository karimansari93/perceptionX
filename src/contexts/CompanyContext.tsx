import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';

export interface Company {
  id: string;
  name: string;
  industry: string;
  industries?: string[];
  company_size: string | null;
  competitors: string[];
  settings: any;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  is_default?: boolean;
  organization_id?: string;
  country?: string | null;
}

export interface CompanyMembership {
  id: string;
  user_id: string;
  company_id: string;
  role: 'owner' | 'admin' | 'member';
  is_default: boolean;
  joined_at: string;
  invited_by: string | null;
  company?: Company;
}

interface CompanyContextType {
  currentCompany: Company | null;
  userCompanies: Company[];
  userMemberships: CompanyMembership[];
  loading: boolean;
  switchCompany: (companyId: string) => Promise<void>;
  refreshCompanies: () => Promise<void>;
  setAsDefaultCompany: (companyId: string) => Promise<void>;
  isOwnerOrAdmin: boolean;
}

export const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    // Return a default value instead of throwing to prevent crashes during initial render
    // This can happen during React's initial render cycle before providers are fully mounted
    console.warn('useCompany called outside CompanyProvider, returning default values');
    return {
      currentCompany: null,
      userCompanies: [],
      userMemberships: [],
      loading: true,
      switchCompany: async () => {},
      refreshCompanies: async () => {},
      setAsDefaultCompany: async () => {},
      isOwnerOrAdmin: false,
    };
  }
  return context;
};

// Admin emails - should match AdminRoute.tsx
const ADMIN_EMAILS = ['karim@perceptionx.ai'];

const isAdminUser = (email: string | undefined): boolean => {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
};

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [currentCompany, setCurrentCompany] = useState<Company | null>(null);
  const [userCompanies, setUserCompanies] = useState<Company[]>([]);
  const [userMemberships, setUserMemberships] = useState<CompanyMembership[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch user's companies through organization membership
  const fetchUserCompanies = useCallback(async () => {
    // CRITICAL: Wait for auth to be fully loaded before fetching companies
    // This prevents race conditions where user data is fetched before auth context is ready
    if (authLoading) {
      console.log('🔍 Auth still loading, waiting...');
      return;
    }

    if (!user) {
      // Clear all state immediately when user is null
      setCurrentCompany(null);
      setUserCompanies([]);
      setUserMemberships([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Check if user is admin - admins see ALL companies
      const isAdmin = isAdminUser(user.email);
      
      if (isAdmin) {
        console.log('🔍 Admin user detected - fetching all companies');
        
        // Fetch ALL companies for admin
        const { data: allCompanies, error: allCompaniesError } = await supabase
          .from('companies')
          .select('id, name, industry, company_size, competitors, settings, created_at, updated_at, created_by')
          .order('created_at', { ascending: false });

        if (allCompaniesError) {
          console.error('🔍 Error fetching all companies for admin:', allCompaniesError);
          throw allCompaniesError;
        }

        if (allCompanies && allCompanies.length > 0) {
          const companyIds = allCompanies.map(c => c.id);
          
          // Fetch industries for all companies
          let industriesMap = new Map<string, Set<string>>();
          if (companyIds.length > 0) {
            const { data: industriesData, error: industriesError } = await supabase
              .from('company_industries')
              .select('company_id, industry')
              .in('company_id', companyIds);

            if (industriesError) {
              console.error('🔍 Error fetching company industries for admin:', industriesError);
            } else if (industriesData) {
              industriesMap = industriesData.reduce((map, row) => {
                if (!map.has(row.company_id)) {
                  map.set(row.company_id, new Set<string>());
                }
                map.get(row.company_id)!.add(row.industry);
                return map;
              }, new Map<string, Set<string>>());
            }
          }

          // Fetch countries for all companies
          // Note: For admin, we don't filter by user_id since admins should see all companies
          // But we still need to be careful about the query structure
          let countriesMap = new Map<string, string | null>();
          if (companyIds.length > 0) {
            const { data: countriesData, error: countriesError } = await supabase
              .from('user_onboarding')
              .select('company_id, country')
              .in('company_id', companyIds)
              .not('company_id', 'is', null)
              .order('created_at', { ascending: false });

            if (countriesError) {
              console.error('🔍 Error fetching company countries for admin:', countriesError);
            } else if (countriesData) {
              countriesMap = countriesData.reduce((map, row) => {
                if (row.company_id && !map.has(row.company_id)) {
                  map.set(row.company_id, row.country || null);
                }
                return map;
              }, new Map<string, string | null>());
            }
          }

          // Fetch organization info for each company
          const { data: orgCompaniesData } = await supabase
            .from('organization_companies')
            .select('company_id, organization_id, organizations(name)')
            .in('company_id', companyIds);

          const orgMap = new Map<string, { id: string; name: string }>();
          if (orgCompaniesData) {
            orgCompaniesData.forEach(oc => {
              const org = Array.isArray(oc.organizations) ? oc.organizations[0] : oc.organizations;
              if (org && oc.company_id) {
                orgMap.set(oc.company_id, { id: oc.organization_id, name: org.name });
              }
            });
          }

          const companies: Company[] = [];
          const memberships: CompanyMembership[] = [];

          for (const company of allCompanies) {
            const industriesSet = industriesMap.get(company.id) || new Set<string>();
            if (company.industry) {
              industriesSet.add(company.industry);
            }
            const industries = Array.from(industriesSet);
            const country = countriesMap.get(company.id) || null;
            const orgInfo = orgMap.get(company.id);

            // Check if admin has a company_members entry (for is_default)
            const { data: companyMember } = await supabase
              .from('company_members')
              .select('is_default, role, joined_at')
              .eq('user_id', user.id)
              .eq('company_id', company.id)
              .maybeSingle();

            const isDefault = companyMember?.is_default || false;
            const memberRole = companyMember?.role || 'admin'; // Admins default to admin role
            const joinedAt = companyMember?.joined_at || new Date().toISOString();

            const companyWithData = {
              ...company,
              organization_id: orgInfo?.id,
              is_default: isDefault,
              industries,
              country
            };

            companies.push(companyWithData);

            memberships.push({
              id: `${orgInfo?.id || 'admin'}-${company.id}`,
              user_id: user.id,
              company_id: company.id,
              role: memberRole as 'owner' | 'admin' | 'member',
              is_default: isDefault,
              joined_at: joinedAt,
              invited_by: null,
              company: companyWithData
            });
          }

          console.log('🔍 All companies loaded for admin:', companies.length);
          setUserCompanies(companies);
          setUserMemberships(memberships);

          // Set current company if none is selected
          setCurrentCompany(prevCurrent => {
            if (!prevCurrent) {
              const defaultCompany = companies.find(c => c.is_default) || companies[0];
              if (defaultCompany) {
                console.log('🔍 Setting initial current company for admin:', defaultCompany.name);
                return defaultCompany;
              }
              return null;
            } else {
              const stillValid = companies.find(c => c.id === prevCurrent.id);
              if (stillValid) {
                return prevCurrent;
              } else {
                const defaultCompany = companies.find(c => c.is_default) || companies[0];
                return defaultCompany || null;
              }
            }
          });
        } else {
          setUserCompanies([]);
          setUserMemberships([]);
          setCurrentCompany(null);
        }
        
        setLoading(false);
        return;
      }

      // Non-admin users: use organization-based approach
      // First, try the new organization-based approach
      const { data: orgMemberships, error: orgError } = await supabase
        .from('organization_members')
        .select(`
          organization_id,
          role,
          is_default,
          organizations!inner(
            id,
            name
          )
        `)
        .eq('user_id', user.id);

      if (orgError) {
        console.error('🔍 Error fetching organization memberships:', orgError);
        throw orgError;
      }

      console.log('🔍 Organization memberships found:', orgMemberships?.length || 0);

      if (orgMemberships && orgMemberships.length > 0) {
        // New organization-based approach - fetch companies separately
        const companies: Company[] = [];
        const memberships: CompanyMembership[] = [];

        for (const orgMembership of orgMemberships) {
          const org = Array.isArray(orgMembership.organizations) 
            ? orgMembership.organizations[0] 
            : orgMembership.organizations;
          
          // Fetch companies for this organization (step 1: get company IDs)
          const { data: orgCompanies, error: companiesError } = await supabase
            .from('organization_companies')
            .select('company_id')
            .eq('organization_id', orgMembership.organization_id);

          if (companiesError) {
            console.error('🔍 Error fetching companies for org:', companiesError);
            continue;
          }

          if (orgCompanies && orgCompanies.length > 0) {
            // Step 2: Fetch company details separately
            const companyIds = orgCompanies.map(oc => oc.company_id);
            const { data: companiesData, error: companyDetailsError } = await supabase
              .from('companies')
              .select('id, name, industry, company_size, competitors, settings, created_at, updated_at, created_by')
              .in('id', companyIds);

            if (companyDetailsError) {
              console.error('🔍 Error fetching company details:', companyDetailsError);
              continue;
            }

            // Fetch industries for these companies (including secondary industries)
            let industriesMap = new Map<string, Set<string>>();
            if (companyIds.length > 0) {
              const { data: industriesData, error: industriesError } = await supabase
                .from('company_industries')
                .select('company_id, industry')
                .in('company_id', companyIds);

              if (industriesError) {
                console.error('🔍 Error fetching company industries:', industriesError);
              } else if (industriesData) {
                industriesMap = industriesData.reduce((map, row) => {
                  if (!map.has(row.company_id)) {
                    map.set(row.company_id, new Set<string>());
                  }
                  map.get(row.company_id)!.add(row.industry);
                  return map;
                }, new Map<string, Set<string>>());
              }
            }

            // Fetch countries for these companies from user_onboarding
            // CRITICAL: Filter by user_id to ensure we only get countries for this user's companies
            let countriesMap = new Map<string, string | null>();
            if (companyIds.length > 0) {
              const { data: countriesData, error: countriesError } = await supabase
                .from('user_onboarding')
                .select('company_id, country')
                .eq('user_id', user.id) // CRITICAL: Filter by user_id to prevent seeing other users' data
                .in('company_id', companyIds)
                .not('company_id', 'is', null)
                .order('created_at', { ascending: false });

              if (countriesError) {
                console.error('🔍 Error fetching company countries:', countriesError);
              } else if (countriesData) {
                // Use the most recent onboarding record for each company
                countriesMap = countriesData.reduce((map, row) => {
                  if (row.company_id && !map.has(row.company_id)) {
                    map.set(row.company_id, row.country || null);
                  }
                  return map;
                }, new Map<string, string | null>());
              }
            }

            for (const company of companiesData || []) {
              if (company) {
                // Fetch the actual is_default from company_members table
                // Use maybeSingle() instead of single() to handle cases where no row exists
                const { data: companyMember, error: memberError } = await supabase
                  .from('company_members')
                  .select('is_default, role, joined_at')
                  .eq('user_id', user.id)
                  .eq('company_id', company.id)
                  .maybeSingle();

                if (memberError) {
                  console.error('🔍 Error fetching company member details:', memberError);
                }

                const isDefault = companyMember?.is_default || false;
                const memberRole = companyMember?.role || orgMembership.role;
                const joinedAt = companyMember?.joined_at || new Date().toISOString();

                const industriesSet = industriesMap.get(company.id) || new Set<string>();
                if (company.industry) {
                  industriesSet.add(company.industry);
                }

                const industries = Array.from(industriesSet);
                const country = countriesMap.get(company.id) || null;

                const companyWithIndustries = {
                  ...company,
                  organization_id: org.id,
                  is_default: isDefault,
                  industries,
                  country
                };

                companies.push(companyWithIndustries);

                memberships.push({
                  id: `${orgMembership.organization_id}-${company.id}`,
                  user_id: user.id,
                  company_id: company.id,
                  role: memberRole as 'owner' | 'admin' | 'member',
                  is_default: isDefault,
                  joined_at: joinedAt,
                  invited_by: null,
                  company: companyWithIndustries
                });
              }
            }
          }
        }

        console.log('🔍 Companies found through organizations:', companies.length);
        setUserCompanies(companies);
        setUserMemberships(memberships);

        // Only set current company if none is selected or current company is no longer valid
        setCurrentCompany(prevCurrent => {
          if (!prevCurrent) {
            // No current company, set to default or first
            const defaultCompany = companies.find(c => c.is_default) || companies[0];
            if (defaultCompany) {
              console.log('🔍 Setting initial current company:', defaultCompany.name);
              return defaultCompany;
            } else {
              console.log('🔍 No companies found');
              return null;
            }
          } else {
            // Check if current company is still valid
            const stillValid = companies.find(c => c.id === prevCurrent.id);
            if (stillValid) {
              console.log('🔍 Current company still valid, keeping:', prevCurrent.name);
              return prevCurrent;
            } else {
              // Current company no longer valid, set to default or first
              const defaultCompany = companies.find(c => c.is_default) || companies[0];
              if (defaultCompany) {
                console.log('🔍 Current company no longer valid, switching to:', defaultCompany.name);
                return defaultCompany;
              } else {
                console.log('🔍 No companies found');
                return null;
              }
            }
          }
        });
      } else {
        // Fallback: Check old company_members table for backwards compatibility
        
        const { data: oldMemberships, error: oldError } = await supabase
          .from('company_members')
          .select('*')
          .eq('user_id', user.id)
          .order('joined_at', { ascending: true });

        if (oldError) {
          console.error('🔍 Error fetching old memberships:', oldError);
          throw oldError;
        }

        if (oldMemberships && oldMemberships.length > 0) {
          // Fetch company details separately
          const companyIds = oldMemberships.map(m => m.company_id);
          const { data: companiesData } = await supabase
            .from('companies')
            .select('*')
            .in('id', companyIds);

          // Fetch industries for these companies
          let industriesMap = new Map<string, Set<string>>();
          if (companyIds.length > 0) {
            const { data: industriesData, error: industriesError } = await supabase
              .from('company_industries')
              .select('company_id, industry')
              .in('company_id', companyIds);

            if (industriesError) {
              console.error('🔍 Error fetching fallback company industries:', industriesError);
            } else if (industriesData) {
              industriesMap = industriesData.reduce((map, row) => {
                if (!map.has(row.company_id)) {
                  map.set(row.company_id, new Set<string>());
                }
                map.get(row.company_id)!.add(row.industry);
                return map;
              }, new Map<string, Set<string>>());
            }
          }

          // Fetch countries for these companies from user_onboarding
          // CRITICAL: Filter by user_id to ensure we only get countries for this user's companies
          let countriesMap = new Map<string, string | null>();
          if (companyIds.length > 0) {
            const { data: countriesData, error: countriesError } = await supabase
              .from('user_onboarding')
              .select('company_id, country')
              .eq('user_id', user.id) // CRITICAL: Filter by user_id to prevent seeing other users' data
              .in('company_id', companyIds)
              .not('company_id', 'is', null)
              .order('created_at', { ascending: false });

            if (countriesError) {
              console.error('🔍 Error fetching fallback company countries:', countriesError);
            } else if (countriesData) {
              // Use the most recent onboarding record for each company
              countriesMap = countriesData.reduce((map, row) => {
                if (row.company_id && !map.has(row.company_id)) {
                  map.set(row.company_id, row.country || null);
                }
                return map;
              }, new Map<string, string | null>());
            }
          }

          const companiesMap = new Map<string, any>(
            (companiesData || []).map(c => {
              const industriesSet = industriesMap.get(c.id) || new Set<string>();
              if (c.industry) {
                industriesSet.add(c.industry);
              }
              const country = countriesMap.get(c.id) || null;
              return [c.id, { ...c, industries: Array.from(industriesSet), country }];
            })
          );

          const companies = oldMemberships.map(m => {
            const company = companiesMap.get(m.company_id);
            if (!company) return null;
            return {
              ...company,
              is_default: m.is_default
            };
          }).filter(Boolean) as Company[];

          setUserCompanies(companies);
          setUserMemberships(oldMemberships.map(m => ({
            ...m,
            company: companiesMap.get(m.company_id)
          })));

          // Only set current company if none is selected or current company is no longer valid
          setCurrentCompany(prevCurrent => {
            if (!prevCurrent) {
              // No current company, set to default or first
              const defaultCompany = companies.find(c => c.is_default) || companies[0];
              if (defaultCompany) {
                console.log('🔍 Setting initial current company (fallback):', defaultCompany.name);
                return defaultCompany;
              }
              return null;
            } else {
              // Check if current company is still valid
              const stillValid = companies.find(c => c.id === prevCurrent.id);
              if (stillValid) {
                console.log('🔍 Current company still valid (fallback), keeping:', prevCurrent.name);
                return prevCurrent;
              } else {
                // Current company no longer valid, set to default or first
                const defaultCompany = companies.find(c => c.is_default) || companies[0];
                if (defaultCompany) {
                  console.log('🔍 Current company no longer valid (fallback), switching to:', defaultCompany.name);
                  return defaultCompany;
                }
                return null;
              }
            }
          });
        } else {
          // No companies found - check if user needs to complete onboarding
          console.log('🔍 No companies found, checking onboarding data...');
          
          const { data: onboardingData } = await supabase
            .from('user_onboarding')
            .select('organization_name, company_name, industry, company_size, competitors')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (onboardingData?.company_name && onboardingData?.industry) {
            // Don't auto-create here, let the user know they need to complete onboarding
            setCurrentCompany(null);
            setUserCompanies([]);
            setUserMemberships([]);
          } else {
            setCurrentCompany(null);
            setUserCompanies([]);
            setUserMemberships([]);
          }
        }
      }

    } catch (error) {
      console.error('Error fetching user companies:', error);
      toast.error('Failed to load companies');
      setCurrentCompany(null);
      setUserCompanies([]);
      setUserMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // CRITICAL: Clear state immediately when user changes to prevent stale data
  useEffect(() => {
    if (!user && !authLoading) {
      // User logged out or auth cleared - immediately clear all company data
      setCurrentCompany(null);
      setUserCompanies([]);
      setUserMemberships([]);
      setLoading(false);
      // Reset refs so next login triggers a fresh fetch
      userLoadedRef.current = null;
      isInitialLoadRef.current = true;
    }
  }, [user?.id, authLoading]); // Only depend on user.id, not entire user object

  // Load companies when user changes or auth finishes loading
  // Use refs to track if we've already loaded for this user to prevent refetches when returning to tab
  const userLoadedRef = useRef<string | null>(null);
  const isInitialLoadRef = useRef(true);
  
  useEffect(() => {
    // Only fetch if auth is fully loaded and user exists
    if (!authLoading) {
      const currentUserId = user?.id || null;
      
      // Only fetch if:
      // 1. This is the initial load (isInitialLoadRef.current === true), OR
      // 2. User ID has actually changed (different user logged in)
      if (isInitialLoadRef.current || (currentUserId && userLoadedRef.current !== currentUserId)) {
        isInitialLoadRef.current = false;
        if (currentUserId) {
          userLoadedRef.current = currentUserId;
        }
        fetchUserCompanies();
      }
    }
  }, [fetchUserCompanies, authLoading, user?.id]); // Only depend on user.id, not entire user object

  const switchCompany = useCallback(async (companyId: string) => {
    console.log('🔍 switchCompany called with ID:', companyId);
    console.log('🔍 Current userCompanies:', userCompanies.map(c => ({ id: c.id, name: c.name })));
    
    let company = userCompanies.find(c => c.id === companyId);
    
    // If company not found in current list, refresh companies first
    if (!company) {
      console.log('🔍 Company not found in current list, refreshing companies...');
      await fetchUserCompanies();
      
      // For admins, fetch all companies directly
      const isAdmin = user && isAdminUser(user.email);
      if (isAdmin) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('id, name, industry, company_size, competitors, settings, created_at, updated_at, created_by')
          .eq('id', companyId)
          .single();
        
        if (companyData) {
          // Fetch additional data
          const { data: industriesData } = await supabase
            .from('company_industries')
            .select('industry')
            .eq('company_id', companyId);
          
          const industries = new Set<string>();
          if (companyData.industry) industries.add(companyData.industry);
          if (industriesData) {
            industriesData.forEach(row => industries.add(row.industry));
          }
          
          const { data: orgCompany } = await supabase
            .from('organization_companies')
            .select('organization_id, organizations(name)')
            .eq('company_id', companyId)
            .maybeSingle();
          
          const org = Array.isArray(orgCompany?.organizations) 
            ? orgCompany?.organizations[0] 
            : orgCompany?.organizations;
          
          const { data: companyMember } = await supabase
            .from('company_members')
            .select('is_default')
            .eq('user_id', user.id)
            .eq('company_id', companyId)
            .maybeSingle();
          
          company = {
            ...companyData,
            organization_id: orgCompany?.organization_id,
            is_default: companyMember?.is_default || false,
            industries: Array.from(industries),
            country: null
          };
        }
      } else {
        // Non-admin: fetch through organization memberships
        const { data: freshCompanies } = await supabase
          .from('organization_members')
          .select(`
            organization_id,
            role,
            is_default,
            organizations!inner(
              id,
              name
            )
          `)
          .eq('user_id', user?.id);

        if (freshCompanies && freshCompanies.length > 0) {
          // Get companies for the organizations
          const companies: Company[] = [];
          for (const orgMembership of freshCompanies) {
            const org = Array.isArray(orgMembership.organizations) 
              ? orgMembership.organizations[0] 
              : orgMembership.organizations;
            
            const { data: orgCompanies } = await supabase
              .from('organization_companies')
              .select('company_id')
              .eq('organization_id', orgMembership.organization_id);

            if (orgCompanies && orgCompanies.length > 0) {
              // Fetch company details separately
              const companyIds = orgCompanies.map(oc => oc.company_id);
              const { data: companiesData } = await supabase
                .from('companies')
                .select('id, name, industry, company_size, competitors, settings, created_at, updated_at, created_by')
                .in('id', companyIds);

              // Fetch countries for these companies
              // CRITICAL: Filter by user_id to ensure we only get countries for this user's companies
              let countriesMap = new Map<string, string | null>();
              if (companyIds.length > 0) {
                const { data: countriesData } = await supabase
                  .from('user_onboarding')
                  .select('company_id, country')
                  .eq('user_id', user.id) // CRITICAL: Filter by user_id to prevent seeing other users' data
                  .in('company_id', companyIds)
                  .not('company_id', 'is', null)
                  .order('created_at', { ascending: false });

                if (countriesData) {
                  countriesMap = countriesData.reduce((map, row) => {
                    if (row.company_id && !map.has(row.company_id)) {
                      map.set(row.company_id, row.country || null);
                    }
                    return map;
                  }, new Map<string, string | null>());
                }
              }

              for (const companyData of companiesData || []) {
                if (companyData) {
                  // Fetch the actual is_default from company_members table
                  // Use maybeSingle() instead of single() to handle cases where no row exists
                  const { data: companyMember } = await supabase
                    .from('company_members')
                    .select('is_default')
                    .eq('user_id', user.id)
                    .eq('company_id', companyData.id)
                    .maybeSingle();

                  const isDefault = companyMember?.is_default || false;
                  const country = countriesMap.get(companyData.id) || null;

                  companies.push({
                    ...companyData,
                    organization_id: org.id,
                    is_default: isDefault,
                    country
                  });
                }
              }
            }
          }
          
          company = companies.find(c => c.id === companyId);
          console.log('🔍 After refresh, company found:', !!company);
        }
      }
    }
    
    if (company) {
      console.log('🔍 Switching to company:', company.id, company.name);
      setCurrentCompany(company);
    } else {
      console.error('🔍 Company not found after refresh:', companyId);
      console.error('🔍 Available companies:', userCompanies.map(c => c.id));
      toast.error('Company not found');
    }
  }, [userCompanies, fetchUserCompanies, user?.id]);

  const refreshCompanies = useCallback(async () => {
    await fetchUserCompanies();
  }, [fetchUserCompanies]);

  const setAsDefaultCompany = useCallback(async (companyId: string) => {
    try {
      // Update the default company in company_members table
      const company = userCompanies.find(c => c.id === companyId);
      if (!company) {
        toast.error('Company not found');
        return;
      }

      // First, unset all other defaults for this user in company_members
      await supabase
        .from('company_members')
        .update({ is_default: false })
        .eq('user_id', user?.id);

      // Set this company as default in company_members
      await supabase
        .from('company_members')
        .update({ is_default: true })
        .eq('user_id', user?.id)
        .eq('company_id', companyId);

      // Refresh companies to update the UI
      await refreshCompanies();
      toast.success('Default company updated');
    } catch (error) {
      console.error('Error setting default company:', error);
      toast.error('Failed to update default company');
    }
  }, [userCompanies, user?.id, refreshCompanies]);

  const isOwnerOrAdmin = useMemo(() => {
    // Admins always have admin access
    if (user && isAdminUser(user.email)) {
      return true;
    }
    if (!currentCompany) return false;
    const membership = userMemberships.find(m => m.company_id === currentCompany.id);
    return membership?.role === 'owner' || membership?.role === 'admin';
  }, [currentCompany, userMemberships, user]);

  const value: CompanyContextType = {
    currentCompany,
    userCompanies,
    userMemberships,
    loading,
    switchCompany,
    refreshCompanies,
    setAsDefaultCompany,
    isOwnerOrAdmin
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
};