import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

interface AdminRouteProps {
  children: React.ReactNode;
}

const ADMIN_EMAILS = ['karim@perceptionx.ai'];

export default function AdminRoute({ children }: AdminRouteProps) {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }

    const isUserAdmin = ADMIN_EMAILS.includes(user.email?.toLowerCase() || '');
    setIsAdmin(isUserAdmin);
  }, [user]);

  if (isAdmin === null) {
    return <LoadingScreen />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              You don't have permission to access the admin panel.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}


