import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { ActionLogService, ActorType, SYSTEM_ACTOR_NAME } from './action-log.service';

interface AimsRequest extends Request {
  user?: any; // Clerk AuthenticatedUser (set by ClerkStrategy)
  userOrganization?: any; // effective org (set by ClerkAuthGuard / ApiV1KeyGuard)
  isOsirisAdmin?: boolean;
  apiKey?: { id: string; name: string }; // set by ApiV1KeyGuard
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// High-frequency background traffic that is not a user action. Substring match
// on the path (no query string).
const SKIP_PATHS = [
  '/health',
  '/metrics',
  '/favicon.ico',
  '/action-log', // never log reads of the log itself
  '/admin/audit', // legacy audit reads
  '/lock/heartbeat', // document presence heartbeat (useDocumentLock)
  '/location-ping', // field app GPS batches
  '/admin/dashboard', // polled stats
];

// Background GETs fired on page load / tab focus, not user intent.
const SKIP_GET_PATHS = ['/configuration', '/organizations/user', '/users/me/roles', '/guide/', '/documents/past-descriptions'];

// POST endpoints that are actually list/read queries ("POST / = list" is a
// house convention) — log them as VIEW, not CREATE.
const VIEW_POST_RE =
  /^\/(documents(\/paginated|\/stats)?|assets|inventories(\/by-status|\/by-ids)?|customers|suppliers|projects|documentTemplates|users\/list|payments\/summary|statements\/(soa|supplier-soa)|posting-preview)$/;

// Path verb segment → semantic action (checked against the LAST static segment).
const VERB_ACTIONS: Record<string, string> = {
  'confirm-do': 'CONFIRM', 'confirm-invoice': 'CONFIRM', 'confirm-pr': 'CONFIRM',
  'bulk-complete-do': 'CONFIRM', approve: 'APPROVE', reject: 'REJECT', submit: 'SUBMIT',
  void: 'VOID', post: 'POST_GL', 'post-batch': 'POST_GL', confirm: 'CONFIRM',
  'send-email': 'SEND', 'sync-to-xero': 'SYNC', duplicate: 'DUPLICATE',
  revisions: 'CREATE_REVISION', notes: 'NOTE', sign: 'SIGN', 'generate-pdf': 'EXPORT',
  'run-due': 'RUN', run: 'RUN', 'generate-now': 'RUN', cancel: 'CANCEL', assign: 'ASSIGN',
  'link-project': 'LINK', link: 'LINK', 'claim-scheduled': 'CLAIM', 'ack-all': 'ACKNOWLEDGE',
  deliver: 'DELIVER', 'collect-return': 'COLLECT', 'off-hire': 'OFF_HIRE',
  revoke: 'REVOKE', activate: 'ACTIVATE', deactivate: 'DEACTIVATE',
  'auto-match': 'MATCH', match: 'MATCH', unmatch: 'UNMATCH', ignore: 'IGNORE',
  update: 'UPDATE', create: 'CREATE', delete: 'DELETE',
};

const METHOD_ACTION: Record<string, string> = { GET: 'VIEW', POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'authorization', 'apikey'];

@Injectable()
export class ActionLogInterceptor implements NestInterceptor {
  constructor(private readonly actionLog: ActionLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AimsRequest>();
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const method = (req.method || '').toUpperCase();

    if (method === 'OPTIONS' || method === 'HEAD') return next.handle();
    if (SKIP_PATHS.some((p) => path.includes(p))) return next.handle();
    if (method === 'GET' && SKIP_GET_PATHS.some((p) => path.startsWith(p))) return next.handle();

    const started = Date.now();
    return next.handle().pipe(
      tap(() => this.write(req, path, method, started, 'SUCCESS', 200)),
      catchError((error) => {
        this.write(req, path, method, started, 'FAILURE', error?.status || 500, error?.message);
        throw error;
      }),
    );
  }

  private write(req: AimsRequest, path: string, method: string, started: number, status: 'SUCCESS' | 'FAILURE', statusCode: number, errorMessage?: string) {
    try {
      const { actorType, actorId, actorName, actorEmail, channel } = this.resolveActor(req, path);
      const segments = path.split('/').filter(Boolean);
      const resource = (segments[0] || 'unknown').toLowerCase();
      const resourceId = (req.params as any)?.id || segments.find((s) => UUID_RE.test(s)) || null;
      const action = this.resolveAction(method, path, segments);

      const details: any = {};
      const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : null;
      if (query) details.query = query.substring(0, 500);
      if (method !== 'GET' && req.body && typeof req.body === 'object') details.body = this.summarizeBody(req.body);
      if (errorMessage) details.error = String(errorMessage).substring(0, 500);
      const activeOrgHeader = req.headers?.['x-active-org-id'];
      if (activeOrgHeader) details.viewingAs = String(activeOrgHeader);

      void this.actionLog.log({
        actorType,
        actorId,
        actorName,
        actorEmail,
        organizationId: req.userOrganization?.id || (req.body as any)?.organizationId || null,
        // When an osiris admin acts under X-Active-Org-Id, record that it was
        // an override; membership org isn't on req, so the flag is the trail.
        homeOrgId: activeOrgHeader && req.isOsirisAdmin ? 'admin-override' : null,
        channel,
        method,
        path,
        action,
        resource,
        resourceId,
        statusCode,
        durationMs: Date.now() - started,
        ipAddress: req.ip || (req as any).connection?.remoteAddress || null,
        userAgent: (req.headers?.['user-agent'] as string) || null,
        details: Object.keys(details).length ? details : undefined,
        status,
      });
    } catch (e: any) {
      console.error('[action-log] interceptor failed:', e?.message || e);
    }
  }

  private resolveActor(req: AimsRequest, path: string): { actorType: ActorType; actorId: string; actorName?: string; actorEmail?: string; channel: string } {
    if (req.user?.id) {
      const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || undefined;
      return { actorType: 'USER', actorId: req.user.id, actorName: name, actorEmail: req.user.emailAddresses?.[0]?.emailAddress, channel: 'portal' };
    }
    if (req.apiKey?.id) {
      return { actorType: 'API_KEY', actorId: req.apiKey.id, actorName: req.apiKey.name, channel: 'v1' };
    }
    // Token-holding guests on public pages: identify by the token itself.
    const params: any = req.params || {};
    if (path.startsWith('/public/delivery/') || path.startsWith('/public-pay/')) {
      const token = params.token || path.split('/').filter(Boolean).pop() || 'unknown';
      return { actorType: 'GUEST', actorId: `token:${String(token).substring(0, 24)}`, actorName: 'Guest (share link)', channel: 'public' };
    }
    // Webhooks / ingestion / anything else non-human → "System creation".
    return { actorType: 'SYSTEM', actorId: `system:${path.split('/').filter(Boolean)[0] || 'unknown'}`, actorName: SYSTEM_ACTOR_NAME, channel: 'webhook' };
  }

  private resolveAction(method: string, path: string, segments: string[]): string {
    if (method === 'POST' && VIEW_POST_RE.test(path)) return 'VIEW';
    // Last static (non-uuid, non-numeric) segment may carry the verb.
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i];
      if (UUID_RE.test(s) || /^\d+$/.test(s)) continue;
      if (VERB_ACTIONS[s]) return VERB_ACTIONS[s];
      break;
    }
    return METHOD_ACTION[method] || 'UNKNOWN';
  }

  /** Cheap, shallow body summary — primitives kept (truncated), nests collapsed. */
  private summarizeBody(body: any): any {
    const out: any = {};
    let count = 0;
    for (const [k, v] of Object.entries(body)) {
      if (count++ >= 30) { out._truncated = true; break; }
      if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) { out[k] = '[REDACTED]'; continue; }
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') out[k] = v.length > 200 ? v.substring(0, 200) + '…' : v;
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (Array.isArray(v)) out[k] = `[array(${v.length})]`;
      else out[k] = '[object]';
    }
    return out;
  }
}
