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
          // Authentication successful - no toast needed
          navigate('/dashboard');
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