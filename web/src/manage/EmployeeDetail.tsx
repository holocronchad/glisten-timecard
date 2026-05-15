import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, Pencil, Coffee, ShieldCheck } from 'lucide-react';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';
import { buildSegments, totalsByDay, totalMinutes, type PunchType } from '../shared/hours';
import EditPunchModal from './EditPunchModal';
import BlurredRate from './BlurredRate';
import { PUNCH_LABEL, punchTextClass } from '../shared/punchType';
import { cprBucketFromExpiry, formatCprDate } from '../shared/cprStatus';

type EmployeeDetailResponse = {
  user: {
    id: number;
    name: string;
    email: string | null;
    role: string;
    employment_type: 'W2' | '1099';
    pay_rate_cents: number | null;
    // WFH rate — paid when this employee punches with the WFH PIN.
    // Null when no separate rate is set (single-rate user).
    pay_rate_cents_remote: number | null;
    is_owner: boolean;
    is_manager: boolean;
    track_hours: boolean;
    active: boolean;
    cpr_org: string | null;
    cpr_issued_at: string | null;
    cpr_expires_at: string | null;
    cpr_updated_at: string | null;
  };
  // index = null when this is a custom range (not a known pay period)
  period: { index: number | null; start: string; end: string; label: string };
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
    no_lunch_reason: string | null;
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
  // Server-computed split for dual-rate employees (Filza). Always present;
  // for single-rate users, has_split_rate is false and the WFH columns
  // collapse to zero. Render the breakdown card only when has_split_rate is true.
  rate_summary: {
    has_split_rate: boolean;
    office_minutes: number;
    wfh_minutes: number;
    total_minutes: number;
    office_rate_cents: number;
    wfh_rate_cents: number;
    office_pay_cents: number;
    wfh_pay_cents: number;
    total_pay_cents: number;
  };
};


export default function EmployeeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { token } = useAuth();
  const [data, setData] = useState<EmployeeDetailResponse | null>(null);
  const [editing, setEditing] = useState<EmployeeDetailResponse['punches'][number] | null>(null);

  const idxParam = params.get('index');
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const isCustomRange = Boolean(fromParam && toParam);

  async function load() {
    const sp = new URLSearchParams();
    if (isCustomRange) {
      sp.set('from', fromParam!);
      sp.set('to', toParam!);
    } else if (idxParam) {
      sp.set('index', idxParam);
    }
    const path = sp.toString()
      ? `/manage/employees/${id}?${sp.toString()}`
      : `/manage/employees/${id}`;
    const r = await api<EmployeeDetailResponse>(path, {
      token: token ?? undefined,
    });
    setData(r);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idxParam, fromParam, toParam, token]);

  // Refresh on global "punches updated" broadcast (AddHoursModal +
  // EditPunchModal both fire it). Lets Dr. Dawood see her changes
  // immediately without a manual page reload.
  useEffect(() => {
    function onPunchesUpdated(e: Event) {
      const detail = (e as CustomEvent<{ userId?: number }>).detail;
      // Only reload if no userId in detail (broad change) or it matches us.
      if (!detail || detail.userId == null || String(detail.userId) === id) {
        load();
      }
    }
    window.addEventListener('glisten:punches-updated', onPunchesUpdated);
    return () => window.removeEventListener('glisten:punches-updated', onPunchesUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, idxParam, token]);

  function shiftPeriod(delta: number) {
    if (!data || data.period.index === null) return;
    setParams({ index: String(data.period.index + delta) });
  }

  function applyCustomRange(from: string, to: string) {
    if (!from || !to) return;
    setParams({ from, to });
  }

  function clearCustomRange() {
    setParams({});
  }

  if (!data) {
    return <div className="text-creamSoft/40 text-sm">Loading…</div>;
  }

  const segments = buildSegments(data.punches);
  const workedDays = totalsByDay(segments);
  const total = totalMinutes(segments);
  // Pad to every day in the pay period so off-days render as zero rows.
  // Dr. Dawood does payroll review per-day — she wants a clean ~14-row
  // breakdown, not just the days the employee happened to work.
  const fullPeriodDays = enumerateDays(data.period.start, data.period.end);
  const dailyMap = new Map(workedDays.map((d) => [d.date, d]));
  const dailyTotals = fullPeriodDays.map(
    (date) =>
      dailyMap.get(date) ?? { date, worked_minutes: 0, open: false },
  );

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
            {data.user.pay_rate_cents !== null && (
              <span className="text-creamSoft/70 ml-2 inline-flex items-baseline gap-1">
                · <BlurredRate cents={data.user.pay_rate_cents} />/hr
                {data.user.pay_rate_cents_remote !== null && (
                  <span
                    className="ml-2 text-[10px] tracking-[0.12em] uppercase rounded-full px-2 py-0.5 bg-sky-300/10 text-sky-300 border border-sky-300/30 inline-flex items-baseline gap-1"
                    title="WFH rate (paid when punching with WFH PIN)"
                  >
                    WFH&nbsp;<BlurredRate cents={data.user.pay_rate_cents_remote} />/hr
                  </span>
                )}
              </span>
            )}
            {!data.user.active && (
              <span className="ml-2 text-amber-300/80">inactive</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {!isCustomRange ? (
            <>
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
            </>
          ) : (
            <span className="text-creamSoft/60 text-sm tabular-nums px-2">
              Custom range
            </span>
          )}
        </div>
      </div>

      <DateRangeBar
        isCustom={isCustomRange}
        currentFrom={fromParam ?? data.period.start.slice(0, 10)}
        currentTo={toParam ?? data.period.end.slice(0, 10)}
        onApply={applyCustomRange}
        onClear={clearCustomRange}
      />

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

      {data.user.track_hours && !data.user.is_owner && (
        <CprCard
          org={data.user.cpr_org}
          issuedAt={data.user.cpr_issued_at}
          expiresAt={data.user.cpr_expires_at}
          updatedAt={data.user.cpr_updated_at}
        />
      )}

      {/* Dual-rate breakdown — only renders for employees with separate WFH rate.
          Built 2026-05-04 to give Dr. Dawood the at-a-glance answer for Filza
          (and any future dual-rate staff): office hrs × $X + WFH hrs × $Y = total. */}
      {data.rate_summary.has_split_rate && (
        <div className="mt-6 rounded-3xl border border-creamSoft/15 bg-gradient-to-br from-graphite/60 to-graphite/30 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase">
              Pay breakdown — this period
            </span>
            <span className="text-creamSoft/30 text-xs">·</span>
            <span className="text-creamSoft/50 text-xs tabular-nums">
              {data.period.label}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Office bucket */}
            <div className="rounded-2xl border border-creamSoft/10 bg-graphite/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full px-2 py-0.5 bg-cream/10 text-creamSoft border border-creamSoft/20 text-[10px] tracking-[0.12em] uppercase">
                  Office
                </span>
                <span className="text-creamSoft/40 text-xs">
                  in-office PIN
                </span>
              </div>
              <div className="text-creamSoft text-2xl tracking-tight tabular-nums font-light">
                {hhmm(data.rate_summary.office_minutes)}
              </div>
              <div className="text-creamSoft/50 text-xs mt-1 tabular-nums inline-flex items-baseline gap-1">
                ×&nbsp;<BlurredRate cents={data.rate_summary.office_rate_cents} />/hr
              </div>
              <div className="text-cream text-lg tracking-tight mt-2 tabular-nums">
                <BlurredRate cents={data.rate_summary.office_pay_cents} className="text-base" />
              </div>
            </div>

            {/* WFH bucket */}
            <div className="rounded-2xl border border-sky-300/20 bg-sky-300/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full px-2 py-0.5 bg-sky-300/15 text-sky-300 border border-sky-300/30 text-[10px] tracking-[0.12em] uppercase">
                  WFH
                </span>
                <span className="text-creamSoft/40 text-xs">
                  remote PIN
                </span>
              </div>
              <div className="text-creamSoft text-2xl tracking-tight tabular-nums font-light">
                {hhmm(data.rate_summary.wfh_minutes)}
              </div>
              <div className="text-creamSoft/50 text-xs mt-1 tabular-nums inline-flex items-baseline gap-1">
                ×&nbsp;<BlurredRate cents={data.rate_summary.wfh_rate_cents} />/hr
              </div>
              <div className="text-cream text-lg tracking-tight mt-2 tabular-nums">
                <BlurredRate cents={data.rate_summary.wfh_pay_cents} className="text-base" />
              </div>
            </div>

            {/* Total */}
            <div className="rounded-2xl border border-creamSoft/25 bg-creamSoft/5 p-4 flex flex-col justify-between">
              <div className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase mb-2">
                Total this period
              </div>
              <div>
                <div className="text-creamSoft text-2xl tracking-tight tabular-nums font-light">
                  {hhmm(data.rate_summary.total_minutes)}
                </div>
                <div className="text-cream text-2xl tracking-tight mt-2 tabular-nums font-medium">
                  <BlurredRate cents={data.rate_summary.total_pay_cents} className="text-base font-medium" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
        Daily breakdown
      </h2>
      <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 p-5">
        <div className="flex flex-col gap-2">
          {dailyTotals.map((d) => (
            <DayRow
              key={d.date}
              date={d.date}
              minutes={d.worked_minutes}
              segments={segments}
            />
          ))}
        </div>
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
                  <td className={`px-5 py-3 font-medium ${punchTextClass(p.type)}`}>
                    {PUNCH_LABEL[p.type]}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/60 hidden sm:table-cell">
                    {p.location_id == null ? (
                      // WFH PIN punch — location_id is null by design (no
                      // geofence binding). Surface as a badge so managers
                      // see at a glance which rate this punch maps to.
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-sky-300/10 text-sky-300 border border-sky-300/30 text-[10px] tracking-[0.12em] uppercase">
                        WFH
                      </span>
                    ) : (
                      p.location_name ?? '—'
                    )}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/40 hidden md:table-cell">
                    {p.source}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-2 justify-end flex-wrap">
                      {p.no_lunch_reason && (
                        <span
                          className="inline-flex items-center gap-1 text-lunchAccent text-xs max-w-[260px] truncate"
                          title={`No lunch break — ${p.no_lunch_reason}`}
                        >
                          <Coffee size={12} /> no lunch · {p.no_lunch_reason}
                        </span>
                      )}
                      {p.flagged ? (
                        <span className="inline-flex items-center gap-1 text-amber-300/80 text-xs">
                          <Flag size={12} /> {p.flag_reason ?? 'flagged'}
                        </span>
                      ) : !p.no_lunch_reason ? (
                        <span className="inline-flex items-center gap-1 text-creamSoft/30 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil size={12} /> Edit
                        </span>
                      ) : null}
                    </div>
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
                <span className="text-sm">
                  <span className={`font-medium ${punchTextClass(m.type)}`}>
                    {PUNCH_LABEL[m.type]}
                  </span>
                  <span className="text-creamSoft/80"> · {dateLabel(m.proposed_ts)} {formatTime(m.proposed_ts)}</span>
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
              location_id: editing.location_id,
              location_name: editing.location_name ?? null,
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
  minutes,
  segments,
}: {
  date: string;
  minutes: number;
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

  const dateObj = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'America/Phoenix',
  });
  const monthDay = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const off = minutes === 0;

  return (
    <div
      className={[
        'flex items-center gap-4 py-2 px-3 rounded-2xl',
        off ? 'opacity-50' : '',
        isWeekend && off ? 'bg-ink/30' : '',
      ].join(' ')}
    >
      <div className="w-36 shrink-0">
        <div className="text-creamSoft/60 text-[10px] tracking-[0.18em] uppercase">
          {weekday}
        </div>
        <div className="text-creamSoft text-sm tracking-tight">{monthDay}</div>
      </div>

      <div className="w-24 shrink-0 text-right">
        {off ? (
          <span className="text-creamSoft/30 text-sm tracking-[0.1em] uppercase">
            Off
          </span>
        ) : (
          <span className="text-cream text-lg tabular-nums tracking-tight font-medium">
            {hhmm(Math.round(minutes))}
          </span>
        )}
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

      <div className="hidden sm:flex w-20 justify-end gap-2 text-[10px] text-creamSoft/30 tabular-nums">
        <span>6a</span>
        <span>10p</span>
      </div>
    </div>
  );
}

// Enumerate every YYYY-MM-DD between [startIso, endIso) anchored to AZ.
// Used to pad the daily breakdown so off-days render as zero rows.
function enumerateDays(startIso: string, endIso: string): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const days: string[] = [];
  // Walk in 24h steps, format in AZ each time. AZ is fixed UTC-7 (no DST).
  const cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Phoenix',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(cursor);
    const y = parts.find((p) => p.type === 'year')!.value;
    const m = parts.find((p) => p.type === 'month')!.value;
    const d = parts.find((p) => p.type === 'day')!.value;
    days.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Dedupe in case the period boundary lands oddly.
  return Array.from(new Set(days));
}

function CprCard({
  org,
  issuedAt,
  expiresAt,
  updatedAt,
}: {
  org: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
}) {
  const info = cprBucketFromExpiry(expiresAt);
  return (
    <div
      className={[
        'mt-6 rounded-3xl border p-5 flex items-center gap-4',
        info.bucket === 'expired'
          ? 'bg-rose-950/20 border-rose-300/30'
          : info.bucket === 'expiring_soon'
            ? 'bg-amber-950/20 border-amber-300/30'
            : info.bucket === 'missing'
              ? 'bg-graphite/40 border-creamSoft/15'
              : 'bg-graphite/40 border-creamSoft/10',
      ].join(' ')}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-creamSoft/10">
        <ShieldCheck size={20} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase">
          CPR certification
        </div>
        <div className="text-creamSoft text-lg tracking-tight mt-0.5">
          {info.bucket === 'missing'
            ? 'No cert on file'
            : info.label}
        </div>
        <div className="text-creamSoft/50 text-xs tracking-tight mt-1">
          {expiresAt ? (
            <>
              {org ?? 'Unknown org'} · issued {formatCprDate(issuedAt)} · expires{' '}
              {formatCprDate(expiresAt)}
            </>
          ) : (
            <>Add it from Staff → edit this employee.</>
          )}
          {updatedAt && expiresAt && (
            <span className="text-creamSoft/30">
              {' · last updated '}
              {formatCprDate(updatedAt)}
            </span>
          )}
        </div>
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

// Custom date range bar — appears under the period nav. When in custom mode
// the From/To inputs are pre-filled with the current range; "Clear" returns
// to pay-period-by-index navigation.
function DateRangeBar({
  isCustom,
  currentFrom,
  currentTo,
  onApply,
  onClear,
}: {
  isCustom: boolean;
  currentFrom: string;
  currentTo: string;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
}) {
  const [from, setFrom] = useState(currentFrom);
  const [to, setTo] = useState(currentTo);
  // Sync if props change (e.g. user navigated periods then opened picker again)
  useEffect(() => {
    setFrom(currentFrom);
    setTo(currentTo);
  }, [currentFrom, currentTo]);

  const dirty = from !== currentFrom || to !== currentTo;

  return (
    <div className="mt-6 flex items-end gap-3 flex-wrap">
      <label className="flex flex-col gap-1.5">
        <span className="text-creamSoft/40 text-[10px] tracking-[0.2em] uppercase">
          From
        </span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="bg-graphite border border-creamSoft/15 rounded-full px-4 py-2 text-sm text-creamSoft tabular-nums focus:outline-none focus:border-cream/40 transition-colors"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-creamSoft/40 text-[10px] tracking-[0.2em] uppercase">
          To
        </span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="bg-graphite border border-creamSoft/15 rounded-full px-4 py-2 text-sm text-creamSoft tabular-nums focus:outline-none focus:border-cream/40 transition-colors"
        />
      </label>
      <button
        onClick={() => onApply(from, to)}
        disabled={!dirty || !from || !to || from > to}
        className="h-10 rounded-full bg-cream text-ink px-4 text-sm tracking-tight disabled:opacity-40"
      >
        Apply range
      </button>
      {isCustom && (
        <button
          onClick={onClear}
          className="h-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-4 text-sm tracking-tight"
        >
          Back to pay period
        </button>
      )}
    </div>
  );
}
