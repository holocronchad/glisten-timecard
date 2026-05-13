import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Pencil, Crosshair, X } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { useToast } from '../shared/toast';
import { formatTime } from '../shared/geo';
import BlurredRate from './BlurredRate';

type LocationInfo = {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  geofence_m: number;
  active: boolean;
};

type RosterRow = {
  id: number;
  name: string;
  role: string;
  employment_type: string;
  pay_rate_cents: number | null;
  is_owner: boolean;
  is_manager: boolean;
  track_hours: boolean;
  active: boolean;
  last_punch_ts: string | null;
  last_punch_type: string | null;
  period_minutes: number;
  open_segments: number;
};

type LocationDetailResponse = {
  location: LocationInfo;
  period: { index: number; start: string; end: string; label: string };
  roster: RosterRow[];
};

function shortName(full: string): string {
  return full.replace(/^Glisten Dental\s+/, '');
}

function hhmm(minutes: number): string {
  if (!minutes) return '0h 00m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Phoenix',
  });
}

export default function LocationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { token } = useAuth();
  const [data, setData] = useState<LocationDetailResponse | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    const r = await api<LocationDetailResponse>(`/manage/locations/${id}`, {
      token: token ?? undefined,
    });
    setData(r);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  if (!data) return <div className="text-creamSoft/40 text-sm">Loading…</div>;

  const onClock = data.roster.filter((r) => r.open_segments > 0).length;

  return (
    <div>
      <button
        onClick={() => nav(-1)}
        className="inline-flex items-center gap-1.5 text-creamSoft/40 hover:text-creamSoft/80 text-sm tracking-tight mb-6"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cream text-ink shrink-0">
            <MapPin size={18} />
          </span>
          <div>
            <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
              <span className="font-serif italic text-cream">
                {shortName(data.location.name)}
              </span>
            </h1>
            <p className="text-creamSoft/40 text-sm mt-1">
              {data.location.address ?? 'No address'}
              {!data.location.active && (
                <span className="ml-2 text-amber-300/80">inactive</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft/80 px-4 h-10 text-sm tracking-tight"
        >
          <Pencil size={14} /> Edit office
        </button>
      </div>

      <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Roster" value={String(data.roster.length)} />
        <Stat label="On the clock" value={String(onClock)} />
        <Stat
          label="GPS"
          value={`${data.location.lat.toFixed(4)}, ${data.location.lng.toFixed(4)}`}
          mono
        />
        <Stat label="Geofence" value={`${data.location.geofence_m}m`} />
      </div>

      <h2 className="text-creamSoft/50 text-xs tracking-[0.18em] uppercase mt-10 mb-3">
        Roster · {data.period.label}
      </h2>
      <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 overflow-hidden">
        {data.roster.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">
            No staff assigned to this office yet.
          </div>
        ) : (
          <ul className="divide-y divide-creamSoft/5">
            {data.roster.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/manage/employees/${r.id}`}
                  className="flex items-center gap-4 p-5 hover:bg-creamSoft/5 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-creamSoft text-base tracking-tight flex items-center gap-2">
                      {r.name}
                      {r.is_owner && (
                        <span className="rounded-full bg-cream/15 text-cream border border-cream/30 text-[9px] tracking-[0.12em] uppercase px-2 py-0.5">
                          Owner
                        </span>
                      )}
                      {!r.is_owner && r.is_manager && (
                        <span className="rounded-full bg-creamSoft/15 text-creamSoft border border-creamSoft/30 text-[9px] tracking-[0.12em] uppercase px-2 py-0.5">
                          Manager
                        </span>
                      )}
                      {r.open_segments > 0 && (
                        <span className="rounded-full bg-emerald-300/10 text-emerald-300 border border-emerald-300/20 text-[9px] tracking-[0.12em] uppercase px-2 py-0.5">
                          On clock
                        </span>
                      )}
                    </div>
                    <div className="text-creamSoft/40 text-xs mt-0.5">
                      {r.role} · {r.employment_type}
                      {r.pay_rate_cents !== null && (
                        <span className="text-creamSoft/60 ml-2 inline-flex items-baseline gap-1">
                          · <BlurredRate cents={r.pay_rate_cents} />/hr
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden sm:block w-32 text-right">
                    {r.last_punch_ts ? (
                      <>
                        <div className="text-creamSoft/70 text-xs tabular-nums">
                          {dateLabel(r.last_punch_ts)} · {formatTime(r.last_punch_ts)}
                        </div>
                        <div className="text-creamSoft/40 text-[10px] mt-0.5 tracking-[0.12em] uppercase">
                          {r.last_punch_type?.replace('_', ' ')}
                        </div>
                      </>
                    ) : (
                      <span className="text-creamSoft/30 text-xs">No punches yet</span>
                    )}
                  </div>

                  <div className="w-24 text-right">
                    <div className="text-cream text-base tabular-nums tracking-tight font-medium">
                      {r.track_hours ? hhmm(r.period_minutes) : '—'}
                    </div>
                    <div className="text-creamSoft/40 text-[10px] mt-0.5 tracking-[0.12em] uppercase">
                      this period
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <EditLocationModal
            location={data.location}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-creamSoft/10 bg-graphite/40 p-4">
      <div className="text-creamSoft/40 text-[10px] tracking-[0.18em] uppercase">
        {label}
      </div>
      <div
        className={[
          'text-creamSoft text-2xl tracking-tight font-light mt-1',
          mono ? 'text-base tabular-nums' : 'tabular-nums',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}

// EditLocationModal — same flow that lived inline in Locations.tsx, now lives
// here on the detail page and lifts back to a single shared modal pattern.
function EditLocationModal({
  location,
  onClose,
  onSaved,
}: {
  location: LocationInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address ?? '');
  const [lat, setLat] = useState(String(location.lat));
  const [lng, setLng] = useState(String(location.lng));
  const [geofence, setGeofence] = useState(String(location.geofence_m));
  const [active, setActive] = useState(location.active);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function useMyLocation() {
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
      toast('Office updated.');
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
