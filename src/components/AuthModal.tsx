import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { validateEmail, sanitizeInput, logger } from '@/lib/utils';

// Microsoft Button component
interface MicrosoftButtonProps {
  onClick: () => void;
  loading: boolean;
  mode: 'login' | 'signup';
}

const MicrosoftButton: React.FC<MicrosoftButtonProps> = ({ onClick, loading, mode }) => {
  return (
    <button
      type="button"
      className="w-full mb-2"
      onClick={onClick}
      disabled={loading}
      style={{
        display: 'flex',
        alignItems: 'center',
        border: 'none',
        borderRadius: '28px',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(60,64,67,.3),0 1.5px 6px 1px rgba(60,64,67,.15)',
        height: '56px',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
        padding: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'center' }}>
        <div style={{ marginRight: 12 }}>
          {/* Microsoft SVG */}
          <svg width="24" height="24" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
            <path fill="#f25022" d="M1 1h10v10H1z"/>
            <path fill="#00a4ef" d="M1 12h10v10H1z"/>
            <path fill="#7fba00" d="M12 1h10v10H12z"/>
            <path fill="#ffb900" d="M12 12h10v10H12z"/>
          </svg>
        </div>
        <span style={{ fontWeight: 500, fontSize: 16, color: '#3c4043' }}>
          {mode === 'login' ? 'Sign in with Microsoft' : 'Sign up with Microsoft'}
        </span>
        {loading && (
          <div className="ml-2 animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
        )}
      </div>
    </button>
  );
};

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onboardingData?: any;
  redirectTo?: string;
}

const AuthModal = ({ open, onOpenChange, onboardingData, redirectTo = '/dashboard' }: AuthModalProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);

  // Close modal and redirect if already authenticated
  useEffect(() => {
    if (user) {
      onOpenChange(false);
      if (onboardingData) {
        navigate('/prompts', { 
          state: { 
            onboardingData,
            userId: user.id 
          } 
        });
      } else {
        navigate('/onboarding');
      }
    }
  }, [user, navigate, onboardingData, redirectTo, onOpenChange]);

  const linkOnboardingToUser = async (userId: string) => {
    if (!onboardingData) return;

    try {
      // First, check if user already has an onboarding record
      const { data: existingRecord } = await supabase
        .from('user_onboarding')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (existingRecord && existingRecord.length > 0) {
        return;
      }

      // Look for unlinked onboarding records that match the company name
      const { data: unlinkedRecords } = await supabase
        .from('user_onboarding')
        .select('*')
        .is('user_id', null)
        .eq('company_name', onboardingData.companyName)
        .order('created_at', { ascending: false })
        .limit(1);

      if (unlinkedRecords && unlinkedRecords.length > 0) {
        // Link existing record to user
        const { error: linkError } = await supabase
          .from('user_onboarding')
          .update({ user_id: userId })
          .eq('id', unlinkedRecords[0].id);

        if (linkError) {
          console.error('Error linking onboarding record:', linkError);
        }
      } else {
        // Create new onboarding record for the user
        const newRecord = {
          user_id: userId,
          company_name: onboardingData.companyName,
          industry: onboardingData.industry,
          session_id: `session_${userId}_${Date.now()}`
        };

        const { error: createError } = await supabase
          .from('user_onboarding')
          .insert(newRecord);

        if (createError) {
          console.error('Error creating onboarding record:', createError);
        }
      }
    } catch (error) {
      console.error('Error in linkOnboardingToUser:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });

        if (error) throw error;
        
        // Signed in successfully - no toast needed
        
        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
        
        onOpenChange(false);
        
        // Always navigate to prompts page with onboarding data
        navigate('/prompts', { 
          state: { 
            onboardingData: onboardingData || {
              industry: '',
              hiringChallenges: [],
              targetRoles: [],
              currentStrategy: '',
              talentCompetitors: []
            },
            userId: data.user?.id 
          } 
        });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
        });

        if (error) throw error;

        // Account created successfully - no toast needed
        onOpenChange(false);
        
        // Navigate to prompts page with onboarding data
        navigate('/prompts', { 
          state: { 
            onboardingData: onboardingData || {
              industry: '',
              hiringChallenges: [],
              targetRoles: [],
              currentStrategy: '',
              talentCompetitors: []
            },
            userId: data.user?.id 
          } 
        });
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      toast.error(error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
      });

      if (error) throw error;

      if (data?.user) {
        navigate('/dashboard', { 
          state: { 
            showOnboarding: true,
            isNewUser: true 
          },
          replace: true 
        });
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Add Microsoft sign in/up handler
  const handleMicrosoftAuth = async () => {
    setMicrosoftLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || 'Microsoft authentication failed');
    } finally {
      setMicrosoftLoading(false);
    }
  };

  if (user) {
    return null; // Will redirect via useEffect
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="absolute right-4 top-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-2xl">
            {isLogin ? 'Sign In' : 'Create Account'}
          </CardTitle>
          <p className="text-gray-600 text-sm">
            {onboardingData ? 
              'Create an account to save your personalized prompts and start monitoring' :
              (isLogin ? 'Welcome back!' : 'Start monitoring your AI perception')
            }
          </p>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <MicrosoftButton
              onClick={handleMicrosoftAuth}
              loading={microsoftLoading}
              mode={isLogin ? 'login' : 'signup'}
            />
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                placeholder="Enter your email"
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleInputChange}
                required
                placeholder="Enter your password"
                minLength={6}
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
              disabled={loading}
            >
              {loading ? 'Loading...' : (isLogin ? 'Sign In' : 'Create Account')}
            </Button>
          </form>

          <div className="text-center mt-4">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:text-primary/80 underline text-sm"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>

          {onboardingData && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              <strong>Your analysis is ready!</strong> Create an account to view your personalized prompts for {onboardingData.companyName}.
            </div>
          )}
        </CardContent>
      </DialogContent>
    </Dialog>
  );
};

export default AuthModal;
