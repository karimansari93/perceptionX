import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Users, RefreshCw, Mail, Building2, Briefcase, Calendar, Search, Crown, Loader2 } from 'lucide-react';

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  subscription_type?: 'free' | 'pro' | null;
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
  const [upgradingUserId, setUpgradingUserId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [users, searchQuery]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Get all users with subscription status
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, created_at, subscription_type')
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

  const handleUpgradeToPro = async (userId: string) => {
    setUpgradingUserId(userId);
    try {
      const { data, error } = await supabase.functions.invoke('admin-upgrade-user', {
        body: { userId }
      });

      if (error) {
        console.error('Error upgrading user:', error);
        toast.error(`Failed to upgrade user: ${error.message || 'Unknown error'}`);
        return;
      }

      toast.success(data?.message || 'User upgraded to Pro successfully!');
      
      // Reload users to refresh subscription status
      await loadUsers();
    } catch (error: any) {
      console.error('Error upgrading user:', error);
      toast.error(`Failed to upgrade user: ${error.message || 'Unknown error'}`);
    } finally {
      setUpgradingUserId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header - compact */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-headline font-semibold text-slate-800">Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage user accounts and permissions</p>
        </div>
        <Button onClick={loadUsers} variant="outline" size="sm" className="border-slate-200 text-slate-600">
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Stats - neutral */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border border-slate-200 shadow-sm bg-white">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-slate-100 text-slate-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-800">{users.length}</p>
                <p className="text-xs text-slate-500">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm bg-white">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-slate-100 text-slate-500">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-800">
                  {users.filter(u => u.subscription_type === 'pro').length}
                </p>
                <p className="text-xs text-slate-500">Pro Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm bg-white">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-slate-100 text-slate-500">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-800">
                  {users.filter(u => u.organizations.length > 0).length}
                </p>
                <p className="text-xs text-slate-500">In Organizations</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 shadow-sm bg-white">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-slate-100 text-slate-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-800">
                  {users.filter(u => u.organizations.length === 0).length}
                </p>
                <p className="text-xs text-slate-500">Unassigned</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search - compact */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardContent className="py-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Search Users</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by email or organization..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-slate-200 h-9 pl-9 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table - focus on data */}
      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-slate-700">
            {filteredUsers.length} {filteredUsers.length === 1 ? 'User' : 'Users'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-10">
              <Users className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-700 mb-1">No users found</p>
              <p className="text-xs text-slate-500">
                {searchQuery ? 'Try adjusting your search' : 'No users in the system yet'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent bg-slate-50/80">
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Email</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Subscription</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organizations</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Joined</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs font-medium text-slate-600">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map(user => {
                    const isPro = user.subscription_type === 'pro';
                    const isUpgrading = upgradingUserId === user.id;
                    return (
                      <TableRow key={user.id} className="border-slate-200">
                        <TableCell className="py-2 px-3 text-sm">
                          <div className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-medium text-slate-800">{user.email}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          <Badge
                            variant={isPro ? 'default' : 'outline'}
                            className={isPro
                              ? 'bg-pink text-white border-pink text-xs font-normal'
                              : 'border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal'
                            }
                          >
                            {isPro ? <><Crown className="h-3 w-3 mr-1" />Pro</> : 'Free'}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          {user.organizations.length === 0 ? (
                            <Badge variant="outline" className="border-slate-200 text-slate-500 bg-slate-50 text-xs font-normal">
                              No organization
                            </Badge>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {user.organizations.map(org => (
                                <div key={org.id} className="flex items-center gap-1">
                                  <Badge variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                                    <Briefcase className="h-3 w-3 mr-1" />
                                    {org.name}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600 font-normal">
                                    {org.role}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2 px-3 text-xs text-slate-500">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(user.created_at).toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 px-3 text-right">
                          {!isPro && (
                            <Button
                              onClick={() => handleUpgradeToPro(user.id)}
                              disabled={isUpgrading}
                              size="sm"
                              className="bg-pink hover:bg-pink/90 text-white h-7 text-xs"
                            >
                              {isUpgrading ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Upgrading...</>
                              ) : (
                                <><Crown className="h-3.5 w-3.5 mr-1.5" />Upgrade to Pro</>
                              )}
                            </Button>
                          )}
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
    </div>
  );
};











