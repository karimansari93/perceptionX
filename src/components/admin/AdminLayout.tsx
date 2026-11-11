import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Users,
  Briefcase,
  LogOut,
  Trophy,
  Tags,
  LayoutDashboard,
  Send,
  Menu
} from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { ViewDashboardDialog } from './ViewDashboardDialog';

interface AdminLayoutProps {
  children: ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const AdminLayout = ({ children, activeTab, onTabChange }: AdminLayoutProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [showDashboardPicker, setShowDashboardPicker] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { clearViewAsOrganization } = useCompany();

  // Coming back to admin ends "view dashboard as organization".
  useEffect(() => {
    clearViewAsOrganization();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  // Per-client tools (collection, data health, recency, Activate, members,
  // reports) live inside the org workspace (Organizations → Open); platform
  // status sits at the top of the Organizations list. Old ?tab= links for the
  // moved tools still resolve.
  const navGroups = [
    {
      label: 'Clients',
      items: [
        { id: 'organizations', label: 'Organizations', icon: Briefcase },
        { id: 'onboarding-forms', label: 'Onboarding Forms', icon: Send },
        { id: 'users', label: 'Users', icon: Users },
      ],
    },
    {
      label: 'Platform',
      items: [
        { id: 'entity-canonicalization', label: 'Data Cleanup', icon: Tags },
        { id: 'visibility-rankings', label: 'Visibility Rankings', icon: Trophy },
      ],
    },
  ];

  const activeLabel =
    navGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? 'Admin';

  // One sidebar body, shown fixed on desktop and in a slide-out sheet on phones.
  const sidebarBody = (onNavigate?: () => void) => (
    <>
      {/* Logo/Header */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <img
            src="/logos/PinkBadge.png"
            alt="PerceptionX"
            className="w-9 h-9 rounded-lg object-cover"
          />
          <div>
            <h1 className="text-sm font-headline font-semibold text-slate-800">PerceptionX</h1>
            <p className="text-xs text-slate-500">Admin</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onTabChange(item.id);
                      onNavigate?.();
                    }}
                    className={`
                      w-full flex items-center gap-2.5 px-2.5 py-2.5 md:py-2 rounded-md text-left transition-colors
                      ${isActive
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                      }
                    `}
                  >
                    <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-slate-700' : 'text-slate-500'}`} />
                    <span className="text-sm font-medium truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* Sign Out */}
      <div className="p-3 border-t border-slate-200 space-y-2">
        <Button
          onClick={() => {
            onNavigate?.();
            setShowDashboardPicker(true);
          }}
          variant="outline"
          size="sm"
          className="w-full border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
        >
          <LayoutDashboard className="h-4 w-4 mr-2" />
          View Dashboard
        </Button>
        <Button
          onClick={handleSignOut}
          variant="outline"
          size="sm"
          className="w-full border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] bg-slate-50">
      {/* Phone top bar: the sidebar moves into a slide-out menu below md. */}
      <header className="md:hidden flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          onClick={() => setMobileNavOpen(true)}
          className="text-slate-600"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <img
          src="/logos/PinkBadge.png"
          alt="PerceptionX"
          className="w-7 h-7 rounded-md object-cover"
        />
        <span className="text-sm font-semibold text-slate-800 truncate">{activeLabel}</span>
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-64 p-0 flex flex-col">
          <SheetTitle className="sr-only">Admin menu</SheetTitle>
          {sidebarBody(() => setMobileNavOpen(false))}
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar - light, minimal */}
      <aside className="hidden md:flex w-56 flex-shrink-0 border-r border-slate-200 bg-white flex-col">
        {sidebarBody()}
      </aside>

      <ViewDashboardDialog open={showDashboardPicker} onOpenChange={setShowDashboardPicker} />

      {/* Main Content - more room for data */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        <div className="p-3 md:p-5">
          {children}
        </div>
      </main>
    </div>
  );
};
