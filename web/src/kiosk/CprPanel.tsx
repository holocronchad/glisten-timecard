import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, CprState } from '../shared/api';

type Props = {
  pin: string;
  cpr: CprState;
  onUpdated: (next: CprState) => void;
};

export default function CprPanel({ pin, cpr, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);

  const status = cprStatus(cpr);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={[
          'w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left',
          'transition-colors hover:border-creamSoft/30',
          status.tone,
        ].join(' ')}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-creamSoft/10">
          <ShieldCheck size={18} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-creamSoft text-sm tracking-tight">{status.label}</span>
          <span className="block text-creamSoft/50 text-xs tracking-tight truncate">
            {status.detail}
          </span>
        </span>
        <span className="text-creamSoft/40 text-[11px] uppercase tracking-[0.18em]">
          {cpr.expires_at ? 'Update' : 'Add'}
        </span>
      </button>

      <AnimatePresence>
        {editing && (
          <CprEditModal
            pin={pin}
            current={cpr}
            onClose={() => setEditing(false)}
            onSaved={(next) => {
              setEditing(false);
              onUpdated(next);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

type StatusInfo = { label: string; detail: string; tone: string };

function cprStatus(cpr: CprState): StatusInfo {
  if (!cpr.expires_at) {
    return {
      label: 'CPR cert — not on file',
      detail: 'Tap Add to record your current cert',
      tone: 'bg-creamSoft/5 border-creamSoft/15',
    };
  }
  const days = cpr.days_until_expiry ?? Infinity;
  const expiryStr = formatDate(cpr.expires_at);
  if (days < 0) {
    return {
      label: `CPR expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`,
      detail: `Cert from ${cpr.org ?? 'unknown org'} expired ${expiryStr}`,
      tone: 'bg-rose-950/30 border-rose-300/30',
    };
  }
  if (days <= 30) {
    return {
      label: `CPR expires in ${days} day${days === 1 ? '' : 's'}`,
      detail: `${cpr.org ?? 'CPR cert'} · expires ${expiryStr}`,
      tone: 'bg-amber-950/30 border-amber-300/30',
    };
  }
  if (days <= 60) {
    return {
      label: `CPR cert good for ${days} more days`,
      detail: `${cpr.org ?? 'CPR cert'} · expires ${expiryStr}`,
      tone: 'bg-amber-950/15 border-amber-300/15',
    };
  }
  return {
    label: 'CPR cert current',
    detail: `${cpr.org ?? 'CPR cert'} · expires ${expiryStr}`,
    tone: 'bg-emerald-950/20 border-emerald-300/20',
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ── Edit modal ──────────────────────────────────────────────────────────────

function CprEditModal({
  pin,
  current,
  onClose,
  onSaved,
}: {
  pin: string;
  current: CprState;
  onClose: () => void;
  onSaved: (next: CprState) => void;
}) {
  const [org, setOrg] = useState(current.org ?? '');
  const [issued, setIssued] = useState(toDateInput(current.issued_at));
  const [expires, setExpires] = useState(toDateInput(current.expires_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!org.trim() || !issued || !expires) {
      setErr('Fill all three fields.');
      return;
    }
    if (issued >= expires) {
      setErr('Expiry must be after the issued date.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ cpr: CprState }>('/kiosk/cpr', {
        method: 'POST',
        body: { pin, org: org.trim(), issued_at: issued, expires_at: expires },
      });
      onSaved(r.cpr);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-30 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(10, 10, 10, 0.7)' }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="frosted-pane w-full max-w-[440px] p-7 sm:p-8 rounded-[1.75rem] sm:rounded-[2rem]"
      >
        <div className="text-center">
          <h2 className="text-[24px] sm:text-[30px] leading-[1.1] tracking-tight font-light">
            CPR <span className="font-serif italic text-cream">certification</span>
          </h2>
          <p className="mt-2 text-creamSoft/55 text-sm">
            Keep your cert info current — we'll remind you when it's about to expire.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-creamSoft/50 text-[11px] tracking-[0.18em] uppercase">
              Issuing organization
            </span>
            <input
              type="text"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="American Heart Association"
              autoFocus
              className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-base focus:outline-none focus:border-cream/40 transition-colors"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-creamSoft/50 text-[11px] tracking-[0.18em] uppercase">
                Issued
              </span>
              <input
                type="date"
                value={issued}
                onChange={(e) => setIssued(e.target.value)}
                className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-base focus:outline-none focus:border-cream/40 transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-creamSoft/50 text-[11px] tracking-[0.18em] uppercase">
                Expires
              </span>
              <input
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="w-full bg-ink/40 border border-creamSoft/15 rounded-2xl px-4 py-3 text-creamSoft text-base focus:outline-none focus:border-cream/40 transition-colors"
              />
            </label>
          </div>

          {err && (
            <p className="text-amber-300/90 text-sm text-center mt-1">{err}</p>
          )}

          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full px-4 py-3 text-creamSoft/60 hover:text-creamSoft text-sm tracking-tight border border-creamSoft/15 hover:border-creamSoft/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !org.trim() || !issued || !expires}
              className="flex-1 rounded-full px-4 py-3 bg-cream text-ink text-sm tracking-tight font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
