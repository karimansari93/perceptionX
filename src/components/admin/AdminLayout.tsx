import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Building2,
  Users,
  Briefcase,
  LogOut,
  Trophy,
  Layers
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface AdminLayoutProps {
  children: ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const AdminLayout = ({ children, activeTab, onTabChange }: AdminLayoutProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const navItems = [
    { id: 'organizations', label: 'Organizations', icon: Briefcase },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'companies', label: 'Companies', icon: Building2 },
    { id: 'visibility-rankings', label: 'Visibility Rankings', icon: Trophy },
    { id: 'batch-company-collection', label: 'Batch Companies', icon: Layers }
  ];

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar - light, minimal */}
      <aside className="w-56 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
        {/* Logo/Header */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <span className="text-sm font-semibold text-slate-600">pX</span>
            </div>
            <div>
              <h1 className="text-sm font-headline font-semibold text-slate-800">PerceptionX</h1>
              <p className="text-xs text-slate-500">Admin</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`
                    w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors
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
        </nav>

        {/* Sign Out */}
        <div className="p-3 border-t border-slate-200">
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
      </aside>

      {/* Main Content - more room for data */}
      <main className="flex-1 overflow-y-auto min-w-0">
        <div className="p-5">
          {children}
        </div>
      </main>
    </div>
  );
};

