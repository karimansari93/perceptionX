import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';

export interface Company {
  id: string;
  name: string;
  industry: string;
  company_size: string | null;
  competitors: string[];
  settings: any;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  is_default?: boolean;
  organization_id?: string;
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

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [currentCompany, setCurrentCompany] = useState<Company | null>(null);
  const [userCompanies, setUserCompanies] = useState<Company[]>([]);
  const [userMemberships, setUserMemberships] = useState<CompanyMembership[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch user's companies through organization membership
  const fetchUserCompanies = useCallback(async () => {
    if (!user) {
      setCurrentCompany(null);
      setUserCompanies([]);
      setUserMemberships([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

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
          
          // Fetch companies for this organization
          const { data: orgCompanies, error: companiesError } = await supabase
            .from('organization_companies')
            .select(`
              company_id,
              companies(
                id,
                name,
                industry,
                company_size,
                competitors,
                settings,
                created_at,
                updated_at,
                created_by
              )
            `)
            .eq('organization_id', orgMembership.organization_id);

          if (companiesError) {
            console.error('🔍 Error fetching companies for org:', companiesError);
            continue;
          }

          if (orgCompanies) {
            for (const orgCompany of orgCompanies) {
              const company = Array.isArray(orgCompany.companies) 
                ? orgCompany.companies[0] 
                : orgCompany.companies;
              if (company) {
                // Fetch the actual is_default from company_members table
                const { data: companyMember, error: memberError } = await supabase
                  .from('company_members')
                  .select('is_default, role, joined_at')
                  .eq('user_id', user.id)
                  .eq('company_id', company.id)
                  .single();

                const isDefault = companyMember?.is_default || false;
                const memberRole = companyMember?.role || orgMembership.role;
                const joinedAt = companyMember?.joined_at || new Date().toISOString();

                companies.push({
                  ...company,
                  organization_id: org.id,
                  is_default: isDefault
                });

                memberships.push({
                  id: `${orgMembership.organization_id}-${company.id}`,
                  user_id: user.id,
                  company_id: company.id,
                  role: memberRole as 'owner' | 'admin' | 'member',
                  is_default: isDefault,
                  joined_at: joinedAt,
                  invited_by: null,
                  company: {
                    ...company,
                    organization_id: org.id,
                    is_default: isDefault
                  }
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
          .select(`
            *,
            company:companies(*)
          `)
          .eq('user_id', user.id)
          .order('joined_at', { ascending: true });

        if (oldError) {
          console.error('🔍 Error fetching old memberships:', oldError);
          throw oldError;
        }

        if (oldMemberships && oldMemberships.length > 0) {
          const companies = oldMemberships.map(m => ({
            ...m.company,
            is_default: m.is_default
          }));

          setUserCompanies(companies);
          setUserMemberships(oldMemberships);

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

  // Load companies when user changes
  useEffect(() => {
    fetchUserCompanies();
  }, [fetchUserCompanies]);

  const switchCompany = useCallback(async (companyId: string) => {
    console.log('🔍 switchCompany called with ID:', companyId);
    console.log('🔍 Current userCompanies:', userCompanies.map(c => ({ id: c.id, name: c.name })));
    
    let company = userCompanies.find(c => c.id === companyId);
    
    // If company not found in current list, refresh companies first
    if (!company) {
      console.log('🔍 Company not found in current list, refreshing companies...');
      await fetchUserCompanies();
      
      // Wait for state to update, then get the fresh companies list
      // We need to fetch the companies again since state updates are async
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
            .select(`
              company_id,
              companies(
                id,
                name,
                industry,
                company_size,
                competitors,
                settings,
                created_at,
                updated_at,
                created_by
              )
            `)
            .eq('organization_id', orgMembership.organization_id);

          if (orgCompanies) {
            for (const orgCompany of orgCompanies) {
              const companyData = Array.isArray(orgCompany.companies) 
                ? orgCompany.companies[0] 
                : orgCompany.companies;
              if (companyData) {
                // Fetch the actual is_default from company_members table
                const { data: companyMember } = await supabase
                  .from('company_members')
                  .select('is_default')
                  .eq('user_id', user.id)
                  .eq('company_id', companyData.id)
                  .single();

                const isDefault = companyMember?.is_default || false;

                companies.push({
                  ...companyData,
                  organization_id: org.id,
                  is_default: isDefault
                });
              }
            }
          }
        }
        
        company = companies.find(c => c.id === companyId);
        console.log('🔍 After refresh, company found:', !!company);
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
    if (!currentCompany) return false;
    const membership = userMemberships.find(m => m.company_id === currentCompany.id);
    return membership?.role === 'owner' || membership?.role === 'admin';
  }, [currentCompany, userMemberships]);

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