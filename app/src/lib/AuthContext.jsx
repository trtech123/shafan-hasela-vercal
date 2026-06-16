import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

// Maps DB enum values to the Hebrew role strings Layout.jsx expects
const ROLE_DISPLAY = {
  admin: 'admin',
  operations: 'אחמ"ש',
  cashier: 'קופאי',
  instructor: 'מדריך',
};

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // 1. Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchProfile(session.user);
      } else {
        setIsLoadingAuth(false);
      }
    });

    // 2. Subscribe to auth changes (token refresh, sign-out from another tab, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          fetchProfile(session.user);
        } else {
          setUser(null);
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (authUser) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('id', authUser.id)
        .single();

      if (error || !profile) {
        setAuthError({ type: 'user_not_registered', message: 'User not registered' });
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        return;
      }

      setUser({
        id: profile.id,
        email: profile.email || authUser.email,
        full_name: profile.full_name,
        role: ROLE_DISPLAY[profile.role] ?? profile.role,
      });
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (err) {
      setAuthError({ type: 'unknown', message: err.message });
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
  };

  // navigateToLogin is called from App.jsx when auth_required;
  // the actual navigation happens there via useNavigate.
  // Exposed here so App.jsx can call it without knowing the route.
  const navigateToLogin = () => {
    // Handled in App.jsx — this is a no-op stub kept for API compatibility.
    // App.jsx reads authError.type === 'auth_required' and redirects.
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      logout,
      navigateToLogin,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
