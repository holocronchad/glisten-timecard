import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus } from 'lucide-react';
import { api, ApiError, PunchType } from '../shared/api';
import { useAuth } from './auth';
import { useToast } from '../shared/toast';

// Add Hours modal — owner flow for inserting a missed punch on behalf of an
// employee (Dr. Dawood asked for this 2026-04-29 because the lunch button
// was being removed and she'd occasionally need to backfill). Mirrors
// EditPunchModal but with an employee picker and no delete/flag toggle.
//
// Lunch types intentionally excluded — kiosk lunch flow was removed
// 2026-04-29; managers entering lunch retroactively would re-introduce
// what we just took out.

type StaffRow = {
  id: number;
  name: string;
  active: boolean;
  is_owner: boolean;
  track_hours: boolean;
};
type Loc = { id: number; name: string; active: boolean };

type Props = { onClose: () => void; onSaved: () => void };

const TYPES: Array<{ value: PunchType; label: string; sub: string }> = [
  { value: 'clock_in',  label: 'Clock in',  sub: 'Started the day' },
  { value: 'clock_out', label: 'Clock out', sub: 'Ended the day' },
];

function nowLocalAz(): string {
  const az = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${az.getFullYear()}-${pad(az.getMonth() + 1)}-${pad(az.getDate())}T${pad(az.getHours())}:${pad(az.getMinutes())}`;
}

export default function AddHoursModal({ onClose, onSaved }: Props) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [type, setType] = useState<PunchType>('clock_in');
  const [when, setWhen] = useState(nowLocalAz());
  const [locationId, setLocationId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ staff: StaffRow[] }>('/manage/staff', {
          token: token ?? undefined,
        });
        if (!cancelled) {
          // Only employees who actually punch the clock — exclude owners,
          // exclude inactive accounts.
          const eligible = r.staff
            .filter((s) => s.active && s.track_hours && !s.is_owner)
            .sort((a, b) => a.name.localeCompare(b.name));
          setStaff(eligible);
        }
      } catch {
        if (!cancelled) setStaff([]);
      }
      try {
        const r = await api<{ locations: Loc[] }>('/manage/locations', {
          token: token ?? undefined,
        });
        if (!cancelled) {
          const active = r.locations.filter((l) => l.active);
          setLocations(active);
          if (active.length > 0) setLocationId(active[0].id);
        }
      } catch {
        /* locations are optional — server endpoint may not exist on older builds */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function save() {
    if (userId == null) {
      setErr('Pick an employee.');
      return;
    }
    if (reason.trim().length < 3) {
      setErr('Add a short reason for the audit log.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const ts = new Date(`${when}:00-07:00`).toISOString();
      await api('/manage/punches', {
        method: 'POST',
        token: token ?? undefined,
        body: {
          user_id: userId,
          type,
          ts,
          location_id: locationId,
          reason: reason.trim(),
        },
      });
      toast('Hours added.');
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
              Add <span className="font-serif italic text-cream">hours</span>
            </h2>
            <p className="text-creamSoft/50 text-sm mt-1">
              Insert a clock-in or clock-out on an employee's behalf.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-creamSoft/40 hover:text-creamSoft/80"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              Employee
            </span>
            <select
              value={userId ?? ''}
              onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
              className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
            >
              <option value="" disabled>
                {staff === null ? 'Loading…' : 'Pick an employee'}
              </option>
              {(staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

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
                    'rounded-2xl py-3 px-3 text-sm tracking-tight border text-left transition-colors',
                    type === t.value
                      ? 'bg-cream text-ink border-cream'
                      : 'bg-ink text-creamSoft/70 border-creamSoft/10 hover:border-creamSoft/30',
                  ].join(' ')}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className={['text-xs', type === t.value ? 'text-ink/60' : 'text-creamSoft/40'].join(' ')}>
                    {t.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              When (Arizona time)
            </span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
            />
          </label>

          {locations.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
                Office
              </span>
              <select
                value={locationId ?? ''}
                onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}
                className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              Reason
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., forgot to clock in this morning"
              className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft placeholder-creamSoft/30 focus:outline-none focus:border-cream/40 transition-colors"
            />
          </label>

          {err && (
            <div className="text-amber-300/90 text-sm bg-amber-950/30 border border-amber-300/20 rounded-2xl px-4 py-2.5">
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-2xl py-3 text-creamSoft/70 hover:bg-creamSoft/5 transition-colors text-sm tracking-tight"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || userId == null || reason.trim().length < 3}
              className="flex-[2] rounded-2xl py-3 bg-cream text-ink hover:bg-cream/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm tracking-tight font-medium inline-flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              {busy ? 'Adding…' : 'Add hours'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
