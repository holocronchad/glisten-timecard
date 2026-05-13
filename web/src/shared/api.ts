// API endpoints live under /api/* on the server so the SPA can own /,
// /me, /manage/* etc. as React routes. Vite dev proxy + production nginx
// both forward /api/* to the Express backend.
const BASE = '/api';

type FetchOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
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

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    const offline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    // eslint-disable-next-line no-console
    console.warn('[api] fetch threw', { path, offline, err: e });
    if (offline) {
      throw new NetworkError(
        'offline',
        "You're offline — check WiFi and try again.",
        e,
      );
    }
    throw new NetworkError(
      'fetch_failed',
      "Couldn't reach the timecard server — try again in a moment.",
      e,
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
