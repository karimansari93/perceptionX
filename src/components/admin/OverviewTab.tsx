import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Users, Briefcase, TrendingUp, Database, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/utils';

interface SystemStats {
  totalOrganizations: number;
  totalUsers: number;
  totalCompanies: number;
  totalPrompts: number;
  totalResponses: number;
  recentActivity: number;
}

export const OverviewTab = () => {
  const [stats, setStats] = useState<SystemStats>({
    totalOrganizations: 0,
    totalUsers: 0,
    totalCompanies: 0,
    totalPrompts: 0,
    totalResponses: 0,
    recentActivity: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Get organizations count
      const { count: orgCount, error: orgError } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true });

      // Get users count
      const { count: userCount, error: userError } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // Get companies count
      const { count: companyCount, error: companyError } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true });

      // Get prompts count
      const { count: promptCount, error: promptError } = await supabase
        .from('confirmed_prompts')
        .select('*', { count: 'exact', head: true });

      // Get responses count
      const { count: responseCount, error: responseError } = await supabase
        .from('prompt_responses')
        .select('*', { count: 'exact', head: true });

      // Get recent activity (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { count: recentCount, error: recentError } = await supabase
        .from('prompt_responses')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo.toISOString());

      if (orgError || userError || companyError || promptError || responseError || recentError) {
        throw new Error('Failed to load stats');
      }

      setStats({
        totalOrganizations: orgCount || 0,
        totalUsers: userCount || 0,
        totalCompanies: companyCount || 0,
        totalPrompts: promptCount || 0,
        totalResponses: responseCount || 0,
        recentActivity: recentCount || 0
      });
    } catch (error) {
      logger.error('Error loading stats:', error);
      toast.error('Failed to load system statistics');
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { title: 'Organizations', value: stats.totalOrganizations, icon: Briefcase, subtitle: null },
    { title: 'Users', value: stats.totalUsers, icon: Users, subtitle: null },
    { title: 'Companies', value: stats.totalCompanies, icon: Building2, subtitle: null },
    { title: 'Total Prompts', value: stats.totalPrompts, icon: Database, subtitle: null },
    { title: 'Total Responses', value: stats.totalResponses, icon: TrendingUp, subtitle: null },
    { title: 'Recent Activity', value: stats.recentActivity, icon: Activity, subtitle: 'Last 7 days' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-slate-600 mx-auto mb-3"></div>
          <p className="text-sm text-slate-500">Loading statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-headline font-semibold text-slate-800">System Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">Monitor your PerceptionX system at a glance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="border border-slate-200 shadow-sm bg-white">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{stat.title}</p>
                    <p className="text-2xl font-semibold text-slate-800 mt-0.5">{stat.value.toLocaleString()}</p>
                    {stat.subtitle && (
                      <p className="text-xs text-slate-400 mt-0.5">{stat.subtitle}</p>
                    )}
                  </div>
                  <div className="p-2 rounded-md bg-slate-100 text-slate-500 flex-shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border border-slate-200 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-slate-800">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              onClick={() => window.location.reload()}
              className="p-3 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors text-left"
            >
              <Briefcase className="h-4 w-4 text-slate-500 mb-1.5" />
              <p className="text-sm font-medium text-slate-800">Manage Organizations</p>
              <p className="text-xs text-slate-500 mt-0.5">Add and configure organizations</p>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="p-3 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors text-left"
            >
              <Building2 className="h-4 w-4 text-slate-500 mb-1.5" />
              <p className="text-sm font-medium text-slate-800">Company Management</p>
              <p className="text-xs text-slate-500 mt-0.5">Update company data and settings</p>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="p-3 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors text-left"
            >
              <Users className="h-4 w-4 text-slate-500 mb-1.5" />
              <p className="text-sm font-medium text-slate-800">User Management</p>
              <p className="text-xs text-slate-500 mt-0.5">Manage user access and permissions</p>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};











