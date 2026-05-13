import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Coffee, X } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';
import { useToast } from '../shared/toast';

// Manager queue for clock_outs flagged by the lunch attestation gate.
// Surfaces both no_lunch and short_lunch (< 15 min) shifts on 7+ hour
// days. Dr. Dawood approves or rejects each one with optional notes.
type ReviewRow = {
  id: number;
  user_id: number;
  user_name: string;
  ts: string;
  location_id: number | null;
  no_lunch_reason: string | null;
  lunch_review_status: 'pending' | 'approved' | 'rejected';
  lunch_review_reason: 'no_lunch' | 'short_lunch';
  lunch_review_minutes: number | null;
  lunch_reviewed_by: number | null;
  lunch_reviewed_at: string | null;
  lunch_review_notes: string | null;
  reviewed_by_name: string | null;
};

export default function LunchReview() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<ReviewRow[] | null>(null);
  const [decided, setDecided] = useState<ReviewRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notesById, setNotesById] = useState<Record<number, string>>({});

  async function load() {
    const r = await api<{ pending: ReviewRow[]; decided: ReviewRow[] }>(
      '/manage/lunch-reviews?status=all',
      { token: token ?? undefined },
    );
    setPending(r.pending ?? []);
    setDecided(r.decided ?? []);
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

  async function decide(row: ReviewRow, decision: 'approve' | 'reject') {
    setBusyId(row.id);
    try {
      const notes = (notesById[row.id] ?? '').trim();
      await api(`/manage/lunch-reviews/${row.id}`, {
        method: 'POST',
        token: token ?? undefined,
        body: { decision, notes: notes.length > 0 ? notes : undefined },
      });
      toast(decision === 'approve' ? 'Approved.' : 'Rejected.');
      setNotesById((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
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
        <span className="font-serif italic text-cream">Lunch</span> review
      </h1>
      <p className="text-creamSoft/40 text-sm mt-1">
        Shifts of 7+ hours where lunch was skipped or under 15 minutes. Approve
        or reject each one — payroll is unaffected, this is for your records.
      </p>

      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-8 mb-3">
        Pending
      </h2>

      <div className="rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {!pending ? (
          <ListSkeleton rows={3} />
        ) : pending.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">
            All caught up — no shifts to review.
          </div>
        ) : (
          <ul className="divide-y divide-creamSoft/5">
            <AnimatePresence initial={false}>
              {pending.map((r) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="p-5 flex flex-col gap-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-lunchAccent/15 text-lunchAccent">
                      <Coffee size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-creamSoft text-base tracking-tight">
                        {r.user_name}
                      </div>
                      <div className="text-sm mt-0.5">
                        <span
                          className={[
                            'rounded-full text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 border',
                            r.lunch_review_reason === 'no_lunch'
                              ? 'text-rose-300 border-rose-300/30 bg-rose-300/10'
                              : 'text-amber-300 border-amber-300/30 bg-amber-300/10',
                          ].join(' ')}
                        >
                          {r.lunch_review_reason === 'no_lunch'
                            ? 'No lunch'
                            : `Short · ${r.lunch_review_minutes ?? 0} min`}
                        </span>
                        <span className="text-creamSoft/60 ml-3 tabular-nums">
                          {formatDateTime(r.ts)}
                        </span>
                      </div>
                      {r.no_lunch_reason && (
                        <div className="text-creamSoft/55 text-sm mt-2 italic">
                          "{r.no_lunch_reason}"
                        </div>
                      )}
                    </div>
                  </div>

                  <textarea
                    value={notesById[r.id] ?? ''}
                    onChange={(e) =>
                      setNotesById((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder="Optional notes for your records…"
                    disabled={busyId === r.id}
                    className="w-full bg-ink/60 border border-creamSoft/10 rounded-2xl px-3 py-2 text-creamSoft placeholder-creamSoft/30 focus:outline-none focus:border-creamSoft/30 transition-colors text-sm"
                  />

                  <div className="flex gap-2 justify-end">
                    <button
                      disabled={busyId === r.id}
                      onClick={() => decide(r, 'reject')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-4 py-2 text-sm tracking-tight disabled:opacity-50"
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      disabled={busyId === r.id}
                      onClick={() => decide(r, 'approve')}
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

      {decided.length > 0 && (
        <>
          <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
            Recently decided
          </h2>
          <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 divide-y divide-creamSoft/5">
            {decided.map((d) => (
              <div
                key={d.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <span
                  className={[
                    'rounded-full text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 border shrink-0',
                    d.lunch_review_status === 'approved'
                      ? 'text-emerald-300 border-emerald-300/20 bg-emerald-300/10'
                      : 'text-creamSoft/40 border-creamSoft/10',
                  ].join(' ')}
                >
                  {d.lunch_review_status}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-creamSoft text-sm tracking-tight">
                    {d.user_name}
                    <span className="text-creamSoft/40 ml-2 text-xs">
                      ·{' '}
                      {d.lunch_review_reason === 'no_lunch'
                        ? 'No lunch'
                        : `Short · ${d.lunch_review_minutes ?? 0} min`}
                    </span>
                  </div>
                  <div className="text-sm mt-0.5">
                    <span className="text-creamSoft/60 tabular-nums">
                      {formatDateTime(d.ts)}
                    </span>
                  </div>
                  {d.no_lunch_reason && (
                    <div className="text-creamSoft/50 text-xs mt-1 italic truncate">
                      "{d.no_lunch_reason}"
                    </div>
                  )}
                  {d.lunch_review_notes && (
                    <div className="text-creamSoft/40 text-xs mt-1">
                      Notes: {d.lunch_review_notes}
                    </div>
                  )}
                </div>
                <div className="text-creamSoft/40 text-xs tabular-nums whitespace-nowrap">
                  {d.lunch_reviewed_at && formatDateTime(d.lunch_reviewed_at)}
                  {d.reviewed_by_name && (
                    <span className="block text-[10px] text-creamSoft/30">
                      by {d.reviewed_by_name}
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
