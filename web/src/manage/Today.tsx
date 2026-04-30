import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';
import { ListSkeleton } from './Skeleton';

type TodayResponse = {
  today: string;
  pending_count: number;
  employees: Array<{
    user: { id: number; name: string; role: string; approved: boolean; self_registered: boolean };
    status: 'on_clock' | 'on_lunch' | 'off';
    worked_minutes_today: number;
    last_punch: { id: number; type: string; ts: string; flagged: boolean } | null;
  }>;
};

const STATUS_LABEL: Record<string, string> = {
  on_clock: 'On the clock',
  on_lunch: 'On lunch',
  off: 'Clocked out',
};

const STATUS_TONE: Record<string, string> = {
  on_clock: 'bg-emerald-300/10 text-emerald-300 border-emerald-300/20',
  on_lunch: 'bg-amber-300/10 text-amber-300 border-amber-300/20',
  off: 'bg-creamSoft/5 text-creamSoft/60 border-creamSoft/10',
};

export default function Today() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api<TodayResponse>('/manage/today', { token: token ?? undefined });
        if (!cancelled) setData(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    function onVis() {
      if (document.visibilityState === 'visible') load();
    }
    function onPunchesUpdated() {
      load();
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('glisten:punches-updated', onPunchesUpdated);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('glisten:punches-updated', onPunchesUpdated);
    };
  }, [token]);

  const onClock = data ? data.employees.filter((e) => e.status === 'on_clock').length : 0;
  const onLunch = data ? data.employees.filter((e) => e.status === 'on_lunch').length : 0;
  const total = data ? data.employees.length : 0;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Today</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            Live status — updates every 30 seconds.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-creamSoft/60">
              <span className="text-creamSoft tabular-nums tracking-tight">
                {onClock}
              </span>{' '}
              on the clock
            </span>
            {onLunch > 0 && (
              <span className="text-creamSoft/60">
                <span className="text-creamSoft tabular-nums tracking-tight">
                  {onLunch}
                </span>{' '}
                at lunch
              </span>
            )}
            <span className="text-creamSoft/30 tabular-nums">/ {total}</span>
          </div>
        )}
      </div>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {loading && !data ? (
          <ListSkeleton rows={6} />
        ) : !data || data.employees.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">No active staff.</div>
        ) : (
          <div className="divide-y divide-creamSoft/5">
            {data.employees.map((e, i) => (
              <motion.div
                key={e.user.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.4) }}
                onClick={() => nav(`/manage/employees/${e.user.id}`)}
                className="flex items-center gap-4 p-5 hover:bg-creamSoft/5 transition-colors cursor-pointer"
              >
                <div className="flex-1">
                  <div className="text-creamSoft text-base tracking-tight flex items-center gap-2">
                    {e.user.name}
                    {!e.user.approved && (
                      <span className="rounded-full bg-amber-300/15 text-amber-300 border border-amber-300/30 text-[10px] tracking-[0.12em] uppercase px-2 py-0.5">
                        Pending approval
                      </span>
                    )}
                  </div>
                  <div className="text-creamSoft/40 text-xs tracking-tight">{e.user.role}</div>
                </div>
                <div
                  className={[
                    'rounded-full text-xs px-3 py-1 border',
                    STATUS_TONE[e.status],
                  ].join(' ')}
                >
                  {STATUS_LABEL[e.status]}
                </div>
                <div className="hidden sm:block text-creamSoft/60 text-sm tabular-nums w-20 text-right">
                  {hhmm(e.worked_minutes_today)}
                </div>
                <div className="hidden md:block text-creamSoft/40 text-xs tabular-nums w-24 text-right">
                  {e.last_punch ? formatTime(e.last_punch.ts) : '—'}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
