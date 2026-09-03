import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { stashReturnTo } from '@/lib/returnTo';
import { ProfileSetupGate } from '@/components/onboarding/ProfileSetupGate';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      // Remember where they were headed (e.g. the MCP consent page) so the
      // login flow can return them there instead of the default landing.
      stashReturnTo(location.pathname + location.search);
      navigate('/auth');
    }
  }, [user, loading, navigate, location]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return null;
  }

  // Signed in, but never completed first-login setup (name + default
  // location)? Show that instead of the page, once; then the page renders.
  return <ProfileSetupGate>{children}</ProfileSetupGate>;
};

export default ProtectedRoute;
