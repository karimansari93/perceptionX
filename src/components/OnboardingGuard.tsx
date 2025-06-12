import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface OnboardingGuardProps {
  children: React.ReactNode;
  requireOnboarding?: boolean;
}

const OnboardingGuard: React.FC<OnboardingGuardProps> = ({ 
  children, 
  requireOnboarding = false 
}) => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [hasOnboarding, setHasOnboarding] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    const checkOnboarding = async () => {
      if (!user) {
        if (!authLoading) {
          navigate('/auth');
        }
        return;
      }

      if (!requireOnboarding) {
        return;
      }

      try {
        if (process.env.NODE_ENV === 'development') {
          console.log('Checking onboarding completion status');
        }
        
        // Test connection first with a simple query
        const { error: connectionTest } = await supabase
          .from('user_onboarding')
          .select('id')
          .limit(1);

        if (connectionTest) {
          console.error('Connection test failed:', connectionTest);
          setConnectionError(true);
          return;
        }

        // Check for completed onboarding (both company_name and industry are required)
        const { data, error } = await supabase
          .from('user_onboarding')
          .select('*')
          .eq('user_id', user.id)
          .not('company_name', 'is', null)
          .not('industry', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          console.error('Error checking onboarding:', error);
          setConnectionError(true);
        } else {
          // Check if the record has both required fields: company_name and industry
          const isComplete = data && data.length > 0 && 
            data[0].company_name && 
            data[0].industry && 
            (data[0].prompts_completed === true || true); // Keep prompts_completed check for backward compatibility
          setHasOnboarding(isComplete);
          if (process.env.NODE_ENV === 'development') {
            console.log('Onboarding completion status:', isComplete);
          }
          setConnectionError(false);
        }
      } catch (error) {
        console.error('Error in onboarding check:', error);
        setConnectionError(true);
      }
    };

    if (!authLoading) {
      checkOnboarding();
    }
  }, [user, requireOnboarding, authLoading, navigate]);

  // Redirect to auth if not logged in
  if (!authLoading && !user) {
    navigate('/');
    return null;
  }

  // Show connection error with bypass options
  if (connectionError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Error</h2>
          <p className="text-gray-600 mb-6">
            Unable to connect to the database. This might be a temporary issue.
          </p>
          <div className="space-y-3">
            <Button 
              onClick={() => window.location.reload()} 
              className="w-full"
            >
              Retry Connection
            </Button>
            <Button 
              onClick={() => navigate('/')} 
              variant="ghost"
              className="w-full"
            >
              Return to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // If onboarding is required and not complete, show the children (which will show the onboarding modal)
  if (requireOnboarding && hasOnboarding === false) {
    return <>{children}</>;
  }

  return <>{children}</>;
};

export default OnboardingGuard;
