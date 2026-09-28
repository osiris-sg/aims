import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantStorage } from './tenant-context';

/**
 * Runs every HTTP request inside a tenant context (TENANCY_MODE=per-org).
 * Guards run first, so the org is already known here: ClerkAuthGuard sets
 * req.userOrganization (honouring "Viewing as org"), ApiV1KeyGuard sets it from
 * the API key. Public token routes start with no org; the first query that finds
 * their row fills it in (see TenancyRouter.fanOut).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const orgId: string | null = req?.userOrganization?.id ?? null;
    return new Observable((subscriber) =>
      tenantStorage.run({ orgId }, () => {
        const sub = next.handle().subscribe(subscriber);
        return () => sub.unsubscribe();
      }),
    );
  }
}
