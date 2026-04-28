import { ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { api } from '../shared/api';

const TABS = [
  { to: 'today', label: 'Today' },
  { to: 'pending', label: 'Pending', badge: true },
  { to: 'missed', label: 'Missed' },
  { to: 'period', label: 'Pay period' },
  { to: 'punches', label: 'Punches' },
  { to: 'staff', label: 'Staff', ownerOnly: true },
  { to: 'offices', label: 'Offices', ownerOnly: true },
  { to: 'audit', label: 'Audit', ownerOnly: true },
];

export default function ManageShell({ children }: { children?: ReactNode }) {
  const { token, user, clear } = useAuth();
  const nav = useNavigate();
  const [pendingCount, setPendingCount] = useState(0);

  function logout() {
    clear();
    nav('/manage/login', { replace: true });
  }

  // Poll the Today endpoint for pending_count so the Pending tab badge stays
  // current. Today is already polled every 30s by the Today view; we duplicate
  // here so the badge is up-to-date even when the manager is on another tab.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await api<{ pending_count: number }>('/manage/today', {
          token: token ?? undefined,
        });
        if (!cancelled) setPendingCount(r.pending_count ?? 0);
      } catch {
        /* ignore */
      }
    }
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div className="bg-noise min-h-[100dvh] flex flex-col">
      <header className="px-6 sm:px-10 pt-6 flex items-center justify-between border-b border-creamSoft/5 pb-5">
        <div className="flex items-baseline gap-6">
          <span className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
            Glisten Timecard
          </span>
          <nav className="flex gap-1">
            {TABS.filter((t) => !(t as any).ownerOnly || user?.is_owner).map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  [
                    'px-4 py-1.5 rounded-full text-sm tracking-tight transition-colors flex items-center gap-2',
                    isActive
                      ? 'bg-cream text-ink'
                      : 'text-creamSoft/60 hover:text-creamSoft/90 hover:bg-creamSoft/5',
                  ].join(' ')
                }
              >
                <span>{t.label}</span>
                {(t as any).badge && pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-300 text-ink text-[10px] font-bold tabular-nums">
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-creamSoft/50 hidden sm:inline">
            {user?.name}{' '}
            {user?.is_owner && (
              <span className="font-serif italic text-cream/80 ml-1">owner</span>
            )}
          </span>
          <button
            onClick={logout}
            className="text-creamSoft/40 hover:text-creamSoft/80 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 sm:px-10 py-8 max-w-[1200px] mx-auto w-full">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
