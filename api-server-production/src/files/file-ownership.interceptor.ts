import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable, switchMap } from 'rxjs';
import { FilesService } from './files.service';

/**
 * Records may only reference files of their own org (security phase 1,
 * 2026-11-24). On every signed-in write (POST/PUT/PATCH) the body is scanned
 * for our bucket's keys / URLs; one that belongs to another org is refused
 * (403) before the handler runs. Platform admins and the template library
 * (cross-org by design) are exempt.
 */
const FOLDERS =
  'org|logos|stamps|signatures|payment-details|assets|captured-images|msr-photos|msr-annotations|inventory-bind|do-start|do-ack|do-install|do-stamped|delivery-pod|job-fields|custom-fields|maintenance-reports|vehicles|bills|bank-transactions|payments|orders|documents|deliveries|shipments|submit-uploads|leads|payables|project-costs|projects|email-ingest|extracted-uploads|supplier-uploads|whatsapp|whatsapp-previews|delivery-posts|misc';
const KEY_RE = new RegExp(`^(?:${FOLDERS})/[^\\s"'<>]+\\.[A-Za-z0-9]{2,5}$`);
const URL_RE = /^https?:\/\/[^/]*amazonaws\.com\//i;
const EXEMPT = ['/documentTemplates', '/admin', '/files/sign', '/uploads/image'];

export function candidateKeys(body: unknown, limit = 2000): string[] {
  const out = new Set<string>();
  let seen = 0;
  const walk = (v: unknown, depth: number) => {
    if (v == null || depth > 12 || seen > limit) return;
    if (typeof v === 'string') {
      seen++;
      const s = v.trim();
      if (s.length < 600 && (KEY_RE.test(s) || URL_RE.test(s))) out.add(s);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === 'object' && !Buffer.isBuffer(v)) for (const x of Object.values(v as object)) walk(x, depth + 1);
  };
  walk(body, 0);
  return [...out];
}

@Injectable()
export class FileOwnershipInterceptor implements NestInterceptor {
  constructor(private readonly files: FilesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const method = String(req?.method || '').toUpperCase();
    const orgId = req?.userOrganization?.id;
    if (!['POST', 'PUT', 'PATCH'].includes(method) || !orgId || req.isOsirisAdmin) return next.handle();
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    if (EXEMPT.some((p) => path.startsWith(p))) return next.handle();
    const keys = candidateKeys(req.body);
    if (!keys.length) return next.handle();
    return from(this.files.assertOwnKeys(orgId, keys)).pipe(switchMap(() => next.handle()));
  }
}
