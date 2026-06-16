import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Check, X } from 'lucide-react';
import { api, ApiError, PunchType } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';
import { useToast } from '../shared/toast';
import { PUNCH_LABEL, punchTextClass } from '../shared/punchType';

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

type MissedRequest = {
  id: number;
  user_id: number;
  user_name: string;
  type: string;
  proposed_ts: string;
  reason: string;
  location_id: number | null;
  created_at: string;
};

export default function Pending() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<PendingUser[] | null>(null);
  const [missed, setMissed] = useState<MissedRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUserIds, setBusyUserIds] = useState<Set<number>>(new Set());
  const [busyMissedId, setBusyMissedId] = useState<number | null>(null);

  async function load() {
    const [usersRes, missedRes] = await Promise.allSettled([
      api<{ pending: PendingUser[] }>('/manage/pending', { token: token ?? undefined }),
      api<{ requests: MissedRequest[] }>('/manage/missed', { token: token ?? undefined }),
    ]);
    if (usersRes.status === 'fulfilled') setUsers(usersRes.value.pending);
    if (missedRes.status === 'fulfilled') setMissed(missedRes.value.requests);
    setLoading(false);
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

  async function decideUser(id: number, decision: 'approve' | 'deny') {
    setBusyUserIds((s) => new Set(s).add(id));
    try {
      await api(`/manage/users/${id}/${decision}`, {
        method: 'POST',
        body: {},
        token: token ?? undefined,
      });
      toast(decision === 'approve' ? 'Approved.' : 'Denied.');
      setUsers((d) => (d ? d.filter((u) => u.id !== id) : d));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Action failed', 'error');
    } finally {
      setBusyUserIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function decideMissed(id: number, decision: 'approve' | 'deny') {
    setBusyMissedId(id);
    try {
      await api(`/manage/missed/${id}/decide`, {
        method: 'POST',
        body: { decision },
        token: token ?? undefined,
      });
      toast(decision === 'approve' ? 'Approved — punch inserted.' : 'Request denied.');
      setMissed((d) => (d ? d.filter((r) => r.id !== id) : d));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Action failed', 'error');
    } finally {
      setBusyMissedId(null);
    }
  }

  const totalPending = (users?.length ?? 0) + (missed?.length ?? 0);

  return (
    <div>
      <div>
        <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
          <span className="font-serif italic text-cream">Pending</span> approvals
        </h1>
        <p className="text-creamSoft/40 text-sm mt-1">
          Everything waiting on your decision.
        </p>
      </div>

      {/* ── Missed punch requests ────────────────────────────── */}
      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
        Missed punch requests
      </h2>
      <div className="rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {loading && !missed ? (
          <ListSkeleton rows={4} />
        ) : !missed || missed.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">All caught up.</div>
        ) : (
          <ul className="divide-y divide-creamSoft/5">
            <AnimatePresence initial={false}>
              {missed.map((r) => (
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
                      disabled={busyMissedId === r.id}
                      onClick={() => decideMissed(r.id, 'deny')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-4 py-2 text-sm tracking-tight disabled:opacity-50"
                    >
                      <X size={14} /> Deny
                    </button>
                    <button
                      disabled={busyMissedId === r.id}
                      onClick={() => decideMissed(r.id, 'approve')}
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

      {/* ── New staff registrations ──────────────────────────── */}
      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
        New staff registrations
      </h2>
      <div className="rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {loading && !users ? (
          <ListSkeleton rows={3} />
        ) : !users || users.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">
            No new self-registrations.
          </div>
        ) : (
          <div className="divide-y divide-creamSoft/5">
            {users.map((u, i) => (
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
                    onClick={() => decideUser(u.id, 'deny')}
                    disabled={busyUserIds.has(u.id)}
                    className="rounded-full px-4 py-2 text-creamSoft/60 hover:text-rose-300 text-sm tracking-tight border border-creamSoft/15 hover:border-rose-300/40 transition-colors disabled:opacity-30 inline-flex items-center gap-2"
                  >
                    <X size={14} /> Deny
                  </button>
                  <button
                    type="button"
                    onClick={() => decideUser(u.id, 'approve')}
                    disabled={busyUserIds.has(u.id)}
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

      {!loading && totalPending === 0 && (
        <p className="mt-8 text-creamSoft/30 text-sm text-center">
          All clear — nothing waiting for approval.
        </p>
      )}
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Phoenix',
  });
}
