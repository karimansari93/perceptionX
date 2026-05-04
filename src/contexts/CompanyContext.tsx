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
      // Clear stale state BEFORE fetching. Without this, if a previous user
      // (especially an admin with every-company access) was just logged in,
      // `userCompanies` would still hold their data while this async fetch
      // runs — exposing other tenants' names/locations in dropdowns during
      // the window. Context consumers see [] instead until the new fetch
      // resolves.
      setCurrentCompany(null);
      setUserCompanies([]);
      setUserMemberships([]);
      setLoading(true);

      // Check if user is admin - admins see ALL companies
      const isAdmin = isAdminUser(user.email);
      
      if (isAdmin) {
        // Fetch ALL companies for admin
        const { data: allCompanies, error: allCompaniesError } = await supabase
          .from('companies')
          .select('id, name, industry, country, company_size, competitors, settings, created_at, updated_at, created_by')
          .order('created_at', { ascending: false });

        if (allCompaniesError) {
          console.error('🔍 Error fetching all companies for admin:', allCompaniesError);
          throw allCompaniesError;
        }

        if (allCompanies && allCompanies.length > 0) {
          const companyIds = allCompanies.map(c => c.id);
          
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
            const orgInfo = orgMap.get(company.id);

            // company_members has been retired — defaults / role come from
            // organization_members or sensible fallbacks.
            const isDefault = false;
            const memberRole: 'owner' | 'admin' | 'member' = 'admin';
            const joinedAt = new Date().toISOString();

            const companyWithData = {
              ...company,
              organization_id: orgInfo?.id,
              is_default: isDefault,
              industries,
              country: company.country ?? null,
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

          setUserCompanies(companies);
          setUserMemberships(memberships);

          // Set current company if none is selected
          setCurrentCompany(prevCurrent => {
            if (!prevCurrent) {
              const defaultCompany = companies.find(c => c.is_default) || companies[0];
              if (defaultCompany) {
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
              .select('id, name, industry, country, company_size, competitors, settings, created_at, updated_at, created_by')
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

            for (const company of companiesData || []) {
              if (company) {
                // Fetch the actual is_default from company_members table
                // company_members retired — role/is_default come from organization_members.
                const isDefault = false;
                const memberRole = orgMembership.role;
                const joinedAt = new Date().toISOString();

                const industriesSet = industriesMap.get(company.id) || new Set<string>();
                if (company.industry) {
                  industriesSet.add(company.industry);
                }

                const industries = Array.from(industriesSet);

                const companyWithIndustries = {
                  ...company,
                  organization_id: org.id,
                  is_default: isDefault,
                  industries,
                  country: company.country ?? null,
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

        setUserCompanies(companies);
        setUserMemberships(memberships);

        // Only set current company if none is selected or current company is no longer valid
        setCurrentCompany(prevCurrent => {
          if (!prevCurrent) {
            // No current company, set to default or first
            const defaultCompany = companies.find(c => c.is_default) || companies[0];
            if (defaultCompany) {
              return defaultCompany;
            } else {
              return null;
            }
          } else {
            // Check if current company is still valid
            const stillValid = companies.find(c => c.id === prevCurrent.id);
            if (stillValid) {
              return prevCurrent;
            } else {
              // Current company no longer valid, set to default or first
              const defaultCompany = companies.find(c => c.is_default) || companies[0];
              if (defaultCompany) {
                return defaultCompany;
              } else {
                return null;
              }
            }
          }
        });
      } else {
        // No org memberships → user has no access to any company yet.
        // Admin must add them to an organization in the admin panel.
        setCurrentCompany(null);
        setUserCompanies([]);
        setUserMemberships([]);
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

  // CRITICAL: Clear state on ANY user identity change — not just logout.
  //
  // Previously this only fired on `!user` (logout). That missed the
  // admin → non-admin account switch case (e.g. karim signs out, rajiv signs
  // in on the same browser): between `user.id` changing and the new fetch
  // resolving, React state still held karim's admin-scoped
  // `userCompanies` — which for admins is EVERY company in the DB. Any
  // consumer reading the context in that window saw cross-tenant data.
  //
  // Fix: every time `user.id` changes, immediately wipe all company state.
  // The fetch effect below will repopulate with the correct user's data.
  const userLoadedRef = useRef<string | null>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (authLoading) return;

    const currentUserId = user?.id || null;

    // On any transition (logout, login, or user swap), drop state so no
    // rendered consumer can read stale data while the next fetch is pending.
    if (userLoadedRef.current !== currentUserId) {
      setCurrentCompany(null);
      setUserCompanies([]);
      setUserMemberships([]);
      // Reset refs so initial load logic re-runs on next fetch.
      if (!currentUserId) {
        setLoading(false);
        userLoadedRef.current = null;
        isInitialLoadRef.current = true;
      }
    }
  }, [user?.id, authLoading]);

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
    let company = userCompanies.find(c => c.id === companyId);
    
    // If company not found in current list, refresh companies first
    if (!company) {
      await fetchUserCompanies();
      
      // For admins, fetch all companies directly
      const isAdmin = user && isAdminUser(user.email);
      if (isAdmin) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('id, name, industry, country, company_size, competitors, settings, created_at, updated_at, created_by')
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
          
          company = {
            ...companyData,
            organization_id: orgCompany?.organization_id,
            is_default: false,
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
                .select('id, name, industry, country, company_size, competitors, settings, created_at, updated_at, created_by')
                .in('id', companyIds);

              for (const companyData of companiesData || []) {
                if (companyData) {
                  companies.push({
                    ...companyData,
                    organization_id: org.id,
                    is_default: false,
                    country: companyData.country ?? null,
                  });
                }
              }
            }
          }
          
          company = companies.find(c => c.id === companyId);
        }
      }
    }
    
    if (company) {
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
    // Per-user default-company tracking has been retired along with
    // company_members. Switching company is handled via switchCompany;
    // there's no persisted default. Keep this as a no-op so existing
    // call sites don't break.
    const company = userCompanies.find(c => c.id === companyId);
    if (!company) {
      toast.error('Company not found');
      return;
    }
  }, [userCompanies]);

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