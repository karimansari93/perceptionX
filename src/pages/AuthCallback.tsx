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
          // Check if user needs onboarding
          try {
            const { data: onboardingData, error: onboardingError } = await supabase
              .from('user_onboarding')
              .select('id, company_name, industry')
              .eq('user_id', session.user.id)
              .not('company_name', 'is', null)
              .not('industry', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1);

            if (onboardingError && onboardingError.code !== 'PGRST116') {
              console.error('Error checking onboarding status:', onboardingError);
              navigate('/onboarding');
              return;
            }

            // If no basic onboarding data, redirect to onboarding
            if (!onboardingData) {
              navigate('/onboarding');
              return;
            }

            // Check if user has confirmed prompts
            const { data: confirmedPrompts, error: promptsError } = await supabase
              .from('confirmed_prompts')
              .select('*')
              .eq('user_id', session.user.id);

            if (promptsError) {
              console.error('Error checking confirmed prompts:', promptsError);
              navigate('/onboarding');
              return;
            }

            // If no confirmed prompts, redirect to onboarding
            if (!confirmedPrompts || confirmedPrompts.length === 0) {
              navigate('/onboarding');
              return;
            }

            // Onboarding complete, redirect to dashboard
            navigate('/dashboard');
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