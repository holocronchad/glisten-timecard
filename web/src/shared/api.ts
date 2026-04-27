const BASE = '';

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

export const AUTH_EXPIRED_EVENT = 'glisten:auth-expired';

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.statusText;
    const code = data && data.error;
    // Manager-scoped 401 → bubble up so the auth provider can clear and
    // route to login. Kiosk/me routes don't carry a token, so this won't
    // fire on PIN failures.
    if (res.status === 401 && opts.token) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, msg, code, data);
  }
  return data as T;
}

export type PunchType = 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';

export type LookupResponse = {
  user: { id: number; name: string };
  last_punch: { type: PunchType; ts: string; flagged: boolean } | null;
  allowed_actions: PunchType[];
  location: { id: number; distance_m: number } | null;
  geofence_required: boolean;
};

export type PunchResponse = {
  punch: { id: number; type: PunchType; ts: string };
  message: string;
  location_id: number;
};
