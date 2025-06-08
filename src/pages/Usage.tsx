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
          src={isCollapsed ? "/logos/perceptionx-small.png" : "/logos/perceptionx-normal.png"}
        />
        <SidebarTrigger className="h-7 w-7 md:hidden" />
      </SidebarHeader>
      <SidebarContent className="flex-1 flex flex-col gap-2 p-0">
        <button
          onClick={() => navigate('/dashboard')}
          className={`flex items-center w-full rounded-lg px-3 py-2 text-base font-normal text-gray-700 hover:bg-gray-100 transition-colors mb-1 ${isCollapsed ? 'justify-center' : 'justify-start'}`}
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
              <User className="h-5 w-5" />
              {!isCollapsed && <span>Account & Settings</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'usage'}
              onClick={() => { onSectionChange('usage'); navigate('/usage'); }}
              className="w-full justify-start relative"
              tooltip={isCollapsed ? 'Usage & Plans' : undefined}
            >
              <BarChart3 className="h-5 w-5" />
              {!isCollapsed && <span>Usage & Plans</span>}
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

  const handleRefresh = async (modelType?: string) => {
    if (!companyName) return;
    await refreshAllPrompts(companyName, modelType);
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
                  <div className="mb-2 font-semibold text-lg">You don't have a plan yet</div>
                  <div className="mb-4 text-gray-600">All users are free during alpha. Paid plans coming soon.</div>
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
                      <span>{USAGE_DATA.prompts} / {USAGE_LIMITS.prompts}</span>
                    </div>
                    <Progress value={(USAGE_DATA.prompts / USAGE_LIMITS.prompts) * 100} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1 text-sm font-medium">
                      <span>Team Members</span>
                      <span>{USAGE_DATA.teamMembers} / {USAGE_LIMITS.teamMembers}</span>
                    </div>
                    <Progress value={(USAGE_DATA.teamMembers / USAGE_LIMITS.teamMembers) * 100} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1 text-sm font-medium">
                      <span>Projects</span>
                      <span>{USAGE_DATA.projects} / {USAGE_LIMITS.projects}</span>
                    </div>
                    <Progress value={(USAGE_DATA.projects / USAGE_LIMITS.projects) * 100} />
                  </div>
                </CardContent>
              </Card>
              <div className="mb-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={isRefreshing} variant="outline" size="sm" className="flex items-center space-x-2 bg-white/80">
                      <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                      <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => handleRefresh()}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh All Models
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRefresh('openai')}>
                      <LLMLogo modelName="openai" size="sm" className="mr-2" />
                      Refresh OpenAI Only
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRefresh('perplexity')}>
                      <LLMLogo modelName="perplexity" size="sm" className="mr-2" />
                      Refresh Perplexity Only
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRefresh('gemini')}>
                      <LLMLogo modelName="gemini" size="sm" className="mr-2" />
                      Refresh Gemini Only
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRefresh('deepseek')}>
                      <LLMLogo modelName="deepseek" size="sm" className="mr-2" />
                      Refresh DeepSeek Only
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="ml-4 text-gray-500 text-sm">This will re-run your prompts and refresh your AI responses.</span>
                {isRefreshing && progress && (
                  <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-sm font-medium text-primary">Refreshing AI Responses</span>
                      </div>
                      <span className="text-sm text-primary/70">
                        {progress.completed} / {progress.total}
                      </span>
                    </div>
                    <div className="w-full bg-primary/20 rounded-full h-2 mb-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${progress.completed / progress.total * 100}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-primary/70">
                      <div>Testing: {progress.currentPrompt}</div>
                      <div>Model: {progress.currentModel}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
} 