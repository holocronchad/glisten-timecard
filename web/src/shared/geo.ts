export type GeoError =
  | 'unsupported'   // browser doesn't support geolocation
  | 'denied'        // user (or browser policy) denied permission
  | 'unavailable'   // device couldn't get a fix
  | 'timeout'       // took too long
  | 'unknown';

export type GeoResult =
  | { ok: true; coords: { lat: number; lng: number } }
  | { ok: false; reason: GeoError };

export async function getCurrentPosition(): Promise<GeoResult> {
  if (!('geolocation' in navigator)) {
    return { ok: false, reason: 'unsupported' };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 8000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ ok: true, coords: { lat: p.coords.latitude, lng: p.coords.longitude } });
      },
      (err) => {
        clearTimeout(timer);
        // err.code: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        const reason: GeoError =
          err.code === 1 ? 'denied' :
          err.code === 2 ? 'unavailable' :
          err.code === 3 ? 'timeout' : 'unknown';
        resolve({ ok: false, reason });
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 7000 },
    );
  });
}

/** Probe permission state up-front (Permissions API where supported).
 *  Returns 'granted' / 'denied' / 'prompt' / null (when unsupported). */
export async function geoPermissionState(): Promise<'granted' | 'denied' | 'prompt' | null> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) return null;
  try {
    const r = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return r.state as any;
  } catch {
    return null;
  }
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Phoenix',
  });
}

export function greetingForHour(now = new Date()): string {
  const az = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Phoenix' }),
  );
  const h = az.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
