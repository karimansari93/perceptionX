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

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onboardingData?: any;
  redirectTo?: string;
}

const AuthModal = ({ open, onOpenChange, onboardingData, redirectTo = '/dashboard' }: AuthModalProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    companyName: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
      console.log('Linking onboarding data to user:', userId);
      
      // First, check if user already has an onboarding record
      const { data: existingRecord } = await supabase
        .from('user_onboarding')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (existingRecord && existingRecord.length > 0) {
        console.log('User already has onboarding record');
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
        } else {
          console.log('Successfully linked existing onboarding record');
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
        } else {
          console.log('Successfully created new onboarding record');
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
        
        console.log('User signed in:', data.user?.id);
        toast.success('Signed in successfully!');
        
        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
        
        onOpenChange(false);
        
        // Always navigate to prompts page with onboarding data
        navigate('/prompts', { 
          state: { 
            onboardingData: onboardingData || {
              companyName: formData.companyName,
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

        console.log('User signed up:', data.user?.id);

        // Update profile with company name
        if (formData.companyName) {
          const { error: profileError } = await supabase
            .from('profiles')
            .update({ company_name: formData.companyName })
            .eq('email', formData.email);

          if (profileError) {
            console.error('Error updating profile:', profileError);
          }
        }

        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }

        toast.success('Account created successfully!');
        onOpenChange(false);
        
        // Navigate to prompts page with onboarding data
        navigate('/prompts', { 
          state: { 
            onboardingData: onboardingData || {
              companyName: formData.companyName,
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

            {!isLogin && (
              <div>
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  name="companyName"
                  type="text"
                  value={formData.companyName || onboardingData?.companyName || ''}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter your company name"
                />
              </div>
            )}

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
