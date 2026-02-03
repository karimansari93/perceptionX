import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Briefcase, Users, Building2, Plus, RefreshCw, Eye, Pencil, UserPlus, Mail, Search, Calendar, Database } from 'lucide-react';
import { OrganizationDataDetail } from './OrganizationDataDetail';

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

interface OrganizationMember {
  id: string;
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

export const OrganizationManagementTab = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [filteredOrganizations, setFilteredOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [selectedOrgForData, setSelectedOrgForData] = useState<Organization | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  
  // Form data
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'member'>('member');
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterOrganizations();
  }, [organizations, searchQuery]);

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
      setFilteredOrganizations(orgsWithCounts);

      // Load all users
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, email')
        .order('email', { ascending: true });

      if (usersError) throw usersError;
      setUsers(usersData || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const filterOrganizations = () => {
    if (!searchQuery) {
      setFilteredOrganizations(organizations);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = organizations.filter(org =>
      org.name.toLowerCase().includes(query) ||
      (org.description && org.description.toLowerCase().includes(query))
    );
    setFilteredOrganizations(filtered);
  };

  const loadOrgMembers = async (orgId: string) => {
    try {
      const { data: membersData, error: membersError } = await supabase
        .from('organization_members')
        .select('id, user_id, role, created_at')
        .eq('organization_id', orgId);

      if (membersError) throw membersError;

      // Fetch profiles separately
      if (membersData && membersData.length > 0) {
        const userIds = membersData.map(m => m.user_id);
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', userIds);

        if (profilesError) throw profilesError;

        const members = membersData.map(member => ({
          id: member.id,
          user_id: member.user_id,
          email: profilesData?.find(p => p.id === member.user_id)?.email || 'Unknown',
          role: member.role,
          joined_at: member.created_at
        }));

        setOrgMembers(members);
      } else {
        setOrgMembers([]);
      }
    } catch (error) {
      console.error('Error loading members:', error);
      toast.error('Failed to load organization members');
    }
  };

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      toast.error('Organization name is required');
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .insert({
          name: orgName,
          description: orgDescription || null
        });

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

  const handleAddUser = async () => {
    if (!selectedOrg || !selectedUser) {
      toast.error('Please select both organization and user');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase
        .from('organization_members')
        .insert({
          organization_id: selectedOrg.id,
          user_id: selectedUser,
          role: selectedRole
        });

      if (error) throw error;

      toast.success('User added to organization successfully');
      setShowAddUserModal(false);
      setSelectedUser('');
      setSelectedRole('member');
      loadData();
      if (showMembersModal) {
        loadOrgMembers(selectedOrg.id);
      }
    } catch (error) {
      console.error('Error adding user:', error);
      toast.error('Failed to add user to organization');
    } finally {
      setAdding(false);
    }
  };

  const handleViewMembers = (org: Organization) => {
    setSelectedOrg(org);
    loadOrgMembers(org.id);
    setShowMembersModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading organizations...</p>
        </div>
      </div>
    );
  }

  if (selectedOrgForData) {
    return (
      <OrganizationDataDetail
        org={{
          id: selectedOrgForData.id,
          name: selectedOrgForData.name,
          description: selectedOrgForData.description ?? undefined,
        }}
        onBack={() => setSelectedOrgForData(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header - compact */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-headline font-semibold text-slate-800">Organizations</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your organizations and their members</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadData} variant="outline" size="sm" className="border-slate-200 text-slate-600">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateOrgModal(true)} size="sm" className="bg-pink hover:bg-pink/90 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Create Organization
          </Button>
        </div>
      </div>

      {/* Search - compact */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardContent className="py-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Search Organizations</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-slate-200 h-9 pl-9 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organizations Table - focus on data */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-slate-700">
            {filteredOrganizations.length} {filteredOrganizations.length === 1 ? 'Organization' : 'Organizations'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredOrganizations.length === 0 ? (
            <div className="text-center py-10">
              <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-700 mb-1">No organizations found</p>
              <p className="text-xs text-slate-500 mb-3">
                {searchQuery ? 'Try adjusting your search' : 'Create your first organization to get started'}
              </p>
              {!searchQuery && (
                <Button onClick={() => setShowCreateOrgModal(true)} size="sm" className="bg-pink hover:bg-pink/90 text-white">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create Organization
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organization Name</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organization ID</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Description</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Members</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Companies</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Created</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs font-medium text-slate-600">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrganizations.map(org => (
                    <TableRow key={org.id} className="border-slate-200">
                      <TableCell className="py-2 px-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-800">{org.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs font-mono text-slate-500">{org.id}</TableCell>
                      <TableCell className="py-2 px-3 text-sm text-slate-600 max-w-[200px] truncate">
                        {org.description || '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                          {org.member_count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        <Badge variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                          {org.company_count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs text-slate-500">
                        {new Date(org.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-right">
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          <Button onClick={() => setSelectedOrgForData(org)} size="sm" className="bg-pink hover:bg-pink/90 text-white h-7 text-xs">
                            <Database className="h-3.5 w-3.5 mr-1" />
                            Manage data
                          </Button>
                          <Button onClick={() => handleViewMembers(org)} size="sm" variant="outline" className="border-slate-200 text-slate-600 h-7 text-xs">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View Members
                          </Button>
                          <Button
                            onClick={() => { setSelectedOrg(org); setShowAddUserModal(true); }}
                            size="sm"
                            className="bg-teal hover:bg-teal/90 text-white h-7 text-xs"
                          >
                            <UserPlus className="h-3.5 w-3.5 mr-1" />
                            Add User
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Organization Modal */}
      <Dialog open={showCreateOrgModal} onOpenChange={setShowCreateOrgModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Create New Organization</DialogTitle>
            <DialogDescription>Add a new organization to your system</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">Organization Name *</Label>
              <Input
                placeholder="Enter organization name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="border-silver"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Description</Label>
              <Textarea
                placeholder="Enter organization description (optional)"
                value={orgDescription}
                onChange={(e) => setOrgDescription(e.target.value)}
                rows={3}
                className="border-silver"
              />
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateOrgModal(false);
                  setOrgName('');
                  setOrgDescription('');
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleCreateOrg} 
                disabled={creating || !orgName.trim()}
                className="bg-pink hover:bg-pink/90"
              >
                {creating ? 'Creating...' : 'Create Organization'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add User Modal */}
      <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Add User to Organization</DialogTitle>
            <DialogDescription>
              Add a user to {selectedOrg?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-nightsky">User *</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="border-silver">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-nightsky/60" />
                        {user.email}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-nightsky">Role *</Label>
              <Select value={selectedRole} onValueChange={(value: any) => setSelectedRole(value)}>
                <SelectTrigger className="border-silver">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddUserModal(false);
                  setSelectedUser('');
                  setSelectedRole('member');
                }}
                className="border-silver"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAddUser} 
                disabled={adding || !selectedUser}
                className="bg-teal hover:bg-teal/90"
              >
                {adding ? 'Adding...' : 'Add User'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Members Modal */}
      <Dialog open={showMembersModal} onOpenChange={setShowMembersModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-nightsky">Organization Members</DialogTitle>
            <DialogDescription>
              Members of {selectedOrg?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {orgMembers.length === 0 ? (
              <div className="text-center py-8 text-nightsky/60">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No members in this organization yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgMembers.map(member => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-nightsky/60" />
                          {member.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.role === 'owner' ? 'default' : 'secondary'} className={
                          member.role === 'owner' ? 'bg-pink' : 
                          member.role === 'admin' ? 'bg-teal' : 'bg-nightsky/20 text-nightsky'
                        }>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-nightsky/60">
                        {new Date(member.joined_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex justify-between pt-4">
              <Button
                onClick={() => {
                  setShowAddUserModal(true);
                }}
                size="sm"
                className="bg-teal hover:bg-teal/90"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
              <Button
                onClick={() => setShowMembersModal(false)}
                variant="outline"
                className="border-silver"
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};


