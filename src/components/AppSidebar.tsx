import { BarChart3, FileText, MessageSquare, Search, Settings, TrendingUp } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import UserMenu from "@/components/UserMenu";
import { Button } from "@/components/ui/button";

interface NavigationItem {
  title: string;
  icon: any;
  section: string;
}

const navigationItems: NavigationItem[] = [
  { title: "Overview", icon: BarChart3, section: "overview" },
  { title: "Prompts", icon: MessageSquare, section: "prompts" },
  { title: "Responses", icon: FileText, section: "responses" },
  { title: "Answer Gaps", icon: Search, section: "answer-gaps" },
  { title: "Reports", icon: TrendingUp, section: "reports" },
];

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export function AppSidebar({ activeSection, onSectionChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar className="border-r bg-white/90 backdrop-blur-sm">
      <SidebarHeader className="border-b border-gray-200/50 p-6">
        <div className="flex items-center justify-between">
          <img 
            alt="Perception Logo" 
            className="h-4 object-fill" 
            src="/lovable-uploads/f1e89523-319d-4c42-bf67-03c76342a128.png" 
          />
          <SidebarTrigger className="h-7 w-7" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.section}>
                  <SidebarMenuButton
                    isActive={activeSection === item.section}
                    onClick={() => onSectionChange(item.section)}
                    className="w-full justify-start"
                  >
                    <item.icon className="h-4 w-4" />
                    {!isCollapsed && <span>{item.title}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-gray-200/50 p-4">
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
