import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, Pencil } from 'lucide-react';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';
import { buildSegments, totalsByDay, totalMinutes, type PunchType } from '../shared/hours';
import EditPunchModal from './EditPunchModal';

type EmployeeDetailResponse = {
  user: {
    id: number;
    name: string;
    email: string | null;
    role: string;
    employment_type: 'W2' | '1099';
    is_owner: boolean;
    is_manager: boolean;
    track_hours: boolean;
    active: boolean;
  };
  period: { index: number; start: string; end: string; label: string };
  punches: Array<{
    id: number;
    location_id: number | null;
    location_name: string | null;
    type: PunchType;
    ts: string;
    source: string;
    flagged: boolean;
    flag_reason: string | null;
    auto_closed_at: string | null;
  }>;
  missed: Array<{
    id: number;
    type: PunchType;
    proposed_ts: string;
    reason: string;
    status: 'pending' | 'approved' | 'denied';
    created_at: string;
    decided_at: string | null;
  }>;
};

const TYPE_LABEL: Record<PunchType, string> = {
  clock_in: 'Clock in',
  clock_out: 'Clock out',
  lunch_start: 'Lunch start',
  lunch_end: 'Lunch end',
};

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { token } = useAuth();
  const [data, setData] = useState<EmployeeDetailResponse | null>(null);
  const [editing, setEditing] = useState<EmployeeDetailResponse['punches'][number] | null>(null);

  const idxParam = params.get('index');

  async function load() {
    const path = idxParam
      ? `/manage/employees/${id}?index=${idxParam}`
      : `/manage/employees/${id}`;
    const r = await api<EmployeeDetailResponse>(path, {
      token: token ?? undefined,
    });
    setData(r);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idxParam, token]);

  function shiftPeriod(delta: number) {
    if (!data) return;
    setParams({ index: String(data.period.index + delta) });
  }

  if (!data) {
    return <div className="text-creamSoft/40 text-sm">Loading…</div>;
  }

  const segments = buildSegments(data.punches);
  const dailyTotals = totalsByDay(segments);
  const total = totalMinutes(segments);

  return (
    <div>
      <button
        onClick={() => nav(-1)}
        className="inline-flex items-center gap-1.5 text-creamSoft/40 hover:text-creamSoft/80 text-sm tracking-tight mb-6"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            {data.user.name.split(' ')[0]}{' '}
            <span className="font-serif italic text-cream">
              {data.user.name.split(' ').slice(1).join(' ')}
            </span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            {data.user.role} · {data.user.employment_type}
            {!data.user.active && (
              <span className="ml-2 text-amber-300/80">inactive</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftPeriod(-1)}
            className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-creamSoft/60 text-sm tabular-nums px-2">
            {data.period.label}
          </span>
          <button
            onClick={() => shiftPeriod(1)}
            className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Period total" value={hhmm(total)} />
        <Stat label="Days worked" value={String(dailyTotals.length)} />
        <Stat
          label="Flagged"
          value={String(data.punches.filter((p) => p.flagged).length)}
        />
        <Stat
          label="Missed reqs"
          value={String(
            data.missed.filter((m) => m.status === 'pending').length,
          )}
        />
      </div>

      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
        Daily timeline
      </h2>
      <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 p-5">
        {dailyTotals.length === 0 ? (
          <div className="text-creamSoft/40 text-sm">
            No worked hours in this period.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {dailyTotals.map((d) => (
              <DayRow key={d.date} date={d.date} segments={segments} />
            ))}
          </div>
        )}
      </div>

      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
        Punches in period
      </h2>
      <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 overflow-hidden">
        {data.punches.length === 0 ? (
          <div className="p-6 text-creamSoft/40 text-sm">No punches.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-creamSoft/40 text-[11px] tracking-[0.18em] uppercase">
              <tr>
                <th className="text-left px-5 py-3">When</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3 hidden sm:table-cell">Location</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Source</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-creamSoft/5">
              {data.punches.map((p) => (
                <tr
                  key={p.id}
                  onClick={() =>
                    setEditing({
                      ...p,
                    })
                  }
                  className="hover:bg-creamSoft/5 cursor-pointer group"
                >
                  <td className="px-5 py-3 text-creamSoft tabular-nums whitespace-nowrap">
                    {dateLabel(p.ts)} · {formatTime(p.ts)}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/80">
                    {TYPE_LABEL[p.type]}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/60 hidden sm:table-cell">
                    {p.location_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/40 hidden md:table-cell">
                    {p.source}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {p.flagged ? (
                      <span className="inline-flex items-center gap-1 text-amber-300/80 text-xs">
                        <Flag size={12} /> {p.flag_reason ?? 'flagged'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-creamSoft/30 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pencil size={12} /> Edit
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.missed.length > 0 && (
        <>
          <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
            Missed-punch history
          </h2>
          <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 divide-y divide-creamSoft/5">
            {data.missed.map((m) => (
              <div key={m.id} className="p-4 flex items-center gap-3">
                <span
                  className={[
                    'rounded-full text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 border',
                    m.status === 'approved'
                      ? 'text-emerald-300 border-emerald-300/20 bg-emerald-300/10'
                      : m.status === 'denied'
                        ? 'text-creamSoft/40 border-creamSoft/10'
                        : 'text-amber-300 border-amber-300/20 bg-amber-300/10',
                  ].join(' ')}
                >
                  {m.status}
                </span>
                <span className="text-creamSoft/80 text-sm">
                  {TYPE_LABEL[m.type]} · {dateLabel(m.proposed_ts)} {formatTime(m.proposed_ts)}
                </span>
                <span className="flex-1 text-creamSoft/50 text-sm italic truncate">
                  "{m.reason}"
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {editing && (
          <EditPunchModal
            punch={{
              id: editing.id,
              user_name: data.user.name,
              type: editing.type,
              ts: editing.ts,
              flagged: editing.flagged,
            }}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DayRow({
  date,
  segments,
}: {
  date: string;
  segments: ReturnType<typeof buildSegments>;
}) {
  const [y, m, d] = date.split('-').map(Number);
  const dayStart = new Date(`${date}T00:00:00-07:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;
  const minute = (t: number) => Math.max(0, Math.min(1440, (t - dayStart) / 60_000));

  // 6 AM → 10 PM is the visible window
  const VIEW_START = 6 * 60;
  const VIEW_END = 22 * 60;
  const VIEW_SPAN = VIEW_END - VIEW_START;
  const pct = (m: number) => `${((m - VIEW_START) / VIEW_SPAN) * 100}%`;

  const todaySegs = segments.filter(
    (s) => s.start.getTime() < dayEnd && s.end.getTime() > dayStart,
  );

  const minutesWorked = todaySegs
    .filter((s) => s.paid)
    .reduce(
      (acc, s) => acc + Math.max(0, (s.end.getTime() - s.start.getTime()) / 60_000),
      0,
    );

  const dateObj = new Date(Date.UTC(y, m - 1, d, 12));
  const label = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });

  return (
    <div className="flex items-center gap-4">
      <div className="w-32 shrink-0">
        <div className="text-creamSoft text-sm tracking-tight">{label}</div>
        <div className="text-creamSoft/40 text-xs tabular-nums">
          {hhmm(Math.round(minutesWorked))}
        </div>
      </div>

      <div className="relative flex-1 h-8 bg-ink/60 rounded-full overflow-hidden">
        {/* Hour gridlines */}
        {[8, 12, 16, 20].map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 w-px bg-creamSoft/10"
            style={{ left: pct(h * 60) }}
          />
        ))}
        {/* Segments */}
        {todaySegs.map((s, i) => {
          const startMin = Math.max(VIEW_START, minute(s.start.getTime()));
          const endMin = Math.min(VIEW_END, minute(s.end.getTime()));
          if (endMin <= startMin) return null;
          const left = pct(startMin);
          const width = `${((endMin - startMin) / VIEW_SPAN) * 100}%`;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.4, delay: i * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
              className={[
                'absolute top-1.5 bottom-1.5 rounded-full origin-left',
                s.paid
                  ? s.open
                    ? 'bg-amber-300/60'
                    : 'bg-cream'
                  : 'bg-creamSoft/15',
              ].join(' ')}
              style={{ left, width }}
              title={`${s.paid ? 'Paid' : 'Lunch'} · ${formatTime(s.start.toISOString())}–${formatTime(s.end.toISOString())}`}
            />
          );
        })}
      </div>

      <div className="hidden sm:flex w-32 justify-end gap-2 text-[10px] text-creamSoft/30 tabular-nums">
        <span>6a</span>
        <span>10p</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 p-4">
      <div className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase">
        {label}
      </div>
      <div className="text-creamSoft text-2xl tracking-tight font-light mt-1 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function hhmm(minutes: number): string {
  if (!minutes) return '0h 00m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
}
