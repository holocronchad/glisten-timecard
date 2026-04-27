import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';

type TodayResponse = {
  today: string;
  employees: Array<{
    user: { id: number; name: string; role: string };
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
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div>
      <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
        <span className="font-serif italic text-cream">Today</span>
      </h1>
      <p className="text-creamSoft/40 text-sm mt-1">
        Live status — updates every 30 seconds.
      </p>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {loading && !data ? (
          <div className="p-10 text-creamSoft/40 text-sm">Loading…</div>
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
                className="flex items-center gap-4 p-5 hover:bg-creamSoft/5 transition-colors"
              >
                <div className="flex-1">
                  <div className="text-creamSoft text-base tracking-tight">{e.user.name}</div>
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
