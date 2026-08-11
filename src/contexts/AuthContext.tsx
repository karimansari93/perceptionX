import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Handle password recovery: flag it so no page can redirect to dashboard
        if (event === 'PASSWORD_RECOVERY') {
          sessionStorage.setItem('passwordRecovery', 'true');
          if (!window.location.pathname.includes('/reset-password')) {
            window.location.href = '/reset-password';
          }
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Error getting session:', error);
        // Clear invalid session
        setSession(null);
        setUser(null);
      } else {
        setSession(session);
        setUser(session?.user ?? null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
    }
    // Clear local state even if signOut fails
    setSession(null);
    setUser(null);
  }, []);

  const clearSession = useCallback(() => {
    setSession(null);
    setUser(null);
  }, []);

  // Memoized (with stable callbacks above) so a provider render doesn't hand
  // every useAuth consumer a fresh object — and a re-render — when nothing
  // auth-related changed.
  const value = useMemo<AuthContextType>(() => ({
    user,
    session,
    loading,
    signOut,
    clearSession
  }), [user, session, loading, signOut, clearSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
