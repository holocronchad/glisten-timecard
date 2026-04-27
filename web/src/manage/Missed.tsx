import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';

type MissedRequest = {
  id: number;
  user_id: number;
  user_name: string;
  date: string;
  type: 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';
  proposed_ts: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  clock_in: 'Clock in',
  clock_out: 'Clock out',
  lunch_start: 'Lunch start',
  lunch_end: 'Lunch end',
};

export default function Missed() {
  const { token } = useAuth();
  const [rows, setRows] = useState<MissedRequest[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api<{ requests: MissedRequest[] }>('/manage/missed', {
      token: token ?? undefined,
    });
    setRows(r.requests);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function decide(id: number, decision: 'approve' | 'deny') {
    setBusyId(id);
    setErr(null);
    try {
      await api(`/manage/missed/${id}/decide`, {
        method: 'POST',
        token: token ?? undefined,
        body: { decision },
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
        <span className="font-serif italic text-cream">Missed</span> punches
      </h1>
      <p className="text-creamSoft/40 text-sm mt-1">
        Pending requests from staff. Approve to insert the punch.
      </p>

      {err && <p className="text-amber-300/80 text-sm mt-4">{err}</p>}

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {!rows ? (
          <ListSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">
            All caught up — no pending requests.
          </div>
        ) : (
          <ul className="divide-y divide-creamSoft/5">
            <AnimatePresence initial={false}>
              {rows.map((r) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="flex-1">
                    <div className="text-creamSoft text-base tracking-tight">
                      {r.user_name}
                    </div>
                    <div className="text-creamSoft/60 text-sm mt-0.5">
                      {TYPE_LABEL[r.type]} ·{' '}
                      <span className="tabular-nums">
                        {formatDateTime(r.proposed_ts)}
                      </span>
                    </div>
                    <div className="text-creamSoft/50 text-sm mt-2 italic">
                      "{r.reason}"
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === r.id}
                      onClick={() => decide(r.id, 'deny')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-4 py-2 text-sm tracking-tight disabled:opacity-50"
                    >
                      <X size={14} /> Deny
                    </button>
                    <button
                      disabled={busyId === r.id}
                      onClick={() => decide(r.id, 'approve')}
                      className="inline-flex items-center gap-1.5 rounded-full bg-cream text-ink px-4 py-2 text-sm tracking-tight disabled:opacity-50"
                    >
                      <Check size={14} /> Approve
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Phoenix',
  });
}
