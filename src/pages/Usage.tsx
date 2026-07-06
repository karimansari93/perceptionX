import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarProvider, SidebarInset, Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { User, BarChart3, ArrowLeft } from 'lucide-react';
import UserMenu from '@/components/UserMenu';
import { useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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
              tooltip={isCollapsed ? 'Usage' : undefined}
            >
              <BarChart3 className="h-4 w-4" />
              {!isCollapsed && <span className="text-sm">Usage</span>}
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
  useDocumentTitle('Usage');
  const [activeSection, setActiveSection] = React.useState('usage');
  useAuth();

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
                  <CardTitle>Account</CardTitle>
                  <CardDescription>Your access level.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 font-semibold text-lg">
                    Full Access
                  </div>
                  <div className="mb-4 text-gray-600">
                    You have access to all prompts and features.
                  </div>
                </CardContent>
              </Card>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
