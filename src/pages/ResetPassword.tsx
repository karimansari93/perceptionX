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

const ResetPassword = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
        password: password
      });

      if (error) throw error;

      sessionStorage.removeItem('passwordRecovery');
      await signOut();

      toast.success('Password updated! Please sign in with your new password.');
      navigate('/auth');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      toast.error(error.message || 'Failed to reset password');
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
        {/* Top left logo */}
        <div className="absolute top-6 left-6 z-10">
          <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
            <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
          </a>
        </div>

        {/* Top right demo link */}
        <div className="absolute top-6 z-10 right-6 md:right-6 left-1/2 md:left-auto transform md:transform-none -translate-x-1/2 md:translate-x-0">
          <div className="flex items-center gap-2 text-sm text-nightsky font-medium text-center whitespace-nowrap" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <span>Looking to learn more?</span>
            <a
              href="https://meetings-eu1.hubspot.com/karim-al-ansari"
              target="_blank"
              rel="noopener noreferrer"
              className="border-2 border-pink text-pink bg-transparent px-3 py-1 rounded-full hover:bg-pink hover:text-white transition-colors font-bold text-xs"
            >
              Book a demo
            </a>
          </div>
        </div>

        <div className="w-full max-w-md flex items-center justify-center p-8 relative flex-col">
          <Card className="w-full bg-white rounded-2xl border border-silver">
            <CardHeader>
              <div className="flex items-center justify-center gap-3">
                <CardTitle className="text-2xl text-center text-nightsky font-bold" style={{ fontFamily: 'Geologica, sans-serif' }}>
                  Link Expired
                </CardTitle>
                <Badge className="bg-pink text-white px-2 py-0.5 text-xs font-bold">
                  BETA
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-nightsky text-base" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                This password reset link has expired or is invalid. Please request a new one.
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

          {/* Footer links */}
          <div className="mt-8 text-center space-x-6">
            <a
              href="https://perceptionx.ai/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-nightsky hover:text-pink-500 transition-colors"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Privacy Policy
            </a>
            <a
              href="https://perceptionx.ai/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-nightsky hover:text-pink-500 transition-colors"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Terms & Conditions
            </a>
          </div>
        </div>
      </div>
    );
  }

  const passwordError = password.length > 0 ? validatePassword(password) : null;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <div className="min-h-screen w-screen flex items-center justify-center relative" style={{ background: '#f7dee7' }}>
      {/* Top left logo */}
      <div className="absolute top-6 left-6 z-10">
        <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
          <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
        </a>
      </div>

      {/* Top right demo link */}
      <div className="absolute top-6 z-10 right-6 md:right-6 left-1/2 md:left-auto transform md:transform-none -translate-x-1/2 md:translate-x-0">
        <div className="flex items-center gap-2 text-sm text-nightsky font-medium text-center whitespace-nowrap" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          <span>Looking to learn more?</span>
          <a
            href="https://meetings-eu1.hubspot.com/karim-al-ansari"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-pink text-pink bg-transparent px-3 py-1 rounded-full hover:bg-pink hover:text-white transition-colors font-bold text-xs"
          >
            Book a demo
          </a>
        </div>
      </div>

      <div className="w-full max-w-md flex items-center justify-center p-8 relative flex-col">
        <Card className="w-full bg-white rounded-2xl border border-silver">
          <CardHeader>
            <div className="flex items-center justify-center gap-3">
              <CardTitle className="text-2xl text-center text-nightsky font-bold" style={{ fontFamily: 'Geologica, sans-serif' }}>
                Reset Password
              </CardTitle>
              <Badge className="bg-pink text-white px-2 py-0.5 text-xs font-bold">
                BETA
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>New Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-silver focus:border-nightsky focus:ring-nightsky text-base"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                />
                {passwordError && (
                  <p className="text-sm text-red-500" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{passwordError}</p>
                )}
                <ul className="text-xs text-gray-500 space-y-0.5 pl-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  <li className={password.length >= PASSWORD_MIN_LENGTH ? 'text-green-600' : ''}>
                    At least {PASSWORD_MIN_LENGTH} characters
                  </li>
                  <li className={/[A-Z]/.test(password) ? 'text-green-600' : ''}>
                    One uppercase letter
                  </li>
                  <li className={/[a-z]/.test(password) ? 'text-green-600' : ''}>
                    One lowercase letter
                  </li>
                  <li className={/[0-9]/.test(password) ? 'text-green-600' : ''}>
                    One number
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="border-silver focus:border-nightsky focus:ring-nightsky text-base"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                />
                {mismatch && (
                  <p className="text-sm text-red-500" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Passwords do not match</p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full bg-nightsky hover:bg-dusk-navy text-white rounded-full font-bold text-base"
                style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                disabled={loading || !!passwordError || mismatch || !password || !confirmPassword}
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  'Reset Password'
                )}
              </Button>
              <div className="text-center mt-2">
                <button
                  type="button"
                  onClick={() => navigate('/auth')}
                  className="text-sm text-nightsky hover:underline font-bold"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                >
                  Back to Login
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Footer links */}
        <div className="mt-8 text-center space-x-6">
          <a
            href="https://perceptionx.ai/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-nightsky hover:text-pink-500 transition-colors"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
          >
            Privacy Policy
          </a>
          <a
            href="https://perceptionx.ai/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-nightsky hover:text-pink-500 transition-colors"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
          >
            Terms & Conditions
          </a>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
