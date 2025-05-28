import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/components/ui/sidebar';

const UserMenu = () => {
  const { user, signOut } = useAuth();
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
          className={`w-full ${isCollapsed ? 'px-2' : 'justify-start px-3'} text-gray-700 hover:bg-gray-100/50`}
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
        <DropdownMenuItem onClick={signOut} className="text-red-600 hover:text-red-700">
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
