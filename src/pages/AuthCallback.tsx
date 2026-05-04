import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logger } from '@/lib/utils';

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

          // Onboarding retired — admin-provisioned users land on dashboard.
          navigate('/dashboard');
        } else {
          toast.error('Authentication failed');
          navigate('/auth');
        }
      } catch (error: any) {
        logger.error('Auth callback error:', error);
        toast.error(error.message || 'Authentication failed');
        navigate('/auth');
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <img
          src="/logos/PinkBadge.png"
          alt="PerceptionX Logo"
          className="w-32 h-32 animate-pulse mx-auto mb-4"
        />
        <p className="text-[hsl(221,56%,22%)]">Completing authentication...</p>
      </div>
    </div>
  );
};

export default AuthCallback; 