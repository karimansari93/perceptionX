import { useState, useEffect } from 'react';
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
import { Building2, Plus, RefreshCw, Pencil, Briefcase, Calendar, ArrowRight } from 'lucide-react';
import { CompanyDetailView } from './CompanyDetailView';

interface Organization {
  id: string;
  name: string;
}

interface Company {
  id: string;
  name: string;
  industry: string;
  created_at: string;
  organization_id: string;
  organization_name: string;
  last_updated: string | null;
  country: string | null;
}

export const CompanyManagementTab = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Company detail view
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

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterCompanies();
  }, [companies, selectedOrg, searchQuery]);

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
        last_updated: company.last_updated || null,
        country: null as string | null // Will be populated below
      }));

      // Fetch countries for companies from user_onboarding
      const companyIds = companiesWithOrg.map(c => c.id);
      if (companyIds.length > 0) {
        const { data: countriesData, error: countriesError } = await supabase
          .from('user_onboarding')
          .select('company_id, country')
          .in('company_id', companyIds)
          .not('company_id', 'is', null)
          .order('created_at', { ascending: false });

        if (!countriesError && countriesData) {
          // Create a map of company_id to country (using most recent record for each company)
          const countriesMap = new Map<string, string | null>();
          countriesData.forEach(row => {
            if (row.company_id && !countriesMap.has(row.company_id)) {
              countriesMap.set(row.company_id, row.country || null);
            }
          });

          // Add country to each company
          companiesWithOrg.forEach(company => {
            company.country = countriesMap.get(company.id) || null;
          });
        }
      }

      setCompanies(companiesWithOrg);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
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
        c.organization_name.toLowerCase().includes(query) ||
        (c.country && c.country.toLowerCase().includes(query))
      );
    }

    setFilteredCompanies(filtered);
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
        { name: 'bing-copilot', fn: 'test-prompt-bing-copilot' },
      ];

      const proModels = [
        { name: 'openai', fn: 'test-prompt-openai' },
        { name: 'perplexity', fn: 'test-prompt-perplexity' },
        { name: 'gemini', fn: 'test-prompt-gemini' },
        { name: 'deepseek', fn: 'test-prompt-deepseek' },
        { name: 'google-ai-overviews', fn: 'test-prompt-google-ai-overviews' },
        { name: 'bing-copilot', fn: 'test-prompt-bing-copilot' },
      ];

      const models = isProUser ? proModels : freeModels;
      console.log('Models available:', models.length, 'Is Pro:', isProUser);

      // Get all unique prompt types
      const allPromptTypes = Array.from(new Set([
        ...regularPrompts.map(p => p.prompt_type),
        ...talentXPrompts.map(p => p.prompt_type)
      ])).sort();
      console.log('All prompt types:', allPromptTypes);

      // Get all unique prompt categories (default to 'General' if null/undefined)
      const allPromptCategories = Array.from(new Set([
        ...regularPrompts.map(p => p.prompt_category || 'General'),
        ...talentXPrompts.map(p => p.prompt_category || 'General')
      ])).sort();
      console.log('All prompt categories:', allPromptCategories);

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
        allPromptCategories,
        selectedPromptCategories: allPromptCategories,
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

  const togglePromptCategorySelection = (promptCategory: string) => {
    if (!confirmationData) return;
    
    const isSelected = confirmationData.selectedPromptCategories.includes(promptCategory);
    const newSelectedCategories = isSelected
      ? confirmationData.selectedPromptCategories.filter((c: string) => c !== promptCategory)
      : [...confirmationData.selectedPromptCategories, promptCategory];
    
    updateTotalOperations({ ...confirmationData, selectedPromptCategories: newSelectedCategories });
  };

  const updateTotalOperations = (newData: any) => {
    const filteredRegularPrompts = newData.regularPrompts.filter((p: any) => 
      newData.selectedPromptTypes.includes(p.prompt_type) &&
      newData.selectedPromptCategories.includes(p.prompt_category || 'General')
    );
    const filteredTalentXPrompts = newData.talentXPrompts.filter((p: any) => 
      newData.selectedPromptTypes.includes(p.prompt_type) &&
      newData.selectedPromptCategories.includes(p.prompt_category || 'General')
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
    updateTotalOperations({ ...confirmationData, selectedPromptCategories: [...confirmationData.allPromptCategories] });
  };

  const deselectAllPromptCategories = () => {
    if (!confirmationData) return;
    updateTotalOperations({ ...confirmationData, selectedPromptCategories: [] });
  };

  const executeRefresh = async () => {
    if (!confirmationData || isRefreshing) return;

    if (confirmationData.selectedModels.length === 0 || confirmationData.selectedPromptTypes.length === 0 || confirmationData.selectedPromptCategories.length === 0) {
      toast.error('Please select at least one model, one prompt type, and one prompt category');
      return;
    }

    setIsRefreshing(true);
    
    try {
      const { regularPrompts, talentXPrompts, selectedModels, selectedPromptTypes, selectedPromptCategories, companyId, companyName } = confirmationData;
      
      // Filter prompts by selected types and categories
      const filteredRegularPrompts = regularPrompts.filter((p: any) => 
        selectedPromptTypes.includes(p.prompt_type) &&
        selectedPromptCategories.includes(p.prompt_category || 'General')
      );
      const filteredTalentXPrompts = talentXPrompts.filter((p: any) => 
        selectedPromptTypes.includes(p.prompt_type) &&
        selectedPromptCategories.includes(p.prompt_category || 'General')
      );
      
      const totalOperations = (filteredRegularPrompts.length + filteredTalentXPrompts.length) * selectedModels.length;
      let completedOperations = 0;

      toast.info(`Starting refresh: ${totalOperations} operations for ${companyName}`);

      // Process regular prompts
      for (const prompt of filteredRegularPrompts) {
        for (const model of selectedModels) {
          try {
            // Get response from model
            const { data: resp, error } = await supabase.functions.invoke(model.fn, {
              body: { prompt: prompt.prompt_text }
            });

            if (error || !(resp as any)?.response) {
              console.error(`${model.name} error:`, error);
              continue;
            }

            // Analyze and store response
            const analyzeResult = await supabase.functions.invoke('analyze-response', {
              body: {
                response: (resp as any).response,
                companyName: companyName,
                promptType: prompt.prompt_type,
                perplexityCitations: model.name === 'perplexity' ? (resp as any).citations : null,
                citations: model.name === 'google-ai-overviews' || model.name === 'bing-copilot' ? (resp as any).citations : null,
                confirmed_prompt_id: prompt.id,
                ai_model: model.name,
                company_id: companyId,
                isTalentXPrompt: false
              }
            });

            if (analyzeResult.error) {
              console.error(`Analyze error:`, analyzeResult.error);
            }
          } catch (e) {
            console.error(`Unexpected error:`, e);
          }

          completedOperations++;
        }
      }

      // Process TalentX prompts
      for (const prompt of filteredTalentXPrompts) {
        for (const model of selectedModels) {
          try {
            const { data: resp, error } = await supabase.functions.invoke(model.fn, {
              body: { prompt: prompt.prompt_text }
            });

            if (error || !(resp as any)?.response) {
              console.error(`${model.name} error:`, error);
              continue;
            }

            const analyzeResult = await supabase.functions.invoke('analyze-response', {
              body: {
                response: (resp as any).response,
                companyName: companyName,
                promptType: prompt.prompt_type,
                perplexityCitations: model.name === 'perplexity' ? (resp as any).citations : null,
                citations: model.name === 'google-ai-overviews' || model.name === 'bing-copilot' ? (resp as any).citations : null,
                confirmed_prompt_id: prompt.id,
                ai_model: model.name,
                company_id: companyId,
                isTalentXPrompt: true
              }
            });

            if (analyzeResult.error) {
              console.error(`Analyze error:`, analyzeResult.error);
            }
          } catch (e) {
            console.error(`Unexpected error:`, e);
          }

          completedOperations++;
        }
      }

      // Update last_updated timestamp
      await supabase
        .from('companies')
        .update({ last_updated: new Date().toISOString() })
        .eq('id', companyId);

      toast.success(`Refresh complete! Processed ${completedOperations} operations.`);
      setConfirmationData(null);
      loadData();
    } catch (error) {
      console.error('Error during refresh:', error);
      toast.error('Failed to complete refresh');
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
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 animate-spin text-pink mx-auto mb-4" />
          <p className="text-nightsky/60">Loading companies...</p>
        </div>
      </div>
    );
  } else if (selectedCompany) {
    // Show company detail view if a company is selected
    content = (
      <CompanyDetailView 
        company={selectedCompany}
        onBack={() => setSelectedCompany(null)}
        onUpdate={() => {
          loadData();
          // Update the selected company data
          const updatedCompany = companies.find(c => c.id === selectedCompany.id);
          if (updatedCompany) {
            setSelectedCompany(updatedCompany);
          }
        }}
        onRefresh={prepareRefreshForCompany}
        onDelete={() => {
          // Reload data and navigate back to list
          loadData();
          setSelectedCompany(null);
        }}
      />
    );
  } else {
    content = (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-headline font-bold text-nightsky">Companies</h1>
          <p className="text-nightsky/60 mt-2">Manage companies and their data</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={loadData} variant="outline" className="border-silver">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateModal(true)} className="bg-pink hover:bg-pink/90">
            <Plus className="h-4 w-4 mr-2" />
            Add Company
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-none shadow-md">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-nightsky">Search</Label>
              <Input
                placeholder="Search by name, industry, or organization..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-silver"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Filter by Organization</Label>
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger className="border-silver">
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

      {/* Companies Table */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky">
            {filteredCompanies.length} {filteredCompanies.length === 1 ? 'Company' : 'Companies'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredCompanies.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="h-16 w-16 text-silver mx-auto mb-4" />
              <p className="text-lg font-medium text-nightsky mb-2">No companies found</p>
              <p className="text-sm text-nightsky/60 mb-4">
                {searchQuery || selectedOrg !== 'all' 
                  ? 'Try adjusting your filters'
                  : 'Create your first company to get started'
                }
              </p>
              {!searchQuery && selectedOrg === 'all' && (
                <Button onClick={() => setShowCreateModal(true)} className="bg-pink hover:bg-pink/90">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Company
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Company ID</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map(company => (
                  <TableRow key={company.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-nightsky/60" />
                        <span className="font-medium text-nightsky">{company.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-nightsky/60 font-mono">{company.id}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-teal/30 text-teal bg-teal/5">
                        {company.industry}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-nightsky/70">
                        {company.country || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-nightsky/70">
                        <Briefcase className="h-4 w-4" />
                        {company.organization_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-nightsky/60 text-sm">
                        <Calendar className="h-4 w-4" />
                        {company.last_updated 
                          ? new Date(company.last_updated).toLocaleDateString()
                          : 'Never'
                        }
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        <Button
                          onClick={() => setSelectedCompany(company)}
                          size="sm"
                          className="bg-pink hover:bg-pink/90"
                        >
                          View Details
                          <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                      <h4 className="font-medium">Prompt Categories ({confirmationData.selectedPromptCategories.length}/{confirmationData.allPromptCategories.length})</h4>
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
                    <div className="space-y-2">
                      {confirmationData.allPromptCategories.map((promptCategory: string) => {
                        const isSelected = confirmationData.selectedPromptCategories.includes(promptCategory);
                        return (
                          <div key={promptCategory} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id={`category-${promptCategory}`}
                              checked={isSelected}
                              onChange={() => togglePromptCategorySelection(promptCategory)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <label 
                              htmlFor={`category-${promptCategory}`}
                              className={`text-sm cursor-pointer ${isSelected ? 'font-medium' : 'text-gray-600'}`}
                            >
                              {promptCategory}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    {confirmationData.selectedPromptCategories.length === 0 && (
                      <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                        ⚠️ Please select at least one prompt category
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
                  disabled={isRefreshing || confirmationData.selectedModels.length === 0 || confirmationData.selectedPromptTypes.length === 0 || confirmationData.selectedPromptCategories.length === 0}
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

