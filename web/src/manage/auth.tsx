import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AUTH_EXPIRED_EVENT } from '../shared/api';

type ManagerUser = {
  id: number;
  name: string;
  is_owner: boolean;
  is_manager: boolean;
};

type AuthCtx = {
  token: string | null;
  user: ManagerUser | null;
  expired: boolean;
  setSession: (token: string, user: ManagerUser) => void;
  clear: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const STORAGE_KEY = 'glisten-timecard-manager';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<ManagerUser | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setToken(p.token);
        setUser(p.user);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function setSession(t: string, u: ManagerUser) {
    setExpired(false);
    setToken(t);
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: t, user: u }));
  }
  function clear() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  useEffect(() => {
    const handler = () => { setExpired(true); clear(); };
    window.addEventListener(AUTH_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
  }, []);

  return (
    <Ctx.Provider value={{ token, user, expired, setSession, clear }}>{children}</Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
