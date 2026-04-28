import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';

type PeriodResponse = {
  period: { index: number; start: string; end: string; label: string };
  employees: Array<{
    user: { id: number; name: string; employment_type: string };
    total_minutes: number;
    daily_totals: Array<{ date: string; worked_minutes: number; open: boolean }>;
    flagged_count: number;
    open_segments: number;
  }>;
};

export default function Period() {
  const { token, user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState<PeriodResponse | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const path =
        index === null ? '/manage/period' : `/manage/period?index=${index}`;
      const r = await api<PeriodResponse>(path, { token: token ?? undefined });
      if (!cancelled) setData(r);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [index, token]);

  function shift(delta: number) {
    if (!data) return;
    setIndex(data.period.index + delta);
  }

  function downloadCsv() {
    if (!data || !user?.is_owner) return;
    const url = `/api/manage/payroll.csv?index=${data.period.index}`;
    fetch(url, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `glisten-payroll-${data.period.start.slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Pay period</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1 tabular-nums">
            {data?.period.label ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => shift(1)}
            className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center"
          >
            <ChevronRight size={18} />
          </button>
          {user?.is_owner && (
            <button
              onClick={downloadCsv}
              className="ml-3 h-10 inline-flex items-center gap-2 rounded-full bg-cream text-ink px-4 text-sm tracking-tight"
            >
              <Download size={16} /> Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40 divide-y divide-creamSoft/5">
        {!data ? (
          <ListSkeleton rows={6} />
        ) : data.employees.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">No active staff.</div>
        ) : (
          data.employees.map((e, i) => (
            <motion.div
              key={e.user.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.03, 0.35) }}
              onClick={() =>
                nav(`/manage/employees/${e.user.id}?index=${data.period.index}`)
              }
              className="p-5 flex items-center gap-4 hover:bg-creamSoft/5 transition-colors cursor-pointer"
            >
              <div className="flex-1">
                <div className="text-creamSoft text-base tracking-tight">
                  {e.user.name}
                </div>
                <div className="text-creamSoft/40 text-xs">
                  {e.user.employment_type}
                  {e.flagged_count > 0 && (
                    <span className="ml-2 text-amber-300/80">
                      · {e.flagged_count} flagged
                    </span>
                  )}
                  {e.open_segments > 0 && (
                    <span className="ml-2 text-amber-300/80">· open shift</span>
                  )}
                </div>
              </div>
              <div className="text-creamSoft tabular-nums tracking-tight">
                {hhmm(e.total_minutes)}
              </div>
            </motion.div>
          ))
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
