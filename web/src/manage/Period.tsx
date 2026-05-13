import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Check, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../shared/api';
import { useAuth } from './auth';
import { useToast } from '../shared/toast';
import { ListSkeleton } from './Skeleton';

type DayReview = {
  date: string;
  worked_minutes: number;
  open: boolean;
  is_clean: boolean;
  anomalies: Array<{
    type: string;
    severity: 'high' | 'medium' | 'low';
    message: string;
  }>;
};

type PeriodResponse = {
  period: { index: number; start: string; end: string; label: string };
  location_id: number | null;
  signed: {
    id: number;
    actor_name: string | null;
    ts: string;
    after_state: any;
  } | null;
  employees: Array<{
    user: { id: number; name: string; employment_type: string };
    total_minutes: number;
    // Split hours by which PIN was used to clock in:
    //   office_minutes → office PIN (paid at office rate)
    //   wfh_minutes    → WFH PIN (paid at WFH rate)
    // Only differs from total when employee has both PINs.
    office_minutes: number;
    wfh_minutes: number;
    // True when this employee has a separate WFH rate (i.e. dual-rate
    // structure). Used to decide whether to show the WFH/Office split
    // pill row even on periods where they happened to only work one bucket.
    has_split_rate: boolean;
    daily_totals: Array<{ date: string; worked_minutes: number; open: boolean }>;
    flagged_count: number;
    open_segments: number;
    day_reviews: DayReview[];
    anomaly_counts: { high: number; medium: number; low: number; total: number };
  }>;
};

type Location = { id: number; name: string; active: boolean };

// Per Anas (2026-05-01): payroll always rolls to a user's HOME office,
// regardless of where the punch happened. The chip filter scopes by
// home_location_id, not by punch.location_id.
function shortName(full: string): string {
  return full.replace(/^Glisten Dental\s+/, '');
}

function slugify(full: string): string {
  return shortName(full).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export default function Period() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [data, setData] = useState<PeriodResponse | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<number | null>(null); // null = All
  const [signing, setSigning] = useState(false);

  // Load locations once for the chip selector.
  useEffect(() => {
    let cancelled = false;
    api<{ locations: Location[] }>('/manage/locations', {
      token: token ?? undefined,
    }).then((r) => {
      if (!cancelled) setLocations(r.locations.filter((l) => l.active));
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams();
      if (index !== null) params.set('index', String(index));
      if (locationId !== null) params.set('location', String(locationId));
      const path = params.toString()
        ? `/manage/period?${params.toString()}`
        : '/manage/period';
      const r = await api<PeriodResponse>(path, { token: token ?? undefined });
      if (!cancelled) setData(r);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [index, locationId, token]);

  function shift(delta: number) {
    if (!data) return;
    setIndex(data.period.index + delta);
  }

  async function signPeriod() {
    if (!data || !user?.is_owner || signing) return;
    const totalMin = data.employees.reduce((acc, e) => acc + e.total_minutes, 0);
    const highAnoms = data.employees.reduce((acc, e) => acc + e.anomaly_counts.high, 0);
    const officeName =
      locationId === null
        ? 'all offices'
        : shortName(locations.find((l) => l.id === locationId)?.name ?? '');
    const confirmMsg = highAnoms > 0
      ? `${highAnoms} HIGH-severity anomal${highAnoms === 1 ? 'y' : 'ies'} flagged. Sign anyway?\n\nPeriod: ${data.period.label}\nScope: ${officeName}\nStaff: ${data.employees.length}\nHours: ${(totalMin / 60).toFixed(1)}`
      : `Sign payroll for ${data.period.label}?\n\nScope: ${officeName}\nStaff: ${data.employees.length}\nHours: ${(totalMin / 60).toFixed(1)}\n\nThis records you as the signer in the audit log + downloads the CSV.`;
    if (!window.confirm(confirmMsg)) return;
    setSigning(true);
    try {
      await api('/manage/period/sign', {
        method: 'POST',
        token: token ?? undefined,
        body: {
          index: data.period.index,
          location_id: locationId,
          total_minutes: totalMin,
          employee_count: data.employees.length,
          high_anomalies: highAnoms,
        },
      });
      toast('Payroll signed.');
      await new Promise<void>((resolve) => {
        downloadCsv();
        setTimeout(resolve, 200);
      });
      // Refetch to surface the signed-by stamp
      const params = new URLSearchParams();
      if (index !== null) params.set('index', String(index));
      if (locationId !== null) params.set('location', String(locationId));
      const path = params.toString()
        ? `/manage/period?${params.toString()}`
        : '/manage/period';
      const r = await api<PeriodResponse>(path, { token: token ?? undefined });
      setData(r);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Sign failed', 'error');
    } finally {
      setSigning(false);
    }
  }

  function downloadCsv() {
    if (!data || !user?.is_owner) return;
    const params = new URLSearchParams({ index: String(data.period.index) });
    if (locationId !== null) params.set('location', String(locationId));
    const url = `/api/manage/payroll.csv?${params.toString()}`;
    const officeSlug =
      locationId === null
        ? 'all'
        : slugify(locations.find((l) => l.id === locationId)?.name ?? 'all');
    fetch(url, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `glisten-payroll-${officeSlug}-${data.period.start.slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.05] tracking-tight font-light">
            <span className="font-serif italic text-cream">Pay period</span>
          </h1>
          <p className="text-creamSoft/40 text-sm mt-1 tabular-nums">
            {data?.period.label ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => shift(1)}
            className="h-10 w-10 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 flex items-center justify-center"
          >
            <ChevronRight size={18} />
          </button>
          {user?.is_owner && (
            <>
              <button
                onClick={downloadCsv}
                className="ml-3 h-10 inline-flex items-center gap-2 rounded-full border border-creamSoft/15 hover:bg-creamSoft/5 text-creamSoft px-4 text-sm tracking-tight"
              >
                <Download size={16} /> CSV only
              </button>
              <button
                onClick={signPeriod}
                disabled={signing}
                className="h-10 inline-flex items-center gap-2 rounded-full bg-cream text-ink px-4 text-sm tracking-tight disabled:opacity-50"
              >
                <Check size={16} /> {signing ? 'Signing…' : 'Sign + export'}
              </button>
            </>
          )}
        </div>
      </div>

      {locations.length > 0 && (
        <div className="mt-6 flex items-center gap-2 flex-wrap">
          <span className="text-creamSoft/40 text-[10px] tracking-[0.2em] uppercase mr-2">
            Office
          </span>
          <button
            onClick={() => setLocationId(null)}
            className={`px-3.5 py-1.5 rounded-full text-xs tracking-tight transition-colors ${
              locationId === null
                ? 'bg-cream text-ink'
                : 'border border-creamSoft/15 text-creamSoft hover:bg-creamSoft/5'
            }`}
          >
            All
          </button>
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setLocationId(loc.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs tracking-tight transition-colors ${
                locationId === loc.id
                  ? 'bg-cream text-ink'
                  : 'border border-creamSoft/15 text-creamSoft hover:bg-creamSoft/5'
              }`}
            >
              {shortName(loc.name)}
            </button>
          ))}
        </div>
      )}

      {data?.signed && (
        <div className="mt-6 rounded-3xl border border-emerald-300/25 bg-emerald-300/5 p-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-300 text-ink shrink-0">
            <Check size={16} />
          </span>
          <div className="flex-1 text-sm">
            <span className="text-emerald-300 font-medium">Signed by {data.signed.actor_name ?? 'unknown'}</span>
            <span className="text-creamSoft/60">
              {' '}· {new Date(data.signed.ts).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: 'America/Phoenix',
              })} PHX
            </span>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-3xl border border-creamSoft/10 overflow-hidden bg-graphite/40 divide-y divide-creamSoft/5">
        {!data ? (
          <ListSkeleton rows={6} />
        ) : data.employees.length === 0 ? (
          <div className="p-10 text-creamSoft/40 text-sm">No active staff.</div>
        ) : (
          data.employees.map((e, i) => {
            const isClean = e.anomaly_counts.total === 0;
            return (
              <motion.div
                key={e.user.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.03, 0.35) }}
                onClick={() =>
                  nav(`/manage/employees/${e.user.id}?index=${data.period.index}`)
                }
                className="p-5 flex items-center gap-4 hover:bg-creamSoft/5 transition-colors cursor-pointer"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                    isClean
                      ? 'bg-emerald-300/15 text-emerald-300'
                      : e.anomaly_counts.high > 0
                        ? 'bg-amber-300/20 text-amber-300'
                        : 'bg-creamSoft/10 text-creamSoft/70'
                  }`}
                  title={isClean ? 'No anomalies' : `${e.anomaly_counts.total} flag(s)`}
                >
                  {isClean ? <Check size={14} /> : <AlertTriangle size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-creamSoft text-base tracking-tight">
                    {e.user.name}
                  </div>
                  <div className="text-creamSoft/40 text-xs">
                    {e.user.employment_type}
                    {e.anomaly_counts.high > 0 && (
                      <span className="ml-2 text-amber-300/80">
                        · {e.anomaly_counts.high} HIGH
                      </span>
                    )}
                    {e.anomaly_counts.medium > 0 && (
                      <span className="ml-2 text-creamSoft/60">
                        · {e.anomaly_counts.medium} medium
                      </span>
                    )}
                    {e.anomaly_counts.low > 0 && (
                      <span className="ml-2 text-creamSoft/40">
                        · {e.anomaly_counts.low} low
                      </span>
                    )}
                    {e.flagged_count > 0 && (
                      <span className="ml-2 text-amber-300/80">
                        · {e.flagged_count} flagged punches
                      </span>
                    )}
                    {e.open_segments > 0 && (
                      <span className="ml-2 text-amber-300/80">· open shift</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-creamSoft tabular-nums tracking-tight">
                    {hhmm(e.total_minutes)}
                  </div>
                  {/* Show office/WFH split only when employee actually has WFH hours
                      (otherwise it's just clutter — most staff have one rate). */}
                  {e.has_split_rate && (
                    <div className="mt-1 flex items-center gap-2 justify-end text-[10px] tabular-nums">
                      <span className="rounded-full px-2 py-0.5 bg-cream/10 text-creamSoft border border-creamSoft/20">
                        Office {hhmm(e.office_minutes)}
                      </span>
                      <span className="rounded-full px-2 py-0.5 bg-sky-300/10 text-sky-300 border border-sky-300/30">
                        WFH {hhmm(e.wfh_minutes)}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
