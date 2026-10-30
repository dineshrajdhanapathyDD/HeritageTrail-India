import { describe, expect, it, vi } from 'vitest';
import { HttpError, httpRequest } from '../src/http.ts';

const req = { url: 'https://overpass-api.de/api/interpreter', method: 'POST' as const, body: 'data=x' };
const response = (status: number, body = '{}') => new Response(body, { status });

describe('httpRequest', () => {
  it('sends the User-Agent and retries 502 with backoff', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response(502)).mockResolvedValueOnce(response(200, '{"ok":1}'));
    const sleep = vi.fn(async () => {});
    const res = await httpRequest(req, { userAgent: 'HeritageTrailIndia/0.1 (+repo README)', fetchImpl, sleep });
    expect(res).toEqual({ status: 200, body: '{"ok":1}' });
    expect(sleep).toHaveBeenCalledWith(30_000);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('HeritageTrailIndia/0.1 (+repo README)');
  });
  it('gives up after 3 attempts on network errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const sleep = vi.fn(async () => {});
    await expect(httpRequest(req, { userAgent: 'ua', fetchImpl, sleep })).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([30_000, 60_000]);
  });
  it('does not retry client errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(400));
    await expect(httpRequest(req, { userAgent: 'ua', fetchImpl, sleep: async () => {} })).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
