import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/ui/loading-screen';

const PASSWORD_MIN_LENGTH = 8;

const validatePassword = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
};

// Landing page for team invites: the email's action link signs the invitee in
// and redirects here so they can set a password before entering the dashboard.
const Welcome = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sessionStatus, setSessionStatus] = useState<'checking' | 'valid' | 'expired'>('checking');

  useEffect(() => {
    if (authLoading) return;

    if (user) {
      setSessionStatus('valid');
      return;
    }

    const timeout = setTimeout(() => {
      setSessionStatus((prev) => (prev === 'valid' ? 'valid' : 'expired'));
    }, 3000);

    return () => clearTimeout(timeout);
  }, [user, authLoading]);

  useEffect(() => {
    if (user) {
      setSessionStatus('valid');
    }
  }, [user]);

  const inviterName = (user?.user_metadata?.inviter_name as string) || null;
  const orgName = (user?.user_metadata?.invited_org_name as string) || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const name = fullName.trim();
    if (!name) {
      toast.error('Please enter your name');
      return;
    }

    const validationError = validatePassword(password);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { full_name: name },
      });

      if (error) throw error;

      // Keep the app-facing profile in sync; the name is what teammates see
      // in invite emails when this user invites others later.
      if (user) {
        await supabase.from('profiles').update({ full_name: name }).eq('id', user.id);
      }

      toast.success("You're all set — welcome to PerceptionX!");
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast.error(error.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  if (sessionStatus === 'checking') {
    return <LoadingScreen />;
  }

  if (sessionStatus === 'expired') {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center relative" style={{ background: '#f7dee7' }}>
        <div className="absolute top-6 left-6 z-10">
          <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
            <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
          </a>
        </div>

        <div className="w-full max-w-md flex items-center justify-center p-8 relative flex-col">
          <Card className="w-full bg-white rounded-2xl border border-silver">
            <CardHeader>
              <div className="flex items-center justify-center gap-3">
                <CardTitle className="text-2xl text-center text-nightsky font-bold" style={{ fontFamily: 'Geologica, sans-serif' }}>
                  Invite Link Expired
                </CardTitle>
                <Badge className="bg-pink text-white px-2 py-0.5 text-xs font-bold">
                  BETA
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-nightsky text-base" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                This invite link has expired or was already used. Ask your teammate
                to resend the invite from their Team page.
              </p>
              <Button
                onClick={() => navigate('/auth')}
                className="w-full bg-nightsky hover:bg-dusk-navy text-white rounded-full font-bold text-base"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
              >
                Back to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const passwordError = password.length > 0 ? validatePassword(password) : null;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <div className="min-h-screen w-screen flex items-center justify-center relative" style={{ background: '#f7dee7' }}>
      <div className="absolute top-6 left-6 z-10">
        <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
          <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
        </a>
      </div>

      <div className="w-full max-w-md flex items-center justify-center p-8 relative flex-col">
        <Card className="w-full bg-white rounded-2xl border border-silver">
          <CardHeader>
            <div className="flex items-center justify-center gap-3">
              <CardTitle className="text-2xl text-center text-nightsky font-bold" style={{ fontFamily: 'Geologica, sans-serif' }}>
                Welcome to PerceptionX
              </CardTitle>
              <Badge className="bg-pink text-white px-2 py-0.5 text-xs font-bold">
                BETA
              </Badge>
            </div>
            <p className="text-center text-sm text-nightsky mt-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              {inviterName && orgName
                ? `${inviterName} invited you to join ${orgName}. Set a password to get started.`
                : 'Set a password to get started.'}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  Your name
                </Label>
                <Input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="First and last name"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  autoComplete="new-password"
                  required
                />
                {passwordError && (
                  <p className="text-xs text-red-500" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    {passwordError}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  required
                />
                {mismatch && (
                  <p className="text-xs text-red-500" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    Passwords do not match
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={loading || !!passwordError || password !== confirmPassword || !password || !fullName.trim()}
                className="w-full bg-pink hover:bg-pink/90 text-white rounded-full font-bold text-base"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
              >
                {loading ? 'Setting up your account...' : 'Set password & go to dashboard'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Welcome;
