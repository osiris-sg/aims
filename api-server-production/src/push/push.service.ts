import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type App, cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from '../common/prisma.service';

/**
 * Firebase Cloud Messaging sender (2026-09).
 *
 * Credentials come from FCM_SERVICE_ACCOUNT_B64 — the service-account JSON,
 * base64-encoded, set on Render. It is validated and the SDK initialised at
 * MODULE STARTUP, not lazily on the first send: a malformed or missing
 * credential is a deployment mistake, and finding out about it weeks later
 * when the first delivery is scheduled is the worst possible time. Boot loudly
 * instead.
 *
 * Recipients are FIELD-TECH users. NotificationsService.emit cannot be reused
 * for this: its resolveRecipients selects holders of `documents:read`, which
 * field-tech deliberately lack — the bell is an OFFICE surface by design. This
 * resolves its own audience.
 */

/** The role that identifies a rider. Not a permission — there is no field-only one. */
const FIELD_ROLE = 'field-tech';

/**
 * FCM error codes that mean "this token is dead, stop sending to it".
 * Anything else (quota, transport, internal) is transient and must NOT prune —
 * deleting on a blip would silently unsubscribe a working device.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export interface PushPayload {
  title: string;
  body: string;
  /** Optional string map delivered alongside; used by the app to deep-link. */
  data?: Record<string, string>;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private app: App | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const b64 = process.env.FCM_SERVICE_ACCOUNT_B64;
    if (!b64 || !b64.trim()) {
      // Deliberately not thrown: the whole API must still boot without push
      // configured (local dev, staging, any env that has not been given the
      // key). Loud enough to be impossible to miss in the Render log, and
      // every send below then no-ops with a single warning.
      this.logger.error(
        'FCM_SERVICE_ACCOUNT_B64 is not set — push notifications are DISABLED. ' +
          'Set it on Render (base64 of the service-account JSON) and redeploy.',
      );
      return;
    }

    let credential: ServiceAccount;
    try {
      const json = Buffer.from(b64, 'base64').toString('utf8');
      credential = JSON.parse(json);
    } catch (e: any) {
      // A malformed key IS fatal: the variable is set, so somebody intended
      // push to work, and silently disabling it would hide a broken deploy.
      throw new Error(
        `FCM_SERVICE_ACCOUNT_B64 is set but could not be decoded as base64 JSON: ${e?.message}. ` +
          'Re-encode the service-account file with `base64 -i key.json` and update the Render variable.',
      );
    }

    const projectId = (credential as any).project_id ?? (credential as any).projectId;
    const clientEmail = (credential as any).client_email ?? (credential as any).clientEmail;
    const privateKey = (credential as any).private_key ?? (credential as any).privateKey;
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'FCM_SERVICE_ACCOUNT_B64 decoded, but is not a service-account key ' +
          '(missing project_id / client_email / private_key).',
      );
    }

    try {
      // Named app so this never collides with any other firebase-admin use.
      this.app = initializeApp({ credential: cert(credential) }, 'aims-push');
      this.logger.log(`FCM initialised for project ${projectId}`);
    } catch (e: any) {
      throw new Error(`FCM initialisation failed for project ${projectId}: ${e?.message}`);
    }
  }

  /** True when a credential was supplied and the SDK came up. */
  get enabled(): boolean {
    return this.app !== null;
  }

  /**
   * Every ACTIVE field-tech in the org. Both joins matter: UserRole carries the
   * role and UserOrganization the membership, and either can be deactivated on
   * its own — a user whose membership was revoked but whose role row survives
   * must not be notified.
   */
  private async fieldTechUserIds(organizationId: string): Promise<string[]> {
    const roles = await this.prisma.userRole.findMany({
      where: { organizationId, isActive: true, role: { name: FIELD_ROLE } },
      select: { userId: true },
    });
    if (!roles.length) return [];
    const userIds = [...new Set(roles.map((r) => r.userId))];
    const members = await this.prisma.userOrganization.findMany({
      where: { organizationId, isActive: true, userId: { in: userIds } },
      select: { userId: true },
    });
    return [...new Set(members.map((m) => m.userId))];
  }

  /**
   * Push to every active field-tech in the org. Best-effort by contract: it
   * resolves to a summary and never throws, so a caller can await it without
   * putting a business transaction at the mercy of Google's uptime.
   */
  async sendToFieldTechs(
    organizationId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number; pruned: number; recipients: number; tokens: number }> {
    const empty = { sent: 0, failed: 0, pruned: 0, recipients: 0, tokens: 0 };
    try {
      if (!this.app) {
        this.logger.warn('push skipped — FCM is not configured (FCM_SERVICE_ACCOUNT_B64 unset)');
        return empty;
      }

      const userIds = await this.fieldTechUserIds(organizationId);
      if (!userIds.length) {
        this.logger.log(`push skipped — no active ${FIELD_ROLE} in org ${organizationId}`);
        return empty;
      }

      const rows = await this.prisma.deviceToken.findMany({
        where: { organizationId, userId: { in: userIds } },
        select: { id: true, token: true, userId: true },
      });
      if (!rows.length) {
        this.logger.log(
          `push skipped — ${userIds.length} ${FIELD_ROLE}(s) in org ${organizationId} but no registered device`,
        );
        return { ...empty, recipients: userIds.length };
      }

      const res = await getMessaging(this.app).sendEachForMulticast({
        tokens: rows.map((r) => r.token),
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high', notification: { channelId: 'aims-deliveries' } },
      });

      // Prune ONLY tokens FCM says are dead. A transient failure keeps its row.
      const deadIds: string[] = [];
      res.responses.forEach((r, i) => {
        if (r.success) return;
        const code = (r.error as any)?.code ?? '';
        if (DEAD_TOKEN_CODES.has(code)) deadIds.push(rows[i].id);
        else this.logger.warn(`push failed for one device (kept, transient): ${code || r.error?.message}`);
      });
      let pruned = 0;
      if (deadIds.length) {
        const del = await this.prisma.deviceToken.deleteMany({ where: { id: { in: deadIds } } });
        pruned = del.count;
        this.logger.log(`pruned ${pruned} dead device token(s)`);
      }

      const summary = {
        sent: res.successCount,
        failed: res.failureCount,
        pruned,
        recipients: userIds.length,
        tokens: rows.length,
      };
      this.logger.log(
        `push "${payload.title}" org=${organizationId}: ` +
          `${summary.sent}/${summary.tokens} delivered to ${summary.recipients} field-tech(s), ` +
          `${summary.failed} failed, ${summary.pruned} pruned`,
      );
      return summary;
    } catch (e: any) {
      // Never propagate: callers hook this onto business writes.
      this.logger.error(`push send failed outright: ${e?.message}`, e?.stack);
      return empty;
    }
  }
}
