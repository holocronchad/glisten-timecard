import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, Mail, Clock as ClockIcon } from 'lucide-react';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';
import { ListSkeleton } from './Skeleton';

type BriefResponse = {
  since: string;
  on_clock_count: number;
  pending_missed: { count: number; items: Array<{ id: number; user_name: string; type: string; proposed_ts: string; reason: string }> };
  failed_logins: { count: number; items: Array<{ id: number; action: string; ts: string; ip: string | null; reason: string | null }> };
  period_anomalies: {
    total: number;
    high: number;
    medium: number;
    items: Array<{ user_id: number; user_name: string; date: string; severity: 'high' | 'medium' | 'low'; type: string; message: string }>;
  };
  period: { index: number; label: string };
};

type TodayResponse = {
  today: string;
  pending_count: number;
  employees: Array<{
    user: { id: number; name: string; role: string; approved: boolean; self_registered: boolean };
    status: 'on_clock' | 'on_lunch' | 'off';
    worked_minutes_today: number;
    last_punch: {
      id: number;
      type: string;
      ts: string;
      flagged: boolean;
      location_id: number | null;
      is_wfh: boolean;
    } | null;
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
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [r, b] = await Promise.all([
          api<TodayResponse>('/manage/today', { token: token ?? undefined }),
          api<BriefResponse>('/manage/brief', { token: token ?? undefined }),
        ]);
        if (!cancelled) {
          setData(r);
          setBrief(b);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000);
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
      {brief && <Brief brief={brief} />}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Today</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            Live status — updates every minute.
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
                <div className="flex items-center gap-2">
                  <div
                    className={[
                      'rounded-full text-xs px-3 py-1 border',
                      STATUS_TONE[e.status],
                    ].join(' ')}
                  >
                    {STATUS_LABEL[e.status]}
                  </div>
                  {/* WFH/Office badge — only meaningful when actively on clock or on lunch */}
                  {e.last_punch && e.status !== 'off' && (
                    <div
                      className={[
                        'rounded-full text-[10px] tracking-[0.12em] uppercase px-2 py-1 border',
                        e.last_punch.is_wfh
                          ? 'bg-sky-300/10 text-sky-300 border-sky-300/30'
                          : 'bg-cream/10 text-creamSoft border-creamSoft/20',
                      ].join(' ')}
                      title={
                        e.last_punch.is_wfh
                          ? 'Punched in with WFH PIN — paid at WFH rate'
                          : 'Punched in with office PIN — paid at office rate'
                      }
                    >
                      {e.last_punch.is_wfh ? 'WFH' : 'Office'}
                    </div>
                  )}
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

function Brief({ brief }: { brief: BriefResponse }) {
  const sinceLabel = relativeTime(brief.since);
  const nav = useNavigate();
  // Build the headline. Order of priority: pending requests → high anomalies →
  // failed logins → all-clear.
  const hasUrgent =
    brief.pending_missed.count > 0 ||
    brief.period_anomalies.high > 0 ||
    brief.failed_logins.count > 0;

  const headline = hasUrgent
    ? buildHeadlineParts(brief)
    : ['All clear since you last logged in. ', `${brief.on_clock_count} on the clock right now.`];

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={[
        'mb-8 rounded-3xl border p-5',
        hasUrgent
          ? 'border-amber-300/30 bg-amber-300/5'
          : 'border-emerald-300/25 bg-emerald-300/5',
      ].join(' ')}
    >
      <div className="flex items-start gap-4">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${
            hasUrgent ? 'bg-amber-300 text-ink' : 'bg-emerald-300 text-ink'
          }`}
        >
          {hasUrgent ? <AlertTriangle size={18} /> : <ClockIcon size={18} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-creamSoft/40 text-[10px] tracking-[0.2em] uppercase mb-1">
            Since {sinceLabel}
          </div>
          <p className="text-creamSoft text-base leading-relaxed">{headline}</p>

          {hasUrgent && (
            <div className="mt-3 flex flex-wrap gap-2">
              {brief.pending_missed.count > 0 && (
                <button
                  onClick={() => nav('/manage/missed')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cream text-ink px-3 py-1.5 text-xs tracking-tight"
                >
                  <Mail size={12} /> Review {brief.pending_missed.count} request
                  {brief.pending_missed.count > 1 ? 's' : ''}
                </button>
              )}
              {brief.period_anomalies.high > 0 && (
                <button
                  onClick={() => nav('/manage/period')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cream text-ink px-3 py-1.5 text-xs tracking-tight"
                >
                  <AlertTriangle size={12} /> Review {brief.period_anomalies.high} HIGH
                </button>
              )}
              {brief.failed_logins.count > 0 && (
                <button
                  onClick={() => nav('/manage/audit')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-3 py-1.5 text-xs tracking-tight"
                >
                  <ShieldAlert size={12} /> {brief.failed_logins.count} failed PIN
                  {brief.failed_logins.count > 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function buildHeadlineParts(b: BriefResponse): string {
  const parts: string[] = [];
  parts.push(`${b.on_clock_count} on the clock`);
  if (b.pending_missed.count > 0) {
    const oldest = b.pending_missed.items[0];
    const oldestName = oldest?.user_name ?? 'someone';
    parts.push(
      `${b.pending_missed.count} missed-punch request${b.pending_missed.count > 1 ? 's' : ''} pending (oldest: ${oldestName})`,
    );
  }
  if (b.period_anomalies.high > 0) {
    const top = b.period_anomalies.items.find((i) => i.severity === 'high');
    parts.push(
      top
        ? `${b.period_anomalies.high} HIGH anomalies — top: ${top.user_name} ${top.message.toLowerCase()}`
        : `${b.period_anomalies.high} HIGH anomalies in this pay period`,
    );
  } else if (b.period_anomalies.medium > 0) {
    parts.push(`${b.period_anomalies.medium} medium-severity anomalies in this pay period`);
  }
  if (b.failed_logins.count > 0) {
    parts.push(
      `${b.failed_logins.count} failed PIN attempt${b.failed_logins.count > 1 ? 's' : ''} since you logged in`,
    );
  }
  return parts.join(' · ') + '.';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Phoenix',
  });
}
