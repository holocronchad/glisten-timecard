import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag } from 'lucide-react';
import PinPad from '../kiosk/PinPad';
import CloudBackground from '../kiosk/CloudBackground';
import { api, ApiError, NetworkError, PunchType } from '../shared/api';
import { formatTime, greetingForHour } from '../shared/geo';
import { buildSegments, totalsByDay, totalMinutes, splitMinutes, formatDateKey } from '../shared/hours';
import { punchTextClass } from '../shared/punchType';

type MeResponse = {
  user: { id: number; name: string };
  punches: Array<{
    id: number;
    location_id: number | null;
    location_name: string | null;
    type: PunchType;
    ts: string;
    flagged: boolean;
  }>;
};

const TYPE_LABEL: Record<PunchType, string> = {
  clock_in: 'In',
  clock_out: 'Out',
  lunch_start: 'Lunch start',
  lunch_end: 'Lunch end',
};

export default function Me() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [shake, setShake] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(pin: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<MeResponse>('/kiosk/me', {
        method: 'POST',
        body: { pin },
      });
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

  if (!data) return <PinScreen onPin={lookup} shake={shake} err={err} busy={busy} />;
  return <Hours data={data} onSignOut={() => setData(null)} />;
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
              Enter your PIN to see your last two weeks.
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
  onSignOut,
}: {
  data: MeResponse;
  onSignOut: () => void;
}) {
  const first = data.user.name.split(' ')[0];
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

        <div className="mt-8 grid grid-cols-2 gap-3">
          <Stat
            label="This week"
            value={hhmm(weekTotalsMinutes)}
            split={showSplit ? weekSplit : null}
          />
          <Stat
            label="Last 14 days"
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
  return segments
    .filter((s) => s.paid && s.start >= start)
    .reduce(
      (acc, s) => acc + Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000)),
      0,
    );
}
