import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'crypto';
import { from, lastValueFrom, Observable } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { cleanIdempotencyKey, requestHashOf, runIdempotent } from './idempotency';

/**
 * Honours an `Idempotency-Key` header on the route it decorates (see
 * idempotency.ts). No header = the route runs exactly as before. The scope is
 * the route pattern (e.g. POST /deliveries/:id/finalize) plus its params, the
 * org comes from the guard's req.userOrganization, and an uploaded file counts
 * towards "the same request" by its bytes. Apply AFTER a FileInterceptor so
 * the file is parsed: @UseInterceptors(FileInterceptor(...), IdempotencyInterceptor).
 * The module using it must provide PrismaService (it is per-module here).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const key = cleanIdempotencyKey(req.headers?.['idempotency-key']);
    const organizationId = req.userOrganization?.id;
    if (!key || !organizationId) return next.handle();
    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const scope = `${route} ${JSON.stringify(req.params ?? {})}`;
    const fileSha = req.file?.buffer ? createHash('sha256').update(req.file.buffer).digest('hex') : null;
    const requestHash = requestHashOf({ method: req.method, path: req.originalUrl?.split('?')[0] ?? req.path, body: req.body, fileSha });
    return from(
      runIdempotent(this.prisma, { organizationId, scope, key, requestHash }, () => lastValueFrom(next.handle(), { defaultValue: null })).then((r) => {
        if (r.replayed) context.switchToHttp().getResponse()?.setHeader?.('Idempotent-Replayed', 'true');
        return r.value;
      }),
    );
  }
}
