import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MapPin, Clock } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { GridSkeleton } from './Skeleton';
import { useToast } from '../shared/toast';

type Location = {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  geofence_m: number;
  active: boolean;
};

export default function Locations() {
  const { token } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<Location[] | null>(null);
  const [autoCloseBusy, setAutoCloseBusy] = useState(false);

  async function load() {
    const r = await api<{ locations: Location[] }>('/manage/locations', {
      token: token ?? undefined,
    });
    setRows(r.locations);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function runAutoClose() {
    if (
      !window.confirm(
        'Auto-close every open shift right now? Each closed punch is flagged for your review.',
      )
    ) {
      return;
    }
    setAutoCloseBusy(true);
    try {
      const r = await api<{ closed: number }>('/manage/auto-close', {
        method: 'POST',
        token: token ?? undefined,
      });
      toast(
        r.closed === 0
          ? 'No open shifts — nothing to close.'
          : `Closed ${r.closed} open shift${r.closed === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Auto-close failed', 'error');
    } finally {
      setAutoCloseBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Offices</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1">
            Address, GPS, and geofence radius for each location.
          </p>
        </div>
        <button
          onClick={runAutoClose}
          disabled={autoCloseBusy}
          className="inline-flex items-center gap-2 self-start rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-4 h-10 text-sm tracking-tight disabled:opacity-50"
        >
          <Clock size={14} />
          {autoCloseBusy ? 'Closing…' : 'Run auto-close now'}
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {!rows
          ? <GridSkeleton count={3} className="col-span-full grid grid-cols-1 md:grid-cols-3" />
          : rows.map((l, i) => (
              <motion.button
                key={l.id}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i * 0.06, 0.4) }}
                whileHover={{ y: -2 }}
                onClick={() => nav(`/manage/offices/${l.id}`)}
                className="text-left rounded-3xl border border-creamSoft/10 bg-graphite/40 p-5 hover:bg-creamSoft/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cream text-ink">
                    <MapPin size={16} />
                  </span>
                  {!l.active && (
                    <span className="text-creamSoft/40 text-xs uppercase tracking-[0.18em]">
                      inactive
                    </span>
                  )}
                </div>
                <div className="mt-4 text-creamSoft text-base tracking-tight">
                  {l.name}
                </div>
                <div className="text-creamSoft/40 text-xs mt-1 line-clamp-2">
                  {l.address ?? 'No address'}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="GPS" value={`${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`} />
                  <Stat label="Geofence" value={`${l.geofence_m}m`} />
                </div>
              </motion.button>
            ))}
      </div>

    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase">
        {label}
      </div>
      <div className="text-creamSoft/80 text-sm tabular-nums tracking-tight mt-0.5">
        {value}
      </div>
    </div>
  );
}

// EditLocationModal moved to LocationDetail.tsx — clicking a card now navigates
// to /manage/offices/:id where the modal can be opened from the detail header.
