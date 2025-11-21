import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  Building2, 
  Users, 
  Briefcase, 
  LogOut,
  MessageSquare
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
    {
      id: 'organizations',
      label: 'Organizations',
      icon: Briefcase,
      description: 'Manage organizations'
    },
    {
      id: 'users',
      label: 'Users',
      icon: Users,
      description: 'Manage users & access'
    },
    {
      id: 'companies',
      label: 'Companies',
      icon: Building2,
      description: 'Manage company data'
    },
    {
      id: 'data-chat',
      label: 'Data Chat',
      icon: MessageSquare,
      description: 'Ask questions about your data'
    }
  ];

  return (
    <div className="flex h-screen bg-silver">
      {/* Sidebar */}
      <aside className="w-72 bg-nightsky text-white flex flex-col">
        {/* Logo/Header */}
        <div className="p-6 border-b border-dusk">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-pink rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold">pX</span>
            </div>
            <div>
              <h1 className="text-lg font-headline font-semibold">PerceptionX</h1>
              <p className="text-xs text-silver/70">Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`
                    w-full flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all
                    ${isActive 
                      ? 'bg-pink text-white shadow-lg' 
                      : 'text-silver/80 hover:bg-dusk hover:text-white'
                    }
                  `}
                >
                  <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${isActive ? 'text-white' : 'text-teal'}`} />
                  <div className="text-left flex-1">
                    <div className={`text-sm font-medium ${isActive ? 'text-white' : ''}`}>
                      {item.label}
                    </div>
                    <div className={`text-xs ${isActive ? 'text-white/80' : 'text-silver/50'}`}>
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Sign Out */}
        <div className="p-4 border-t border-dusk">
          <Button
            onClick={handleSignOut}
            variant="outline"
            className="w-full bg-transparent border-silver/20 text-silver hover:bg-dusk hover:text-white"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

