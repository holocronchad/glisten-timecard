import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { ListSkeleton } from './Skeleton';
import { useToast } from '../shared/toast';
import BlurredRate from './BlurredRate';
import { cprBucketFromExpiry, toDateInputValue } from '../shared/cprStatus';

type StaffRow = {
  id: number;
  name: string;
  email: string | null;
  role: string;
  employment_type: 'W2' | '1099';
  pay_rate_cents: number | null;
  // WFH rate — paid when employee punches with the WFH PIN that bypasses
  // geofence. Null when the employee has only one rate (most staff).
  pay_rate_cents_remote: number | null;
  is_owner: boolean;
  is_manager: boolean;
  track_hours: boolean;
  active: boolean;
  last_login_at: string | null;
  cpr_org: string | null;
  cpr_issued_at: string | null;
  cpr_expires_at: string | null;
  cpr_updated_at: string | null;
};

export default function Staff() {
  const { token, user } = useAuth();
  const isOwner = !!user?.is_owner;
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await api<{ staff: StaffRow[] }>('/manage/staff', {
      token: token ?? undefined,
    });
    setRows(r.staff);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Staff</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            {isOwner
              ? 'PIN, role, employment type.'
              : 'Tap a person to record their CPR certification.'}
          </p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-full bg-cream text-ink px-4 h-10 text-sm tracking-tight"
          >
            <Plus size={16} /> Add staff
          </button>
        )}
      </div>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40 divide-y divide-creamSoft/5">
        {loading ? (
          <ListSkeleton rows={5} />
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              onClick={() => setEditing(r)}
              className="flex items-center gap-4 p-5 transition-colors cursor-pointer hover:bg-creamSoft/5"
            >
              <div className="flex-1">
                <div
                  className={[
                    'text-base tracking-tight',
                    r.active ? 'text-creamSoft' : 'text-creamSoft/40 line-through',
                  ].join(' ')}
                >
                  {r.name}
                  {r.is_owner && (
                    <span className="font-serif italic text-cream/80 ml-2 text-sm">owner</span>
                  )}
                  {r.is_manager && !r.is_owner && (
                    <span className="text-creamSoft/50 ml-2 text-xs uppercase tracking-[0.18em]">
                      manager
                    </span>
                  )}
                </div>
                <div className="text-creamSoft/40 text-xs tracking-tight">
                  {r.role} · {r.employment_type}
                  {r.email && <> · {r.email}</>}
                </div>
                <CprPill expiresAt={r.cpr_expires_at} org={r.cpr_org} />
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                {isOwner &&
                  (r.pay_rate_cents !== null ? (
                  <span className="text-creamSoft text-sm tracking-tight inline-flex items-baseline gap-1">
                    <BlurredRate cents={r.pay_rate_cents} />
                    <span className="text-creamSoft/40 text-xs">/hr</span>
                    {r.pay_rate_cents_remote !== null && (
                      <span
                        className="ml-2 text-[10px] tracking-[0.12em] uppercase rounded-full px-2 py-0.5 bg-sky-300/10 text-sky-300 border border-sky-300/30 inline-flex items-baseline gap-1"
                        title={`WFH rate (paid when punching with WFH PIN)`}
                      >
                        WFH&nbsp;<BlurredRate cents={r.pay_rate_cents_remote} />/hr
                      </span>
                    )}
                  </span>
                ) : !r.is_owner && (
                  <span className="text-creamSoft/40 text-xs italic">salary / commission</span>
                ))}
                {r.active && r.track_hours && (
                  <span className="text-creamSoft/40 text-[10px] uppercase tracking-[0.18em]">
                    on the clock
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddStaffModal
            onClose={() => setShowAdd(false)}
            onCreated={() => {
              setShowAdd(false);
              load();
            }}
          />
        )}
        {editing && (
          <EditStaffModal
            staff={editing}
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

function AddStaffModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Front desk');
  const [pin, setPin] = useState('');
  const [employmentType, setEmploymentType] = useState<'W2' | '1099'>('W2');
  const [isManager, setIsManager] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api('/manage/staff', {
        method: 'POST',
        token: token ?? undefined,
        body: {
          name,
          email: email || undefined,
          role,
          employment_type: employmentType,
          pin,
          is_manager: isManager,
        },
      });
      toast(`${name} added.`);
      onCreated();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed';
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
          <h2 className="text-2xl tracking-tight font-light">
            Add <span className="font-serif italic text-cream">staff</span>
          </h2>
          <button
            onClick={onClose}
            className="text-creamSoft/40 hover:text-creamSoft/80"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Email (optional)" type="email" value={email} onChange={setEmail} />
          <Field label="Role" value={role} onChange={setRole} />
          <Field label="4-digit PIN" value={pin} onChange={setPin} maxLength={4} />
          <div className="grid grid-cols-2 gap-3">
            <Toggle
              label="W2"
              active={employmentType === 'W2'}
              onClick={() => setEmploymentType('W2')}
            />
            <Toggle
              label="1099"
              active={employmentType === '1099'}
              onClick={() => setEmploymentType('1099')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-creamSoft/70 mt-1">
            <input
              type="checkbox"
              checked={isManager}
              onChange={(e) => setIsManager(e.target.checked)}
              className="accent-cream"
            />
            Manager (can view dashboard)
          </label>
        </div>

        {err && <p className="text-amber-300/80 text-sm mt-3">{err}</p>}

        <button
          onClick={submit}
          disabled={busy || !name || !role || pin.length !== 4}
          className="mt-5 w-full rounded-full bg-cream text-ink py-3 tracking-tight disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add staff'}
        </button>
      </motion.div>
    </motion.div>
  );
}

function EditStaffModal({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token, user } = useAuth();
  const isOwner = !!user?.is_owner;
  const { toast } = useToast();
  const [name, setName] = useState(staff.name);
  const [email, setEmail] = useState(staff.email ?? '');
  const [role, setRole] = useState(staff.role);
  const [employmentType, setEmploymentType] = useState<'W2' | '1099'>(
    staff.employment_type,
  );
  const [pin, setPin] = useState('');
  const [isManager, setIsManager] = useState(staff.is_manager);
  const [active, setActive] = useState(staff.active);
  const [reason, setReason] = useState('');
  // CPR cert — three inputs treated as one atomic group on save.
  const [cprOrg, setCprOrg] = useState(staff.cpr_org ?? '');
  const [cprIssued, setCprIssued] = useState(toDateInputValue(staff.cpr_issued_at));
  const [cprExpires, setCprExpires] = useState(toDateInputValue(staff.cpr_expires_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { reason };
      if (name !== staff.name) body.name = name;
      if ((email || null) !== (staff.email || null)) body.email = email || null;
      if (role !== staff.role) body.role = role;
      if (employmentType !== staff.employment_type)
        body.employment_type = employmentType;
      if (isManager !== staff.is_manager) body.is_manager = isManager;
      if (active !== staff.active) body.active = active;
      if (pin) body.pin = pin;

      // CPR diff: only send if any of the three changed vs. server state.
      const cprChanged =
        (cprOrg || null) !== (staff.cpr_org || null) ||
        cprIssued !== toDateInputValue(staff.cpr_issued_at) ||
        cprExpires !== toDateInputValue(staff.cpr_expires_at);
      if (cprChanged) {
        const trimmedOrg = cprOrg.trim();
        const allEmpty = !trimmedOrg && !cprIssued && !cprExpires;
        const allFilled = !!trimmedOrg && !!cprIssued && !!cprExpires;
        if (!allEmpty && !allFilled) {
          setErr('CPR cert: fill all three fields (org, issued, expires) or clear all three.');
          setBusy(false);
          return;
        }
        if (allFilled && cprIssued >= cprExpires) {
          setErr('CPR cert: expiry must be after the issued date.');
          setBusy(false);
          return;
        }
        body.cpr_org = allEmpty ? null : trimmedOrg;
        body.cpr_issued_at = allEmpty ? null : cprIssued;
        body.cpr_expires_at = allEmpty ? null : cprExpires;
      }

      if (Object.keys(body).length === 1) {
        setErr('Nothing changed.');
        setBusy(false);
        return;
      }

      await api(`/manage/staff/${staff.id}`, {
        method: 'PATCH',
        token: token ?? undefined,
        body,
      });
      toast(`${name} updated.`);
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
        className="w-full max-w-[480px] rounded-3xl bg-graphite border border-creamSoft/10 p-6 max-h-[92dvh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-2xl tracking-tight font-light">
            Edit <span className="font-serif italic text-cream">{staff.name.split(' ')[0]}</span>
          </h2>
          <button
            onClick={onClose}
            className="text-creamSoft/40 hover:text-creamSoft/80"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {!isOwner && (
            <p className="text-creamSoft/40 text-xs tracking-tight -mt-1 mb-1">
              You can record this person's CPR certification below. Pay, role,
              and access are owner-only.
            </p>
          )}
          {isOwner && (
            <>
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Email" type="email" value={email} onChange={setEmail} />
              <Field label="Role" value={role} onChange={setRole} />
              <Field
                label="New PIN (leave blank to keep current)"
                value={pin}
                onChange={setPin}
                maxLength={4}
              />
              <div className="grid grid-cols-2 gap-3">
                <Toggle
                  label="W2"
                  active={employmentType === 'W2'}
                  onClick={() => setEmploymentType('W2')}
                />
                <Toggle
                  label="1099"
                  active={employmentType === '1099'}
                  onClick={() => setEmploymentType('1099')}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-creamSoft/70">
                <input
                  type="checkbox"
                  checked={isManager}
                  onChange={(e) => setIsManager(e.target.checked)}
                  className="accent-cream"
                />
                Manager (can view dashboard)
              </label>
              <label className="flex items-center gap-2 text-sm text-creamSoft/70">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="accent-cream"
                />
                Active
              </label>
            </>
          )}

          {/* CPR cert — manager-side entry. All three fields atomic; leave all
              blank to clear. Mirrors the kiosk's CprPanel invariant so a
              partially-filled record can never land in the audit log. */}
          <div className="mt-2 rounded-2xl border border-creamSoft/10 bg-ink/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={14} className="text-creamSoft/60" />
              <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
                CPR certification
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <Field
                label="Issuing organization"
                value={cprOrg}
                onChange={setCprOrg}
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
                    Issued
                  </span>
                  <input
                    type="date"
                    value={cprIssued}
                    onChange={(e) => setCprIssued(e.target.value)}
                    className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
                    Expires
                  </span>
                  <input
                    type="date"
                    value={cprExpires}
                    onChange={(e) => setCprExpires(e.target.value)}
                    className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
                  />
                </label>
              </div>
              <p className="text-creamSoft/40 text-[11px] tracking-tight">
                Leave all three blank to clear an existing cert from the record.
              </p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5 mt-1">
            <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">
              Reason for change
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="PIN reset after she forgot it"
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
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </motion.div>
    </motion.div>
  );
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  maxLength,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft focus:outline-none focus:border-cream/40 transition-colors"
      />
    </label>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-2xl py-3 text-sm tracking-tight border transition-colors',
        active
          ? 'bg-cream text-ink border-cream'
          : 'bg-ink text-creamSoft/70 border-creamSoft/10 hover:border-creamSoft/30',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function CprPill({
  expiresAt,
  org,
}: {
  expiresAt: string | null;
  org: string | null;
}) {
  const info = cprBucketFromExpiry(expiresAt);
  const detail = org && info.bucket !== 'missing' ? ` · ${org}` : '';
  return (
    <span
      className={[
        'mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-[10px] tracking-[0.12em] uppercase',
        info.pillClass,
      ].join(' ')}
      title={
        expiresAt
          ? `CPR expires ${new Date(expiresAt).toLocaleDateString('en-US', { timeZone: 'UTC' })}${detail}`
          : 'No CPR cert on file'
      }
    >
      <ShieldCheck size={10} />
      {info.label}
      {detail}
    </span>
  );
}
