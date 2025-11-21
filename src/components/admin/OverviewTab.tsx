import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Users, Briefcase, TrendingUp, Database, Activity } from 'lucide-react';
import { toast } from 'sonner';

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
      console.error('Error loading stats:', error);
      toast.error('Failed to load system statistics');
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'Organizations',
      value: stats.totalOrganizations,
      icon: Briefcase,
      color: 'text-pink',
      bgColor: 'bg-pink/10'
    },
    {
      title: 'Users',
      value: stats.totalUsers,
      icon: Users,
      color: 'text-teal',
      bgColor: 'bg-teal/10'
    },
    {
      title: 'Companies',
      value: stats.totalCompanies,
      icon: Building2,
      color: 'text-nightsky',
      bgColor: 'bg-nightsky/10'
    },
    {
      title: 'Total Prompts',
      value: stats.totalPrompts,
      icon: Database,
      color: 'text-pink',
      bgColor: 'bg-pink/10'
    },
    {
      title: 'Total Responses',
      value: stats.totalResponses,
      icon: TrendingUp,
      color: 'text-teal',
      bgColor: 'bg-teal/10'
    },
    {
      title: 'Recent Activity',
      value: stats.recentActivity,
      icon: Activity,
      color: 'text-nightsky',
      bgColor: 'bg-nightsky/10',
      subtitle: 'Last 7 days'
    }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink mx-auto mb-4"></div>
          <p className="text-nightsky/60">Loading statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-bold text-nightsky">System Overview</h1>
        <p className="text-nightsky/60 mt-2">Monitor your PerceptionX system at a glance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="border-none shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-nightsky/60 font-medium mb-1">{stat.title}</p>
                    <p className="text-3xl font-bold text-nightsky">{stat.value.toLocaleString()}</p>
                    {stat.subtitle && (
                      <p className="text-xs text-nightsky/40 mt-1">{stat.subtitle}</p>
                    )}
                  </div>
                  <div className={`${stat.bgColor} ${stat.color} p-3 rounded-lg`}>
                    <Icon className="h-6 w-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => window.location.reload()}
              className="p-4 border border-silver rounded-lg hover:bg-silver/50 transition-colors text-left"
            >
              <Briefcase className="h-5 w-5 text-pink mb-2" />
              <p className="font-medium text-nightsky">Manage Organizations</p>
              <p className="text-sm text-nightsky/60 mt-1">Add and configure organizations</p>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="p-4 border border-silver rounded-lg hover:bg-silver/50 transition-colors text-left"
            >
              <Building2 className="h-5 w-5 text-teal mb-2" />
              <p className="font-medium text-nightsky">Company Management</p>
              <p className="text-sm text-nightsky/60 mt-1">Update company data and settings</p>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="p-4 border border-silver rounded-lg hover:bg-silver/50 transition-colors text-left"
            >
              <Users className="h-5 w-5 text-nightsky mb-2" />
              <p className="font-medium text-nightsky">User Management</p>
              <p className="text-sm text-nightsky/60 mt-1">Manage user access and permissions</p>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};











