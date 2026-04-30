import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Flag, Pencil } from 'lucide-react';
import { api, PunchType } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';
import EditPunchModal from './EditPunchModal';
import { ListSkeleton } from './Skeleton';
import { PUNCH_LABEL, punchTextClass } from '../shared/punchType';

type PunchRow = {
  id: number;
  user_id: number;
  user_name: string;
  location_id: number | null;
  location_name: string | null;
  type: string;
  ts: string;
  source: string;
  flagged: boolean;
  flag_reason: string | null;
  geofence_pass: boolean | null;
  auto_closed_at: string | null;
};

export default function Punches() {
  const { token } = useAuth();
  const [rows, setRows] = useState<PunchRow[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PunchRow | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (flaggedOnly) params.set('flagged', 'true');
    if (from) params.set('from', new Date(`${from}T00:00:00-07:00`).toISOString());
    if (to) {
      const exclusive = new Date(`${to}T00:00:00-07:00`);
      exclusive.setDate(exclusive.getDate() + 1);
      params.set('to', exclusive.toISOString());
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const r = await api<{ punches: PunchRow[] }>(`/manage/punches${qs}`, {
      token: token ?? undefined,
    });
    setRows(r.punches);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedOnly, from, to, token]);

  // Refresh on Add Hours / Edit Punch saves so the manager sees their
  // change land without a manual page reload.
  useEffect(() => {
    function onPunchesUpdated() {
      load();
    }
    window.addEventListener('glisten:punches-updated', onPunchesUpdated);
    return () => window.removeEventListener('glisten:punches-updated', onPunchesUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedOnly, from, to, token]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Punches</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            Up to 500 records {from || to ? 'in range.' : '— filter to narrow.'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
          {(from || to) && (
            <button
              onClick={() => {
                setFrom('');
                setTo('');
              }}
              className="text-creamSoft/40 hover:text-creamSoft/80 text-xs tracking-tight pb-2.5"
            >
              Clear
            </button>
          )}
          <label className="flex items-center gap-2 text-sm text-creamSoft/60 cursor-pointer pb-2.5">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => setFlaggedOnly(e.target.checked)}
              className="accent-cream"
            />
            Flagged only
          </label>
        </div>
      </div>

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40">
        {loading ? (
          <ListSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">No punches.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-creamSoft/40 text-[11px] tracking-[0.18em] uppercase">
              <tr>
                <th className="text-left px-5 py-3">When</th>
                <th className="text-left px-5 py-3">Who</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Location</th>
                <th className="text-left px-5 py-3 hidden sm:table-cell">Source</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-creamSoft/5">
              {rows.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setEditing(p)}
                  className="hover:bg-creamSoft/5 cursor-pointer group"
                >
                  <td className="px-5 py-3 text-creamSoft tabular-nums whitespace-nowrap">
                    {dateLabel(p.ts)} · {formatTime(p.ts)}
                  </td>
                  <td className="px-5 py-3 text-creamSoft">{p.user_name}</td>
                  <td className={`px-5 py-3 font-medium ${punchTextClass(p.type as PunchType)}`}>
                    {PUNCH_LABEL[p.type as PunchType] ?? p.type}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/60 hidden md:table-cell">
                    {p.location_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-creamSoft/40 hidden sm:table-cell">
                    {p.source}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {p.flagged ? (
                      <span className="inline-flex items-center gap-1 text-amber-300/80 text-xs">
                        <Flag size={12} /> {p.flag_reason ?? 'flagged'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-creamSoft/30 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pencil size={12} /> Edit
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <EditPunchModal
            punch={editing}
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

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-creamSoft/50 text-[10px] tracking-[0.18em] uppercase">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-graphite border border-creamSoft/15 rounded-full px-3 py-1.5 text-sm text-creamSoft focus:outline-none focus:border-cream/40 transition-colors tabular-nums"
      />
    </label>
  );
}
