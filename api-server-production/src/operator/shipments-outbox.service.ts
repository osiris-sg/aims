/**
 * WhatsApp staff notifications (ADH, round S, 2026-10-21) — the SEND side.
 *
 * Every minute: (1) at 08:30 JST, build each shipments org's morning digest and queue it per user
 * (a DIGEST row goes out as the approved `aims_notify` utility template, so it lands outside the
 * 24-hour window); (2) drain due QUEUED rows — one message per user with every due line in it —
 * through the WhatsApp adapter, on the business line the user last wrote to (else the org's own
 * line). Quiet hours and the 10-minute batch were applied when the rows were queued.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { TradeAlertsService } from '../shipments/trade-alerts.service';
import { ShipmentsNotifyService } from '../shipments/shipments-notify.service';
import { tradeToday } from '../shipments/shipments.rules';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { batchText, DigestInput, digestText, isDigestTime, jstDateLabel, jstDay, shipmentRefOf } from './shipments-agent.rules';

const NOTIFY_TEMPLATE = () => process.env.WHATSAPP_NOTIFY_TEMPLATE || 'aims_notify';

@Injectable()
export class ShipmentsOutboxService {
  private readonly logger = new Logger(ShipmentsOutboxService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: ShipmentsNotifyService,
    private readonly alerts: TradeAlertsService,
    private readonly whatsapp: WhatsAppAdapter,
  ) {}

  @Cron('* * * * *')
  async tick() {
    if (this.running || process.env.WHATSAPP_OUTBOX_DISABLED === '1') return;
    this.running = true;
    try {
      const now = new Date();
      if (isDigestTime(now)) await this.digests(now);
      await this.drain(now);
    } catch (e: any) {
      this.logger.warn(`outbox tick failed: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  // ── digest ─────────────────────────────────────────────────────────────────

  /** Orgs with the SHIPMENTS module on (the flag is checked by queue()). */
  private async shipmentsOrgs(): Promise<string[]> {
    const rows: Array<{ organizationId: string }> = await this.prisma.organizationModule.findMany({ where: { moduleCode: 'SHIPMENTS', enabled: true }, select: { organizationId: true } }).catch(() => []);
    return [...new Set(rows.map((r) => r.organizationId))];
  }

  async digests(now = new Date()) {
    for (const org of await this.shipmentsOrgs()) {
      try {
        await runAsOrg(org, async () => {
          if (!(await this.notify.enabled(org))) return;
          const input = await this.digestInput(org, now);
          await this.notify.queue(org, 'DIGEST', digestText(input, 'en'), { dedupeKey: `digest:${jstDay(now)}`, textFor: (prefs) => digestText(input, prefs.lang), at: now });
        });
      } catch (e: any) {
        this.logger.warn(`digest for ${org} failed: ${e?.message}`);
      }
    }
  }

  /** The digest's facts: emails since yesterday's digest, tasks overdue / today, arrivals this week. */
  async digestInput(org: string, now = new Date()): Promise<DigestInput> {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const today = tradeToday(now);
    const week = new Date(Date.parse(today) + 7 * 86_400_000);
    const [emails, tasks, ships, orders, shipments]: [any[], any[], any[], any[], any[]] = await Promise.all([
      this.prisma.emailIngestLog.findMany({ where: { organizationId: org, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE', 'PROCESSED'] }, OR: [{ createdAt: { gte: since } }, { inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }] }, select: { id: true, subject: true, inboxState: true, orderId: true, shipmentId: true, actions: true, createdAt: true } }),
      this.alerts.myTasks(org, now),
      this.prisma.shipment.findMany({ where: { organizationId: org, status: 'OPEN', eta: { gte: new Date(today), lte: week }, NOT: { order: { isTest: true } } }, orderBy: { eta: 'asc' }, select: { id: true, seqNo: true, vessel: true, eta: true, order: { select: { orderNo: true } } } }),
      this.prisma.tradeOrder.findMany({ where: { organizationId: org }, select: { id: true, orderNo: true } }),
      this.prisma.shipment.findMany({ where: { organizationId: org }, select: { id: true, seqNo: true, order: { select: { orderNo: true } } } }),
    ]);
    const orderRef = new Map(orders.map((o) => [o.id, `#${o.orderNo}`]));
    const shipRef = new Map(shipments.map((s) => [s.id, shipmentRefOf(s.order?.orderNo, s.seqNo)]));
    const refOf = (e: any) => (e.shipmentId && shipRef.get(e.shipmentId)) || (e.orderId && orderRef.get(e.orderId)) || 'linked';
    const autoFiled = emails
      .filter((e) => e.inboxState === 'PROCESSED' && e.actions?.review?.outcome === 'AUTO' && e.createdAt >= since)
      .map((e) => {
        const files = (e.actions?.done ?? []).filter((a: any) => a.kind === 'file' && a.status === 'done');
        return { ref: refOf(e), what: files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : (e.actions?.autoLabel ?? 'linked').toString().slice(0, 30) };
      });
    const open = emails.filter((e) => e.inboxState !== 'PROCESSED');
    const noOrder = open.filter((e) => e.actions?.backlog?.kind === 'NO_ORDER').length;
    const dueOf = (t: any) => new Date(t.dueAt).toISOString().slice(0, 10);
    return {
      dateLabel: jstDateLabel(now),
      emails: { autoFiled, needsYou: open.length - noOrder, noOrder },
      tasks: { overdue: tasks.filter((t) => t.status === 'DUE' && dueOf(t) < today).map((t) => ({ title: t.title })), today: tasks.filter((t) => dueOf(t) === today).map((t) => ({ title: t.title })) },
      arriving: ships.map((s) => ({ ref: shipmentRefOf(s.order?.orderNo, s.seqNo), vessel: s.vessel, eta: new Date(s.eta).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) })),
      portalUrl: `${process.env.PORTAL_URL || 'https://app.ai-ms.io'}/portal/shipments/dashboard`,
    };
  }

  // ── drain ──────────────────────────────────────────────────────────────────

  async drain(now = new Date()) {
    const due: any[] = await this.prisma.whatsAppOutbox.findMany({ where: { status: 'QUEUED', dueAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 200 });
    if (!due.length) return { sent: 0, failed: 0 };
    const groups = new Map<string, any[]>();
    for (const r of due) {
      const k = `${r.organizationId}|${r.userId}|${r.to}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    let sent = 0;
    let failed = 0;
    for (const rows of groups.values()) {
      const { organizationId: org, to } = rows[0];
      const line = await this.lineFor(to, org);
      if (!line) {
        await this.prisma.whatsAppOutbox.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'FAILED', error: 'no WhatsApp line to send from' } });
        failed += rows.length;
        continue;
      }
      const digests = rows.filter((r) => r.kind === 'DIGEST');
      const others = rows.filter((r) => r.kind !== 'DIGEST');
      for (const d of digests) {
        const ok = await this.whatsapp.sendTemplate(to, NOTIFY_TEMPLATE(), d.text).catch(() => false);
        await this.mark([d], ok, 'template send failed');
        ok ? sent++ : failed++;
      }
      if (others.length) {
        const lang = others.some((r) => /[぀-ヿ一-鿿]/.test(r.text)) ? 'ja' : 'en';
        const ok = await this.whatsapp.sendText(to, batchText(others, lang)).then(() => true).catch(() => false);
        await this.mark(others, ok, 'text send failed');
        ok ? (sent += others.length) : (failed += others.length);
      }
    }
    if (sent || failed) this.logger.log(`outbox: sent ${sent}, failed ${failed}`);
    return { sent, failed };
  }

  private async mark(rows: any[], ok: boolean, err: string) {
    await this.prisma.whatsAppOutbox.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: ok ? { status: 'SENT', sentAt: new Date() } : { status: 'FAILED', error: err } });
  }

  /**
   * The business line to send from: the one this number last wrote to (ADH staff talk to the shared
   * Osiris line — the org itself may own no line), else the org's own connected line.
   */
  private async lineFor(to: string, organizationId: string): Promise<string | null> {
    const last = await this.prisma.whatsAppMessage.findFirst({ where: { counterparty: to, direction: 'INBOUND', phoneNumberId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { phoneNumberId: true } }).catch(() => null);
    if (last?.phoneNumberId) {
      const conn = await this.prisma.whatsAppConnection.findFirst({ where: { phoneNumberId: last.phoneNumberId, status: 'CONNECTED' }, select: { phoneNumberId: true } });
      if (conn) {
        this.whatsapp.rememberContext(to, conn.phoneNumberId);
        return conn.phoneNumberId;
      }
    }
    const own = await this.prisma.whatsAppConnection.findFirst({ where: { organizationId, status: 'CONNECTED' }, orderBy: { isPrimary: 'desc' }, select: { phoneNumberId: true } });
    if (own) {
      this.whatsapp.rememberContext(to, own.phoneNumberId);
      return own.phoneNumberId;
    }
    return null;
  }
}
