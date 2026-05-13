import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { useToast } from '../shared/toast';

// Add Hours modal — owner/manager flow for backfilling missed punches.
//
// Four checkboxes (per Anas 2026-04-29 third pass — Dr. Dawood needed
// to backfill lunch breaks too):
//   - Clock-in
//   - Lunch start
//   - Lunch end
//   - Clock-out
//
// Manager can check any subset. Common combinations:
//   - Clock-out alone               -> employee forgot to punch out
//   - Lunch start + Lunch end       -> backfill a missed lunch break
//   - Full shift in/lunch start/lunch end/out -> never punched at all
//
// Validation: among checked items, timestamps must be in chronological
// order: clock_in < lunch_start < lunch_end < clock_out. Server side
// records each as a separate manager_edit punch; the state machine on
// the kiosk path doesn't apply here because manager edits bypass it.

type StaffRow = {
  id: number;
  name: string;
  active: boolean;
  is_owner: boolean;
  track_hours: boolean;
  role?: string;
  // From /manage/employees (added 2026-05-04). When defined, the modal can
  // default the rate-bucket picker to the employee's home office and show
  // a "WFH / remote" option only for dual-rate staff.
  home_location_id?: number | null;
  has_remote_rate?: boolean;
};
type Loc = { id: number; name: string; active: boolean };

// Sentinel for the rate-bucket picker meaning "WFH / remote" — i.e., the
// inserted punches will land with location_id = null and pay at the
// employee's WFH rate. Numeric values are real location ids.
const WFH_BUCKET = -1;

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
  const [includeLunchStart, setIncludeLunchStart] = useState(false);
  const [includeLunchEnd, setIncludeLunchEnd] = useState(false);
  const [includeOut, setIncludeOut] = useState(true);

  const initialNow = nowLocalAz();
  const [whenIn, setWhenIn] = useState(initialNow);
  const [whenLunchStart, setWhenLunchStart] = useState(initialNow);
  const [whenLunchEnd, setWhenLunchEnd] = useState(initialNow);
  const [whenOut, setWhenOut] = useState(initialNow);

  // Either a real location_id, WFH_BUCKET (= null on the wire), or null
  // (= "not yet picked"). Defaults to the selected employee's home office.
  const [locationId, setLocationId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // /manage/employees is the manager-safe minimal picker (no pay rate,
        // no email). Falls back to /manage/staff if the older endpoint is
        // missing on the server side. Filters out the test user (Chad).
        const r = await api<{ employees: StaffRow[] }>('/manage/employees', {
          token: token ?? undefined,
        }).catch(() =>
          api<{ employees: StaffRow[] }>('/manage/staff', {
            token: token ?? undefined,
          }).then((rr: any) => ({ employees: rr.staff as StaffRow[] })),
        );
        if (!cancelled) {
          const eligible = r.employees
            .filter((s) => s.active && s.track_hours && !s.is_owner && s.role !== 'tester')
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
          // Don't pick a default here — we wait for the employee selection
          // to default to THEIR home location (avoids defaulting Mesa staff
          // to Gilbert just because Gilbert sorts first).
        }
      } catch {
        /* locations endpoint optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Default the rate-bucket picker to the SELECTED employee's home office.
  // Without this, Mesa staff would silently inherit whatever location_id was
  // last picked (or the first location in the list), creating wrong-rate
  // and wrong-office bookkeeping. Reset to home_location_id on every userId
  // change. Manager can override (especially needed for the rare "WFH /
  // remote" case for dual-rate staff).
  useEffect(() => {
    if (userId == null || !staff) return;
    const employee = staff.find((s) => s.id === userId);
    if (!employee) return;
    if (typeof employee.home_location_id === 'number') {
      setLocationId(employee.home_location_id);
    } else {
      // No home set (e.g., owner / test user) — leave the picker on first
      // active location as a soft default.
      setLocationId(locations[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, staff, locations]);

  // Each row: (active?, type, datetime-string).
  function plannedPunches() {
    const list: Array<{ type: 'clock_in' | 'lunch_start' | 'lunch_end' | 'clock_out'; when: string }> = [];
    if (includeIn) list.push({ type: 'clock_in', when: whenIn });
    if (includeLunchStart) list.push({ type: 'lunch_start', when: whenLunchStart });
    if (includeLunchEnd) list.push({ type: 'lunch_end', when: whenLunchEnd });
    if (includeOut) list.push({ type: 'clock_out', when: whenOut });
    return list;
  }

  async function save() {
    if (userId == null) {
      setErr('Pick an employee.');
      return;
    }
    const planned = plannedPunches();
    if (planned.length === 0) {
      setErr('Pick at least one punch to add.');
      return;
    }
    // Chronological-order check among checked rows. The expected sequence is
    // clock_in < lunch_start < lunch_end < clock_out, which already matches
    // plannedPunches() order, so a strict-monotonic ms array works.
    const tsMs = planned.map((p) => new Date(`${p.when}:00-07:00`).getTime());
    for (let i = 1; i < tsMs.length; i++) {
      if (!(tsMs[i] > tsMs[i - 1])) {
        const ORDER_LABEL: Record<typeof planned[number]['type'], string> = {
          clock_in: 'Clock-in',
          lunch_start: 'Lunch start',
          lunch_end: 'Lunch end',
          clock_out: 'Clock-out',
        };
        setErr(`${ORDER_LABEL[planned[i].type]} must be after ${ORDER_LABEL[planned[i - 1].type]}.`);
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
      // Insert in chronological order. POST /manage/punches audit-logs
      // each insert separately; manager edits bypass the kiosk state
      // machine so order doesn't strictly matter, but we do it for any
      // future reader of history.
      // WFH_BUCKET sentinel maps to wire-level null (= remote / WFH rate).
      const wireLocationId = locationId === WFH_BUCKET ? null : locationId;
      for (const p of planned) {
        await api('/manage/punches', {
          method: 'POST',
          token: token ?? undefined,
          body: {
            user_id: userId,
            type: p.type,
            ts: localAzToIso(p.when),
            location_id: wireLocationId,
            reason: reason.trim(),
          },
        });
      }
      // Single-action toast wording when only one type is being added;
      // generic when multiple.
      const summary =
        planned.length === 1
          ? planned[0].type === 'clock_in'
            ? 'Clock-in added.'
            : planned[0].type === 'clock_out'
            ? 'Clock-out added.'
            : planned[0].type === 'lunch_start'
            ? 'Lunch start added.'
            : 'Lunch end added.'
          : planned.length === 2 &&
            planned[0].type === 'lunch_start' &&
            planned[1].type === 'lunch_end'
          ? 'Lunch break added.'
          : `${planned.length} punches added.`;
      toast(summary);
      // Broadcast so any list view (Today, Punches, EmployeeDetail) reloads
      // without forcing the manager to refresh the page.
      try {
        window.dispatchEvent(
          new CustomEvent('glisten:punches-updated', {
            detail: { userId },
          }),
        );
      } catch {
        /* dispatchEvent should always work in browsers; no-op on SSR */
      }
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Save failed';
      setErr(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  const checkedCount =
    Number(includeIn) + Number(includeLunchStart) + Number(includeLunchEnd) + Number(includeOut);
  const ctaLabel = (() => {
    if (checkedCount === 0) return 'Add hours';
    if (checkedCount === 1) {
      if (includeIn) return 'Add clock-in';
      if (includeLunchStart) return 'Add lunch start';
      if (includeLunchEnd) return 'Add lunch end';
      if (includeOut) return 'Add clock-out';
    }
    if (
      checkedCount === 2 &&
      includeLunchStart &&
      includeLunchEnd &&
      !includeIn &&
      !includeOut
    ) {
      return 'Add lunch break';
    }
    if (checkedCount === 2 && includeIn && includeOut) return 'Add full shift';
    if (checkedCount === 4) return 'Add full shift with lunch';
    return `Add ${checkedCount} punches`;
  })();

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
                ? 'bg-clockInDeep/15 border-clockIn/40'
                : 'bg-ink/30 border-creamSoft/5',
            ].join(' ')}
          >
            <label className="flex items-center gap-2 text-sm tracking-tight cursor-pointer">
              <input
                type="checkbox"
                checked={includeIn}
                onChange={(e) => setIncludeIn(e.target.checked)}
                className="accent-clockIn w-4 h-4"
              />
              <span className="text-xs tracking-[0.18em] uppercase font-medium text-clockIn">
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

          {/* Lunch start row */}
          <div
            className={[
              'rounded-2xl border p-4 transition-colors',
              includeLunchStart
                ? 'bg-lunchAccent/10 border-lunchAccent/40'
                : 'bg-ink/30 border-creamSoft/5',
            ].join(' ')}
          >
            <label className="flex items-center gap-2 text-sm tracking-tight cursor-pointer">
              <input
                type="checkbox"
                checked={includeLunchStart}
                onChange={(e) => setIncludeLunchStart(e.target.checked)}
                className="accent-lunchAccent w-4 h-4"
              />
              <span className="text-xs tracking-[0.18em] uppercase font-medium text-lunchAccent">
                Lunch start
              </span>
            </label>
            {includeLunchStart && (
              <input
                type="datetime-local"
                value={whenLunchStart}
                onChange={(e) => setWhenLunchStart(e.target.value)}
                className="mt-2 w-full bg-ink border border-creamSoft/10 rounded-xl px-3 py-2.5 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
              />
            )}
          </div>

          {/* Lunch end row */}
          <div
            className={[
              'rounded-2xl border p-4 transition-colors',
              includeLunchEnd
                ? 'bg-lunchAccent/10 border-lunchAccent/40'
                : 'bg-ink/30 border-creamSoft/5',
            ].join(' ')}
          >
            <label className="flex items-center gap-2 text-sm tracking-tight cursor-pointer">
              <input
                type="checkbox"
                checked={includeLunchEnd}
                onChange={(e) => setIncludeLunchEnd(e.target.checked)}
                className="accent-lunchAccent w-4 h-4"
              />
              <span className="text-xs tracking-[0.18em] uppercase font-medium text-lunchAccent">
                Lunch end
              </span>
            </label>
            {includeLunchEnd && (
              <input
                type="datetime-local"
                value={whenLunchEnd}
                onChange={(e) => setWhenLunchEnd(e.target.value)}
                className="mt-2 w-full bg-ink border border-creamSoft/10 rounded-xl px-3 py-2.5 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
              />
            )}
          </div>

          {/* Clock-out row */}
          <div
            className={[
              'rounded-2xl border p-4 transition-colors',
              includeOut
                ? 'bg-clockOutDeep/15 border-clockOut/40'
                : 'bg-ink/30 border-creamSoft/5',
            ].join(' ')}
          >
            <label className="flex items-center gap-2 text-sm tracking-tight cursor-pointer">
              <input
                type="checkbox"
                checked={includeOut}
                onChange={(e) => setIncludeOut(e.target.checked)}
                className="accent-clockOut w-4 h-4"
              />
              <span className="text-xs tracking-[0.18em] uppercase font-medium text-clockOut">
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

          {(locations.length > 1 ||
            (userId != null &&
              staff?.find((s) => s.id === userId)?.has_remote_rate)) && (
            <label className="flex flex-col gap-1.5">
              <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
                {staff?.find((s) => s.id === userId)?.has_remote_rate
                  ? 'Rate bucket'
                  : 'Office'}
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
                {staff?.find((s) => s.id === userId)?.has_remote_rate && (
                  <option value={WFH_BUCKET}>WFH / remote (WFH rate)</option>
                )}
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
                checkedCount === 0 ||
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
