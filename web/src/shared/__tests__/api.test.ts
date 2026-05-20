import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { api, ApiError, NetworkError } from '../api';

// Helpers — build a Response that fetch() would return.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api() retry loop (origin: dental office wired-LAN packet loss 2026-05-20)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Real timers — backoff delays are short (400ms / 1000ms / 2200ms) and
    // the tests below assert on call counts, not wall-clock time. Using
    // fake timers would couple every test to the exact backoff array.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries on pre-response network errors and succeeds on a later attempt', async () => {
    // 2 throws, then 200. Caller never sees the failures.
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, value: 42 }));

    const result = await api<{ ok: boolean; value: number }>('/kiosk/lookup', {
      method: 'POST',
      body: { pin: '1234' },
    });

    expect(result).toEqual({ ok: true, value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('does NOT retry once an HTTP response (even 5xx) is received', async () => {
    // 502 is a real response from somewhere upstream — retrying would just
    // pile load. ApiError surfaces to the caller on the first attempt.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, { error: 'bad_gateway' }),
    );

    await expect(api('/kiosk/lookup', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws NetworkError after exhausting all retries', async () => {
    // 4 throws total = 1 initial + 3 retries — every attempt fails.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      api('/kiosk/punch', { method: 'POST', body: { pin: '1234' } }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 10_000);

  it('honors noRetry — single attempt, no backoff loop', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(
      api('/kiosk/lookup', { method: 'POST', noRetry: true }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
