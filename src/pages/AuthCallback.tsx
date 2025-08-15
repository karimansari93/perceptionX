import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          throw error;
        }

        if (session) {
          const adminEmails = ['karim@perceptionx.ai'];
          if (adminEmails.includes(session.user.email?.toLowerCase() || '')) {
            setTimeout(() => navigate('/admin'), 0);
            return;
          }

          // Check if user needs onboarding
          try {
            const { data: userOnboardingData, error: onboardingError } = await supabase
              .from('user_onboarding')
              .select('id, company_name, industry')
              .eq('user_id', session.user.id)
              .not('company_name', 'is', null)
              .not('industry', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1);

            if (onboardingError) {
              console.error('Error checking onboarding status:', onboardingError);
              // If we can't check, default to dashboard
              setTimeout(() => navigate('/dashboard'), 0);
              return;
            }

            // If no basic onboarding data, redirect to onboarding
            if (!userOnboardingData || userOnboardingData.length === 0 || 
                !userOnboardingData[0].company_name || !userOnboardingData[0].industry) {
              navigate('/onboarding');
              return;
            }

            // Check if there are actual confirmed prompts
            const { data: promptsData, error: promptsError } = await supabase
              .from('confirmed_prompts')
              .select('id')
              .eq('onboarding_id', userOnboardingData[0].id)
              .limit(1);

            if (promptsError) {
              console.error('Error checking confirmed prompts:', promptsError);
              // If we can't check, default to dashboard
              navigate('/dashboard');
              return;
            }

            // If no confirmed prompts, onboarding is incomplete
            if (!promptsData || promptsData.length === 0) {
              navigate('/onboarding');
            } else {
              // User has completed onboarding, go to dashboard
              navigate('/dashboard');
            }
          } catch (onboardingCheckError) {
            console.error('Error checking onboarding status:', onboardingCheckError);
            // If we can't check, default to dashboard
            navigate('/dashboard');
          }
        } else {
          toast.error('Authentication failed');
          navigate('/auth');
        }
      } catch (error: any) {
        console.error('Auth callback error:', error);
        toast.error(error.message || 'Authentication failed');
        navigate('/auth');
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white">Completing authentication...</p>
      </div>
    </div>
  );
};

export default AuthCallback; 