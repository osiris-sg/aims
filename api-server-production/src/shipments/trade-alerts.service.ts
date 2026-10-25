import { ALERTABLE_ORDER, isTestRecord, isUnconfirmed, mutedRecordIds } from './trade-test-orders';
import { freeTimeLine, stepOverdueLine } from '../operator/push-text';
import { ShipmentsNotifyService } from './shipments-notify.service';
import { CUSTOM_KIND, STANDING_KINDS } from './trade-alerts';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionLogService } from '../action-log/action-log.service';
import { orderLabel, shipmentRef, stepLabel, supplierOrderLabel, tradeToday } from './shipments.rules';
import {
  alertRulesOf,
  AlertRules,
  DepositFacts,
  InvoiceFacts,
  planDepositAlert,
  PlannedAlert,
  planInvoiceAlert,
  planShipmentAlerts,
  planStuckAlert,
  receiptNotTracked,
  reconcileAlert,
  ShipmentFacts,
  StepFacts,
} from './trade-alerts';
import { depositDueDate } from './trade-deposit';
import { generatedInvoiceTotal } from './trade-payments.service';
import { stepPaymentOf } from './trade-payments';
import { IMPORT_NOTE } from './trade-open-orders';

const ALERT_SELECT = { id: true, kind: true, key: true, dueAt: true, title: true, detail: true, shipmentId: true, orderId: true, supplierOrderId: true, linkUrl: true, status: true, notifiedAt: true, resolvedAt: true, updatedAt: true };

/**
 * Alerts and reminders (2026-10): an hourly sweep plans every reminder from
 * the open records' dates (trade-alerts.ts), stores them as TradeAlert rows by
 * key (a moved ETA re-schedules; a finished task resolves), sends due ones to
 * the bell once, and mails ADH staff a daily digest (AIMS users only).
 */
@Injectable()
export class TradeAlertsService {
  private readonly logger = new Logger(TradeAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly actionLog: ActionLogService,
    @Optional() private readonly clerkIdentity?: ClerkIdentityService,
    @Optional() private readonly whatsapp?: ShipmentsNotifyService,
  ) {}

  private async rules(organizationId: string): Promise<AlertRules> {
    const row = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { alertRules: true } });
    return alertRulesOf(row?.alertRules);
  }

  /** What should exist now for one org (pure planning over its facts). */
  async plan(organizationId: string, now = new Date()): Promise<PlannedAlert[]> {
    const rules = await this.rules(organizationId);
    const out: PlannedAlert[] = [];
    // Shipments: CI received → tax funding / A/N; discharge / ETA → free time.
    const ships: any[] = await this.prisma.shipment.findMany({
      // Round N: no reminders for test orders; round AB: nor for unconfirmed ones ("status" in checkFields).
      where: { organizationId, status: 'OPEN', orderId: { not: null }, order: ALERTABLE_ORDER },
      select: {
        id: true,
        seqNo: true,
        status: true,
        orderId: true,
        eta: true,
        dischargeDate: true,
        detFreeDays: true,
        demFreeDays: true,
        ciAmount: true,
        costs: true,
        order: { select: { orderNo: true } },
        fileLinks: { select: { file: { select: { docType: true } } } },
        steps: { select: { code: true, status: true, skipReason: true } },
      },
    });
    for (const s of ships) {
      const types = new Set(s.fileLinks.map((l: { file: { docType: string } }) => l.file.docType));
      const step = (code: string) => s.steps.find((x: { code: string }) => x.code === code)?.status;
      // Imported from ADH's task list at step 9 or later (step 8 marked done "before AIMS"): the cargo has left the port.
      const importedPast9 = s.steps.some((x: { code: string; status: string; skipReason: string | null }) => x.code === 'TAX_FUNDS' && x.status === 'DONE' && x.skipReason === IMPORT_NOTE);
      const costs = (s.costs ?? {}) as Record<string, unknown>;
      const facts: ShipmentFacts = {
        id: s.id,
        ref: shipmentRef(s.order?.orderNo, s.seqNo) || 'Shipment',
        orderId: s.orderId,
        status: s.status,
        eta: s.eta,
        dischargeDate: s.dischargeDate,
        detFreeDays: s.detFreeDays,
        demFreeDays: s.demFreeDays,
        hasCi: types.has('CI') || s.ciAmount !== null,
        hasAn: types.has('ARRIVAL_NOTICE'),
        taxFunded: step('TAX_FUNDS') === 'DONE' || typeof costs.importTaxFunded === 'number',
        // Past the port once step 9 (A/N + delivery instructions) is done — no free-time warnings after that.
        cleared: step('AN_INSTRUCTIONS') === 'DONE' || importedPast9,
      };
      out.push(...planShipmentAlerts(facts, rules));
    }
    // Customer invoices: due date until paid (round H: the receipt is on the step — 2 for Invoice #1, 11 for Invoice #2 / single).
    const receipts: Array<{ orderId: string | null; code: string; payment: unknown; skipReason: string | null }> = await this.prisma.tradeStep.findMany({
      where: { organizationId, orderId: { not: null }, shipmentId: null, code: { in: ['INVOICE_1', 'INVOICE_2'] } },
      select: { orderId: true, code: true, payment: true, skipReason: true },
    });
    const receiptStep = (orderId: string | null, code: string) => receipts.find((r) => r.orderId === orderId && r.code === code);
    const invs: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE'] } },
      select: { id: true, docType: true, number: true, header: true, rows: true, orderId: true, shipmentId: true, order: { select: { status: true, isTest: true, checkFields: true, customer: { select: { name: true } } } }, shipment: { select: { orderId: true, order: { select: { status: true, isTest: true, checkFields: true, customer: { select: { name: true } } } } } } },
    });
    for (const g of invs) {
      const total = generatedInvoiceTotal(g);
      if (total <= 0) continue; // credit notes are not collected
      const orderId = g.orderId ?? g.shipment?.orderId ?? null;
      const order = g.order ?? g.shipment?.order ?? null;
      if (order?.isTest || isUnconfirmed(order)) continue; // round AB: no reminders for test / unconfirmed orders
      const step = receiptStep(orderId, g.docType === 'INVOICE_1' ? 'INVOICE_1' : 'INVOICE_2');
      const paid = stepPaymentOf(step?.payment)?.amount ?? 0;
      const facts: InvoiceFacts = {
        id: g.id,
        number: g.number ?? 'invoice',
        customerName: order?.customer?.name ?? null,
        dueDate: g.header?.dueDate ? new Date(g.header.dueDate) : null,
        total,
        paid,
        currency: 'USD',
        orderId,
        shipmentId: g.shipmentId ?? null,
        // Round O: history keyed in without receipts (closed order / imported step) is not chased.
        imported: receiptNotTracked({ orderStatus: order?.status ?? null, stepSkipReason: step?.skipReason ?? null, paid }),
      };
      const a = planInvoiceAlert(facts);
      if (a) out.push(a);
    }
    // Supplier deposits: PI date + the order's deposit term, until paid (step 1 done / paid).
    const deposits: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, status: 'OPEN', ...ALERTABLE_ORDER, piDate: { not: null } },
      select: { id: true, year: true, orderNo: true, piNo: true, piDate: true, depositPaidAt: true, depositDueDays: true, depositDueUnit: true, steps: { where: { code: 'PI_PAYMENT' }, select: { status: true, notApplicable: true, payment: true } } },
    });
    for (const o of deposits) {
      const st = o.steps[0];
      if (!st || st.notApplicable) continue;
      const due = depositDueDate(o.piDate, o.depositDueDays ?? 5, o.depositDueUnit ?? 'BUSINESS');
      const facts: DepositFacts = { orderId: o.id, label: `${orderLabel(o)}${o.piNo ? ` PI ${o.piNo}` : ''}`, dueDate: due ? new Date(due) : null, paid: !!o.depositPaidAt || !!stepPaymentOf(st.payment) || st.status === 'DONE' };
      const a = planDepositAlert(facts);
      if (a) out.push(a);
    }
    // Steps that haven't moved for N days (open records only).
    const cutoff = new Date(now.getTime() - rules.stuckDays * 86_400_000);
    const stuck: any[] = rules.stuckDays
      ? await this.prisma.tradeStep.findMany({
          where: { organizationId, status: 'IN_PROGRESS', notApplicable: false, isOngoing: false, updatedAt: { lt: cutoff } },
          take: 200,
          select: {
            id: true,
            title: true,
            displayNo: true,
            updatedAt: true,
            shipmentId: true,
            orderId: true,
            supplierOrderId: true,
            shipment: { select: { status: true, seqNo: true, orderId: true, order: { select: { orderNo: true } } } },
            order: { select: { status: true, year: true, orderNo: true } },
            supplierOrder: { select: { status: true, soNo: true, piNo: true } },
          },
        })
      : [];
    const test = stuck.length ? await mutedRecordIds(this.prisma, organizationId) : null;
    for (const st of stuck) {
      const open = (st.shipment?.status ?? st.order?.status ?? st.supplierOrder?.status) === 'OPEN';
      if (!open) continue;
      if (test && isTestRecord(test, { orderId: st.orderId ?? st.shipment?.orderId, shipmentId: st.shipmentId })) continue;
      const recordRef = st.shipment ? shipmentRef(st.shipment.order?.orderNo, st.shipment.seqNo) : st.order ? orderLabel(st.order) : supplierOrderLabel(st.supplierOrder);
      const facts: StepFacts = { id: st.id, label: stepLabel(st), recordRef, updatedAt: st.updatedAt, shipmentId: st.shipmentId, orderId: st.orderId ?? st.shipment?.orderId ?? null, supplierOrderId: st.supplierOrderId };
      const a = planStuckAlert(facts, rules, now);
      if (a) out.push(a);
    }
    return out;
  }

  /**
   * Reconcile one org: create / re-schedule / resolve TradeAlert rows by key;
   * stuck-step alerts no longer planned are resolved too. Returns counts.
   */
  async sweep(organizationId: string, now = new Date()) {
    const planned = await this.plan(organizationId, now);
    const existing: any[] = await this.prisma.tradeAlert.findMany({ where: { organizationId, status: { in: ['SCHEDULED', 'DUE', 'DISMISSED'] } }, select: ALERT_SELECT });
    const byKey = new Map(existing.map((a) => [a.key, a]));
    let created = 0;
    let updated = 0;
    for (const p of planned) {
      const cur = byKey.get(p.key) ?? (await this.prisma.tradeAlert.findFirst({ where: { organizationId, key: p.key }, select: ALERT_SELECT }));
      byKey.delete(p.key);
      const r = reconcileAlert(cur ?? null, p, now);
      const data = {
        kind: p.kind,
        dueAt: p.dueAt,
        title: p.title,
        detail: p.detail,
        shipmentId: p.shipmentId ?? null,
        orderId: p.orderId ?? null,
        supplierOrderId: p.supplierOrderId ?? null,
        linkUrl: p.linkUrl,
        status: r.status,
        ...(r.status === 'DONE' ? { resolvedAt: now } : {}),
        ...(r.resetNotified ? { notifiedAt: null } : {}),
      };
      if (r.action === 'create') {
        await this.prisma.tradeAlert.create({ data: { organizationId, key: p.key, ...data } });
        created++;
      } else if (r.action === 'update') {
        await this.prisma.tradeAlert.update({ where: { id: cur.id }, data });
        updated++;
      }
    }
    // Planned no more (record closed, step moved on): resolved.
    for (const left of byKey.values()) {
      if (left.status === 'DONE' || STANDING_KINDS.has(left.kind)) continue; // round T: a person's own reminder is not the planner's to close
      await this.prisma.tradeAlert.update({ where: { id: left.id }, data: { status: 'DONE', resolvedAt: now } });
      updated++;
    }
    const notified = await this.notifyDue(organizationId, now);
    return { planned: planned.length, created, updated, notified };
  }

  /** Due alerts go to the bell once (re-sent only when their date moves). */
  private async notifyDue(organizationId: string, now: Date) {
    const due: any[] = await this.prisma.tradeAlert.findMany({ where: { organizationId, status: 'DUE', notifiedAt: null }, select: ALERT_SELECT, take: 100 });
    for (const a of due) {
      await this.notifications.emit({ organizationId, kind: 'TRADE_ALERT', title: a.title, body: a.detail, entityType: 'trade-alert', entityId: a.id, linkUrl: a.linkUrl });
      await this.prisma.tradeAlert.update({ where: { id: a.id }, data: { notifiedAt: now } });
      // Round S: free time ending / a stuck step also reach the linked staff on WhatsApp (batched, quiet hours).
      if (this.whatsapp && (a.kind === 'FREE_TIME' || a.kind === 'STEP_STUCK')) {
        // Round X: one plain line, no emojis: "#14-1 detention free time ended 20 Oct, check costs" / "#21-1 step overdue: Customs tax estimate".
        const ref = /^(#\d+(?:-\d+)?)/.exec(a.title)?.[1] ?? a.title.split(':')[0];
        const rest = a.title.replace(/^#\d+(?:-\d+)?\s*[:：]?\s*/, '');
        const line = (lang: 'en' | 'ja') => (a.kind === 'FREE_TIME' ? freeTimeLine(ref, /demurrage/i.test(a.title) ? 'demurrage' : 'detention', a.dueAt, lang) : stepOverdueLine(ref, rest.replace(/\s*\(.*\)\s*$/, ''), lang));
        await this.whatsapp.queue(organizationId, 'EVENT', line('en'), { linkUrl: a.linkUrl, dedupeKey: `alert:${a.id}:${a.dueAt.toISOString().slice(0, 10)}`, textFor: (p) => line(p.lang) });
      }
    }
    return due.length;
  }

  /** Every org with trade settings, hourly. */
  @Cron('11 * * * *')
  async hourly() {
    const orgs: Array<{ organizationId: string; alertRules: unknown }> = await this.prisma.tradeSetting.findMany({ select: { organizationId: true, alertRules: true } });
    const now = new Date();
    for (const o of orgs) {
      try {
        const r = await runAsOrg(o.organizationId, () => this.sweep(o.organizationId, now));
        if (r.created || r.notified) this.actionLog.system('trade-alerts', 'UPDATE', 'TradeAlert', { organizationId: o.organizationId, details: r });
        const rules = alertRulesOf(o.alertRules);
        if (rules.digestEnabled && jstHour(now) === rules.digestHourJst) await runAsOrg(o.organizationId, () => this.digest(o.organizationId, now));
      } catch (e) {
        this.logger.warn(`alert sweep failed for ${o.organizationId}: ${(e as Error)?.message}`);
      }
    }
  }

  /** The daily digest to ADH staff (users holding shipments:read in the org) — AIMS's own mailer. */
  async digest(organizationId: string, now = new Date()) {
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const test = await mutedRecordIds(this.prisma, organizationId);
    const alerts: any[] = (
      await this.prisma.tradeAlert.findMany({
        where: { organizationId, status: { in: ['DUE', 'SCHEDULED'] }, dueAt: { lte: soon } },
        orderBy: { dueAt: 'asc' },
        select: ALERT_SELECT,
      })
    ).filter((a: any) => !isTestRecord(test, a));
    if (!alerts.length) return { sent: 0, alerts: 0 };
    const holders: Array<{ userId: string }> = await this.prisma.userRole.findMany({
      where: { organizationId, isActive: true, role: { permissions: { some: { name: 'shipments:read' } } } },
      select: { userId: true },
    });
    const emails = await this.emailsOf([...new Set(holders.map((h) => h.userId))]);
    const to = [...new Set(emails.filter((e) => !/@osiris\.sg$/i.test(e)))];
    if (!to.length) return { sent: 0, alerts: alerts.length };
    const base = process.env.PORTAL_URL || 'https://app.ai-ms.io';
    const row = (a: any) =>
      `<tr><td style="padding:4px 8px;white-space:nowrap">${a.dueAt.toISOString().slice(0, 10)}</td><td style="padding:4px 8px">${a.status === 'DUE' ? '<b>due</b>' : 'soon'}</td><td style="padding:4px 8px">${esc(a.title)}${a.detail ? `<br><span style="color:#666">${esc(a.detail)}</span>` : ''}${a.linkUrl ? ` — <a href="${base}${a.linkUrl}">open</a>` : ''}</td></tr>`;
    const html = `<p>Today's shipment tasks (${tradeToday()}):</p><table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">${alerts.map(row).join('')}</table><p style="color:#888;font-size:12px">AIMS daily digest — change it in Org Settings → Shipping → Alerts.</p>`;
    const r = await this.email.sendSimpleEmail({ to, subject: `AIMS · ${alerts.filter((a) => a.status === 'DUE').length} due, ${alerts.filter((a) => a.status !== 'DUE').length} coming up`, html });
    this.actionLog.system('trade-alerts-digest', 'SEND', 'TradeAlert', { organizationId, details: { to: to.length, alerts: alerts.length, ok: r.success } });
    return { sent: r.success ? to.length : 0, alerts: alerts.length };
  }

  /** Users' primary e-mail addresses (Clerk holds them). */
  private async emailsOf(userIds: string[]): Promise<string[]> {
    if (!userIds.length || !this.clerkIdentity) return [];
    try {
      // DB ids -> Clerk users (by external_id, then id); see src/clerk.
      const list = [...(await this.clerkIdentity.toClerkUsers(userIds)).values()];
      return list.map((u) => u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress).filter((e: unknown): e is string => typeof e === 'string');
    } catch (e) {
      this.logger.warn(`digest recipients: ${(e as Error)?.message}`);
      return [];
    }
  }

  // ── API ─────────────────────────────────────────────────────────────────
  async list(organizationId: string, q: { status?: string; shipmentId?: string; orderId?: string }) {
    const statuses = q.status === 'all' ? undefined : q.status ? q.status.split(',') : ['DUE', 'SCHEDULED'];
    const rows: any[] = await this.prisma.tradeAlert.findMany({
      where: { organizationId, ...(statuses ? { status: { in: statuses } } : {}), ...(q.shipmentId ? { shipmentId: q.shipmentId } : {}), ...(q.orderId ? { orderId: q.orderId } : {}) },
      orderBy: { dueAt: 'asc' },
      take: 300,
      select: ALERT_SELECT,
    });
    // A record's own alerts always show; the org-wide list leaves test orders out (round N).
    if (q.shipmentId || q.orderId) return rows;
    const test = await mutedRecordIds(this.prisma, organizationId);
    return rows.filter((a) => !isTestRecord(test, a));
  }

  /** "My tasks today": due now and the next 3 days. */
  async myTasks(organizationId: string, now = new Date()) {
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const test = await mutedRecordIds(this.prisma, organizationId);
    const rows: any[] = await this.prisma.tradeAlert.findMany({ where: { organizationId, status: { in: ['DUE', 'SCHEDULED'] }, dueAt: { lte: soon } }, orderBy: { dueAt: 'asc' }, take: 100, select: ALERT_SELECT });
    return rows.filter((a) => !isTestRecord(test, a));
  }

  /** Round T: a reminder a person set (WhatsApp "remind me …"); shows in the bell and the digest like any task. */
  async createCustom(organizationId: string, input: { title: string; dueAt: Date; detail?: string | null; orderId?: string | null; shipmentId?: string | null; linkUrl?: string | null; by?: string | null }) {
    const key = `CUSTOM:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    return this.prisma.tradeAlert.create({ data: { organizationId, key, kind: CUSTOM_KIND, dueAt: input.dueAt, title: input.title.slice(0, 200), detail: (input.detail ?? (input.by ? `Set by ${input.by}` : null))?.slice(0, 500) ?? null, orderId: input.orderId ?? null, shipmentId: input.shipmentId ?? null, linkUrl: input.linkUrl ?? null, status: input.dueAt <= new Date() ? 'DUE' : 'SCHEDULED' }, select: ALERT_SELECT });
  }

  /** Round T: push a task's due date (snooze). A planned alert moves until the next sweep re-plans it; a CUSTOM one stays moved. */
  async snooze(organizationId: string, id: string, until: Date) {
    const a = await this.prisma.tradeAlert.findFirst({ where: { id, organizationId }, select: { id: true, status: true } });
    if (!a) throw new NotFoundException('Alert not found');
    return this.prisma.tradeAlert.update({ where: { id }, data: { dueAt: until, status: until <= new Date() ? 'DUE' : 'SCHEDULED', notifiedAt: null }, select: ALERT_SELECT });
  }

  async setStatus(organizationId: string, id: string, status: 'DONE' | 'DISMISSED') {
    const a = await this.prisma.tradeAlert.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!a) throw new NotFoundException('Alert not found');
    return this.prisma.tradeAlert.update({ where: { id }, data: { status, resolvedAt: new Date() }, select: ALERT_SELECT });
  }

  /** Re-plan one org now (after an ETA change, or "Refresh"). Never throws. */
  async refresh(organizationId: string) {
    try {
      return await this.sweep(organizationId);
    } catch (e) {
      this.logger.warn(`alert refresh failed: ${(e as Error)?.message}`);
      return null;
    }
  }
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** The hour in Tokyo (UTC+9, no DST). */
const jstHour = (d: Date) => (d.getUTCHours() + 9) % 24;
