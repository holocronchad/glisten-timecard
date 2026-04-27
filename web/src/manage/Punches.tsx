import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Flag, Pencil } from 'lucide-react';
import { api } from '../shared/api';
import { useAuth } from './auth';
import { formatTime } from '../shared/geo';
import EditPunchModal from './EditPunchModal';
import { ListSkeleton } from './Skeleton';

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

const TYPE_LABEL: Record<string, string> = {
  clock_in: 'Clock in',
  clock_out: 'Clock out',
  lunch_start: 'Lunch start',
  lunch_end: 'Lunch end',
};

export default function Punches() {
  const { token } = useAuth();
  const [rows, setRows] = useState<PunchRow[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PunchRow | null>(null);

  async function load() {
    setLoading(true);
    const r = await api<{ punches: PunchRow[] }>(
      `/manage/punches${flaggedOnly ? '?flagged=true' : ''}`,
      { token: token ?? undefined },
    );
    setRows(r.punches);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedOnly, token]);

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Punches</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">Last 500 records.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-creamSoft/60 cursor-pointer">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
            className="accent-cream"
          />
          Flagged only
        </label>
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
                  <td className="px-5 py-3 text-creamSoft/80">{TYPE_LABEL[p.type] ?? p.type}</td>
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
