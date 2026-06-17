import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, ChevronLeft, ChevronRight } from 'lucide-react';
import PinPad from '../kiosk/PinPad';
import CloudBackground from '../kiosk/CloudBackground';
import { api, ApiError, NetworkError, PunchType } from '../shared/api';
import { formatTime, greetingForHour } from '../shared/geo';
import {
  buildSegments,
  totalsByDay,
  totalMinutes,
  splitMinutes,
  formatDateKey,
} from '../shared/hours';
import { punchTextClass } from '../shared/punchType';

type MeResponse = {
  user: { id: number; name: string };
  // null when the employee has no scheduled home office → rolling 14-day
  // window, no pager. Otherwise the selected pay period; drives the pager.
  period: {
    index: number;
    start: string;
    end: string;
    label: string;
    is_current: boolean;
  } | null;
  punches: Array<{
    id: number;
    location_id: number | null;
    location_name: string | null;
    type: PunchType;
    ts: string;
    flagged: boolean;
    // Per Dr. Dawood: lunch-review fields are deliberately NOT exposed to
    // employees on /me. Server doesn't send them; UI doesn't render them;
    // hours show raw (un-deducted) totals here so the employee can't infer
    // a rejection by comparing /me to their paystub.
  }>;
};

const TYPE_LABEL: Record<PunchType, string> = {
  clock_in: 'In',
  clock_out: 'Out',
  lunch_start: 'Lunch start',
  lunch_end: 'Lunch end',
};

export default function Me() {
  // PIN is held in memory for the session so we can re-query when the employee
  // pages to a different pay period. Cleared on sign-out; never persisted.
  const [pin, setPin] = useState<string | null>(null);
  const [data, setData] = useState<MeResponse | null>(null);
  const [shake, setShake] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);

  function fetchHours(pinVal: string, periodIndex?: number) {
    return api<MeResponse>('/kiosk/me', {
      method: 'POST',
      body:
        periodIndex === undefined
          ? { pin: pinVal }
          : { pin: pinVal, period_index: periodIndex },
    });
  }

  async function lookup(pinVal: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchHours(pinVal);
      setPin(pinVal);
      setData(r);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 429
            ? 'Too many attempts — try again in a few minutes.'
            : 'PIN not recognized.'
          : e instanceof NetworkError
            ? e.message
            : 'Connection failed — try again in a moment.';
      setErr(msg);
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  }

  async function gotoPeriod(periodIndex: number) {
    if (!pin || paging) return;
    setPaging(true);
    try {
      const r = await fetchHours(pin, periodIndex);
      setData(r);
    } catch {
      // Non-fatal: keep the current period visible if a page fetch fails.
    } finally {
      setPaging(false);
    }
  }

  function signOut() {
    setPin(null);
    setData(null);
  }

  if (!data) return <PinScreen onPin={lookup} shake={shake} err={err} busy={busy} />;
  return (
    <Hours
      data={data}
      paging={paging}
      onSignOut={signOut}
      onPrev={() => data.period && gotoPeriod(data.period.index - 1)}
      onNext={() => data.period && gotoPeriod(data.period.index + 1)}
    />
  );
}

function PinScreen({
  onPin,
  shake,
  err,
  busy,
}: {
  onPin: (pin: string) => void;
  shake: number;
  err: string | null;
  busy: boolean;
}) {
  return (
    <div className="relative min-h-[100dvh] flex flex-col isolate">
      <CloudBackground />
      <div className="relative z-10 flex flex-col flex-1">
      <header className="px-6 pt-6 flex justify-between items-baseline">
        <span className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
          My hours
        </span>
        <a
          href="/"
          className="text-creamSoft/40 hover:text-creamSoft/70 text-xs tracking-[0.18em] uppercase transition-colors"
        >
          Kiosk →
        </a>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-10">
        <div className="frosted-pane w-full max-w-[480px] flex flex-col items-center gap-6 sm:gap-8 p-6 sm:p-8 rounded-[2rem]">
          <div className="text-center">
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
              className="text-[40px] sm:text-[52px] leading-[1.05] tracking-tight font-light"
            >
              Your <span className="font-serif italic text-cream">hours</span>
            </motion.h1>
            <p className="mt-3 text-creamSoft/50 text-base">
              Enter your PIN to see your hours by pay period.
            </p>
          </div>

          <PinPad
            onSubmit={onPin}
            shake={shake > 0 ? shake : undefined}
            disabled={busy}
          />

          {err && (
            <p className="text-amber-300/80 text-sm text-center">{err}</p>
          )}
        </div>
      </main>
      </div>
    </div>
  );
}

function Hours({
  data,
  paging,
  onSignOut,
  onPrev,
  onNext,
}: {
  data: MeResponse;
  paging: boolean;
  onSignOut: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const first = data.user.name.split(' ')[0];
  // No period (employee without a scheduled home office) → legacy rolling
  // 14-day view, "This week" still applies. A past pay period has no
  // meaningful "this week", so that card is hidden when paged back.
  const isCurrent = data.period?.is_current ?? true;
  // /me intentionally never receives the lunch_review_deduction_seconds
  // column from the server, so every segment is deduction=0 and totals
  // here render as RAW worked time. Employees do not see deductions.
  const segments = buildSegments(data.punches);
  const dailyTotals = totalsByDay(segments);
  const weekTotalsMinutes = totalMinutesThisWeek(segments);
  const periodTotalMinutes = totalMinutes(segments);
  // Dual-PIN employees (Filza office+WFH) see an Office / WFH split under
  // each total. Single-PIN employees never see it (the breakdown collapses
  // to one bucket = same number twice, which would be noisy).
  const weekSplit = splitMinutes(
    segments.filter((s) => {
      const start = sundayOfThisAzWeekUtc();
      return s.start >= start;
    }),
  );
  const periodSplit = splitMinutes(segments);
  const showSplit = periodSplit.office > 0 && periodSplit.wfh > 0;

  return (
    <div className="relative min-h-[100dvh] flex flex-col isolate">
      <CloudBackground />
      <div className="relative z-10 flex flex-col flex-1">
      <header className="px-6 pt-6 flex justify-between items-baseline">
        <span className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
          My hours
        </span>
        <button
          onClick={onSignOut}
          className="text-creamSoft/40 hover:text-creamSoft/80 text-xs tracking-[0.18em] uppercase transition-colors"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 px-6 pb-10 pt-6 max-w-[640px] mx-auto w-full">
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-light"
        >
          {greetingForHour()},{' '}
          <span className="font-serif italic text-cream">{first}</span>
        </motion.h1>

        {data.period && (
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={onPrev}
              disabled={paging}
              aria-label="Previous pay period"
              className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center disabled:opacity-40 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1 text-center">
              <div className="text-creamSoft/40 text-[10px] tracking-[0.2em] uppercase">
                Pay period
              </div>
              <div className={`text-cream text-sm tabular-nums tracking-tight transition-opacity ${paging ? 'opacity-40' : ''}`}>
                {data.period.label}
              </div>
            </div>
            <button
              onClick={onNext}
              disabled={paging || data.period.is_current}
              aria-label="Next pay period"
              className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center disabled:opacity-40 transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}

        <div className={`${data.period ? 'mt-4' : 'mt-8'} grid gap-3 ${isCurrent ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {isCurrent && (
            <Stat
              label="This week"
              value={hhmm(weekTotalsMinutes)}
              split={showSplit ? weekSplit : null}
            />
          )}
          <Stat
            label={data.period ? (isCurrent ? 'This period' : 'Period total') : 'Last 14 days'}
            value={hhmm(periodTotalMinutes)}
            split={showSplit ? periodSplit : null}
          />
        </div>

        <h2 className="text-creamSoft/60 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
          By day
        </h2>
        <div className="frosted-pane rounded-3xl divide-y divide-creamSoft/10 overflow-hidden">
          {dailyTotals.length === 0 ? (
            <div className="p-6 text-creamSoft/50 text-sm">No hours yet.</div>
          ) : (
            <AnimatePresence>
              {[...dailyTotals].reverse().map((d, i) => (
                <motion.div
                  key={d.date}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.4) }}
                  className="flex items-center justify-between p-4"
                >
                  <span className="text-creamSoft text-base">{prettyDate(d.date)}</span>
                  <span className="text-cream tabular-nums tracking-tight text-base font-medium">
                    {hhmm(d.worked_minutes)}
                    {d.open && <span className="text-amber-300 ml-2 text-xs">(open)</span>}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        <h2 className="text-creamSoft/60 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
          Recent punches
        </h2>
        <div className="frosted-pane rounded-3xl divide-y divide-creamSoft/10 overflow-hidden">
          {data.punches.length === 0 ? (
            <div className="p-6 text-creamSoft/50 text-sm">No punches yet.</div>
          ) : (
            data.punches.slice(0, 30).map((p) => (
              <div key={p.id} className="flex items-center gap-4 p-4">
                <div className="flex-1">
                  <div className={`text-base font-medium ${punchTextClass(p.type)}`}>{TYPE_LABEL[p.type]}</div>
                  <div className="text-creamSoft/55 text-xs mt-0.5">
                    {p.location_name ?? 'No location'}
                  </div>
                </div>
                <div className="text-cream text-sm tabular-nums tracking-tight whitespace-nowrap">
                  {prettyDate(formatDateKey(new Date(p.ts), 'America/Phoenix'))} · {formatTime(p.ts)}
                </div>
                {p.flagged && (
                  <Flag size={14} className="text-amber-300" />
                )}
              </div>
            ))
          )}
        </div>

        <p className="text-creamSoft/30 text-xs mt-8 text-center">
          Hours are unofficial — your manager confirms the final timesheet each pay period.
        </p>
      </main>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  split,
}: {
  label: string;
  value: string;
  split?: { office: number; wfh: number } | null;
}) {
  return (
    <div className="frosted-pane rounded-3xl p-5">
      <div className="text-creamSoft/60 text-xs tracking-[0.18em] uppercase">{label}</div>
      <div className="text-cream text-3xl tracking-tight font-light mt-1 tabular-nums">
        {value}
      </div>
      {split && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] tabular-nums">
          <span className="rounded-full bg-creamSoft/10 px-2 py-0.5 text-creamSoft/80">
            Office <span className="text-cream">{hhmm(split.office)}</span>
          </span>
          <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-300/85">
            WFH <span className="text-sky-200">{hhmm(split.wfh)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// AZ is fixed UTC-7 (no DST). Sunday 00:00 AZ = Sunday 07:00 UTC.
function sundayOfThisAzWeekUtc(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date());
  const y = +parts.find((p) => p.type === 'year')!.value;
  const m = +parts.find((p) => p.type === 'month')!.value;
  const d = +parts.find((p) => p.type === 'day')!.value;
  const wkdy = parts.find((p) => p.type === 'weekday')!.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wkdy);
  return new Date(Date.UTC(y, m - 1, d - dow, 7, 0, 0));
}

function hhmm(minutes: number): string {
  if (!minutes) return '0h 00m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function prettyDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
}

function totalMinutesThisWeek(
  segments: ReturnType<typeof buildSegments>,
): number {
  const start = sundayOfThisAzWeekUtc();
  // Inlined paidMinutesOf — same math as shared/hours.ts. Honors the
  // lunch-review deduction (migration 015) so this week's number matches
  // the period number and the by-day list.
  return segments
    .filter((s) => s.paid && s.start >= start)
    .reduce((acc, s) => {
      const raw = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
      return acc + Math.max(0, raw - s.lunch_review_deduction_minutes);
    }, 0);
}
