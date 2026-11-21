import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActionLogService } from '../../action-log/action-log.service';
import { PrismaService } from '../../common/prisma.service';
import { runAsOrg } from '../../common/tenancy/tenant-context';
import { fieldEngineLive } from '../common/field-flags';
import { FieldEngine } from './engine';

/**
 * Auto-close (siteclock src/jobs/autoclose.ts, every 15 min). Runs ONLY for orgs with enableFieldModule AND
 * fieldEngineLive (both default off): while SiteClock is the live clock-in engine, the Field tables hold a
 * shadow copy whose open days must never be closed by AIMS. Every other org: nothing is read or written.
 * Each close lands in the Activity Log as "System creation" (field-autoclose).
 */
@Injectable()
export class FieldAutoCloseCron {
  private readonly log = new Logger('FieldAutoClose');
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly actionLog: ActionLogService) {}

  /** The orgs the cron may touch. */
  async liveOrgs(): Promise<string[]> {
    const rows: Array<{ organizationId: string; features: any }> = await (this.prisma as any).organizationUIConfig.findMany({ select: { organizationId: true, features: true } });
    return rows.filter((r) => fieldEngineLive(r.features)).map((r) => r.organizationId);
  }

  @Cron('*/15 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const org of await this.liveOrgs()) {
        try {
          const engine = new FieldEngine(this.prisma as any);
          await runAsOrg(org, () => engine.autoCloseStaleEntries(org));
          for (const e of engine.events) this.actionLog.system('field-autoclose', 'AUTO_CLOSE', 'FieldTimeEntry', { organizationId: org, resourceId: e.entityId ?? undefined, details: { fieldAction: e.action, before: e.before, after: e.after } } as any);
        } catch (err: any) {
          this.log.warn(`auto-close failed for ${org}: ${err?.message ?? err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
