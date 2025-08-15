import { BarChart3, FileText, MessageSquare, Search, TrendingUp, HelpCircle, CheckCircle2, ActivitySquare, Target, Globe, Users, Lock } from "lucide-react";
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
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';

interface NavigationItem {
  title: string;
  icon: any;
  section: string;
  comingSoon?: boolean;
  requiresPro?: boolean;
  group: string;
  route?: string;
}

interface NavigationGroup {
  title: string;
  items: NavigationItem[];
}

const navigationGroups: NavigationGroup[] = [
  {
    title: "Dashboard",
    items: [
      { title: "Overview", icon: BarChart3, section: "overview", group: "dashboard", route: "/dashboard" },
      { title: "Sources", icon: Globe, section: "sources", group: "dashboard", route: "/dashboard/sources" },
      { title: "Competitors", icon: Users, section: "competitors", group: "dashboard", route: "/dashboard/competitors" },
    ]
  },
  {
    title: "Monitoring",
    items: [
      { title: "Prompts", icon: MessageSquare, section: "prompts", group: "monitor", route: "/monitor" },
      { title: "Responses", icon: FileText, section: "responses", group: "monitor", route: "/monitor/responses" },
    ]
  },
  {
    title: "Analyze",
    items: [
      { title: "TalentX", icon: Target, section: "talentx", comingSoon: true, group: "analyze", route: "/analyze" },
      { title: "Answer Gaps", icon: Search, section: "answer-gaps", comingSoon: true, group: "analyze", route: "/analyze/answer-gaps" },
      { title: "Reports", icon: TrendingUp, section: "reports", comingSoon: true, group: "analyze", route: "/analyze/reports" },
    ]
  }
];

// Flatten all items for the collapsed sidebar
const allNavigationItems = navigationGroups.flatMap(group => group.items);

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export function AppSidebar({ activeSection, onSectionChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { isPro } = useSubscription();
  const navigate = useNavigate();

  const handleSectionClick = (item: NavigationItem) => {
    // All items now have unique routes, so always navigate
    if (item.route) {
      navigate(item.route);
    } else {
      // Fallback for items without routes
      onSectionChange(item.section);
    }
  };

  if (isCollapsed) {
    // Render a minimal sidebar with only logo, trigger, and icons
    return (
      <>
        <aside className="h-full flex flex-col items-center bg-white border-r w-[4rem] min-w-[4rem] max-w-[4rem]">
          <div className="flex flex-col items-center gap-2 py-4 w-full">
            <div className="relative">
              <img
                alt="Perception Logo"
                className="object-contain h-8 w-8"
                src="/logos/perceptionx-small.png"
              />
              {isPro && (
                <Badge className="absolute -top-1 -right-1 bg-[#0DBCBA] text-white px-1.5 py-0.5 text-[8px] font-bold border-2 border-white">
                  PRO
                </Badge>
              )}
            </div>
            <SidebarTrigger className="h-8 w-8" />
          </div>
          <nav className="flex flex-col items-center gap-2 flex-1 w-full mt-2">
            {allNavigationItems.map((item) => (
              <SidebarMenuButton
                key={item.section}
                isActive={activeSection === item.section}
                onClick={() => handleSectionClick(item)}
                className="w-10 h-10 flex items-center justify-center rounded-lg p-0 relative"
                title={item.title}
              >
                <item.icon className="h-5 w-5" />
                {item.comingSoon && (
                  <span className="absolute top-1 right-1 block w-2 h-2 rounded-full bg-gray-400" title="Coming Soon"></span>
                )}
                {item.requiresPro && !isPro && (
                  <Lock className="absolute top-1 right-1 h-3 w-3 text-gray-400" title="Pro Feature" />
                )}
              </SidebarMenuButton>
            ))}
                  </nav>
      </aside>
    </>
  );
  }

  // Expanded sidebar (full layout)
  return (
    <>
      <Sidebar className="border-r bg-white/90 backdrop-blur-sm transition-all duration-200">
        <SidebarHeader className="border-b border-gray-200/50 flex flex-row items-center p-6">
          <div className="flex items-center gap-2">
            <img
              alt="Perception Logo"
              className="object-contain h-4"
              src="/logos/PerceptionX-PrimaryLogo.png"
            />
            {isPro && (
              <Badge className="bg-[#0DBCBA] text-white px-2 py-0.5 text-xs font-bold">
                PRO
              </Badge>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent className="flex-1">
          {navigationGroups.map((group, groupIndex) => (
            <SidebarGroup key={group.title}>
              <SidebarGroupContent>
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {group.title}
                    </h3>
                    {group.title === "Analyze" && !isPro && (
                      <Badge className="bg-[#0DBCBA] text-white px-1.5 py-0.5 text-[8px] font-bold flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Pro
                      </Badge>
                    )}
                  </div>
                </div>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.section}>
                      <SidebarMenuButton
                        isActive={activeSection === item.section}
                        onClick={() => handleSectionClick(item)}
                        className="w-full justify-start relative"
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="text-sm">{item.title}</span>
                        {item.comingSoon && (
                          <Badge className="ml-2 bg-gray-200 text-gray-700 px-2 py-0.5 text-[10px] font-semibold">Coming Soon</Badge>
                        )}
                        {item.requiresPro && !isPro && (
                          <Badge className="ml-2 bg-[#0DBCBA] text-white px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            Pro
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="p-4 flex flex-col gap-3">
          <div className="w-full rounded-lg border border-pink-600 bg-pink-100/60 text-pink-800 text-xs px-4 py-3 mb-1">
            <span className="font-semibold block mb-1">Dashboard is in BETA</span>
            Please reach out to <a href="mailto:karim@perceptionx.ai" className="underline font-medium">karim@perceptionx.ai</a> if you have any feedback.
          </div>

          <UserMenu />
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
