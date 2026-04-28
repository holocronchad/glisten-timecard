import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';
import { useToast } from '../shared/toast';

type PendingUser = {
  id: number;
  name: string;
  role: string;
  created_at: string;
  cpr_org: string | null;
  cpr_expires_at: string | null;
  punch_count: string | number;
  first_punch_at: string | null;
  last_punch_at: string | null;
};

type PendingResponse = { pending: PendingUser[] };

export default function Pending() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<PendingUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  async function load() {
    try {
      const r = await api<PendingResponse>('/manage/pending', {
        token: token ?? undefined,
      });
      setData(r.pending);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (cancelled) return;
      await load();
    }
    run();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function decide(id: number, decision: 'approve' | 'deny') {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await api(`/manage/users/${id}/${decision}`, {
        method: 'POST',
        body: {},
        token: token ?? undefined,
      });
      toast(decision === 'approve' ? 'Approved.' : 'Denied.');
      setData((d) => (d ? d.filter((u) => u.id !== id) : d));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Action failed', 'error');
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
          <span className="font-serif italic text-cream">Pending</span> approvals
        </h1>
        <p className="text-creamSoft/40 text-sm mt-1">
          New employees who registered themselves at the kiosk. Their punches are
          recorded but excluded from payroll until approved.
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {loading && !data ? (
          <ListSkeleton rows={3} />
        ) : !data || data.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">
            No one is waiting on approval right now.
          </div>
        ) : (
          <div className="divide-y divide-creamSoft/5">
            {data.map((u, i) => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.4) }}
                className="flex items-start sm:items-center gap-4 p-5 flex-col sm:flex-row"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-creamSoft text-base tracking-tight">
                    {u.name}
                  </div>
                  <div className="text-creamSoft/40 text-xs tracking-tight mt-0.5">
                    Registered {timeAgo(u.created_at)} · {Number(u.punch_count)} punch
                    {Number(u.punch_count) === 1 ? '' : 'es'} on file
                    {u.last_punch_at && (
                      <> · last {timeAgo(u.last_punch_at)}</>
                    )}
                  </div>
                  {u.cpr_org && (
                    <div className="text-creamSoft/40 text-xs tracking-tight mt-0.5">
                      CPR: {u.cpr_org}
                      {u.cpr_expires_at && (
                        <> · expires {formatDate(u.cpr_expires_at)}</>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(u.id, 'deny')}
                    disabled={busyIds.has(u.id)}
                    className="rounded-full px-4 py-2 text-creamSoft/60 hover:text-rose-300 text-sm tracking-tight border border-creamSoft/15 hover:border-rose-300/40 transition-colors disabled:opacity-30 inline-flex items-center gap-2"
                  >
                    <X size={14} /> Deny
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(u.id, 'approve')}
                    disabled={busyIds.has(u.id)}
                    className="rounded-full px-4 py-2 bg-cream text-ink text-sm tracking-tight font-bold disabled:opacity-30 inline-flex items-center gap-2"
                  >
                    <CheckCircle2 size={14} /> Approve
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return iso;
  const diff = Date.now() - ts.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 14) return `${d}d ago`;
  return ts.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
