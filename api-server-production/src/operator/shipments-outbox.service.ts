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
import { isDigestTime, jstDay, shipmentRefOf } from './shipments-agent.rules';
import { batchText, DigestInput, digestTemplateParams, digestText, pushTemplateParams, PushTemplateKind, shortTask, stripEmoji } from './push-text';
import { EmailTriageService } from '../ingestion-email/email-triage.service';

const NOTIFY_TEMPLATE = () => process.env.WHATSAPP_NOTIFY_TEMPLATE || 'aims_notify';
/** Round X: a structured digest template (one variable per line), once Meta approves it; unset = send the digest as plain text (the closed-window recovery falls back to aims_notify / the bridge). */
const DIGEST_TEMPLATE = () => process.env.WHATSAPP_DIGEST_TEMPLATE || '';
/** The approved per-kind templates for a single "needs a check" push (aims_needs_check / aims_new_deal / aims_recheck); unset = plain text. */
const PUSH_TEMPLATE: Record<PushTemplateKind, () => string> = { needs_check: () => process.env.WHATSAPP_NEEDS_TEMPLATE || '', new_deal: () => process.env.WHATSAPP_NEW_DEAL_TEMPLATE || '', recheck: () => process.env.WHATSAPP_RECHECK_TEMPLATE || '' };
const PORTAL = () => `${process.env.PORTAL_URL || 'https://app.ai-ms.io'}/portal/shipments/dashboard`;

@Injectable()
export class ShipmentsOutboxService {
  private readonly logger = new Logger(ShipmentsOutboxService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: ShipmentsNotifyService,
    private readonly alerts: TradeAlertsService,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly triage: EmailTriageService,
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
          await this.notify.queue(org, 'DIGEST', this.digestFor(input, 'en'), { dedupeKey: `digest:${jstDay(now)}`, textFor: (prefs) => this.digestFor(input, prefs.lang), at: now });
        });
      } catch (e: any) {
        this.logger.warn(`digest for ${org} failed: ${e?.message}`);
      }
    }
  }

  /**
   * The digest's facts. Round X: the "need your check" number is the Dashboard's own (questions = threads waiting
   * for a person, and the emails behind them — the same query the portal and the "What needs me?" tool read), the
   * auto-filed emails are a COUNT only, tasks overdue are short, arrivals are soonest first.
   */
  async digestInput(org: string, now = new Date()): Promise<DigestInput> {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const today = tradeToday(now);
    const week = new Date(Date.parse(today) + 7 * 86_400_000);
    const [filed, dash, tasks, ships]: [number, { toConfirm: { emails: number; total: number } }, any[], any[]] = await Promise.all([
      this.prisma.emailIngestLog.count({ where: { organizationId: org, inboxState: 'PROCESSED', createdAt: { gte: since }, actions: { path: ['review', 'outcome'], equals: 'AUTO' } } }).catch(async () => {
        const rows: any[] = await this.prisma.emailIngestLog.findMany({ where: { organizationId: org, inboxState: 'PROCESSED', createdAt: { gte: since } }, select: { actions: true } });
        return rows.filter((e) => e.actions?.review?.outcome === 'AUTO').length;
      }),
      this.triage.dashboard(org, 'en'),
      this.alerts.myTasks(org, now),
      this.prisma.shipment.findMany({ where: { organizationId: org, status: 'OPEN', eta: { gte: new Date(today), lte: week }, NOT: { order: { isTest: true } } }, orderBy: { eta: 'asc' }, select: { id: true, seqNo: true, vessel: true, eta: true, order: { select: { orderNo: true } } } }),
    ]);
    const dueOf = (t: any) => new Date(t.dueAt).toISOString().slice(0, 10);
    return {
      at: now,
      filedAuto: filed,
      questions: dash.toConfirm.total,
      questionEmails: dash.toConfirm.emails,
      overdue: tasks.filter((t) => t.status === 'DUE' && dueOf(t) < today).map((t) => t.title as string),
      arriving: ships.map((s) => ({ ref: shipmentRefOf(s.order?.orderNo, s.seqNo), eta: s.eta })),
      portalUrl: PORTAL(),
    };
  }

  /** The digest in one language (the overdue titles shortened in that language). */
  digestFor(input: DigestInput, lang: 'en' | 'ja'): string {
    return digestText({ ...input, overdue: input.overdue.map((t) => shortTask(t, lang)) }, lang);
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
        // Round X: plain text keeps its lines (the closed-window recovery resends it via the bridge or aims_notify);
        // a structured digest template (WHATSAPP_DIGEST_TEMPLATE, one variable per line) is used once approved.
        const text = stripEmoji(d.text);
        const lang = /[぀-ヿ一-鿿]/.test(text) ? 'ja' : 'en';
        const tpl = DIGEST_TEMPLATE();
        const params = tpl ? digestTemplateParams(text, lang) : null;
        // The structured template when it exists and the text reads back into its 6 values; plain text otherwise.
        const ok = (tpl && params ? await this.whatsapp.sendTemplateLines(to, tpl, params, lang).catch(() => false) : false) || (await this.whatsapp.sendText(to, text).then(() => true).catch(() => false));
        await this.mark([d], ok, 'digest send failed');
        ok ? sent++ : failed++;
      }
      // Round X: a single "needs a check" push goes as its approved template when one is configured (lands outside
      // the 24h window too); batches and events go as one text (the closed-window recovery covers those).
      const asTemplate: any[] = [];
      const asText: any[] = [];
      for (const r of others) {
        const t = r.kind === 'NEEDS_ME' ? pushTemplateParams(stripEmoji(r.text)) : null;
        (t && PUSH_TEMPLATE[t.kind]() && others.filter((x) => x.kind === 'NEEDS_ME').length === 1 ? asTemplate : asText).push(r);
      }
      for (const r of asTemplate) {
        const t = pushTemplateParams(stripEmoji(r.text))!;
        const ok = (await this.whatsapp.sendTemplateLines(to, PUSH_TEMPLATE[t.kind](), t.params, t.lang).catch(() => false)) || (await this.whatsapp.sendText(to, stripEmoji(r.text)).then(() => true).catch(() => false));
        await this.mark([r], ok, 'push send failed');
        ok ? sent++ : failed++;
      }
      if (asText.length) {
        const lang = asText.some((r) => /[぀-ヿ一-鿿]/.test(r.text)) ? 'ja' : 'en';
        const others = asText;
        const ok = await this.whatsapp.sendText(to, batchText(others, lang, PORTAL())).then(() => true).catch(() => false);
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
