import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Users, Calendar, Building2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface UserRow {
  id: string;
  email: string;
  company_name: string;
  industry: string;
  last_updated: string | null;
  created_at: string;
  has_prompts: boolean;
  subscription_type?: string;
}

export default function Admin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingUsers, setRefreshingUsers] = useState<Set<string>>(new Set());
  const { signOut } = useAuth();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);

      // 1) Get completed onboarding records (latest per user)
      const { data: allOnboardings, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('user_id, company_name, industry, created_at')
        .not('company_name', 'is', null)
        .not('industry', 'is', null)
        .order('created_at', { ascending: false });
      if (onboardingError) throw onboardingError;
      const userIdToOnboarding: Record<string, any> = {};
      for (const row of allOnboardings || []) {
        if (!userIdToOnboarding[row.user_id]) userIdToOnboarding[row.user_id] = row;
      }
      const completedUserIds = Object.keys(userIdToOnboarding);

      if (completedUserIds.length === 0) {
        setUsers([]);
        return;
      }

      // 2) Fetch profiles only for completed users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id,email,created_at,subscription_type')
        .in('id', completedUserIds)
        .order('created_at', { ascending: false });
      if (profilesError) throw profilesError;

      // 3) Confirmed prompts per user (also used to compute last response)
      const { data: prompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('user_id, id')
        .in('user_id', completedUserIds);
      if (promptsError) throw promptsError;
      const usersWithPrompts = new Set<string>((prompts || []).map((r: any) => r.user_id));
      const promptIdToUserId: Record<string, string> = {};
      const promptIds: string[] = [];
      for (const r of prompts || []) {
        promptIdToUserId[r.id] = r.user_id;
        promptIds.push(r.id);
      }

      // 4) Latest prompt_responses per prompt, then reduce to per user
      const userIdToLastResponse: Record<string, string> = {};
      if (promptIds.length > 0) {
        const { data: responses, error: responsesError } = await supabase
          .from('prompt_responses')
          .select('confirmed_prompt_id, created_at')
          .in('confirmed_prompt_id', promptIds)
          .order('created_at', { ascending: false });
        if (responsesError) throw responsesError;
        for (const row of responses || []) {
          const uid = promptIdToUserId[row.confirmed_prompt_id as unknown as string];
          if (uid && !userIdToLastResponse[uid]) {
            userIdToLastResponse[uid] = row.created_at as unknown as string;
          }
        }
      }

      const profileMap: Record<string, { email: string; created_at: string; subscription_type?: string }> = {};
      for (const p of profiles || []) {
        profileMap[p.id] = { email: p.email || 'No email', created_at: p.created_at, subscription_type: (p as any).subscription_type } as any;
      }

      const rows: UserRow[] = completedUserIds.map((uid: string) => {
        const ob = userIdToOnboarding[uid];
        const prof = profileMap[uid];
        return {
          id: uid,
          email: prof?.email || '(no profile) ' + uid,
          company_name: ob?.company_name || '—',
          industry: ob?.industry || '—',
          last_updated: userIdToLastResponse[uid] || null,
          created_at: prof?.created_at || ob?.created_at || new Date().toISOString(),
          has_prompts: usersWithPrompts.has(uid),
          subscription_type: prof?.subscription_type || 'free',
        };
      });

      setUsers(rows);
    } catch (e: any) {
      console.error('Error fetching users:', e);
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const refreshUserModels = async (userId: string) => {
    try {
      setRefreshingUsers(prev => new Set(prev).add(userId));

      const target = users.find(u => u.id === userId);
      if (!target) return;

      const { data: confirmedPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('is_active', true)
        .eq('user_id', userId);

      if (promptsError) throw promptsError;

      if (!confirmedPrompts || confirmedPrompts.length === 0) {
        toast.error('No active prompts found for this user');
        return;
      }

      // Delete old responses for this user's prompts
      const promptIds = confirmedPrompts.map((p: any) => p.id);
      if (promptIds.length > 0) {
        await supabase
          .from('prompt_responses')
          .delete()
          .in('confirmed_prompt_id', promptIds);
      }

      const models = [
        { name: 'openai', fn: 'test-prompt-openai' },
        { name: 'perplexity', fn: 'test-prompt-perplexity' },
        { name: 'gemini', fn: 'test-prompt-gemini' },
      ];

      for (const prompt of confirmedPrompts) {
        for (const model of models) {
          try {
            const { data: resp, error } = await supabase.functions.invoke(model.fn, {
              body: {
                prompt: prompt.prompt_text,
                companyName: target.company_name,
                industry: target.industry,
              },
            });
            if (error) continue;

            await supabase.from('prompt_responses').insert({
              confirmed_prompt_id: prompt.id,
              ai_model: model.name,
              response_text: (resp as any)?.response || (resp as any)?.content || '',
            });
          } catch (e) {
            console.error('Model run error', e);
          }
        }
      }

      toast.success(`Refreshed models for ${target.email}`);
      await fetchUsers();
    } catch (e: any) {
      console.error('Error refreshing user models:', e);
      toast.error('Failed to refresh user models');
    } finally {
      setRefreshingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : 'Never');

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-gray-600">View users and refresh their data</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchUsers} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh List
          </Button>
          <Button onClick={signOut} variant="ghost" className="text-red-600 hover:text-red-700">
            <LogOut className="w-4 h-4 mr-2" />
            Log out
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" /> Users ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-gray-500" />
                      {u.company_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.industry}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      {fmt(u.last_updated)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.subscription_type === 'pro' ? 'default' : 'secondary'}>
                      {u.subscription_type === 'pro' ? 'Pro' : 'Free'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.has_prompts ? 'default' : 'destructive'}>
                      {u.has_prompts ? 'Active' : 'No Prompts'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      onClick={() => refreshUserModels(u.id)}
                      disabled={refreshingUsers.has(u.id) || !u.has_prompts}
                      size="sm"
                      variant="outline"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${refreshingUsers.has(u.id) ? 'animate-spin' : ''}`} />
                      {refreshingUsers.has(u.id) ? 'Refreshing…' : 'Refresh Models'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}


