import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User, BarChart3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/components/ui/sidebar';
import { useNavigate } from 'react-router-dom';

const UserMenu = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  let isCollapsed = false;
  
  try {
    const { state } = useSidebar();
    isCollapsed = state === "collapsed";
  } catch (error) {
    // If useSidebar is not available, use default state
    isCollapsed = false;
  }

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          className={`w-full ${isCollapsed ? 'px-2' : 'justify-start px-3'} text-gray-700 hover:bg-pink hover:text-white`}
        >
          <User className="w-4 h-4" />
          {!isCollapsed && (
            <span className="ml-2 truncate">{user.email}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={isCollapsed ? "right" : "top"}>
        <DropdownMenuItem disabled className="text-gray-600">
          <User className="w-4 h-4 mr-2" />
          {user.email}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/account')} className="text-gray-700 hover:bg-gray-100/70">
          <User className="w-4 h-4 mr-2" />
          Account & Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/usage')} className="text-gray-700 hover:bg-gray-100/70">
          <BarChart3 className="w-4 h-4 mr-2" />
          Usage & Plans
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut} className="text-red-600 hover:text-red-700">
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
