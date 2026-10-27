import { BarChart3, MessageSquare, TrendingUp, HelpCircle, CheckCircle2, ActivitySquare, Globe, Users, Lightbulb, Download, Compass, UserPlus, Search, Sparkles, Plug, ListChecks } from "lucide-react";
import { ASK_AI_ENABLED } from "@/lib/askAi";
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
import { useNavigate } from 'react-router-dom';
import { useWalkthrough } from '@/contexts/WalkthroughContext';
import { useSuperAdminOrgs } from '@/hooks/useIsSuperAdmin';
import InviteTeammatesModal from '@/components/team/InviteTeammatesModal';
import { WhatsNewModal } from '@/components/announcement/WhatsNewModal';
import { useAnnouncement } from '@/hooks/useAnnouncement';
import { useAuth } from '@/contexts/AuthContext';
import type { AnnouncementStep } from '@/lib/announcements';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { SEARCH_SHORTCUT } from '@/lib/searchShortcut';

interface NavigationItem {
  title: string;
  icon: any;
  section: string;
  comingSoon?: boolean;
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
      { title: "Themes", icon: Lightbulb, section: "thematic", group: "dashboard", route: "/dashboard/themes" },
      { title: "Actions", icon: ListChecks, section: "actions", group: "dashboard", route: "/dashboard/actions" },
    ]
  },
  {
    title: "Analyze",
    items: [
      // Ask PerceptionX — the in-app analyst (same tools and rulebook as the
      // ChatGPT/Claude connector). Hidden by the VITE_ASK_AI_ENABLED kill switch.
      ...(ASK_AI_ENABLED ? [{ title: "Ask AI", icon: Sparkles, section: "chat", group: "analyze", route: "/chat" }] : []),
      { title: "Reports", icon: Download, section: "reports", group: "reports", route: "/analyze/reports" },
      { title: "Prompts", icon: MessageSquare, section: "prompts", group: "monitor", route: "/monitor" },
    ]
  },
  // Temporarily hidden - Analyze section
  // {
  //   title: "Analyze",
  //   items: [
  //     { title: "Career Site", icon: Globe, section: "career-site", group: "analyze", route: "/analyze/career-site" },
  //   ]
  // }
];

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  /** Opens the global command palette (⌘K / Ctrl+K search). */
  onOpenSearch?: () => void;
}


export function AppSidebar({ activeSection, onSectionChange, onOpenSearch }: AppSidebarProps) {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const { start: startWalkthrough } = useWalkthrough();
  const { orgs: superAdminOrgs } = useSuperAdminOrgs();
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  // What's-new: opens once per announcement version for returning users
  // (ProfileSetupGate runs first, so brand-new accounts never see it), and
  // again from the "Set up AI integrations" card, straight on the form.
  const { user } = useAuth();
  const { unseen: announcementUnseen, markSeen: markAnnouncementSeen } = useAnnouncement(user);
  const [whatsNew, setWhatsNew] = useState<{ open: boolean; step: AnnouncementStep }>({ open: false, step: 'intro' });
  useEffect(() => {
    if (ASK_AI_ENABLED && announcementUnseen) setWhatsNew({ open: true, step: 'intro' });
  }, [announcementUnseen]);
  const closeWhatsNew = () => { setWhatsNew(w => ({ ...w, open: false })); void markAnnouncementSeen(); };

  const handleSectionClick = (item: NavigationItem) => {
    // Coming-soon items are locked — keep the entry visible but disable navigation
    if (item.comingSoon) return;
    // All items now have unique routes, so always navigate
    if (item.route) {
      navigate(item.route);
    } else {
      // Fallback for items without routes
      onSectionChange(item.section);
    }
  };

  const modals = (
    <>
      <WhatsNewModal open={whatsNew.open} initialStep={whatsNew.step} onClose={closeWhatsNew} />
      <InviteTeammatesModal
        open={inviteModalOpen}
        onOpenChange={setInviteModalOpen}
        orgs={superAdminOrgs}
      />
    </>
  );

  // Desktop: a narrow icon rail with each label under its icon (after
  // Zoom's), so the dashboard gets the width; search lives in the top bar.
  // Phones keep the full sidebar, opened as a sheet from the header.
  if (!isMobile) {
    const railItem = (key: string, label: string, Icon: typeof Search, onClick: () => void, opts: { active?: boolean; tour?: string; muted?: boolean } = {}) => (
      <button
        key={key}
        type="button"
        onClick={onClick}
        data-tour={opts.tour}
        aria-current={opts.active ? 'page' : undefined}
        className={cn(
          'flex w-[70px] flex-col items-center gap-1 rounded-xl px-0 py-1.5 text-[10px] tracking-[-0.01em] leading-tight transition-colors [@media(max-height:700px)]:py-1',
          opts.active ? 'bg-white font-semibold text-[#13274F] shadow-[0_1px_3px_rgba(19,39,79,.1)]' : 'text-gray-600 hover:bg-white/70 hover:text-[#13274F]',
          opts.muted && 'cursor-not-allowed opacity-60'
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
        <span className="w-full truncate text-center">{label}</span>
      </button>
    );
    return (
      <>
        <aside aria-label="Main navigation" className="flex h-full w-[80px] flex-none flex-col items-center border-r border-gray-200/70 bg-gray-50 pb-3">
          {/* The logo block is the header's height, and its bottom border
              continues the header's line across the rail. */}
          <div className="box-content flex h-16 w-full flex-none items-center justify-center border-b border-gray-200/50">
            <img alt="PerceptionX" className="h-7 w-7 object-contain" src="/logos/perceptionx-small.png" />
          </div>
          <nav className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto pt-3">
            {navigationGroups.map((group, i) => (
              <div key={group.title} className="flex w-full flex-col items-center gap-1">
                {i > 0 && <div className="my-1 h-px w-8 bg-gray-200" />}
                {group.items.map(item => railItem(
                  item.section,
                  item.title,
                  item.icon,
                  () => handleSectionClick(item),
                  { active: activeSection === item.section, muted: item.comingSoon },
                ))}
              </div>
            ))}
          </nav>
          <div className="flex w-full flex-col items-center gap-1 pt-2">
            {ASK_AI_ENABLED && railItem('integrations', 'Connect AI', Plug, () => setWhatsNew({ open: true, step: 'form' }))}
            {railItem('tour', 'Tour', Compass, startWalkthrough)}
            {superAdminOrgs.length > 0 && railItem('invite', 'Invite', UserPlus, () => setInviteModalOpen(true))}
            <div className="mt-1"><UserMenu compact /></div>
          </div>
        </aside>
        {modals}
      </>
    );
  }

  // Expanded sidebar (full layout)
  return (
    <>
      <Sidebar className="border-r bg-white/90 backdrop-blur-sm transition-all duration-200">
        <SidebarHeader className="h-16 box-content border-b border-gray-200/50 flex flex-row items-center justify-between px-6 py-0">
          <div className="flex items-center gap-2">
            <img
              alt="Perception Logo"
              className="object-contain h-4"
              src="/logos/PerceptionX-PrimaryLogo.png"
            />
          </div>
          <SidebarTrigger className="h-7 w-7 text-[#13274F]" />
        </SidebarHeader>
        <SidebarContent className="flex-1">
          {onOpenSearch && (
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={onOpenSearch}
                className="w-full flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                <Search className="h-4 w-4 text-gray-400" />
                <span className="flex-1 text-left">Search…</span>
                <kbd className="pointer-events-none inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                  {SEARCH_SHORTCUT}
                </kbd>
              </button>
            </div>
          )}
          {navigationGroups.map((group, groupIndex) => (
            <SidebarGroup key={group.title} className="py-1">
              <SidebarGroupContent>
                <div className="px-3 pt-1 pb-1.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {group.title}
                    </h3>
                  </div>
                </div>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.section}>
                      <SidebarMenuButton
                        isActive={activeSection === item.section}
                        onClick={() => handleSectionClick(item)}
                        aria-disabled={item.comingSoon || undefined}
                        className={`w-full justify-start relative [@media(max-height:740px)]:py-1.5 ${item.comingSoon ? "cursor-not-allowed opacity-60 hover:bg-transparent" : ""}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="text-sm">{item.title}</span>
                        {item.comingSoon && (
                          <Badge className="ml-2 bg-gray-200 text-gray-700 px-2 py-0.5 text-[10px] font-semibold">Coming Soon</Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="p-4 pt-2 flex flex-col gap-2 [@media(max-height:740px)]:gap-1.5 [@media(max-height:740px)]:pb-3">
          {ASK_AI_ENABLED && (
            <button
              type="button"
              onClick={() => setWhatsNew({ open: true, step: 'form' })}
              className="w-full rounded-xl border border-[#DB5E89]/[0.32] bg-gradient-to-br from-[#DB5E89]/[0.12] via-white via-[62%] to-[#0DBCBA]/[0.07] p-3 text-left transition-colors hover:border-[#DB5E89] flex items-center gap-3 [@media(max-height:740px)]:p-2 [@media(max-height:660px)]:hidden"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[#13274F]/10 bg-white text-[#DB5E89] [@media(max-height:740px)]:h-7 [@media(max-height:740px)]:w-7">
                <Plug className="h-[18px] w-[18px] [@media(max-height:740px)]:h-4 [@media(max-height:740px)]:w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block whitespace-nowrap text-[13px] font-semibold leading-[1.2] text-[#13274F]">Set up AI integrations</span>
                <span className="mt-0.5 block text-[11px] leading-[1.3] text-[#6b7280] [@media(max-height:860px)]:hidden">Use PerceptionX in ChatGPT or any other AI</span>
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={startWalkthrough}
            className="group w-full text-left rounded-xl border border-[#0DBCBA]/30 bg-gradient-to-br from-[#0DBCBA]/10 via-white to-[#13274F]/5 hover:from-[#0DBCBA]/15 hover:to-[#13274F]/10 hover:border-[#0DBCBA]/60 hover:shadow-md transition-all p-3 flex items-center gap-3 [@media(max-height:740px)]:p-2"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#0DBCBA] text-white shadow-sm group-hover:scale-105 transition-transform [@media(max-height:740px)]:h-7 [@media(max-height:740px)]:w-7">
              <Compass className="h-5 w-5 [@media(max-height:740px)]:h-4 [@media(max-height:740px)]:w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#13274F] leading-tight">
                Want a guided tour?
              </div>
              <div className="text-[11px] text-gray-500 leading-tight mt-0.5 [@media(max-height:860px)]:hidden">
                Try this — a 2 min walkthrough.
              </div>
            </div>
          </button>
          {superAdminOrgs.length > 0 && (
            <button
              type="button"
              onClick={() => setInviteModalOpen(true)}
              className="group w-full text-left rounded-xl border border-pink/30 bg-gradient-to-br from-pink/10 via-white to-[#13274F]/5 hover:from-pink/15 hover:to-[#13274F]/10 hover:border-pink/60 hover:shadow-md transition-all p-3 flex items-center gap-3 [@media(max-height:740px)]:p-2"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-pink text-white shadow-sm group-hover:scale-105 transition-transform [@media(max-height:740px)]:h-7 [@media(max-height:740px)]:w-7">
                <UserPlus className="h-5 w-5 [@media(max-height:740px)]:h-4 [@media(max-height:740px)]:w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#13274F] leading-tight">
                  Invite teammates
                </div>
                <div className="text-[11px] text-gray-500 leading-tight mt-0.5 [@media(max-height:860px)]:hidden">
                  Bring your team onto the dashboard.
                </div>
              </div>
            </button>
          )}
          <UserMenu />
        </SidebarFooter>
      </Sidebar>
      {modals}
    </>
  );
}
