import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarProvider, SidebarInset, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { User, BarChart3, ArrowLeft, RefreshCw, ChevronDown } from 'lucide-react';
import UserMenu from '@/components/UserMenu';
import { useNavigate } from 'react-router-dom';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useRefreshPrompts } from '@/hooks/useRefreshPrompts';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import LLMLogo from '@/components/LLMLogo';
import { useSubscription } from '@/hooks/useSubscription';
import { TalentXProService } from '@/services/talentXProService';
import { supabase } from '@/integrations/supabase/client';

const USAGE_LIMITS = {
  prompts: 3,
  teamMembers: 1,
  projects: 1,
};

const USAGE_DATA = {
  prompts: 3,
  teamMembers: 1,
  projects: 1,
};

function UsageSidebar({ activeSection, onSectionChange }) {
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const navigate = useNavigate();

  return (
    <Sidebar className="border-r bg-white/90 backdrop-blur-sm transition-all duration-200">
      <SidebarHeader className="border-b border-gray-200/50 flex flex-row items-center justify-between p-6">
        <img
          alt="Perception Logo"
          className="object-contain h-4"
          src={isCollapsed ? "/logos/perceptionx-small.png" : "/logos/PerceptionX-PrimaryLogo.png"}
        />
        <SidebarTrigger className="h-7 w-7 md:hidden" />
      </SidebarHeader>
      <SidebarContent className="flex-1">
        <button
          onClick={() => navigate('/dashboard')}
          className={`flex items-center w-full rounded-lg px-3 py-2 text-base font-normal text-gray-700 hover:bg-gray-100 transition-colors ${isCollapsed ? 'justify-center' : 'justify-start'}`}
          type="button"
        >
          <ArrowLeft className="w-5 h-5" />
          {!isCollapsed && <span className="ml-2">Go back</span>}
        </button>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'account'}
              onClick={() => { onSectionChange('account'); navigate('/account'); }}
              className="w-full justify-start relative"
              tooltip={isCollapsed ? 'Account & Settings' : undefined}
            >
              <User className="h-4 w-4" />
              {!isCollapsed && <span className="text-sm">Account & Settings</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'usage'}
              onClick={() => { onSectionChange('usage'); navigate('/usage'); }}
              className="w-full justify-start relative"
              tooltip={isCollapsed ? 'Usage & Plans' : undefined}
            >
              <BarChart3 className="h-4 w-4" />
              {!isCollapsed && <span className="text-sm">Usage & Plans</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-4 flex flex-col gap-3">
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

export default function Usage() {
  const [activeSection, setActiveSection] = React.useState('usage');
  const navigate = useNavigate();
  const { companyName } = useDashboardData();
  const { isRefreshing, progress, refreshAllPrompts } = useRefreshPrompts();
  const { subscription, isPro, getLimits } = useSubscription();
  const { user } = useAuth();
  const [isResetting, setIsResetting] = React.useState(false);

  const handleRefresh = async (modelType?: string) => {
    if (!companyName) return;
    await refreshAllPrompts(companyName, { modelType });
  };

  const handleResetTalentX = async () => {
    if (!user) return;
    setIsResetting(true);
    try {
      // First check if prompts exist, if not generate them
      const hasPrompts = await TalentXProService.hasProPrompts(user.id);
      
      if (!hasPrompts) {
        // Get company info from onboarding
        const { data: onboardingData } = await supabase
          .from('user_onboarding')
          .select('company_name, industry')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        const companyName = onboardingData?.company_name || 'Your Company';
        const industry = onboardingData?.industry || 'Technology';
        
        await TalentXProService.generateProPrompts(user.id, companyName, industry);
        alert('TalentX Pro prompts generated successfully! You can now refresh to process them.');
      } else {
        // Reset existing prompts
        await TalentXProService.resetProPrompts(user.id);
        alert('TalentX Pro prompts reset successfully! You can now refresh to process them again.');
      }
    } catch (error) {
      console.error('Error with TalentX Pro prompts:', error);
      alert('Error with TalentX Pro prompts. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  const limits = getLimits();
  const usageData = {
    prompts: subscription?.prompts_used || 0,
    teamMembers: 1, // Team member tracking - coming soon
    projects: 1, // Project tracking - coming soon
  };

  return (
    <SidebarProvider>
      <div className="relative min-h-screen w-full flex flex-row">
        <div className="transition-all duration-200 h-full">
          <UsageSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        </div>
        <div className="flex-1 min-w-0">
          <SidebarInset>
            {/* Hamburger for mobile */}
            <div className="md:hidden flex items-center mb-4">
              <SidebarTrigger className="h-8 w-8" />
            </div>
            <div className="flex-1 space-y-8 p-8 max-w-2xl mx-auto">
              <Card>
                <CardHeader>
                  <CardTitle>Billing Settings</CardTitle>
                  <CardDescription>Manage your billing information and subscription.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 font-semibold text-lg">
                    {isPro ? 'Pro Plan' : 'Free Plan'}
                  </div>
                  <div className="mb-4 text-gray-600">
                    {isPro 
                      ? 'You have access to unlimited prompts and advanced features.'
                      : 'Upgrade to Pro for unlimited prompts and advanced features.'
                    }
                  </div>
                  {!isPro && (
                    <Button variant="outline" className="w-full">
                      Upgrade to Pro
                    </Button>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Usage</CardTitle>
                  <CardDescription>
                    Overview of your current plan's feature usage and limits for the period of N/A.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <div className="flex justify-between mb-1 text-sm font-medium">
                      <span>Active Prompts</span>
                      <span>{usageData.prompts} / {limits.prompts}</span>
                    </div>
                    <Progress value={(usageData.prompts / limits.prompts) * 100} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1 text-sm font-medium">
                      <span>Team Members</span>
                      <span>{usageData.teamMembers} / {limits.teamMembers}</span>
                    </div>
                    <Progress value={(usageData.teamMembers / limits.teamMembers) * 100} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1 text-sm font-medium">
                      <span>Projects</span>
                      <span>{usageData.projects} / {limits.projects}</span>
                    </div>
                    <Progress value={(usageData.projects / limits.projects) * 100} />
                  </div>
                </CardContent>
              </Card>
              {/* Removed refresh and reset TalentX prompts UI for Pro users */}
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
} 