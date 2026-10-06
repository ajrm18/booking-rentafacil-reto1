import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser } from '../types';
import { auth as authApi } from '../api';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const t = localStorage.getItem('rf_token');
      const u = localStorage.getItem('rf_user');
      if (t && u) { setToken(t); setUser(JSON.parse(u)); }
    } catch (e) { console.warn('Error leyendo la sesión', e); }
    finally { setLoading(false); }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setToken(res.access_token);
    setUser(res.user);
    localStorage.setItem('rf_token', res.access_token);
    localStorage.setItem('rf_user', JSON.stringify(res.user));
    return res.user;
  };

  const logout = () => {
    setToken(null); setUser(null);
    localStorage.removeItem('rf_token');
    localStorage.removeItem('rf_user');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
