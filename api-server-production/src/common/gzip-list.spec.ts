import { gunzipSync } from 'zlib';
import { GZIP_MIN_BYTES, gzipListMiddleware, wantsGzip } from './gzip-list';

const fakeRes = () => {
  const headers: Record<string, string> = {};
  const res: any = {
    sent: null as any,
    getHeader: (k: string) => headers[k],
    setHeader: (k: string, v: string) => (headers[k] = v),
    removeHeader: (k: string) => delete headers[k],
    send: (b: any) => (res.sent = b),
    headers,
  };
  return res;
};

describe('gzip for the Orders list only', () => {
  it('only GET /orders (any query), only when the browser accepts gzip', () => {
    expect(wantsGzip('GET', '/orders', 'gzip, deflate, br')).toBe(true);
    expect(wantsGzip('GET', '/orders?part=imported', 'gzip')).toBe(true);
    expect(wantsGzip('GET', '/orders/abc', 'gzip')).toBe(false);
    expect(wantsGzip('POST', '/orders', 'gzip')).toBe(false);
    expect(wantsGzip('GET', '/documents', 'gzip')).toBe(false);
    expect(wantsGzip('GET', '/orders', '')).toBe(false);
  });

  it('a large body is gzipped (same bytes once unzipped); a small one goes as it is', () => {
    const big = JSON.stringify({ data: 'x'.repeat(GZIP_MIN_BYTES + 10) });
    const res = fakeRes();
    gzipListMiddleware({ method: 'GET', originalUrl: '/orders', headers: { 'accept-encoding': 'gzip' } }, res, () => undefined);
    res.send(big);
    expect(res.headers['Content-Encoding']).toBe('gzip');
    expect(gunzipSync(res.sent).toString()).toBe(big);
    const small = fakeRes();
    gzipListMiddleware({ method: 'GET', originalUrl: '/orders', headers: { 'accept-encoding': 'gzip' } }, small, () => undefined);
    small.send('{"data":[]}');
    expect(small.sent).toBe('{"data":[]}');
    expect(small.headers['Content-Encoding']).toBeUndefined();
  });

  it('other routes: the response is not touched at all', () => {
    const res = fakeRes();
    const original = res.send;
    gzipListMiddleware({ method: 'GET', originalUrl: '/documents', headers: { 'accept-encoding': 'gzip' } }, res, () => undefined);
    expect(res.send).toBe(original);
  });
});
