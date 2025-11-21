import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, User, BarChart3, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/components/ui/sidebar';
import { useNavigate, Link } from 'react-router-dom';
import { getEmailDomainFavicon } from '@/utils/citationUtils';
import { useSubscription } from '@/hooks/useSubscription';

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const { subscription } = useSubscription();
  const sidebar = useSidebar(); // Always call the hook

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (!user) return null;

  const userFavicon = user.email ? getEmailDomainFavicon(user.email) : '';
  const userInitials = user.email ? user.email.substring(0, 2).toUpperCase() : 'U';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-100">
          <Avatar className="h-6 w-6 border border-gray-300">
            <AvatarImage 
              src={userFavicon} 
              alt={`${user.email} domain favicon`}
              onError={(e) => {
                // Hide the image if it fails to load, showing the fallback
                e.currentTarget.style.display = 'none';
              }}
            />
            <AvatarFallback className="text-xs bg-gray-200 text-gray-600">
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-gray-600 hidden sm:inline">{user.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-600">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Hidden for now - Account & Settings and Usage & Plans pages */}
        {/* <DropdownMenuItem asChild>
          <Link to="/account">
            <User className="mr-2 h-4 w-4" />
            <span>Account & Settings</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/usage">
            <BarChart3 className="mr-2 h-4 w-4" />
            <span>Usage & Plans</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator /> */}
        <DropdownMenuItem onClick={handleSignOut} className="text-red-600 hover:text-red-700">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
