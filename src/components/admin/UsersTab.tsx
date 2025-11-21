import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Users, RefreshCw, Mail, Building2, Briefcase, Calendar, Search } from 'lucide-react';

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  organizations: {
    id: string;
    name: string;
    role: string;
  }[];
}

export const UsersTab = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [users, searchQuery]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Get all users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get organization memberships for each user
      const { data: memberships, error: membershipsError } = await supabase
        .from('organization_members')
        .select(`
          user_id,
          role,
          organizations!inner(id, name)
        `);

      if (membershipsError) throw membershipsError;

      // Combine data
      const usersWithOrgs = (profiles || []).map(profile => {
        const userOrgs = (memberships || [])
          .filter((m: any) => m.user_id === profile.id)
          .map((m: any) => ({
            id: m.organizations.id,
            name: m.organizations.name,
            role: m.role
          }));

        return {
          ...profile,
          organizations: userOrgs
        };
      });

      setUsers(usersWithOrgs);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const filterUsers = () => {
    if (!searchQuery) {
      setFilteredUsers(users);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = users.filter(user =>
      user.email.toLowerCase().includes(query) ||
      user.organizations.some(org => org.name.toLowerCase().includes(query))
    );
    setFilteredUsers(filtered);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-12 w-12 animate-spin text-pink mx-auto mb-4" />
          <p className="text-nightsky/60">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-headline font-bold text-nightsky">Users</h1>
          <p className="text-nightsky/60 mt-2">Manage user accounts and permissions</p>
        </div>
        <Button onClick={loadUsers} variant="outline" className="border-silver">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="bg-teal/10 p-3 rounded-lg">
                <Users className="h-6 w-6 text-teal" />
              </div>
              <div>
                <p className="text-2xl font-bold text-nightsky">{users.length}</p>
                <p className="text-sm text-nightsky/60">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="bg-pink/10 p-3 rounded-lg">
                <Briefcase className="h-6 w-6 text-pink" />
              </div>
              <div>
                <p className="text-2xl font-bold text-nightsky">
                  {users.filter(u => u.organizations.length > 0).length}
                </p>
                <p className="text-sm text-nightsky/60">Users in Organizations</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="bg-nightsky/10 p-3 rounded-lg">
                <Users className="h-6 w-6 text-nightsky" />
              </div>
              <div>
                <p className="text-2xl font-bold text-nightsky">
                  {users.filter(u => u.organizations.length === 0).length}
                </p>
                <p className="text-sm text-nightsky/60">Unassigned Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="border-none shadow-md">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label className="text-nightsky">Search Users</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-nightsky/40" />
              <Input
                placeholder="Search by email or organization..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-silver pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky">
            {filteredUsers.length} {filteredUsers.length === 1 ? 'User' : 'Users'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-16 w-16 text-silver mx-auto mb-4" />
              <p className="text-lg font-medium text-nightsky mb-2">No users found</p>
              <p className="text-sm text-nightsky/60">
                {searchQuery ? 'Try adjusting your search' : 'No users in the system yet'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Organizations</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-nightsky/60" />
                        <span className="font-medium text-nightsky">{user.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.organizations.length === 0 ? (
                        <Badge variant="outline" className="border-red-300 text-red-600 bg-red-50">
                          No organization
                        </Badge>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {user.organizations.map(org => (
                            <div key={org.id} className="flex items-center gap-1">
                              <Badge 
                                variant="outline" 
                                className="border-teal/30 text-teal bg-teal/5"
                              >
                                <Briefcase className="h-3 w-3 mr-1" />
                                {org.name}
                              </Badge>
                              <Badge 
                                variant="secondary" 
                                className="text-xs bg-nightsky/10 text-nightsky"
                              >
                                {org.role}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-nightsky/60 text-sm">
                        <Calendar className="h-4 w-4" />
                        {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};











