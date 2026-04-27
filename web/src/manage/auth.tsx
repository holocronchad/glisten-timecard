import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type ManagerUser = {
  id: number;
  name: string;
  is_owner: boolean;
  is_manager: boolean;
};

type AuthCtx = {
  token: string | null;
  user: ManagerUser | null;
  setSession: (token: string, user: ManagerUser) => void;
  clear: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const STORAGE_KEY = 'glisten-timecard-manager';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<ManagerUser | null>(null);

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
    setToken(t);
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: t, user: u }));
  }
  function clear() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <Ctx.Provider value={{ token, user, setSession, clear }}>{children}</Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
