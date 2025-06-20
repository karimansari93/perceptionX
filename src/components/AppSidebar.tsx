import { BarChart3, FileText, MessageSquare, Search, TrendingUp, HelpCircle, Calendar, CheckCircle2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import UserMenu from "@/components/UserMenu";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { UpgradeModal } from '@/components/upgrade/UpgradeModal';

interface NavigationItem {
  title: string;
  icon: any;
  section: string;
  comingSoon?: boolean;
}

const navigationItems: NavigationItem[] = [
  { title: "Overview", icon: BarChart3, section: "overview" },
  { title: "Prompts", icon: MessageSquare, section: "prompts" },
  { title: "Responses", icon: FileText, section: "responses" },
  { title: "Answer Gaps", icon: Search, section: "answer-gaps", comingSoon: true },
  { title: "Reports", icon: TrendingUp, section: "reports", comingSoon: true },
];

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export function AppSidebar({ activeSection, onSectionChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  if (isCollapsed) {
    // Render a minimal sidebar with only logo, trigger, and icons
    return (
      <aside className="h-full flex flex-col items-center bg-white border-r w-[4rem] min-w-[4rem] max-w-[4rem]">
        <div className="flex flex-col items-center gap-2 py-4 w-full">
          <img
            alt="Perception Logo"
            className="object-contain h-8 w-8"
            src="/logos/perceptionx-small.png"
          />
          <SidebarTrigger className="h-8 w-8" />
        </div>
        <nav className="flex flex-col items-center gap-2 flex-1 w-full mt-2">
          {navigationItems.map((item) => (
            <SidebarMenuButton
              key={item.section}
              isActive={activeSection === item.section}
              onClick={() => onSectionChange(item.section)}
              className="w-10 h-10 flex items-center justify-center rounded-lg p-0 relative"
              title={item.title}
            >
              <item.icon className="h-5 w-5" />
              {item.comingSoon && (
                <span className="absolute top-1 right-1 block w-2 h-2 rounded-full bg-gray-400" title="Coming Soon"></span>
              )}
            </SidebarMenuButton>
          ))}
        </nav>
      </aside>
    );
  }

  // Expanded sidebar (full layout)
  return (
    <Sidebar className="border-r bg-white/90 backdrop-blur-sm transition-all duration-200">
      <SidebarHeader className="border-b border-gray-200/50 flex flex-row items-center p-6">
        <img
          alt="Perception Logo"
          className="object-contain h-4"
          src="/logos/perceptionx-normal.png"
        />
      </SidebarHeader>
      <SidebarContent className="flex-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.section}>
                  <SidebarMenuButton
                    isActive={activeSection === item.section}
                    onClick={() => onSectionChange(item.section)}
                    className="w-full justify-start relative"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                    {item.comingSoon && (
                      <Badge className="ml-2 bg-gray-200 text-gray-700 px-2 py-0.5 text-xs font-semibold">Coming Soon</Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 flex flex-col gap-3">
        <div className="w-full rounded-lg border border-pink-600 bg-pink-100/60 text-pink-800 text-xs px-4 py-3 mb-1">
          <span className="font-semibold block mb-1">Dashboard is in Alpha</span>
          Please reach out to <a href="mailto:karim@perceptionx.co" className="underline font-medium">karim@perceptionx.co</a> if you have any feedback.
        </div>
        
        <Button
          onClick={() => setShowUpgradeModal(true)}
          variant="outline"
          className="w-full border-primary text-primary hover:bg-primary/10 hover:text-primary"
        >
          <Calendar className="w-4 h-4 mr-2 text-primary" />
          Upgrade to Pro
        </Button>

        <UserMenu />
      </SidebarFooter>

      <UpgradeModal 
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
      />
    </Sidebar>
  );
}
