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

export type RegisterResponse = {
  user: { id: number; name: string; approved: boolean };
  message: string;
};
