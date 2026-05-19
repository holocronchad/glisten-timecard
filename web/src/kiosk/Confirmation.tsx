import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, ShieldAlert } from 'lucide-react';
import { PunchType, CprState } from '../shared/api';
import { formatTime } from '../shared/geo';
import { playPunchSuccess, vibrateSuccess } from '../shared/feedback';
import { punchTextClass } from '../shared/punchType';
import { cprClockInAlert } from '../shared/cprAlert';

const VERB: Record<PunchType, string> = {
  clock_in: 'Clocked in',
  clock_out: 'Clocked out',
  lunch_start: 'Lunch started',
  lunch_end: 'Lunch ended',
};

const VERB_ICON_BG: Record<PunchType, string> = {
  clock_in: 'bg-clockIn',
  clock_out: 'bg-clockOut',
  lunch_start: 'bg-lunchAccent',
  lunch_end: 'bg-lunchAccent',
};

type Props = {
  type: PunchType;
  ts: string;
  name: string;
  greeting: string;
  cpr?: CprState | null;
};

function cprDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function Confirmation({ type, ts, name, greeting, cpr }: Props) {
  const first = name.split(' ')[0];
  const alert = cprClockInAlert(cpr, type);

  useEffect(() => {
    playPunchSuccess();
    vibrateSuccess();
  }, []);

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1.36, 0.36, 1] }}
        className={`flex h-24 w-24 items-center justify-center rounded-full text-ink ${VERB_ICON_BG[type]}`}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.35, delay: 0.25 }}
        >
          <Check size={42} strokeWidth={2.5} />
        </motion.div>
      </motion.div>

      <div>
        <motion.h2
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="text-[40px] sm:text-[48px] leading-[1.05] tracking-tight font-light"
        >
          <span className={punchTextClass(type)}>{VERB[type]}</span>
          <span className="text-creamSoft"> at </span>
          <span className="font-serif italic text-cream">{formatTime(ts)}</span>
        </motion.h2>
        <motion.p
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-3 text-creamSoft/60"
        >
          {greeting.replace('{name}', first)}
        </motion.p>
      </div>

      {alert && (
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className={[
            'flex items-start gap-3 text-left rounded-2xl border px-4 py-3 max-w-[440px]',
            alert.bucket === 'expired'
              ? 'bg-rose-950/40 border-rose-300/30'
              : 'bg-amber-950/40 border-amber-300/30',
          ].join(' ')}
        >
          <span
            className={[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              alert.bucket === 'expired'
                ? 'bg-rose-300/15 text-rose-200'
                : 'bg-amber-300/15 text-amber-200',
            ].join(' ')}
          >
            <ShieldAlert size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <span
              className={[
                'block text-sm tracking-tight',
                alert.bucket === 'expired' ? 'text-rose-100' : 'text-amber-100',
              ].join(' ')}
            >
              {alert.bucket === 'expired'
                ? `Your CPR card expired ${Math.abs(alert.daysUntil)} day${
                    Math.abs(alert.daysUntil) === 1 ? '' : 's'
                  } ago`
                : alert.daysUntil === 0
                  ? 'Your CPR card expires today'
                  : `Your CPR card expires in ${alert.daysUntil} day${
                      alert.daysUntil === 1 ? '' : 's'
                    }`}
            </span>
            <span className="block text-creamSoft/60 text-xs tracking-tight mt-0.5">
              {cpr?.expires_at
                ? `${alert.bucket === 'expired' ? 'Expired' : 'Expires'} ${cprDate(
                    cpr.expires_at,
                  )}. `
                : ''}
              Renew it, then tap the CPR panel after your PIN to update — or see a manager.
            </span>
          </span>
        </motion.div>
      )}
    </div>
  );
}
