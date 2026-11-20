import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isOrgFeatureEnabled } from '../common/org-features';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { ActionLogService } from '../action-log/action-log.service';
import {
  ASSISTANT_SIGNED_DOC_LOCK_FLAG,
  assistantLockMessage,
  findLockedDeliveryTargets,
  uuidsInRequest,
} from '../documents/delivery-doc-lock';

/**
 * Refuses WhatsApp-assistant (Operator) HTTP writes that touch a delivered/signed
 * DO or RDO, or a completed run, for orgs with enableAssistantSignedDocLock.
 * Runs after ClerkAuthGuard, which marks assistant self-calls (request.viaOperator)
 * and sets the org. Every other request, and every org without the flag, passes untouched.
 */
@Injectable()
export class OperatorDeliveryLockGuard implements CanActivate {
  private readonly logger = new Logger(OperatorDeliveryLockGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionLog: ActionLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (!req?.viaOperator) return true;
    if (String(req.method || 'GET').toUpperCase() === 'GET') return true;
    const orgId: string | undefined = req.userOrganization?.id;
    if (!orgId) return true;
    const locked = await runAsOrg(orgId, async () => {
      if (!(await isOrgFeatureEnabled(this.prisma, orgId, ASSISTANT_SIGNED_DOC_LOCK_FLAG))) return [];
      return findLockedDeliveryTargets(this.prisma as any, orgId, uuidsInRequest(req));
    });
    if (!locked.length) return true;
    const path = String(req.path || req.url || '').split('?')[0];
    this.logger.warn(`assistant write refused on locked delivery doc: ${req.method} ${path}`);
    this.actionLog.system('assistant-signed-doc-lock', 'REFUSED', 'documents', {
      organizationId: orgId,
      resourceId: locked[0].id,
      method: req.method,
      path,
      statusCode: 403,
      status: 'FAILURE',
      details: { note: 'WhatsApp assistant write refused: delivered/signed DO, RDO or completed run', actorUserId: req.user?.id, locked },
    });
    throw new ForbiddenException(assistantLockMessage(locked.find((l) => l.name)?.name));
  }
}
