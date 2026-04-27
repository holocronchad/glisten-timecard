import { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';

const TABS = [
  { to: 'today', label: 'Today' },
  { to: 'missed', label: 'Missed' },
  { to: 'period', label: 'Pay period' },
  { to: 'punches', label: 'Punches' },
  { to: 'staff', label: 'Staff', ownerOnly: true },
  { to: 'offices', label: 'Offices', ownerOnly: true },
  { to: 'audit', label: 'Audit', ownerOnly: true },
];

export default function ManageShell({ children }: { children?: ReactNode }) {
  const { user, clear } = useAuth();
  const nav = useNavigate();

  function logout() {
    clear();
    nav('/manage/login', { replace: true });
  }

  return (
    <div className="bg-noise min-h-[100dvh] flex flex-col">
      <header className="px-6 sm:px-10 pt-6 flex items-center justify-between border-b border-creamSoft/5 pb-5">
        <div className="flex items-baseline gap-6">
          <span className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
            Glisten Timecard
          </span>
          <nav className="flex gap-1">
            {TABS.filter((t) => !t.ownerOnly || user?.is_owner).map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  [
                    'px-4 py-1.5 rounded-full text-sm tracking-tight transition-colors',
                    isActive
                      ? 'bg-cream text-ink'
                      : 'text-creamSoft/60 hover:text-creamSoft/90 hover:bg-creamSoft/5',
                  ].join(' ')
                }
              >
                {t.label}
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
