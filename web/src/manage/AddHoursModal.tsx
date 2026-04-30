import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { useToast } from '../shared/toast';

// Add Hours modal — owner flow for backfilling missed punches.
//
// Three modes (per Anas 2026-04-29 second pass):
//   1. Clock-in only        — employee forgot to punch in
//   2. Clock-out only       — employee forgot to punch out
//   3. Full shift (in + out) — employee never punched at all
//
// Server endpoint POST /api/manage/punches takes a single punch; for the
// "full shift" mode we just post twice in sequence. Each insert audit-logs
// independently, which is fine — manager_edit source + the Reason text
// makes provenance clear.
//
// Lunch types intentionally absent — only clock_in / clock_out backfill.

type StaffRow = {
  id: number;
  name: string;
  active: boolean;
  is_owner: boolean;
  track_hours: boolean;
};
type Loc = { id: number; name: string; active: boolean };

type Props = { onClose: () => void; onSaved: () => void };

function nowLocalAz(): string {
  const az = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${az.getFullYear()}-${pad(az.getMonth() + 1)}-${pad(az.getDate())}T${pad(az.getHours())}:${pad(az.getMinutes())}`;
}

function localAzToIso(local: string): string {
  // datetime-local field is naive; treat it as Arizona time (UTC-7, no DST).
  return new Date(`${local}:00-07:00`).toISOString();
}

export default function AddHoursModal({ onClose, onSaved }: Props) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [userId, setUserId] = useState<number | null>(null);

  const [includeIn, setIncludeIn] = useState(true);
  const [includeOut, setIncludeOut] = useState(true);
  const [whenIn, setWhenIn] = useState(nowLocalAz());
  const [whenOut, setWhenOut] = useState(nowLocalAz());
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
        /* locations endpoint optional */
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
    if (!includeIn && !includeOut) {
      setErr('Pick at least a clock-in or a clock-out.');
      return;
    }
    if (includeIn && includeOut) {
      const inMs = new Date(`${whenIn}:00-07:00`).getTime();
      const outMs = new Date(`${whenOut}:00-07:00`).getTime();
      if (!(outMs > inMs)) {
        setErr('Clock-out time must be after clock-in time.');
        return;
      }
    }
    if (reason.trim().length < 3) {
      setErr('Add a short reason for the audit log.');
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      // Insert in chronological order so the state machine stays valid for
      // anyone who looks at history afterwards. POST /manage/punches is
      // idempotent enough for our purposes — each call audit-logs separately.
      if (includeIn) {
        await api('/manage/punches', {
          method: 'POST',
          token: token ?? undefined,
          body: {
            user_id: userId,
            type: 'clock_in',
            ts: localAzToIso(whenIn),
            location_id: locationId,
            reason: reason.trim(),
          },
        });
      }
      if (includeOut) {
        await api('/manage/punches', {
          method: 'POST',
          token: token ?? undefined,
          body: {
            user_id: userId,
            type: 'clock_out',
            ts: localAzToIso(whenOut),
            location_id: locationId,
            reason: reason.trim(),
          },
        });
      }
      const summary =
        includeIn && includeOut
          ? 'Full shift added.'
          : includeIn
          ? 'Clock-in added.'
          : 'Clock-out added.';
      toast(summary);
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Save failed';
      setErr(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  const ctaLabel =
    includeIn && includeOut
      ? 'Add full shift'
      : includeIn
      ? 'Add clock-in'
      : includeOut
      ? 'Add clock-out'
      : 'Add hours';

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
        className="w-full max-w-[480px] rounded-3xl bg-graphite border border-creamSoft/10 p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-2xl tracking-tight font-light">
              Add <span className="font-serif italic text-cream">hours</span>
            </h2>
            <p className="text-creamSoft/50 text-sm mt-1">
              Backfill a missed clock-in, clock-out, or both.
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

          {/* Clock-in row */}
          <div
            className={[
              'rounded-2xl border p-4 transition-colors',
              includeIn
                ? 'bg-ink/60 border-creamSoft/20'
                : 'bg-ink/30 border-creamSoft/5',
            ].join(' ')}
          >
            <label className="flex items-center gap-2 text-creamSoft/85 text-sm tracking-tight cursor-pointer">
              <input
                type="checkbox"
                checked={includeIn}
                onChange={(e) => setIncludeIn(e.target.checked)}
                className="accent-cream w-4 h-4"
              />
              <span className="text-xs tracking-[0.18em] uppercase text-creamSoft/60">
                Clock-in
              </span>
            </label>
            {includeIn && (
              <input
                type="datetime-local"
                value={whenIn}
                onChange={(e) => setWhenIn(e.target.value)}
                className="mt-2 w-full bg-ink border border-creamSoft/10 rounded-xl px-3 py-2.5 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
              />
            )}
          </div>

          {/* Clock-out row */}
          <div
            className={[
              'rounded-2xl border p-4 transition-colors',
              includeOut
                ? 'bg-ink/60 border-creamSoft/20'
                : 'bg-ink/30 border-creamSoft/5',
            ].join(' ')}
          >
            <label className="flex items-center gap-2 text-creamSoft/85 text-sm tracking-tight cursor-pointer">
              <input
                type="checkbox"
                checked={includeOut}
                onChange={(e) => setIncludeOut(e.target.checked)}
                className="accent-cream w-4 h-4"
              />
              <span className="text-xs tracking-[0.18em] uppercase text-creamSoft/60">
                Clock-out
              </span>
            </label>
            {includeOut && (
              <input
                type="datetime-local"
                value={whenOut}
                onChange={(e) => setWhenOut(e.target.value)}
                className="mt-2 w-full bg-ink border border-creamSoft/10 rounded-xl px-3 py-2.5 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
              />
            )}
          </div>

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
              placeholder="e.g., forgot to punch in this morning"
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
              disabled={
                busy ||
                userId == null ||
                (!includeIn && !includeOut) ||
                reason.trim().length < 3
              }
              className="flex-[2] rounded-2xl py-3 bg-cream text-ink hover:bg-cream/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm tracking-tight font-medium inline-flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              {busy ? 'Adding…' : ctaLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
