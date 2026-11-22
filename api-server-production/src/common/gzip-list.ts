/**
 * Gzip for the big list answers (2026-11-22, WCT Orders list: 6,669 rows = 9 MB of JSON, about 1 MB gzipped). The
 * API has no compression middleware; this one only touches the GET paths listed here, only when the browser accepts
 * gzip and the body is large. Every other route is untouched (same bytes, same headers).
 */
import { gzipSync } from 'zlib';

export const GZIP_PATHS = [/^\/orders\/?$/];
export const GZIP_MIN_BYTES = 32 * 1024;

export const wantsGzip = (method: unknown, path: unknown, acceptEncoding: unknown): boolean =>
  String(method).toUpperCase() === 'GET' && GZIP_PATHS.some((re) => re.test(String(path ?? '').split('?')[0])) && /\bgzip\b/i.test(String(acceptEncoding ?? ''));

export function gzipListMiddleware(req: any, res: any, next: () => void) {
  if (!wantsGzip(req.method, req.originalUrl ?? req.url, req.headers?.['accept-encoding'])) return next();
  const send = res.send.bind(res);
  res.send = (body: any) => {
    const raw = typeof body === 'string' ? Buffer.from(body) : Buffer.isBuffer(body) ? body : null;
    if (!raw || raw.length < GZIP_MIN_BYTES || res.getHeader('Content-Encoding')) return send(body);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.removeHeader('Content-Length');
    return send(gzipSync(raw, { level: 6 }));
  };
  next();
}
