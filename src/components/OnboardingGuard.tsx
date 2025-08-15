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
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    const checkOnboarding = async () => {
      if (!user) {
        if (!authLoading) {
          // Use setTimeout to defer navigation until after render
          setTimeout(() => navigate('/auth'), 0);
        }
        return;
      }

      if (!requireOnboarding) {
        return;
      }

      try {
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

        // Check if user has basic onboarding data
        const { data: onboardingData, error: onboardingError } = await supabase
          .from('user_onboarding')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (onboardingError) {
          console.error('Error fetching onboarding data:', onboardingError);
          return;
        }

        // Check if user has confirmed prompts
        if (onboardingData && onboardingData.length > 0) {
          const { data: promptsData, error: promptsError } = await supabase
            .from('confirmed_prompts')
            .select('*')
            .eq('onboarding_id', onboardingData[0].id);

          if (promptsError) {
            console.error('Error fetching confirmed prompts:', promptsError);
            return;
          }

          // Check if user has completed onboarding
          if (promptsData && promptsData.length > 0) {
            // Check if user has any responses
            const { data: responsesData, error: responsesError } = await supabase
              .from('prompt_responses')
              .select('id')
              .in('confirmed_prompt_id', promptsData.map(p => p.id))
              .limit(1);

            if (responsesError) {
              console.error('Error fetching responses:', responsesError);
              return;
            }

            // User has completed onboarding if they have prompts and responses
            if (responsesData && responsesData.length > 0) {
              setHasOnboarding(true);
              return;
            }
          }
        }

        // No basic onboarding data found
        setHasOnboarding(false);
      } catch (error) {
        console.error('Error in onboarding check:', error);
        setConnectionError(true);
      }
    };

    if (!authLoading) {
      checkOnboarding();
    }
  }, [user, requireOnboarding, authLoading, navigate]);

  // Handle navigation after render using useEffect
  useEffect(() => {
    if (hasOnboarding === false && requireOnboarding && !isNavigating) {
      // Defer navigation to next tick to avoid render cycle issues
      setIsNavigating(true);
      const timer = setTimeout(() => {
        navigate('/onboarding');
      }, 0);
      
      return () => clearTimeout(timer);
    }
  }, [hasOnboarding, requireOnboarding, navigate, isNavigating]);

  // Redirect to auth if not logged in
  if (!authLoading && !user) {
    if (!isNavigating) {
      setIsNavigating(true);
      setTimeout(() => navigate('/auth'), 0);
    }
    return null; // Don't navigate here, let the useEffect handle it
  }

  // Show loading while navigating
  if (isNavigating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
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

  // If onboarding is required and not complete, redirect to onboarding page
  if (requireOnboarding && hasOnboarding === false) {
    navigate('/onboarding');
    return null;
  }

  return <>{children}</>;
};

export default OnboardingGuard;
