import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { api, ApiError, PunchType } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';
import { useToast } from '../shared/toast';
import { PUNCH_LABEL, punchTextClass } from '../shared/punchType';

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
  // Captured at request time from which PIN the employee used (added
  // 2026-05-04). null = WFH PIN → WFH-rate punch on approve. number =
  // home office id → office-rate punch on approve. Manager can spot a
  // mis-filing before clicking approve.
  location_id: number | null;
};

type DecidedRequest = MissedRequest & {
  status: 'approved' | 'denied';
  decided_at: string;
  decider_name: string | null;
  inserted_punch_id: number | null;
};

export default function Missed() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<MissedRequest[] | null>(null);
  const [decidedToday, setDecidedToday] = useState<DecidedRequest[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    const r = await api<{
      requests: MissedRequest[];
      decided_today: DecidedRequest[];
    }>('/manage/missed', {
      token: token ?? undefined,
    });
    setRows(r.requests);
    setDecidedToday(r.decided_today ?? []);
  }

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    function onVis() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function decide(id: number, decision: 'approve' | 'deny') {
    setBusyId(id);
    try {
      await api(`/manage/missed/${id}/decide`, {
        method: 'POST',
        token: token ?? undefined,
        body: { decision },
      });
      toast(
        decision === 'approve' ? 'Approved — punch inserted.' : 'Request denied.',
      );
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Action failed', 'error');
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

      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-8 mb-3">
        Pending
      </h2>

      <div className="rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
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
                    <div className="text-sm mt-0.5">
                      <span className={`font-medium ${punchTextClass(r.type as PunchType)}`}>
                        {PUNCH_LABEL[r.type as PunchType]}
                      </span>
                      <span className="text-creamSoft/60"> · </span>
                      <span className="text-creamSoft/60 tabular-nums">
                        {formatDateTime(r.proposed_ts)}
                      </span>
                      {r.location_id == null && (
                        <span className="text-sky-300/80 ml-2 text-xs uppercase tracking-[0.14em]">
                          · WFH rate
                        </span>
                      )}
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

      {decidedToday.length > 0 && (
        <>
          <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
            Decided today
          </h2>
          <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 divide-y divide-creamSoft/5">
            {decidedToday.map((d) => (
              <div
                key={d.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <span
                  className={[
                    'rounded-full text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 border shrink-0',
                    d.status === 'approved'
                      ? 'text-emerald-300 border-emerald-300/20 bg-emerald-300/10'
                      : 'text-creamSoft/40 border-creamSoft/10',
                  ].join(' ')}
                >
                  {d.status}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-creamSoft text-sm tracking-tight">
                    {d.user_name}
                  </div>
                  <div className="text-sm mt-0.5">
                    <span className={`font-medium ${punchTextClass(d.type as PunchType)}`}>
                      {PUNCH_LABEL[d.type as PunchType]}
                    </span>
                    <span className="text-creamSoft/60"> · </span>
                    <span className="text-creamSoft/60 tabular-nums">
                      {formatDateTime(d.proposed_ts)}
                    </span>
                    {d.status === 'approved' && d.inserted_punch_id !== null && (
                      <span className="text-emerald-300/80 ml-2 text-xs">
                        · punch #{d.inserted_punch_id} added
                      </span>
                    )}
                  </div>
                  <div className="text-creamSoft/50 text-sm mt-1 italic truncate">
                    "{d.reason}"
                  </div>
                </div>
                <div className="text-creamSoft/40 text-xs tabular-nums whitespace-nowrap">
                  {formatDateTime(d.decided_at)}
                  {d.decider_name && (
                    <span className="block text-[10px] text-creamSoft/30">
                      by {d.decider_name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
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
