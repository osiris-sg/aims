/**
 * WhatsApp staff notifications (ADH, round S, 2026-10-21) — the SEND side.
 *
 * Every minute: (1) at 08:30 JST, build each shipments org's morning digest and queue it per user
 * (a DIGEST row goes out as the APPROVED aims_digest / aims_digest_v2 template when the line has one — round AD:
 * decided from Meta's list, env vars only as overrides — else as plain text); (2) drain due QUEUED rows — one message per user with every due line in it —
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
import { isDigestTime, jstDay, SHIPMENTS_PUSH_KINDS_ON, shipmentRefOf } from './shipments-agent.rules';
import { answerBatchParamsOf, answerBatchText, batchText, DigestInput, digestTemplateParams, digestText, parseAnswerPush, renderTemplate, ANSWER_TEMPLATES, shortTask, stripEmoji } from './push-text';
import { EmailTriageService } from '../ingestion-email/email-triage.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { TemplateStatusService } from './template-status.service';

// Round AD: the template names come from TemplateStatusService (what Meta APPROVED on the sending line's WABA; v2
// preferred; the WHATSAPP_*_TEMPLATE env vars remain optional overrides). '' = plain text.
/** Round AD: the Dashboard link is a short one (https://app.ai-ms.io/go/<token>, 30 days, login required) — see ShortLinksService. */
const DASHBOARD_PATH = '/portal';

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
    private readonly links: ShortLinksService,
    private readonly templates: TemplateStatusService,
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
    if (!SHIPMENTS_PUSH_KINDS_ON.includes('DIGEST')) return; // round AE (owner): the digest is off — the code stays
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
      portalUrl: await this.links.url(org, DASHBOARD_PATH),
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
        const tpl = await this.templates.shipmentsTemplate('digest', lang, line).catch(() => '');
        const params = tpl ? digestTemplateParams(text, lang) : null;
        // The structured template when it exists and the text reads back into its 6 values; plain text otherwise.
        const ok = (tpl && params ? await this.whatsapp.sendTemplateLines(to, tpl, params, lang).catch(() => false) : false) || (await this.whatsapp.sendText(to, text).then(() => true).catch(() => false));
        await this.mark([d], ok, 'digest send failed');
        ok ? sent++ : failed++;
      }
      // Round AE (owner): the "needs your answer" pushes are ONE message family that looks the same everywhere — the
      // approved template when the line has it (inside or outside the 24h window), else the identical plain text inside
      // the window; outside it the row is HELD (kept QUEUED, retried) until the template is approved — never dropped.
      const needs = others.filter((r) => r.kind === 'NEEDS_ME');
      const rest = others.filter((r) => r.kind !== 'NEEDS_ME');
      if (needs.length) {
        const r = await this.sendAnswerPushes(org, to, line, needs, now);
        sent += r.sent;
        failed += r.failed;
      }
      if (rest.length) {
        const lang = rest.some((r) => /[぀-ヿ一-鿿]/.test(r.text)) ? 'ja' : 'en';
        const ok = await this.whatsapp.sendText(to, batchText(rest, lang, await this.links.url(org, DASHBOARD_PATH))).then(() => true).catch(() => false);
        await this.mark(rest, ok, 'text send failed');
        ok ? (sent += rest.length) : (failed += rest.length);
      }
    }
    if (sent || failed) this.logger.log(`outbox: sent ${sent}, failed ${failed}`);
    return { sent, failed };
  }

  /**
   * The answer pushes of one user due together. One row → its variant's template (values read back from the stored
   * text); several → the batch template (count, latest, link). Rows whose email is no longer open are SKIPPED.
   */
  private async sendAnswerPushes(org: string, to: string, line: string, rows: any[], now: Date): Promise<{ sent: number; failed: number }> {
    const live: any[] = [];
    for (const r of rows) {
      const logId = /^needs:([0-9a-f-]{36})/i.exec(r.dedupeKey ?? '')?.[1];
      const open = logId ? await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId: org, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, select: { id: true } }).catch(() => ({ id: logId })) : { id: null };
      if (logId && !open) await this.prisma.whatsAppOutbox.updateMany({ where: { id: { in: [r.id] } }, data: { status: 'SKIPPED', error: 'answered before it was sent' } });
      else live.push(r);
    }
    if (!live.length) return { sent: 0, failed: 0 };
    const parsed = live.map((r) => ({ r, p: parseAnswerPush(stripEmoji(r.text)) }));
    // The language is the push's own (its title), never the subject's script — an English push often carries a Japanese subject.
    const lang: 'en' | 'ja' = parsed.some((x) => x.p?.lang === 'ja') || (parsed.every((x) => !x.p) && parsed.some((x) => /[぀-ヿ一-鿿]/.test((x.r.text ?? '').split('\n')[0]))) ? 'ja' : 'en';
    let kind: 'answer' | 'answer_deal' | 'answer_is_shipment' | 'answer_recheck' | 'answer_batch';
    let params: string[];
    let text: string;
    if (live.length === 1 && parsed[0].p) {
      kind = parsed[0].p.variant;
      params = parsed[0].p.params;
      text = renderTemplate(ANSWER_TEMPLATES[kind][lang], params);
    } else if (live.length === 1) {
      // An older row (round X–AD layout): plain text as stored.
      kind = 'answer';
      params = [];
      text = stripEmoji(live[0].text);
    } else {
      const latest = [...parsed].sort((a, b) => new Date(b.r.createdAt).getTime() - new Date(a.r.createdAt).getTime())[0];
      const url = latest.p?.url ?? (await this.links.url(org, DASHBOARD_PATH));
      const who = latest.p ? { who: latest.p.who, when: latest.p.when, subject: latest.p.subject } : { who: '-', when: '-', subject: '-' };
      kind = 'answer_batch';
      params = answerBatchParamsOf(live.length, who, url);
      text = answerBatchText(live.length, who, url, lang);
    }
    const name = params.length ? await this.templates.answerTemplate(kind, lang, line).catch(() => '') : '';
    if (name && (await this.whatsapp.sendTemplateLines(to, name, params, lang).catch(() => false))) {
      await this.mark(live, true, '');
      return { sent: live.length, failed: 0 };
    }
    const res = await this.whatsapp.sendTextResult(to, text).catch((e: any) => ({ ok: false, code: null as number | null, message: String(e?.message ?? e) }));
    if (res.ok) {
      await this.mark(live, true, '');
      return { sent: live.length, failed: 0 };
    }
    if (res.code === 131047 || /re-?engagement/i.test(res.message ?? '')) {
      // The 24-hour window is closed and the template is not approved yet: hold, retry in 30 minutes, never drop.
      await this.prisma.whatsAppOutbox.updateMany({ where: { id: { in: live.map((r) => r.id) } }, data: { status: 'QUEUED', dueAt: new Date(now.getTime() + 30 * 60_000), error: `held: 24h window closed — waiting for the approved template ${name || 'aims_answer*'}` } });
      this.logger.log(`outbox: held ${live.length} answer push(es) for …${to.slice(-3)} until the template is approved`);
      return { sent: 0, failed: 0 };
    }
    await this.mark(live, false, `send failed${res.message ? `: ${res.message.slice(0, 120)}` : ''}`);
    return { sent: 0, failed: live.length };
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
