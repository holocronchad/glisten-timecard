import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { api, ApiError, PunchType } from '../shared/api';
import { useAuth } from './auth';
import { useToast } from '../shared/toast';

type Props = {
  punch: {
    id: number;
    user_name: string;
    type: string;
    ts: string;
    flagged: boolean;
  };
  onClose: () => void;
  onSaved: () => void;
};

const TYPES: Array<{ value: PunchType; label: string }> = [
  { value: 'clock_in', label: 'Clock in' },
  { value: 'clock_out', label: 'Clock out' },
  { value: 'lunch_start', label: 'Lunch start' },
  { value: 'lunch_end', label: 'Lunch end' },
];

function isoToLocalAz(iso: string): string {
  const az = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${az.getFullYear()}-${pad(az.getMonth() + 1)}-${pad(az.getDate())}T${pad(az.getHours())}:${pad(az.getMinutes())}`;
}

export default function EditPunchModal({ punch, onClose, onSaved }: Props) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [type, setType] = useState<PunchType>(punch.type as PunchType);
  const [when, setWhen] = useState(isoToLocalAz(punch.ts));
  const [flagged, setFlagged] = useState(punch.flagged);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const ts = new Date(`${when}:00-07:00`).toISOString();
      await api(`/manage/punches/${punch.id}`, {
        method: 'PATCH',
        token: token ?? undefined,
        body: { ts, type, flagged, reason },
      });
      toast('Punch updated.');
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Save failed';
      setErr(msg);
      toast(msg, 'error');
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
        className="w-full max-w-[480px] rounded-3xl bg-graphite border border-creamSoft/10 p-6"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-2xl tracking-tight font-light">
              Edit <span className="font-serif italic text-cream">punch</span>
            </h2>
            <p className="text-creamSoft/50 text-sm mt-1">{punch.user_name}</p>
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
              Type
            </span>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={[
                    'rounded-2xl py-3 text-sm tracking-tight border transition-colors',
                    type === t.value
                      ? 'bg-cream text-ink border-cream'
                      : 'bg-ink text-creamSoft/70 border-creamSoft/10 hover:border-creamSoft/30',
                  ].join(' ')}
                >
                  {t.label}
                </button>
              ))}
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

          <label className="flex items-center gap-2 text-sm text-creamSoft/70">
            <input
              type="checkbox"
              checked={flagged}
              onChange={(e) => setFlagged(e.target.checked)}
              className="accent-cream"
            />
            Keep flagged for review
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              Reason for edit
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Annie texted to say the kiosk was unreachable; correcting time."
              className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft placeholder:text-creamSoft/30 focus:outline-none focus:border-cream/40 transition-colors resize-none"
            />
          </label>
        </div>

        {err && <p className="text-amber-300/80 text-sm mt-3">{err}</p>}

        <button
          onClick={save}
          disabled={busy || reason.trim().length < 3}
          className="mt-5 w-full rounded-full bg-cream text-ink py-3 tracking-tight disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save change'}
        </button>
      </motion.div>
    </motion.div>
  );
}
