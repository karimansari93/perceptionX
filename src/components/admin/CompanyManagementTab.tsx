import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building2, Users, UserPlus, Plus, Search, RefreshCw, Eye } from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  member_count?: number;
  company_count?: number;
}

interface Company {
  id: string;
  name: string;
  industry: string;
  created_at: string;
  organization_id: string;
  organization_name: string;
}

interface OrganizationMember {
  id: string;
  user_id: string;
  email: string;
  role: string;
  is_default: boolean;
}

export const CompanyManagementTab = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [showAssignCompanyModal, setShowAssignCompanyModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  
  // Form data
  const [companyName, setCompanyName] = useState('');
  const [companyIndustry, setCompanyIndustry] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load organizations with counts
      const { data: orgsData, error: orgsError } = await supabase
        .from('organizations')
        .select('*')
        .order('created_at', { ascending: false });

      if (orgsError) throw orgsError;

      // Load member counts
      const { data: membersData } = await supabase
        .from('organization_members')
        .select('organization_id');

      // Load company counts
      const { data: companiesData } = await supabase
        .from('organization_companies')
        .select('organization_id');

      // Calculate counts
      const orgsWithCounts = (orgsData || []).map(org => ({
        ...org,
        member_count: (membersData || []).filter(m => m.organization_id === org.id).length,
        company_count: (companiesData || []).filter(c => c.organization_id === org.id).length
      }));

      setOrganizations(orgsWithCounts);

      // Load all companies with their organization info
      const { data: companiesDataFull, error: companiesError } = await supabase
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

      const companiesWithOrg = (companiesDataFull || []).map(company => ({
        ...company,
        organization_id: company.organization_companies[0]?.organization_id,
        organization_name: company.organization_companies[0]?.organizations?.name || 'Unknown'
      }));

      setCompanies(companiesWithOrg);

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadOrganizationMembers = async (orgId: string) => {
    try {
      const { data, error } = await supabase
        .from('organization_members')
        .select(`
          id,
          user_id,
          role,
          is_default,
          profiles!inner(email)
        `)
        .eq('organization_id', orgId);

      if (error) throw error;

      const members = (data || []).map(member => ({
        id: member.id,
        user_id: member.user_id,
        email: (member.profiles as any)?.email || 'Unknown',
        role: member.role,
        is_default: member.is_default
      }));

      setOrgMembers(members);
    } catch (error) {
      console.error('Error loading organization members:', error);
      toast.error('Failed to load organization members');
    }
  };

  const handleCreateCompany = async () => {
    if (!selectedOrg || !companyName.trim() || !companyIndustry.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCreating(true);
    try {
      // Create company
      const { data: companyData, error: companyError } = await supabase
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
          organization_id: selectedOrg.id,
          company_id: companyData.id
        });

      if (linkError) throw linkError;

      toast.success('Company created and linked to organization');
      setShowCreateCompanyModal(false);
      setCompanyName('');
      setCompanyIndustry('');
      setSelectedOrg(null);
      loadData();
    } catch (error) {
      console.error('Error creating company:', error);
      toast.error('Failed to create company');
    } finally {
      setCreating(false);
    }
  };

  const handleAssignCompany = async () => {
    if (!selectedOrg || !selectedCompany) {
      toast.error('Please select both an organization and a company');
      return;
    }

    setAssigning(true);
    try {
      // Check if already assigned
      const { data: existing } = await supabase
        .from('organization_companies')
        .select('id')
        .eq('company_id', selectedCompany)
        .eq('organization_id', selectedOrg.id)
        .single();

      if (existing) {
        toast.error('Company is already assigned to this organization');
        setAssigning(false);
        return;
      }

      const { error } = await supabase
        .from('organization_companies')
        .insert({
          company_id: selectedCompany,
          organization_id: selectedOrg.id
        });

      if (error) throw error;

      toast.success('Company assigned to organization');
      setShowAssignCompanyModal(false);
      setSelectedCompany('');
      setSelectedOrg(null);
      loadData();
    } catch (error) {
      console.error('Error assigning company:', error);
      toast.error('Failed to assign company');
    } finally {
      setAssigning(false);
    }
  };

  const getCompaniesForOrg = (orgId: string) => {
    return companies.filter(c => c.organization_id === orgId);
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Companies by Organization</h2>
        <div className="flex gap-2">
          <Button onClick={() => setShowCreateCompanyModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Company
          </Button>
          <Button variant="outline" onClick={() => setShowAssignCompanyModal(true)}>
            <Building2 className="h-4 w-4 mr-2" />
            Assign Company
          </Button>
        </div>
      </div>

      {/* Organizations and their Companies */}
      {organizations.map(org => {
        const orgCompanies = getCompaniesForOrg(org.id);
        return (
          <Card key={org.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-500" />
                    {org.name}
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    {org.description || 'No description'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant="secondary">
                    <Users className="h-3 w-3 mr-1" />
                    {org.member_count || 0} members
                  </Badge>
                  <Badge variant="outline">
                    <Building2 className="h-3 w-3 mr-1" />
                    {orgCompanies.length} companies
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedOrg(org);
                      loadOrganizationMembers(org.id);
                      setShowMembersModal(true);
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View Members
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {orgCompanies.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No companies in this organization yet.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company Name</TableHead>
                      <TableHead>Industry</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgCompanies.map(company => (
                      <TableRow key={company.id}>
                        <TableCell className="font-medium">{company.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{company.industry}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {new Date(company.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Create Company Modal */}
      <Dialog open={showCreateCompanyModal} onOpenChange={setShowCreateCompanyModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Company</DialogTitle>
            <DialogDescription>
              Create a company and assign it to an organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Organization *</Label>
              <Select value={selectedOrg?.id || ''} onValueChange={(value) => {
                const org = organizations.find(o => o.id === value);
                setSelectedOrg(org || null);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Company Name *</Label>
              <Input
                placeholder="e.g., Acme Corp"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Industry *</Label>
              <Input
                placeholder="e.g., Technology"
                value={companyIndustry}
                onChange={(e) => setCompanyIndustry(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateCompanyModal(false);
                  setCompanyName('');
                  setCompanyIndustry('');
                  setSelectedOrg(null);
                }}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleCreateCompany} 
                disabled={creating || !selectedOrg || !companyName.trim() || !companyIndustry.trim()}
              >
                {creating ? 'Creating...' : 'Create Company'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Company Modal */}
      <Dialog open={showAssignCompanyModal} onOpenChange={setShowAssignCompanyModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Company to Organization</DialogTitle>
            <DialogDescription>
              Link an existing company to an organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Organization *</Label>
              <Select value={selectedOrg?.id || ''} onValueChange={(value) => {
                const org = organizations.find(o => o.id === value);
                setSelectedOrg(org || null);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Company *</Label>
              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(company => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name} ({company.industry})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAssignCompanyModal(false);
                  setSelectedCompany('');
                  setSelectedOrg(null);
                }}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAssignCompany} 
                disabled={assigning || !selectedOrg || !selectedCompany}
              >
                {assigning ? 'Assigning...' : 'Assign Company'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Members Modal */}
      <Dialog open={showMembersModal} onOpenChange={setShowMembersModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Organization Members: {selectedOrg?.name}</DialogTitle>
            <DialogDescription>
              Users who can access all companies in this organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {orgMembers.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No members in this organization.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Default</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgMembers.map(member => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.email}</TableCell>
                      <TableCell>
                        <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {member.is_default ? (
                          <Badge variant="outline">Default</Badge>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};