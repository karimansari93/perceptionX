import { useState, useEffect, useRef } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building2, Plus, RefreshCw, Pencil, Briefcase, Calendar, ArrowRight, Play, Loader2, XCircle } from 'lucide-react';
import { CompanyDetailView } from './CompanyDetailView';
import { CompanyGroupDetailView } from './CompanyGroupDetailView';
import { useAdminCompanyCollection } from '@/hooks/useAdminCompanyCollection';
import { coverageLabel } from '@/utils/collectionCoverage';

interface Organization {
  id: string;
  name: string;
}

interface Company {
  id: string;
  name: string;
  industry: string;
  industries: string[];
  created_at: string;
  organization_id: string;
  organization_name: string;
  last_updated: string | null;
  country: string | null;
  /** All countries from user_onboarding for this company */
  countries: string[];
  data_collection_status?: string | null;
  prompt_count: number;
  response_count: number;
  /** Number of active prompts that have 5 model responses each (used for accurate Completed badge) */
  prompts_with_full_coverage: number;
}

/** Group of companies with same name in same org - one row in the list */
interface CompanyGroup {
  name: string;
  organization_id: string;
  organization_name: string;
  industries: string[];
  companies: Company[];
  /** Unique countries across all companies in group */
  countries: string[];
  /** Summary: e.g. "2/3 Completed" when 2 of 3 locations are complete */
  statusSummary: { completed: number; total: number; inProgress: number; pending: number };
}

export const CompanyManagementTab = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);
  const [filteredGroups, setFilteredGroups] = useState<CompanyGroup[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Company detail view - group view shows countries; single company for drill-down
  const [selectedGroup, setSelectedGroup] = useState<CompanyGroup | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Form data
  const [companyName, setCompanyName] = useState('');
  const [companyIndustry, setCompanyIndustry] = useState('');
  const [companyOrgId, setCompanyOrgId] = useState('');
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  
  // Refresh modal state
  const [confirmationData, setConfirmationData] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { runContinueCollection, isRunning: isCollectionRunning } = useAdminCompanyCollection();
  const [continueCollectionCompanyId, setContinueCollectionCompanyId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Server-side search with debouncing
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If search query exists and is long enough, use server-side search
    if (searchQuery && searchQuery.trim().length >= 2) {
      setSearchLoading(true);
      
      // Debounce search by 300ms
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const { data, error } = await supabase.functions.invoke('search-companies', {
            body: {
              searchTerm: searchQuery.trim(),
              limit: 100,
              offset: 0,
              userId: userData.user?.id
            }
          });

          if (error) throw error;

          if (data?.companies) {
            // Apply organization filter client-side (since search doesn't support it yet)
            let filtered = data.companies;
            if (selectedOrg && selectedOrg !== 'all') {
              filtered = filtered.filter((c: any) => c.organization_id === selectedOrg);
            }
            // Enrich with countries array (search returns single country; use as countries for grouping).
            // Use last_updated when present, else updated_at so "Last Updated" column shows a date instead of "Never".
            const enriched = filtered.map((c: any) => ({
              ...c,
              countries: c.country ? [c.country] : [],
              last_updated: c.last_updated ?? c.updated_at ?? null,
            }));
            setFilteredCompanies(enriched);
            setFilteredGroups(buildCompanyGroups(enriched));
          }
        } catch (error) {
          console.error('Error searching companies:', error);
          // Fallback to client-side filtering
          filterCompanies();
        } finally {
          setSearchLoading(false);
        }
      }, 300);
    } else {
      // No search query or too short - use client-side filtering on all companies
      filterCompanies();
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, selectedOrg, companies]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load organizations
      const { data: orgsData, error: orgsError } = await supabase
        .from('organizations')
        .select('id, name')
        .order('name', { ascending: true });

      if (orgsError) throw orgsError;
      setOrganizations(orgsData || []);

      // Load industries from user_onboarding
      const { data: industriesData, error: industriesError } = await supabase
        .from('user_onboarding')
        .select('industry');

      if (!industriesError && industriesData) {
        const uniqueIndustries = [...new Set(industriesData.map(item => item.industry).filter(Boolean))];
        uniqueIndustries.sort();
        setIndustries(uniqueIndustries);
      } else {
        // Fallback industries
        setIndustries(['Technology', 'Healthcare', 'Finance', 'Other']);
      }

      // Load companies
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select(`
          *,
          organization_companies!inner(
            organization_id,
            organizations!inner(name)
          )
        `)
        .order('created_at', { ascending: false });

      if (companiesError) throw companiesError;

      const companiesWithOrg = (companiesData || []).map(company => ({
        ...company,
        organization_id: company.organization_companies[0]?.organization_id,
        organization_name: company.organization_companies[0]?.organizations?.name || 'Unknown',
        last_updated: company.last_updated ?? (company as { updated_at?: string }).updated_at ?? null,
        country: null as string | null,
        countries: [] as string[],
        industries: [] as string[],
        data_collection_status: (company as { data_collection_status?: string | null }).data_collection_status ?? undefined,
        prompt_count: 0,
        response_count: 0,
        prompts_with_full_coverage: 0,
      }));

      const companyIds = companiesWithOrg.map(c => c.id);
      if (companyIds.length > 0) {
        const [countriesRes, industriesRes, promptsRes, responsesRes] = await Promise.all([
          supabase
            .from('user_onboarding')
            .select('company_id, country')
            .in('company_id', companyIds)
            .not('company_id', 'is', null)
            .order('created_at', { ascending: false }),
          supabase.from('company_industries').select('company_id, industry').in('company_id', companyIds),
          supabase
            .from('confirmed_prompts')
            .select('company_id, id')
            .eq('is_active', true)
            .in('company_id', companyIds),
          supabase.from('prompt_responses').select('company_id, confirmed_prompt_id').in('company_id', companyIds),
        ]);

        const countriesMap = new Map<string, string[]>();
        (countriesRes.data || []).forEach(row => {
          if (row.company_id) {
            const arr = countriesMap.get(row.company_id) || [];
            const c = row.country || null;
            if (c && !arr.includes(c)) arr.push(c);
            countriesMap.set(row.company_id, arr);
          }
        });

        const industriesMap = new Map<string, Set<string>>();
        (industriesRes.data || []).forEach(row => {
          if (!industriesMap.has(row.company_id)) industriesMap.set(row.company_id, new Set());
          industriesMap.get(row.company_id)!.add(row.industry);
        });

        const promptCountByCompany = new Map<string, number>();
        const promptIdsByCompany = new Map<string, Set<string>>();
        (promptsRes.data || []).forEach(row => {
          if (row.company_id) {
            promptCountByCompany.set(row.company_id, (promptCountByCompany.get(row.company_id) ?? 0) + 1);
            if (row.id) {
              if (!promptIdsByCompany.has(row.company_id)) promptIdsByCompany.set(row.company_id, new Set());
              promptIdsByCompany.get(row.company_id)!.add(row.id);
            }
          }
        });
        const responseCountByCompany = new Map<string, number>();
        const responseCountByPrompt = new Map<string, number>();
        (responsesRes.data || []).forEach(row => {
          if (row.company_id) {
            responseCountByCompany.set(row.company_id, (responseCountByCompany.get(row.company_id) ?? 0) + 1);
            if (row.confirmed_prompt_id) {
              const key = `${row.company_id}:${row.confirmed_prompt_id}`;
              responseCountByPrompt.set(key, (responseCountByPrompt.get(key) ?? 0) + 1);
            }
          }
        });

        const EXPECTED_MODELS = 5;
        const promptsWithFullCoverageByCompany = new Map<string, number>();
        promptIdsByCompany.forEach((promptIds, companyId) => {
          let full = 0;
          promptIds.forEach(pid => {
            if ((responseCountByPrompt.get(`${companyId}:${pid}`) ?? 0) >= EXPECTED_MODELS) full++;
          });
          promptsWithFullCoverageByCompany.set(companyId, full);
        });

        companiesWithOrg.forEach(company => {
          const countriesList = countriesMap.get(company.id) || [];
          company.countries = countriesList;
          company.country = countriesList[0] || null;
          const indSet = industriesMap.get(company.id);
          company.industries = indSet ? Array.from(indSet) : (company.industry ? [company.industry] : []);
          company.prompt_count = promptCountByCompany.get(company.id) ?? 0;
          company.response_count = responseCountByCompany.get(company.id) ?? 0;
          company.prompts_with_full_coverage = promptsWithFullCoverageByCompany.get(company.id) ?? 0;
        });
      }

      setCompanies(companiesWithOrg);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  /** Build company groups: same name + same org = one group */
  const buildCompanyGroups = (list: Company[]): CompanyGroup[] => {
    const byKey = new Map<string, Company[]>();
    for (const c of list) {
      const key = `${c.name.toLowerCase().trim()}::${c.organization_id}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(c);
    }
    return Array.from(byKey.entries()).map(([, companies]) => {
      const allCountries = [...new Set(companies.flatMap(c => c.countries || (c.country ? [c.country] : [])))];
      const industries = [...new Set(companies.flatMap(c => c.industries?.length ? c.industries : (c.industry ? [c.industry] : [])))];
      let completed = 0, inProgress = 0, pending = 0;
      companies.forEach(c => {
        const status = c.data_collection_status ?? null;
        const promptCount = c.prompt_count ?? 0;
        const fullCoverage = c.prompts_with_full_coverage ?? 0;
        if (status === 'collecting_search_insights' || status === 'collecting_llm_data') inProgress++;
        else if (promptCount > 0 && fullCoverage === promptCount) completed++;
        else pending++;
      });
      return {
        name: companies[0].name,
        organization_id: companies[0].organization_id,
        organization_name: companies[0].organization_name,
        industries,
        companies: companies.sort((a, b) => (a.country || 'zzz').localeCompare(b.country || 'zzz')),
        countries: allCountries.sort(),
        statusSummary: { completed, total: companies.length, inProgress, pending },
      };
    });
  };

  const filterCompanies = () => {
    let filtered = companies;

    // Filter by organization
    if (selectedOrg && selectedOrg !== 'all') {
      filtered = filtered.filter(c => c.organization_id === selectedOrg);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.industry.toLowerCase().includes(query) ||
        (c.industries && c.industries.some(ind => ind.toLowerCase().includes(query))) ||
        c.organization_name.toLowerCase().includes(query) ||
        (c.country && c.country.toLowerCase().includes(query)) ||
        (c.countries && c.countries.some(ct => ct.toLowerCase().includes(query)))
      );
    }

    setFilteredCompanies(filtered);
    setFilteredGroups(buildCompanyGroups(filtered));
  };

  const handleCreateCompany = async () => {
    if (!companyName.trim() || !companyIndustry || !companyOrgId) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCreating(true);
    try {
      // Create company
      const { data: newCompany, error: companyError } = await supabase
        .from('companies')
        .insert({
          name: companyName,
          industry: companyIndustry
        })
        .select()
        .single();

      if (companyError) throw companyError;

      // Link to organization
      const { error: linkError } = await supabase
        .from('organization_companies')
        .insert({
          organization_id: companyOrgId,
          company_id: newCompany.id
        });

      if (linkError) throw linkError;

      toast.success('Company created successfully');
      setShowCreateModal(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Error creating company:', error);
      toast.error('Failed to create company');
    } finally {
      setCreating(false);
    }
  };

  const handleEditCompany = (company: Company) => {
    setEditingCompany(company);
    setCompanyName(company.name);
    setCompanyIndustry(company.industry);
    setShowEditModal(true);
  };

  const handleUpdateCompany = async () => {
    if (!editingCompany || !companyName.trim() || !companyIndustry) {
      toast.error('Please fill in all required fields');
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          name: companyName,
          industry: companyIndustry
        })
        .eq('id', editingCompany.id);

      if (error) throw error;

      toast.success('Company updated successfully');
      setShowEditModal(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Error updating company:', error);
      toast.error('Failed to update company');
    } finally {
      setUpdating(false);
    }
  };

  const prepareRefreshForCompany = async (companyId: string) => {
    try {
      console.log('Preparing refresh for company:', companyId);
      
      // Get company and organization details
      const company = companies.find(c => c.id === companyId);
      if (!company) {
        console.error('Company not found in companies array');
        toast.error('Company not found');
        return;
      }
      console.log('Company found:', company.name, 'Org ID:', company.organization_id);

      // Get organization owner to determine subscription type
      // Fetch organization_members first
      console.log('Fetching organization members...');
      const { data: orgMember, error: orgMemberError } = await supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', company.organization_id)
        .eq('role', 'owner')
        .limit(1)
        .single();

      if (orgMemberError) {
        console.error('Organization member error:', orgMemberError);
        throw orgMemberError;
      }
      console.log('Org member found:', orgMember);

      // Then fetch profile data separately to avoid RLS issues
      console.log('Fetching profile data...');
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('email, subscription_type')
        .eq('id', orgMember.user_id)
        .single();

      if (profileError) {
        console.error('Profile error:', profileError);
        throw profileError;
      }
      console.log('Profile data:', profileData);

      const isProUser = profileData?.subscription_type === 'pro';
      const userEmail = profileData?.email || 'admin@perceptionx.ai';

      // Fetch prompts for this specific company
      console.log('Fetching prompts for company...');
      const { data: allPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('is_active', true)
        .eq('company_id', companyId);

      if (promptsError) {
        console.error('Prompts error:', promptsError);
        throw promptsError;
      }
      console.log('Prompts fetched:', allPrompts?.length);

      // Separate regular and TalentX prompts
      const regularPrompts = allPrompts?.filter(p => !p.is_pro_prompt) || [];
      const talentXPrompts = allPrompts?.filter(p => p.is_pro_prompt) || [];
      console.log('Regular prompts:', regularPrompts.length, 'TalentX prompts:', talentXPrompts.length);

      const totalPrompts = (allPrompts?.length || 0);
      if (totalPrompts === 0) {
        toast.error('No active prompts found for this company');
        return;
      }

      // Define models based on subscription type
      const freeModels = [
        { name: 'openai', fn: 'test-prompt-openai' },
        { name: 'perplexity', fn: 'test-prompt-perplexity' },
        { name: 'google-ai-overviews', fn: 'test-prompt-google-ai-overviews' },
      ];

      const proModels = [
        { name: 'openai', fn: 'test-prompt-openai' },
        { name: 'perplexity', fn: 'test-prompt-perplexity' },
        { name: 'gemini', fn: 'test-prompt-gemini' },
        { name: 'deepseek', fn: 'test-prompt-deepseek' },
        { name: 'google-ai-overviews', fn: 'test-prompt-google-ai-overviews' },
      ];

      const models = isProUser ? proModels : freeModels;
      console.log('Models available:', models.length, 'Is Pro:', isProUser);

      // Get all unique prompt types
      const allPromptTypes = Array.from(new Set([
        ...regularPrompts.map(p => p.prompt_type),
        ...talentXPrompts.map(p => p.prompt_type)
      ])).sort();
      console.log('All prompt types:', allPromptTypes);

      // Get all unique prompt category/theme pairs (prompt_theme defaults to 'General' if null)
      const categoryThemePairs = [
        ...regularPrompts.map((p: any) => ({
          category: p.prompt_category || 'General',
          theme: p.prompt_theme || 'General'
        })),
        ...talentXPrompts.map((p: any) => ({
          category: p.prompt_category || 'General',
          theme: p.prompt_theme || 'General'
        }))
      ];
      const uniquePairs = Array.from(
        new Map(categoryThemePairs.map(p => [`${p.category}|${p.theme}`, p])).values()
      ).sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category);
        return catCmp !== 0 ? catCmp : a.theme.localeCompare(b.theme);
      });
      const allPromptCategoryThemes = uniquePairs;
      console.log('All prompt category/themes:', allPromptCategoryThemes);

      const totalOperations = totalPrompts * models.length;
      console.log('Total operations:', totalOperations);

      // Show confirmation modal
      console.log('Setting confirmation data...');
      const confirmData = {
        companyId,
        companyName: company.name,
        userEmail,
        isProUser,
        regularPrompts,
        talentXPrompts,
        models,
        selectedModels: models,
        allPromptTypes,
        selectedPromptTypes: allPromptTypes,
        allPromptCategoryThemes,
        selectedPromptCategoryThemes: allPromptCategoryThemes,
        totalOperations
      };
      console.log('Confirmation data:', confirmData);
      setConfirmationData(confirmData);
      console.log('Confirmation data set! Modal should appear.');

    } catch (e: any) {
      console.error('Error preparing company refresh:', e);
      console.error('Error details:', JSON.stringify(e, null, 2));
      toast.error(`Failed to prepare refresh data: ${e.message || 'Unknown error'}`);
    }
  };

  const toggleModelSelection = (modelName: string) => {
    if (!confirmationData) return;
    
    const isSelected = confirmationData.selectedModels.some((m: any) => m.name === modelName);
    const newSelectedModels = isSelected
      ? confirmationData.selectedModels.filter((m: any) => m.name !== modelName)
      : [...confirmationData.selectedModels, confirmationData.models.find((m: any) => m.name === modelName)];
    
    updateTotalOperations({ ...confirmationData, selectedModels: newSelectedModels });
  };

  const togglePromptTypeSelection = (promptType: string) => {
    if (!confirmationData) return;
    
    const isSelected = confirmationData.selectedPromptTypes.includes(promptType);
    const newSelectedTypes = isSelected
      ? confirmationData.selectedPromptTypes.filter((t: string) => t !== promptType)
      : [...confirmationData.selectedPromptTypes, promptType];
    
    updateTotalOperations({ ...confirmationData, selectedPromptTypes: newSelectedTypes });
  };

  const getCategoryThemeKey = (category: string, theme: string) => `${category}|${theme}`;

  const togglePromptCategoryThemeSelection = (category: string, theme: string) => {
    if (!confirmationData) return;
    const key = getCategoryThemeKey(category, theme);
    const current = confirmationData.selectedPromptCategoryThemes as { category: string; theme: string }[];
    const isSelected = current.some((p: { category: string; theme: string }) => getCategoryThemeKey(p.category, p.theme) === key);
    const newSelected = isSelected
      ? current.filter((p: { category: string; theme: string }) => getCategoryThemeKey(p.category, p.theme) !== key)
      : [...current, { category, theme }];
    updateTotalOperations({ ...confirmationData, selectedPromptCategoryThemes: newSelected });
  };

  const updateTotalOperations = (newData: any) => {
    const selectedSet = new Set(
      (newData.selectedPromptCategoryThemes || []).map((p: { category: string; theme: string }) =>
        getCategoryThemeKey(p.category, p.theme)
      )
    );
    const matchesPrompt = (p: any) =>
      selectedSet.has(getCategoryThemeKey(p.prompt_category || 'General', p.prompt_theme || 'General'));
    const filteredRegularPrompts = newData.regularPrompts.filter((p: any) =>
      newData.selectedPromptTypes.includes(p.prompt_type) && matchesPrompt(p)
    );
    const filteredTalentXPrompts = newData.talentXPrompts.filter((p: any) =>
      newData.selectedPromptTypes.includes(p.prompt_type) && matchesPrompt(p)
    );
    
    const totalFilteredPrompts = filteredRegularPrompts.length + filteredTalentXPrompts.length;
    const newTotalOperations = totalFilteredPrompts * newData.selectedModels.length;
    
    setConfirmationData({
      ...newData,
      totalOperations: newTotalOperations
    });
  };

  const selectAllModels = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedModels: [...confirmationData.models] });
  };

  const deselectAllModels = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedModels: [] });
  };

  const selectAllPromptTypes = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedPromptTypes: [...confirmationData.allPromptTypes] });
  };

  const deselectAllPromptTypes = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedPromptTypes: [] });
  };

  const selectAllPromptCategories = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedPromptCategoryThemes: [...confirmationData.allPromptCategoryThemes] });
  };

  const deselectAllPromptCategories = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedPromptCategoryThemes: [] });
  };

  const executeRefresh = async () => {
    if (!confirmationData || isRefreshing) return;

    if (confirmationData.selectedModels.length === 0 || confirmationData.selectedPromptTypes.length === 0 || (confirmationData.selectedPromptCategoryThemes?.length ?? 0) === 0) {
      toast.error('Please select at least one model, one prompt type, and one prompt category/theme');
      return;
    }

    setIsRefreshing(true);
    
    try {
      const { regularPrompts, talentXPrompts, selectedModels, selectedPromptTypes, selectedPromptCategoryThemes, companyId, companyName } = confirmationData;
      const selectedSet = new Set(
        (selectedPromptCategoryThemes || []).map((p: { category: string; theme: string }) => `${p.category}|${p.theme}`)
      );
      const matchesPrompt = (p: any) =>
        selectedSet.has(`${p.prompt_category || 'General'}|${p.prompt_theme || 'General'}`);
      
      // Filter prompts by selected types and category/themes
      const filteredRegularPrompts = regularPrompts.filter((p: any) =>
        selectedPromptTypes.includes(p.prompt_type) && matchesPrompt(p)
      );
      const filteredTalentXPrompts = talentXPrompts.filter((p: any) =>
        selectedPromptTypes.includes(p.prompt_type) && matchesPrompt(p)
      );
      
      // Combine all filtered prompts
      const allFilteredPrompts = [...filteredRegularPrompts, ...filteredTalentXPrompts];
      const promptIds = allFilteredPrompts.map((p: any) => p.id);
      const modelNames = selectedModels.map((m: any) => m.name);

      const totalOperations = allFilteredPrompts.length * selectedModels.length;

      toast.info(`Starting batch refresh: ${totalOperations} operations for ${companyName}`);

      // Derive unique categories for backend (promptIds are the source of truth for filtering)
      const promptCategories = [...new Set((selectedPromptCategoryThemes || []).map((p: { category: string }) => p.category))];

      // Call batch collection function
      const { data, error } = await supabase.functions.invoke('collect-company-responses', {
        body: {
          companyId,
          promptIds,
          models: modelNames,
          promptTypes: selectedPromptTypes,
          promptCategories,
          batchSize: 5,
          skipExisting: false
        }
      });

      if (error) {
        let message = error.message || 'Failed to refresh company data';
        if (error instanceof FunctionsHttpError && error.context) {
          try {
            const body = await (error.context as Response).json();
            if (body?.error) message = body.error;
          } catch {
            // ignore parse errors
          }
        }
        throw new Error(message);
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Batch refresh failed');
      }

      const { results, summary } = data;
      
      if (results.errors.length > 0) {
        console.warn('Some errors occurred during refresh:', results.errors);
        toast.warning(`Refresh completed with ${results.errors.length} errors. ${results.responsesCollected} responses collected.`);
      } else {
        toast.success(`Refresh complete! Processed ${results.promptsProcessed} prompts and collected ${results.responsesCollected} responses.`);
      }

      setConfirmationData(null);
      loadData();
    } catch (error: any) {
      console.error('Error during refresh:', error);
      toast.error(`Failed to complete refresh: ${error.message || 'Unknown error'}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const resetForm = () => {
    setCompanyName('');
    setCompanyIndustry('');
    setCompanyOrgId('');
    setEditingCompany(null);
  };

  // Render content based on state
  let content;
  
  if (loading) {
    content = (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading companies...</p>
        </div>
      </div>
    );
  } else if (selectedCompany) {
    // Drill-down: full company detail for a specific location
    content = (
      <CompanyDetailView 
        company={selectedCompany}
        onBack={() => setSelectedCompany(null)}
        onUpdate={() => {
          loadData();
          const updatedCompany = companies.find(c => c.id === selectedCompany.id);
          if (updatedCompany) setSelectedCompany(updatedCompany);
        }}
        onRefresh={prepareRefreshForCompany}
        onDelete={() => {
          loadData();
          setSelectedCompany(null);
          setSelectedGroup(null);
        }}
      />
    );
  } else if (selectedGroup) {
    // Group view: countries with collection status
    content = (
      <CompanyGroupDetailView
        group={selectedGroup}
        onBack={() => setSelectedGroup(null)}
        onSelectCompany={(c) => setSelectedCompany(c)}
        onUpdate={loadData}
        onContinueCollection={async (company) => {
          setContinueCollectionCompanyId(company.id);
          try {
            const ok = await runContinueCollection(company.id, company.organization_id, company.name);
            if (ok) loadData();
          } finally {
            setContinueCollectionCompanyId(null);
          }
        }}
        continueCollectionCompanyId={continueCollectionCompanyId}
        isCollectionRunning={isCollectionRunning}
      />
    );
  } else {
    content = (
    <div className="space-y-4">
      {/* Header - compact */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-headline font-semibold text-slate-800">Companies</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage companies and their data</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadData} variant="outline" size="sm" className="border-slate-200 text-slate-600">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateModal(true)} size="sm" className="bg-pink hover:bg-pink/90 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Add Company
          </Button>
        </div>
      </div>

      {/* Filters - compact */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardContent className="py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Search</Label>
              <div className="relative">
                <Input
                  placeholder="Search by name, industry, or organization..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="border-slate-200 h-9 text-sm"
                  disabled={searchLoading}
                />
                {searchLoading && (
                  <RefreshCw className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Organization</Label>
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger className="border-slate-200 h-9">
                  <SelectValue placeholder="All organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Organizations</SelectItem>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Companies Table - grouped by name+org */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-slate-700">
            {filteredGroups.length} {filteredGroups.length === 1 ? 'Company' : 'Companies'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-10">
              <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-700 mb-1">No companies found</p>
              <p className="text-xs text-slate-500 mb-3">
                {searchQuery || selectedOrg !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Create your first company to get started'
                }
              </p>
              {!searchQuery && selectedOrg === 'all' && (
                <Button onClick={() => setShowCreateModal(true)} size="sm" className="bg-pink hover:bg-pink/90 text-white">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Company
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Company Name</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Industries</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Countries</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organization</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Collection status</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Last Updated</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs font-medium text-slate-600">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {filteredGroups.map(group => {
                  const latestUpdated = group.companies
                    .map(c => c.last_updated)
                    .filter(Boolean)
                    .sort()
                    .pop() as string | undefined;
                  const hasInProgress = group.statusSummary.inProgress > 0;
                  const allCompleted = group.statusSummary.completed === group.statusSummary.total;
                  const statusLabel = hasInProgress
                    ? `${group.statusSummary.inProgress} collecting`
                    : allCompleted
                      ? `${group.statusSummary.completed}/${group.statusSummary.total} Completed`
                      : `${group.statusSummary.completed}/${group.statusSummary.total} done`;
                  return (
                    <TableRow key={`${group.name}-${group.organization_id}`} className="border-slate-200">
                      <TableCell className="py-2 px-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-800">{group.name}</span>
                          {group.companies.length > 1 && (
                            <Badge variant="outline" className="text-xs font-normal border-slate-200">
                              {group.companies.length} locations
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {group.industries.map(ind => (
                            <Badge key={ind} variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                              {ind}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-sm text-slate-600">
                        {group.countries.length > 0 ? group.countries.join(', ') : '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                          {group.organization_name}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge
                          variant={
                            hasInProgress ? 'secondary' :
                            allCompleted ? 'default' : 'outline'
                          }
                          className="text-xs font-normal"
                          title={`${group.statusSummary.completed} completed, ${group.statusSummary.inProgress} in progress, ${group.statusSummary.pending} pending`}
                        >
                          {statusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-slate-500">
                        {latestUpdated ? new Date(latestUpdated).toLocaleDateString() : 'Never'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-right">
                        <Button
                          onClick={() => setSelectedGroup(group)}
                          size="sm"
                          className="bg-pink hover:bg-pink/90 text-white h-7 text-xs"
                        >
                          View Details
                          <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Company Modal */}
      <Dialog open={showCreateModal} onOpenChange={(open) => {
        setShowCreateModal(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Add New Company</DialogTitle>
            <DialogDescription>Create a new company and assign it to an organization</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">Company Name *</Label>
              <Input
                placeholder="Enter company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="border-silver"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Industry *</Label>
              <Select value={companyIndustry} onValueChange={setCompanyIndustry}>
                <SelectTrigger className="border-silver">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map(industry => (
                    <SelectItem key={industry} value={industry}>{industry}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Organization *</Label>
              <Select value={companyOrgId} onValueChange={setCompanyOrgId}>
                <SelectTrigger className="border-silver">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateModal(false);
                  resetForm();
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleCreateCompany} 
                disabled={creating || !companyName.trim() || !companyIndustry || !companyOrgId}
                className="bg-pink hover:bg-pink/90"
              >
                {creating ? 'Creating...' : 'Create Company'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    );
  }

  return (
    <>
      {content}
      
      {/* Edit Company Modal */}
      <Dialog open={showEditModal} onOpenChange={(open) => {
        setShowEditModal(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Edit Company</DialogTitle>
            <DialogDescription>Update company information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">Company Name *</Label>
              <Input
                placeholder="Enter company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="border-silver"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Industry *</Label>
              <Select value={companyIndustry} onValueChange={setCompanyIndustry}>
                <SelectTrigger className="border-silver">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map(industry => (
                    <SelectItem key={industry} value={industry}>{industry}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditModal(false);
                  resetForm();
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleUpdateCompany} 
                disabled={updating || !companyName.trim() || !companyIndustry}
                className="bg-teal hover:bg-teal/90"
              >
                {updating ? 'Updating...' : 'Update Company'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Refresh Confirmation Modal */}
      <Dialog open={confirmationData !== null} onOpenChange={() => setConfirmationData(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Confirm Model Refresh</DialogTitle>
          </DialogHeader>
          
          {confirmationData && (
            <>
              <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-sm font-medium text-blue-900">
                    <strong>Company:</strong> {confirmationData.companyName}
                  </div>
                  <div className="text-sm text-blue-700">
                    <strong>Plan:</strong> {confirmationData.isProUser ? 'Pro' : 'Free'} ({confirmationData.models.length} models available)
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">Models ({confirmationData.selectedModels.length}/{confirmationData.models.length})</h4>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={selectAllModels}
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          All
                        </button>
                        <span className="text-xs text-gray-400">|</span>
                        <button
                          type="button"
                          onClick={deselectAllModels}
                          className="text-xs text-red-600 hover:text-red-800 underline"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {confirmationData.models.map((model: any) => {
                        const isSelected = confirmationData.selectedModels.some((m: any) => m.name === model.name);
                        return (
                          <div key={model.name} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id={`model-${model.name}`}
                              checked={isSelected}
                              onChange={() => toggleModelSelection(model.name)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <label 
                              htmlFor={`model-${model.name}`}
                              className={`text-sm cursor-pointer ${isSelected ? 'font-medium' : 'text-gray-600'}`}
                            >
                              {model.name.toUpperCase()}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    {confirmationData.selectedModels.length === 0 && (
                      <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                        ⚠️ Please select at least one model to refresh
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">Prompt Types ({confirmationData.selectedPromptTypes.length}/{confirmationData.allPromptTypes.length})</h4>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={selectAllPromptTypes}
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          All
                        </button>
                        <span className="text-xs text-gray-400">|</span>
                        <button
                          type="button"
                          onClick={deselectAllPromptTypes}
                          className="text-xs text-red-600 hover:text-red-800 underline"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {confirmationData.allPromptTypes.map((promptType: string) => {
                        const isSelected = confirmationData.selectedPromptTypes.includes(promptType);
                        const displayName = promptType.replace('talentx_', '').replace(/_/g, ' ');
                        return (
                          <div key={promptType} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id={`prompt-${promptType}`}
                              checked={isSelected}
                              onChange={() => togglePromptTypeSelection(promptType)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <label 
                              htmlFor={`prompt-${promptType}`}
                              className={`text-sm cursor-pointer capitalize ${isSelected ? 'font-medium' : 'text-gray-600'}`}
                            >
                              {displayName}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    {confirmationData.selectedPromptTypes.length === 0 && (
                      <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                        ⚠️ Please select at least one prompt type
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">
                        Prompt Categories / Themes ({confirmationData.selectedPromptCategoryThemes?.length ?? 0}/{confirmationData.allPromptCategoryThemes?.length ?? 0})
                      </h4>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={selectAllPromptCategories}
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          All
                        </button>
                        <span className="text-xs text-gray-400">|</span>
                        <button
                          type="button"
                          onClick={deselectAllPromptCategories}
                          className="text-xs text-red-600 hover:text-red-800 underline"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3 max-h-48 overflow-y-auto">
                      {(() => {
                        const items = confirmationData.allPromptCategoryThemes || [];
                        const selected = confirmationData.selectedPromptCategoryThemes || [];
                        const byCategory = items.reduce((acc: Record<string, { category: string; theme: string }[]>, p: { category: string; theme: string }) => {
                          if (!acc[p.category]) acc[p.category] = [];
                          acc[p.category].push(p);
                          return acc;
                        }, {});
                        return Object.entries(byCategory).map(([category, themes]) => (
                          <div key={category} className="space-y-1">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{category}</div>
                            {themes.map(({ theme }) => {
                              const isSelected = selected.some(
                                (s: { category: string; theme: string }) => s.category === category && s.theme === theme
                              );
                              const id = `category-${category}-${theme}`;
                              return (
                                <div key={id} className="flex items-center space-x-2 pl-2">
                                  <input
                                    type="checkbox"
                                    id={id}
                                    checked={isSelected}
                                    onChange={() => togglePromptCategoryThemeSelection(category, theme)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                  />
                                  <label
                                    htmlFor={id}
                                    className={`text-sm cursor-pointer ${isSelected ? 'font-medium' : 'text-gray-600'}`}
                                  >
                                    {theme}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        ));
                      })()}
                    </div>
                    {(confirmationData.selectedPromptCategoryThemes?.length ?? 0) === 0 && (
                      <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                        ⚠️ Please select at least one prompt category/theme
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-medium">Prompts to Process</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      <div className="text-sm bg-gray-50 p-3 rounded">
                        <strong>Total Prompts:</strong> {confirmationData.regularPrompts.length + confirmationData.talentXPrompts.length}
                        <div className="text-xs text-gray-600 mt-2">
                          <div>• Regular prompts: {confirmationData.regularPrompts.length}</div>
                          {confirmationData.talentXPrompts.length > 0 && (
                            <div>• TalentX prompts: {confirmationData.talentXPrompts.length}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 p-4 rounded-lg">
                  <div className="text-sm font-medium text-yellow-900">
                    <strong>Total Operations:</strong> {confirmationData.totalOperations}
                  </div>
                  <div className="text-xs text-yellow-700 mt-1">
                    This will make {confirmationData.totalOperations} API calls to AI models
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setConfirmationData(null)}
                  disabled={isRefreshing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={executeRefresh}
                  disabled={isRefreshing || confirmationData.selectedModels.length === 0 || confirmationData.selectedPromptTypes.length === 0 || (confirmationData.selectedPromptCategoryThemes?.length ?? 0) === 0}
                  className="bg-pink hover:bg-pink/90"
                >
                  {isRefreshing ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Start Refresh
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

