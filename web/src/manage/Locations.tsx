import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, X, Crosshair } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';

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
  const [rows, setRows] = useState<Location[] | null>(null);
  const [editing, setEditing] = useState<Location | null>(null);

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

  return (
    <div>
      <div>
        <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
          <span className="font-serif italic text-cream">Offices</span>
        </h1>
        <p className="text-creamSoft/40 text-sm mt-1">
          Address, GPS, and geofence radius for each location.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {!rows
          ? null
          : rows.map((l, i) => (
              <motion.button
                key={l.id}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i * 0.06, 0.4) }}
                whileHover={{ y: -2 }}
                onClick={() => setEditing(l)}
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

      <AnimatePresence>
        {editing && (
          <EditLocationModal
            location={editing}
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

function EditLocationModal({
  location,
  onClose,
  onSaved,
}: {
  location: Location;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address ?? '');
  const [lat, setLat] = useState(String(location.lat));
  const [lng, setLng] = useState(String(location.lng));
  const [geofence, setGeofence] = useState(String(location.geofence_m));
  const [active, setActive] = useState(location.active);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setErr('This browser has no GPS.');
      return;
    }
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
      },
      (e) => setErr(`Couldn't read GPS: ${e.message}`),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const latN = parseFloat(lat);
      const lngN = parseFloat(lng);
      const radius = parseInt(geofence, 10);
      if (!Number.isFinite(latN) || !Number.isFinite(lngN) || !Number.isFinite(radius)) {
        setErr('GPS and radius must be numbers.');
        setBusy(false);
        return;
      }
      await api(`/manage/locations/${location.id}`, {
        method: 'PATCH',
        token: token ?? undefined,
        body: {
          name,
          address: address || null,
          lat: latN,
          lng: lngN,
          geofence_m: radius,
          active,
          reason,
        },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
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
        className="w-full max-w-[520px] rounded-3xl bg-graphite border border-creamSoft/10 p-6 max-h-[92dvh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-2xl tracking-tight font-light">
              Edit <span className="font-serif italic text-cream">office</span>
            </h2>
            <p className="text-creamSoft/50 text-sm mt-1">{location.slug}</p>
          </div>
          <button
            onClick={onClose}
            className="text-creamSoft/40 hover:text-creamSoft/80"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Address" value={address} onChange={setAddress} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" value={lat} onChange={setLat} />
            <Field label="Longitude" value={lng} onChange={setLng} />
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            className="self-start inline-flex items-center gap-1.5 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-3 py-1.5 text-xs tracking-tight"
          >
            <Crosshair size={12} /> Use this device's location
          </button>
          <Field label="Geofence radius (meters)" value={geofence} onChange={setGeofence} />
          <label className="flex items-center gap-2 text-sm text-creamSoft/70 mt-1">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="accent-cream"
            />
            Active (staff can punch from this office)
          </label>
          <Field
            label="Reason for change"
            value={reason}
            onChange={setReason}
            placeholder="Move to new suite, recalibrating GPS"
          />
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
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-ink border border-creamSoft/10 rounded-2xl px-4 py-3 text-creamSoft placeholder:text-creamSoft/30 focus:outline-none focus:border-cream/40 transition-colors"
      />
    </label>
  );
}
