import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, NotFoundException, createParamDecorator } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { fieldEngineLive, fieldModuleOn } from '../common/field-flags';
import { fieldSettings } from '../common/settings';

/** The person using the AIMS phone app: their Worker row, HR profile and the org's HR settings. */
export interface AppCtx {
  organizationId: string;
  organizationName: string;
  userId: string;
  features: Record<string, unknown>;
  /** fieldEngineLive: clock-ins are taken here (off while the org still clocks in SiteClock). */
  live: boolean;
  worker: { id: string; organizationId: string; name: string; phone: string | null; active: boolean };
  profile: any;
  settings: any;
}

/** An error whose body the app reads: `message` is the text or code, the rest is spread next to it by the app. */
export function appError(status: number, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ message, data }, status);
}

export const App = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().fieldApp);

/**
 * Runs after ClerkAuthGuard on every /field/app route. HR module off for the org: 404 (the route does not
 * exist). The login is not a worker of the org (Worker.userId): 403 NO_WORKER. A worker without an HR profile
 * gets one with the defaults on first use.
 */
@Injectable()
export class FieldAppGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const db = this.prisma as any;
    const req = context.switchToHttp().getRequest();
    const org = req.userOrganization;
    if (!org?.id) throw new ForbiddenException('User is not assigned to any organization');
    const ui = await db.organizationUIConfig.findUnique({ where: { organizationId: org.id }, select: { features: true } });
    const features = (ui?.features as Record<string, unknown>) || {};
    if (!fieldModuleOn(features)) throw new NotFoundException();
    const userId: string = req.user?.id ?? '';
    const worker = userId ? await db.worker.findFirst({ where: { organizationId: org.id, userId, active: true }, select: { id: true, organizationId: true, name: true, phone: true, active: true } }) : null;
    if (!worker) throw appError(403, 'This login is not set up as a worker in HR. Ask your office.', { code: 'NO_WORKER' });
    const profile =
      (await db.fieldWorkerProfile.findUnique({ where: { workerId: worker.id } })) ??
      (await db.fieldWorkerProfile.create({ data: { organizationId: org.id, workerId: worker.id } }));
    const settings = await fieldSettings(db, org.id);
    const ctx: AppCtx = { organizationId: org.id, organizationName: org.name ?? '', userId, features, live: fieldEngineLive(features), worker, profile, settings };
    req.fieldApp = ctx;
    return true;
  }
}
