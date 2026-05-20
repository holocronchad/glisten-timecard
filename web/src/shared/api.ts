// API endpoints live under /api/* on the server so the SPA can own /,
// /me, /manage/* etc. as React routes. Vite dev proxy + production nginx
// both forward /api/* to the Express backend.
const BASE = '/api';

type FetchOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  // Opt out of the built-in retry loop. Default IS retry: pre-response
  // network failures get up to MAX_RETRIES retries with backoff. Caller can
  // disable (e.g. a deliberate "is the server reachable" probe). Retry is
  // safe for writes because the server-side punch path advisory-locks on
  // (user, day) and the state machine rejects out-of-order duplicates with
  // a clean 409 — see server/src/routes/kiosk.ts.
  noRetry?: boolean;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;
  constructor(status: number, message: string, code?: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// Distinct from ApiError: the server never answered, or answered with
// garbage (HTML 502 page, dropped JSON). Surfaced separately so callers
// can render a "network blip" message instead of the catch-all
// "Connection failed." that swallowed Ashley's intermittent reports.
export class NetworkError extends Error {
  kind: 'offline' | 'fetch_failed' | 'bad_response';
  cause?: unknown;
  constructor(kind: NetworkError['kind'], message: string, cause?: unknown) {
    super(message);
    this.kind = kind;
    this.cause = cause;
  }
}

export const AUTH_EXPIRED_EVENT = 'glisten:auth-expired';

// Fired on `window` whenever the retry loop activates. UI components listen
// (Kiosk.tsx) to render a "Reconnecting…" indicator without every caller
// plumbing their own state.
//   detail.phase: 'started' on first retry, 'attempt' on each subsequent,
//                 'ended' once the loop resolves (success OR final failure)
//   detail.attempt: 1-indexed retry number (omitted on 'ended')
// Origin 2026-05-20: dental staff reported "finicky" timecard on wired
// office LAN. Backend was healthy (nginx logs 200 OK for every request
// that arrived), no SW to poison — diagnosis pointed at dropped packets
// between office router and Cloudflare. Single-shot fetch made every
// drop a user-visible "Connection failed." This loop swallows N transient
// drops before bothering staff.
export const API_RETRY_EVENT = 'glisten:api-retry';

const MAX_RETRIES = 3;
// Ramped backoff — first retry is fast (most transient drops resolve in
// <500ms); later retries give the network real time to recover.
const RETRY_DELAYS_MS = [400, 1000, 2200];
// Per-attempt deadline. Pre-2026-05-20 the kiosk had no fetch timeout — a
// stalled TCP connection would hang the spinner indefinitely until the
// user tapped away. 8s is generous (P95 server latency is ~550ms) but
// short enough that a stalled attempt can be cut and retried.
const REQUEST_TIMEOUT_MS = 8000;

function emitRetry(
  phase: 'started' | 'attempt' | 'ended',
  attempt?: number,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(API_RETRY_EVENT, { detail: { phase, attempt } }),
  );
}

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };

  const maxAttempts = opts.noRetry ? 1 : 1 + MAX_RETRIES;
  let res: Response | null = null;
  let lastErr: unknown = null;
  let notifiedStart = false;

  for (let i = 0; i < maxAttempts; i++) {
    const ctl = new AbortController();
    const deadline = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(url, { ...init, signal: ctl.signal });
      clearTimeout(deadline);
      // Any HTTP response (incl. 5xx) means the request reached something
      // that spoke HTTP — don't retry. 5xx propagates as ApiError where the
      // caller can react meaningfully. Retrying 5xx would just pile load
      // on a server that's already struggling.
      break;
    } catch (e) {
      clearTimeout(deadline);
      lastErr = e;
      if (i >= maxAttempts - 1) break;
      if (!notifiedStart) {
        notifiedStart = true;
        emitRetry('started', i + 1);
      } else {
        emitRetry('attempt', i + 1);
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i] ?? 2200));
    }
  }

  if (notifiedStart) emitRetry('ended');

  if (!res) {
    const offline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    // eslint-disable-next-line no-console
    console.warn('[api] all attempts threw', {
      path,
      offline,
      attempts: maxAttempts,
      err: lastErr,
    });
    if (offline) {
      throw new NetworkError(
        'offline',
        "You're offline — check WiFi and try again.",
        lastErr,
      );
    }
    throw new NetworkError(
      'fetch_failed',
      "Couldn't reach the timecard server — try again in a moment.",
      lastErr,
    );
  }

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Server returned non-JSON (nginx 502 HTML, Cloudflare error page,
      // truncated response). Don't show "Connection failed." — show the
      // HTTP status so we can tell what actually happened.
      // eslint-disable-next-line no-console
      console.warn('[api] non-JSON response', {
        path,
        status: res.status,
        bodyHead: text.slice(0, 120),
      });
      throw new NetworkError(
        'bad_response',
        `Server hiccup (${res.status}) — try once more.`,
        e,
      );
    }
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.statusText;
    const code = data && data.error;
    if (res.status === 401 && opts.token) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, msg, code, data);
  }
  return data as T;
}

export type PunchType = 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';

export type CprState = {
  org: string | null;
  issued_at: string | null;
  expires_at: string | null;
  updated_at: string | null;
  days_until_expiry: number | null;
};

export type EmployeeLookup = {
  kind: 'employee';
  user: { id: number; name: string; approved: boolean };
  last_punch: { type: PunchType; ts: string; flagged: boolean } | null;
  allowed_actions: PunchType[];
  location: { id: number; distance_m: number } | null;
  geofence_required: boolean;
  bypass_geofence: boolean;
  cpr: CprState;
};

export type ManagerLookup = {
  kind: 'manager';
  token: string;
  user: { id: number; name: string; is_owner: boolean; is_manager: boolean };
};

export type LookupResponse = EmployeeLookup | ManagerLookup;

export type PunchResponse = {
  punch: { id: number; type: PunchType; ts: string };
  message: string;
  location_id: number;
  pending_approval?: boolean;
  // CPR snapshot, server-authoritative as of this punch. Used to surface the
  // clock-in CPR-card expiry reminder on the confirmation screen. Optional so
  // an older cached SPA bundle tolerates its absence.
  cpr?: CprState;
};

export type RegisterSuggestion = {
  id: number;
  name: string;
  role: string | null;
  reason: 'fuzzy' | 'first_name';
};

export type RegisterResponse =
  | {
      user: { id: number; name: string; approved: boolean };
      message: string;
      roster_matched: boolean;
      suggestion?: undefined;
    }
  | {
      // Suggest path — no DB write yet. Frontend shows "Did you mean X?"
      // and re-POSTs with `confirm_user_id` (Yes) or `force_self_register`
      // (No, register me as the name I typed).
      suggestion: RegisterSuggestion;
      message: string;
      user?: undefined;
    };
