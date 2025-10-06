import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building2, Users, UserPlus, Plus, Briefcase, X } from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  member_count?: number;
  company_count?: number;
}

interface User {
  id: string;
  email: string;
}

interface Company {
  id: string;
  name: string;
  industry: string;
}

export const OrganizationManagementTab = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [showAssignUserModal, setShowAssignUserModal] = useState(false);
  const [showAssignCompanyModal, setShowAssignCompanyModal] = useState(false);
  
  // Selected items
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'member'>('member');
  
  // Form data
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
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

      // Load all users
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, email')
        .order('email', { ascending: true });

      if (usersError) throw usersError;
      setUsers(usersData || []);

      // Load all companies
      const { data: companiesDataFull, error: companiesError } = await supabase
        .from('companies')
        .select('id, name, industry')
        .order('name', { ascending: true });

      console.log('Companies loaded:', companiesDataFull?.length, 'Error:', companiesError);
      
      if (companiesError) {
        console.error('Error loading companies:', companiesError);
        throw companiesError;
      }
      setCompanies(companiesDataFull || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      toast.error('Organization name is required');
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('organizations')
        .insert({
          name: orgName,
          description: orgDescription || null
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Organization created successfully');
      setShowCreateOrgModal(false);
      setOrgName('');
      setOrgDescription('');
      loadData();
    } catch (error) {
      console.error('Error creating organization:', error);
      toast.error('Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  const handleAssignUser = async () => {
    if (!selectedOrg || !selectedUser) {
      toast.error('Please select both an organization and a user');
      return;
    }

    setAssigning(true);
    try {
      // Check if already assigned
      const { data: existing } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', selectedUser)
        .eq('organization_id', selectedOrg.id)
        .single();

      if (existing) {
        toast.error('User is already a member of this organization');
        setAssigning(false);
        return;
      }

      const { error } = await supabase
        .from('organization_members')
        .insert({
          user_id: selectedUser,
          organization_id: selectedOrg.id,
          role: selectedRole
        });

      if (error) throw error;

      toast.success('User assigned to organization');
      setShowAssignUserModal(false);
      setSelectedUser('');
      loadData();
    } catch (error) {
      console.error('Error assigning user:', error);
      toast.error('Failed to assign user');
    } finally {
      setAssigning(false);
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
      loadData();
    } catch (error) {
      console.error('Error assigning company:', error);
      toast.error('Failed to assign company');
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with Create button */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Organizations</h2>
        <Button onClick={() => setShowCreateOrgModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Organization
        </Button>
      </div>

      {/* Organizations List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            All Organizations ({organizations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No organizations yet. Create one to get started!</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Companies</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map(org => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {org.description || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <Users className="h-3 w-3 mr-1" />
                        {org.member_count || 0}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        <Briefcase className="h-3 w-3 mr-1" />
                        {org.company_count || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedOrg(org);
                            setShowAssignUserModal(true);
                          }}
                        >
                          <UserPlus className="h-4 w-4 mr-1" />
                          Add User
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedOrg(org);
                            setShowAssignCompanyModal(true);
                          }}
                        >
                          <Briefcase className="h-4 w-4 mr-1" />
                          Add Company
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

      {/* Create Organization Modal */}
      <Dialog open={showCreateOrgModal} onOpenChange={setShowCreateOrgModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>
              Create an organization to manage users and companies
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Organization Name *</Label>
              <Input
                placeholder="e.g., Hanson Search Agency"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="What does this organization do?"
                value={orgDescription}
                onChange={(e) => setOrgDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateOrgModal(false);
                  setOrgName('');
                  setOrgDescription('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateOrg} disabled={creating || !orgName.trim()}>
                {creating ? 'Creating...' : 'Create Organization'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign User Modal */}
      <Dialog open={showAssignUserModal} onOpenChange={setShowAssignUserModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign User to {selectedOrg?.name}</DialogTitle>
            <DialogDescription>
              Add a team member to this organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select User</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={(value: any) => setSelectedRole(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAssignUserModal(false);
                  setSelectedUser('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleAssignUser} disabled={assigning || !selectedUser}>
                {assigning ? 'Assigning...' : 'Assign User'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Company Modal */}
      <Dialog open={showAssignCompanyModal} onOpenChange={setShowAssignCompanyModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Company to {selectedOrg?.name}</DialogTitle>
            <DialogDescription>
              Add a client/company to this organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Company</Label>
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
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleAssignCompany} disabled={assigning || !selectedCompany}>
                {assigning ? 'Assigning...' : 'Assign Company'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
