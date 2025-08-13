import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

function GoogleOneTapCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  useEffect(() => {
    const handleAuth = async () => {
      const token = searchParams.get('token');
      
      if (token) {
        try {
          const { data, error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: token
          });
          
          if (data.user && !error) {
            // Success - go to dashboard
            navigate('/dashboard');
          } else {
            // Error - go back to login
            navigate('/auth?error=auth_failed');
          }
        } catch (err) {
          console.error('Auth error:', err);
          navigate('/auth?error=server_error');
        }
      } else {
        navigate('/auth?error=no_token');
      }
    };
    
    handleAuth();
  }, [searchParams, navigate]);
  
  return (
    <div style={{textAlign: 'center', padding: '50px'}}>
      <h3>Signing you in...</h3>
      <p>Please wait a moment.</p>
    </div>
  );
}

export default GoogleOneTapCallback;
