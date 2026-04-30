import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { api, ApiError, PunchType } from '../shared/api';
import { punchTextClass } from '../shared/punchType';

type Props = {
  pin: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const TYPES: Array<{ value: PunchType; label: string }> = [
  { value: 'clock_in', label: 'Clock in' },
  { value: 'clock_out', label: 'Clock out' },
  { value: 'lunch_start', label: 'Lunch start' },
  { value: 'lunch_end', label: 'Lunch end' },
];

function nowLocalInputValue(): string {
  const d = new Date();
  const az = new Date(d.toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${az.getFullYear()}-${pad(az.getMonth() + 1)}-${pad(az.getDate())}T${pad(az.getHours())}:${pad(az.getMinutes())}`;
}

export default function MissedPunchModal({ pin, onClose, onSubmitted }: Props) {
  const [type, setType] = useState<PunchType>('clock_in');
  const [when, setWhen] = useState<string>(nowLocalInputValue());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      // Convert AZ-local datetime-local string to ISO with AZ offset (-07:00 year-round, no DST)
      const proposed = new Date(`${when}:00-07:00`).toISOString();
      await api('/kiosk/missed-punch', {
        method: 'POST',
        body: { pin, type, proposed_ts: proposed, reason },
      });
      onSubmitted();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not submit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-3xl bg-graphite border border-creamSoft/10 p-6"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-2xl tracking-tight font-light">
              Forgot to <span className="font-serif italic text-cream">punch?</span>
            </h2>
            <p className="text-creamSoft/50 text-sm mt-1">
              A manager will review your request.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-creamSoft/40 hover:text-creamSoft/80"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              What did you forget?
            </span>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {TYPES.map((t) => {
                const selected = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={[
                      'rounded-2xl py-3 text-sm tracking-tight font-medium border transition-colors',
                      selected
                        ? 'bg-cream text-ink border-cream'
                        : `bg-ink ${punchTextClass(t.value)} border-creamSoft/10 hover:border-creamSoft/30`,
                    ].join(' ')}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              When
            </span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              What happened?
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Forgot to clock in this morning before my first patient."
              className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft placeholder:text-creamSoft/30 focus:outline-none focus:border-cream/40 transition-colors resize-none"
            />
          </label>
        </div>

        {err && <p className="text-amber-300/80 text-sm mt-3">{err}</p>}

        <button
          onClick={submit}
          disabled={busy || reason.trim().length < 3 || !when}
          className="mt-5 w-full rounded-full bg-cream text-ink py-3 tracking-tight disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </motion.div>
    </motion.div>
  );
}
