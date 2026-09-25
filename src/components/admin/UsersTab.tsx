import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Users, RefreshCw, Mail, Building2, Briefcase, Calendar, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { clearPlatformAdminCache } from '@/lib/platformAdmin';

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
  // Platform admins (user_roles.role = 'admin'): who can open /admin and see
  // every client's data. Granted and revoked here via set_platform_admin.
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [savingAdminId, setSavingAdminId] = useState<string | null>(null);
  const { user: currentUser } = useAuth();

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

      const { data: admins, error: adminsError } = await supabase.rpc('list_platform_admins' as never);
      if (adminsError) throw adminsError;
      setAdminIds(new Set(((admins as unknown as { user_id: string }[]) || []).map((a) => a.user_id)));
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const setPlatformAdmin = async (user: UserRow, makeAdmin: boolean) => {
    const prompt = makeAdmin
      ? `Make ${user.email} a platform admin? They will be able to open the admin panel and see every client's data.`
      : `Remove platform admin access from ${user.email}?`;
    if (!window.confirm(prompt)) return;
    setSavingAdminId(user.id);
    const { error } = await supabase.rpc('set_platform_admin' as never, { p_user_id: user.id, p_is_admin: makeAdmin } as never);
    setSavingAdminId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    clearPlatformAdminCache();
    setAdminIds((prev) => {
      const next = new Set(prev);
      if (makeAdmin) next.add(user.id);
      else next.delete(user.id);
      return next;
    });
    toast.success(makeAdmin ? `${user.email} is now a platform admin` : `${user.email} is no longer a platform admin`);
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
          <p className="text-sm text-slate-500 mt-0.5">Everyone with an account. Platform admins can open this admin panel and see every client.</p>
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
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Organizations</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600">Joined</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-slate-600 text-right">Platform admin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map(user => {
                    return (
                      <TableRow key={user.id} className="border-slate-200">
                        <TableCell className="py-2 px-3 text-sm">
                          <div className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-medium text-slate-800">{user.email}</span>
                          </div>
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
                          {adminIds.has(user.id) ? (
                            <div className="flex items-center justify-end gap-2">
                              <Badge className="bg-teal/10 text-teal border-teal/30 text-xs font-normal" variant="outline">
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Admin
                              </Badge>
                              {user.id !== currentUser?.id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-slate-500"
                                  disabled={savingAdminId === user.id}
                                  onClick={() => setPlatformAdmin(user, false)}
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-slate-200 text-slate-600"
                              disabled={savingAdminId === user.id}
                              onClick={() => setPlatformAdmin(user, true)}
                            >
                              Make admin
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











