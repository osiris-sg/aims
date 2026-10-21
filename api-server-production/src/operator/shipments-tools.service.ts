/**
 * WhatsApp shipments agent (ADH, round S, 2026-10-21) — the ONLY tools the agent has for a
 * shipments org. Reads need `shipments:read`; every write needs `shipments:update` AND comes back
 * as a Confirm / Cancel card (PendingAction kind 'shipments') that runPending() executes after the
 * tap. There is no free-form API or database access here on purpose: message text is data.
 *
 * Audit: every write lands in the Activity Log as the user, channel chat:whatsapp, via 'whatsapp';
 * inbox reviews carry `review.via = 'whatsapp'`.
 */
import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { ActionLogService } from '../action-log/action-log.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { EmailTriageService } from '../ingestion-email/email-triage.service';
import { emailFolder, reconstructEml, safeKeyName, StoredAttachment, StoredEmailMeta } from '../ingestion-email/email-store';
import { alertRulesOf } from '../shipments/trade-alerts';
import { TradeAlertsService } from '../shipments/trade-alerts.service';
import { TradeFilesService } from '../shipments/trade-files.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { currentStepOf, freeTimeLeft, missingDocTypes, shipmentTab, tradeToday } from '../shipments/shipments.rules';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorContext, PendingAction, WebUiEvent } from './operator.types';
import { parseRecordRef, shipmentRefOf } from './shipments-agent.rules';

export interface ShipToolOutcome {
  result: any;
  pending?: PendingAction;
  preview?: { documentId?: string; url: string; filename: string; caption: string };
  choice?: { question: string; options: string[] };
  /** Never set here (web panels are not part of this profile); typed so the Operator loop treats both outcomes alike. */
  ui?: WebUiEvent;
}

interface ToolDef {
  name: string;
  description: string;
  permissions: string[];
  input_schema: Anthropic.Tool['input_schema'];
  run: (ctx: OperatorContext, args: any) => Promise<ShipToolOutcome>;
}

/** The write operations a Confirm card can carry (the model never names these; the tools do). */
export type ShipOp = 'email_accept' | 'email_assign' | 'email_dismiss' | 'task_status' | 'set_eta' | 'add_note';

export const SHIPMENTS_READ = 'shipments:read';
export const SHIPMENTS_WRITE = 'shipments:update';

const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const dmy = (d: Date | string | null | undefined) => {
  const s = ymd(d);
  if (!s) return null;
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const step = (s: { label?: string; title?: string } | null | undefined) => s?.label ?? s?.title ?? 'done';

@Injectable()
export class ShipmentsToolsService {
  private readonly logger = new Logger(ShipmentsToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: OperatorAuthService,
    private readonly triage: EmailTriageService,
    private readonly alerts: TradeAlertsService,
    private readonly files: TradeFilesService,
    private readonly shipments: ShipmentsService,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
    private readonly actionLog: ActionLogService,
  ) {}

  /** Tool definitions handed to Claude — only the ones this user's permissions allow. */
  definitions(ctx: OperatorContext): Anthropic.Tool[] {
    return this.tools()
      .filter((t) => this.auth.hasPermission(ctx, t.permissions))
      .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  names(): string[] {
    return this.tools().map((t) => t.name);
  }

  async execute(ctx: OperatorContext, name: string, args: any): Promise<ShipToolOutcome> {
    const tool = this.tools().find((t) => t.name === name);
    if (!tool) return { result: { error: `No such tool: ${name}` } };
    if (!this.auth.hasPermission(ctx, tool.permissions)) return { result: { error: `You do not have permission for ${name} (${tool.permissions.join(', ')})` } };
    try {
      return await tool.run(ctx, args || {});
    } catch (e: any) {
      this.logger.error(`tool ${name} failed: ${e?.message}`);
      return { result: { error: e?.response?.message ?? e?.message ?? 'Tool failed' } };
    }
  }

  // ── Confirmed writes ───────────────────────────────────────────────────────

  /** The tapped Confirm: run the held operation as the user. Permission is re-checked here, not only at hold time. */
  async runPending(ctx: OperatorContext, pending: PendingAction): Promise<{ ok: boolean; message: string }> {
    if (!this.auth.hasPermission(ctx, [SHIPMENTS_WRITE])) return { ok: false, message: 'You no longer have permission to change shipments.' };
    const a = (pending.args ?? {}) as { op: ShipOp } & Record<string, any>;
    const actor = this.actorOf(ctx);
    const org = ctx.organizationId;
    switch (a.op) {
      case 'email_accept': {
        const row: any = await this.triage.accept(org, a.emailId, actor);
        this.log(ctx, 'UPDATE', 'EmailIngestLog', a.emailId, subject60(row?.subject), `accepted the intake's link (${row?.matched ?? 'link'})`);
        return { ok: true, message: `${subject60(row?.subject)} → ${row?.matched ?? 'linked'}${this.filedLine(row)}` };
      }
      case 'email_assign': {
        const row: any = await this.triage.assign(org, a.emailId, { orderId: a.orderId ?? null, shipmentId: a.shipmentId ?? null, accept: true }, actor);
        this.log(ctx, 'UPDATE', 'EmailIngestLog', a.emailId, subject60(row?.subject), `linked to ${a.ref}`);
        return { ok: true, message: `${subject60(row?.subject)} → ${a.ref}${this.filedLine(row)}` };
      }
      case 'email_dismiss': {
        await this.triage.dismiss(org, a.emailId, actor);
        this.log(ctx, 'UPDATE', 'EmailIngestLog', a.emailId, a.subject, 'marked not a shipment email');
        return { ok: true, message: `"${a.subject}" marked as not a shipment email.` };
      }
      case 'task_status': {
        const r: any = await this.alerts.setStatus(org, a.taskId, a.status === 'DISMISSED' ? 'DISMISSED' : 'DONE');
        this.log(ctx, 'UPDATE', 'TradeAlert', a.taskId, r?.title, a.status === 'DISMISSED' ? 'dismissed' : 'marked done');
        return { ok: true, message: `${r?.title ?? 'Task'} ${a.status === 'DISMISSED' ? 'dismissed' : 'marked done'}.` };
      }
      case 'set_eta': {
        const dto: any = { etaSource: 'whatsapp' };
        if (a.eta) dto.eta = a.eta;
        if (a.arrived) dto.actualArrivalDate = a.arrived;
        await this.shipments.update(org, a.shipmentId, dto, actor);
        this.log(ctx, 'UPDATE', 'Shipment', a.shipmentId, a.ref, [a.eta ? `ETA ${a.eta}` : null, a.arrived ? `arrived ${a.arrived}` : null].filter(Boolean).join(', '));
        return { ok: true, message: `${a.ref}: ${[a.eta ? `ETA ${dmy(a.eta)}` : null, a.arrived ? `arrived ${dmy(a.arrived)}` : null].filter(Boolean).join(', ')}.` };
      }
      case 'add_note': {
        const cur = await this.prisma.shipment.findFirst({ where: { id: a.shipmentId, organizationId: org }, select: { notes: true } });
        const stamp = `[${tradeToday()} ${actor.name ?? 'WhatsApp'} via WhatsApp]`;
        const notes = `${cur?.notes ? `${cur.notes}\n` : ''}${stamp} ${String(a.note).slice(0, 1000)}`.slice(0, 5000);
        await this.shipments.update(org, a.shipmentId, { notes } as any, actor);
        this.log(ctx, 'UPDATE', 'Shipment', a.shipmentId, a.ref, `note added: ${String(a.note).slice(0, 120)}`);
        return { ok: true, message: `Note added to ${a.ref}.` };
      }
      default:
        return { ok: false, message: 'That card is not one I can run.' };
    }
  }

  // ── Inbound files (same intake as email) ───────────────────────────────────

  /**
   * A PDF / photo sent on WhatsApp goes through the SAME pipeline as an email attachment: stored like a
   * store-only email (source whatsapp), then triaged (rules → per-attachment keys → thread reasoner →
   * backlog rules, PARTIAL_AUTO guards). The caller turns the result into a Confirm card.
   */
  async intakeFile(ctx: OperatorContext, file: { dataUri: string; mimetype: string; filename?: string }, caption: string, providerMessageId?: string) {
    const org = ctx.organizationId;
    const who = ctx.actor.name || ctx.actor.email || ctx.channelUserId;
    const messageId = `<whatsapp-${providerMessageId || randomUUID()}@aims>`;
    const base64 = file.dataUri.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    const name = safeKeyName(file.filename, `whatsapp-${Date.now()}.${file.mimetype.includes('pdf') ? 'pdf' : 'jpg'}`);
    const log = await this.prisma.emailIngestLog.create({
      data: {
        organizationId: org,
        messageId,
        fromAddress: `"${who.replace(/"/g, '')} via WhatsApp" <${slug(who)}@whatsapp>`,
        subject: (caption || file.filename || name).slice(0, 200),
        status: 'RECEIVED',
        reason: null,
        attachmentCount: 1,
        rawMeta: { to: 'whatsapp', hasText: !!caption, attachmentNames: [name], source: 'whatsapp' },
      },
    });
    const folder = emailFolder(org, log.id, log.createdAt);
    const key = `${folder}attachments/${name}`;
    await this.s3.uploadFile(key, buf, file.mimetype || 'application/octet-stream');
    const attachments: StoredAttachment[] = [{ name: file.filename || name, contentType: file.mimetype || 'application/octet-stream', size: buf.length, key }];
    const eml = reconstructEml({ from: `${who} via WhatsApp <${slug(who)}@whatsapp>`, to: 'whatsapp', subject: log.subject ?? name, date: log.createdAt.toISOString(), messageId, text: caption || '', attachments: [{ contentType: attachments[0].contentType, contentBase64: base64, filename: attachments[0].name }] });
    const emlKey = `${folder}message.eml`;
    await this.s3.uploadFile(emlKey, eml, 'message/rfc822');
    const meta = {
      mode: 'STORE',
      to: 'whatsapp',
      envelopeFrom: null,
      date: log.createdAt.toISOString(),
      messageId,
      emlKey,
      emlSource: 'reconstructed',
      emlSize: eml.length,
      attachmentNames: [attachments[0].name],
      attachments,
      skippedAttachments: [],
      headerTo: [],
      cc: [],
      inReplyTo: null,
      references: [],
      bodyText: (caption || '').slice(0, 8000),
      source: 'whatsapp',
      sentBy: { userId: ctx.actor.id, name: who, channel: 'whatsapp' },
    } as unknown as StoredEmailMeta;
    await this.prisma.emailIngestLog.update({ where: { id: log.id }, data: { status: 'STORED', reason: 'store-only', rawMeta: meta as any } });
    this.log(ctx, 'CREATE', 'EmailIngestLog', log.id, log.subject ?? name, `file sent on WhatsApp → intake (${attachments[0].name})`);
    const out = await this.triage.triage(org, log.id);
    const row: any = await this.triage.row(org, log.id);
    return { logId: log.id, inboxState: out.inboxState, verdict: out.verdict, row };
  }

  /** The Confirm card for a file the intake could link but did not apply by itself. */
  pendingForIntake(row: any, filename: string): PendingAction | null {
    if (!row || row.inboxState !== 'SUGGESTED' || !row.matched) return null;
    const planned = (row.planned ?? []).filter((a: any) => a.kind === 'file');
    const slot = planned[0]?.docType ? ` as ${planned[0].docType.replace(/_/g, ' ').toLowerCase()}` : '';
    return { kind: 'shipments', summary: `File ${filename} → ${row.matched}${slot}${row.evidence ? `\n${String(row.evidence).slice(0, 200)}` : ''}`, args: { op: 'email_accept', emailId: row.id }, createdAt: new Date().toISOString() };
  }

  // ── Tool table ─────────────────────────────────────────────────────────────

  private tools(): ToolDef[] {
    return [
      {
        name: 'emails_recent',
        description: 'What came in by email (and WhatsApp files) recently and where each went: auto-filed (to which record and step), needs you (why), no order yet, or handled by a person. Default: since yesterday.',
        permissions: [SHIPMENTS_READ],
        input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'How many days back (1–14). Default 1.' } } },
        run: async (ctx, a) => this.emailsRecent(ctx.organizationId, Math.min(14, Math.max(1, Number(a.days) || 1))),
      },
      {
        name: 'record_status',
        description: 'Status of an order ("#19"), a shipment ("#19-1"), a B/L number ("198GX06522") or a free search ("SUS 6063 Sep"): current step, ETA, vessel, what is missing. Lists the matches when several fit.',
        permissions: [SHIPMENTS_READ],
        input_schema: { type: 'object', properties: { ref: { type: 'string', description: 'The reference exactly as the user wrote it.' } }, required: ['ref'] },
        run: async (ctx, a) => this.recordStatus(ctx.organizationId, String(a.ref ?? '')),
      },
      {
        name: 'arriving',
        description: 'Open shipments arriving within the next N days (default 7): ref, vessel, ETA, customer, current step.',
        permissions: [SHIPMENTS_READ],
        input_schema: { type: 'object', properties: { days: { type: 'integer', description: '1–30, default 7' } } },
        run: async (ctx, a) => this.arriving(ctx.organizationId, Math.min(30, Math.max(1, Number(a.days) || 7))),
      },
      {
        name: 'tasks_due',
        description: 'Overdue and due-soon tasks / reminders (the bell list): title, due date, overdue or not, the record. Use for "what is overdue" and "what needs me".',
        permissions: [SHIPMENTS_READ],
        input_schema: { type: 'object', properties: {} },
        run: async (ctx) => this.tasksDue(ctx.organizationId),
      },
      {
        name: 'needs_me',
        description: 'Everything waiting for this person: emails needing a decision (with the candidates), overdue tasks, free time (detention / demurrage) ending within 3 days.',
        permissions: [SHIPMENTS_READ],
        input_schema: { type: 'object', properties: {} },
        run: async (ctx) => this.needsMe(ctx.organizationId),
      },
      {
        name: 'send_document',
        description: 'Send a stored document of a record to the user on WhatsApp (e.g. the import permit of #16-2). docType is optional — the latest file is sent when it is left out; the matching files are listed when several fit.',
        permissions: [SHIPMENTS_READ],
        input_schema: { type: 'object', properties: { ref: { type: 'string', description: '"#16-2", "#16" or a B/L number' }, docType: { type: 'string', description: 'Document type code or a word from its name ("permit", "B/L", "invoice", "COA")' } }, required: ['ref'] },
        run: async (ctx, a) => this.sendDocument(ctx, String(a.ref ?? ''), a.docType ? String(a.docType) : null),
      },
      // ── writes (each shows a Confirm card) ──
      {
        name: 'email_link',
        description: 'Link an unprocessed email (from emails_recent / needs_me) to an order or shipment, or accept the link the intake suggested. With no ref, the candidates are shown as buttons. Shows a Confirm card.',
        permissions: [SHIPMENTS_WRITE],
        input_schema: { type: 'object', properties: { emailId: { type: 'string' }, ref: { type: 'string', description: '"#21-1" / "#21"; leave out to accept the suggestion or to be shown the candidates' } }, required: ['emailId'] },
        run: async (ctx, a) => this.emailLink(ctx, String(a.emailId ?? ''), a.ref ? String(a.ref) : null),
      },
      {
        name: 'email_not_shipment',
        description: 'Mark an unprocessed email as not a shipment email (it leaves the inbox; its content is removed, the row is kept). Shows a Confirm card.',
        permissions: [SHIPMENTS_WRITE],
        input_schema: { type: 'object', properties: { emailId: { type: 'string' } }, required: ['emailId'] },
        run: async (ctx, a) => this.emailNotShipment(ctx, String(a.emailId ?? '')),
      },
      {
        name: 'task_done',
        description: 'Mark a task / reminder (from tasks_due) done, or dismiss it. Shows a Confirm card.',
        permissions: [SHIPMENTS_WRITE],
        input_schema: { type: 'object', properties: { taskId: { type: 'string' }, dismiss: { type: 'boolean', description: 'true = dismiss instead of done' } }, required: ['taskId'] },
        run: async (ctx, a) => this.taskDone(ctx, String(a.taskId ?? ''), !!a.dismiss),
      },
      {
        name: 'set_eta',
        description: 'Set a shipment\'s ETA and/or actual arrival date ("#19-1 ETA 30 Oct"). Dates as YYYY-MM-DD. Shows a Confirm card.',
        permissions: [SHIPMENTS_WRITE],
        input_schema: { type: 'object', properties: { ref: { type: 'string' }, eta: { type: 'string', description: 'YYYY-MM-DD' }, arrived: { type: 'string', description: 'actual arrival YYYY-MM-DD' } }, required: ['ref'] },
        run: async (ctx, a) => this.setEta(ctx, String(a.ref ?? ''), a.eta ? String(a.eta) : null, a.arrived ? String(a.arrived) : null),
      },
      {
        name: 'add_note',
        description: 'Add a short note to a shipment (stamped with the user and "via WhatsApp"). Shows a Confirm card.',
        permissions: [SHIPMENTS_WRITE],
        input_schema: { type: 'object', properties: { ref: { type: 'string' }, note: { type: 'string' } }, required: ['ref', 'note'] },
        run: async (ctx, a) => this.addNote(ctx, String(a.ref ?? ''), String(a.note ?? '')),
      },
    ];
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  private async emailsRecent(org: string, days: number) {
    const [todo, done] = await Promise.all([this.triage.threads(org, 'UNPROCESSED', { limit: 40 }), this.triage.threads(org, 'PROCESSED', { sinceDays: days })]);
    const since = Date.now() - days * 86_400_000;
    const line = (m: any) => ({
      emailId: m.id,
      from: domainOf(m.from),
      subject: subject60(m.subject),
      date: ymd(m.date ?? m.receivedAt),
      ...(m.inboxState === 'PROCESSED'
        ? { went: m.by?.outcome === 'AUTO' ? `auto-filed → ${m.linked?.ref ?? m.matched ?? '?'}${m.linked?.label ? ` (${m.linked.label})` : ''}` : `${m.by?.outcome?.toLowerCase() ?? 'handled'} by ${m.by?.name ?? '?'}${m.linked?.ref ? ` → ${m.linked.ref}` : ''}`, filed: (m.done ?? []).filter((d: any) => d.kind === 'file' && d.status === 'done').length }
        : { needsYou: m.reason?.code === 'NO_ORDER' ? 'no order yet (create one in the portal)' : m.reason?.label ?? 'a decision', suggested: m.matched ?? null, candidates: (m.candidates ?? []).slice(0, 3).map((c: any) => c.ref) }),
    });
    const unprocessed = todo.threads.flatMap((t: any) => t.messages).filter((m: any) => new Date(m.date ?? m.receivedAt ?? 0).getTime() >= since || true).map(line);
    const processed = done.threads.flatMap((t: any) => t.messages).map(line);
    return {
      result: {
        sinceDays: days,
        autoFiled: processed.filter((m: any) => /^auto-filed/.test(m.went)),
        handledByPeople: processed.filter((m: any) => !/^auto-filed/.test(m.went)),
        needsYou: unprocessed.filter((m: any) => !/^no order/.test(m.needsYou)),
        noOrderYet: unprocessed.filter((m: any) => /^no order/.test(m.needsYou)),
      },
    };
  }

  private async recordStatus(org: string, raw: string) {
    const hit = await this.resolve(org, raw);
    if (!hit) return { result: { error: `Nothing found for "${raw.slice(0, 60)}"` } };
    if ('many' in hit) return { result: { several: hit.many } };
    if (hit.shipment) return { result: await this.shipmentStatus(org, hit.shipment.id) };
    return { result: await this.orderStatus(org, hit.order!.id) };
  }

  private async orderStatus(org: string, id: string) {
    const o: any = await this.prisma.tradeOrder.findFirst({
      where: { id, organizationId: org },
      select: { id: true, orderNo: true, status: true, shipMonth: true, deliveryMonth: true, grade: true, product: true, size: true, qtyMt: true, customer: { select: { name: true } }, supplier: { select: { name: true } }, steps: { select: STEP_SEL }, shipments: { orderBy: { seqNo: 'asc' }, select: { id: true, seqNo: true, blNumber: true, vessel: true, eta: true, actualArrivalDate: true, status: true, steps: { select: STEP_SEL } } } },
    });
    if (!o) return { error: 'Order not found' };
    return {
      kind: 'order',
      label: `#${o.orderNo}`,
      status: o.status,
      customer: o.customer?.name ?? null,
      supplier: o.supplier?.name ?? null,
      product: [o.grade, o.product, o.size, o.qtyMt ? `${Number(o.qtyMt)} MT` : null].filter(Boolean).join(' '),
      months: [o.shipMonth, o.deliveryMonth].filter(Boolean).join(' → '),
      currentStep: step(currentStepOf(o.steps)),
      shipments: o.shipments.map((s: any) => ({ ref: shipmentRefOf(o.orderNo, s.seqNo), bl: s.blNumber, vessel: s.vessel, eta: dmy(s.eta), arrived: dmy(s.actualArrivalDate), status: s.status, currentStep: step(currentStepOf(s.steps)) })),
    };
  }

  private async shipmentStatus(org: string, id: string) {
    const s: any = await this.prisma.shipment.findFirst({
      where: { id, organizationId: org },
      select: { id: true, seqNo: true, blNumber: true, vessel: true, voyageNo: true, etd: true, eta: true, actualArrivalDate: true, dischargeDate: true, detFreeDays: true, demFreeDays: true, status: true, netWeightMt: true, portOfDischarge: true, notes: true, customer: { select: { name: true } }, order: { select: { orderNo: true, grade: true, product: true, size: true } }, steps: { select: { ...STEP_SEL, requiredDocTypes: true } }, fileLinks: { select: { file: { select: { docType: true, fileName: true } } } } },
    });
    if (!s) return { error: 'Shipment not found' };
    const cur = currentStepOf(s.steps);
    const curRow = cur ? s.steps.find((x: any) => x.code === cur.code) : null;
    const present = (s.fileLinks ?? []).map((l: any) => l.file?.docType).filter(Boolean);
    const missing = curRow ? missingDocTypes(curRow.requiredDocTypes ?? [], present) : [];
    const rules = alertRulesOf((await this.prisma.tradeSetting.findUnique({ where: { organizationId: org }, select: { alertRules: true } }))?.alertRules);
    const today = tradeToday();
    const tab = shipmentTab({ ...s, steps: s.steps }, today);
    const free = tab === 'arrived' ? freeTimeLeft(s, rules, today) : null;
    return {
      kind: 'shipment',
      label: shipmentRefOf(s.order?.orderNo, s.seqNo),
      status: s.status,
      stage: tab,
      customer: s.customer?.name ?? null,
      product: [s.order?.grade, s.order?.product, s.order?.size, s.netWeightMt ? `${Number(s.netWeightMt)} MT` : null].filter(Boolean).join(' '),
      bl: s.blNumber,
      vessel: [s.vessel, s.voyageNo].filter(Boolean).join(' '),
      etd: dmy(s.etd),
      eta: dmy(s.eta),
      arrived: dmy(s.actualArrivalDate),
      port: s.portOfDischarge,
      currentStep: step(cur),
      missingDocuments: missing,
      freeTime: free ? { detentionEnds: free.det.ends, detentionDaysLeft: free.det.daysLeft, demurrageEnds: free.dem.ends, demurrageDaysLeft: free.dem.daysLeft } : null,
      documents: (s.fileLinks ?? []).map((l: any) => l.file?.fileName).filter(Boolean).slice(0, 12),
      lastNote: s.notes ? String(s.notes).split('\n').pop()?.slice(0, 160) : null,
    };
  }

  private async arriving(org: string, days: number) {
    const today = tradeToday();
    const until = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
    const rows: any[] = await this.prisma.shipment.findMany({
      where: { organizationId: org, status: 'OPEN', eta: { gte: new Date(today), lte: new Date(until) }, NOT: { order: { isTest: true } } },
      orderBy: { eta: 'asc' },
      select: { id: true, seqNo: true, blNumber: true, vessel: true, eta: true, portOfDischarge: true, customer: { select: { name: true } }, order: { select: { orderNo: true, grade: true } }, steps: { select: STEP_SEL } },
    });
    return { result: { from: today, to: until, shipments: rows.map((s) => ({ ref: shipmentRefOf(s.order?.orderNo, s.seqNo), customer: s.customer?.name ?? null, grade: s.order?.grade ?? null, vessel: s.vessel, eta: dmy(s.eta), port: s.portOfDischarge, bl: s.blNumber, currentStep: step(currentStepOf(s.steps)) })) } };
  }

  private async tasksDue(org: string) {
    const rows: any[] = await this.alerts.myTasks(org);
    const today = tradeToday();
    return { result: { today, tasks: rows.map((a) => ({ taskId: a.id, title: a.title, detail: a.detail, due: ymd(a.dueAt), overdue: a.status === 'DUE' && ymd(a.dueAt)! < today, dueToday: ymd(a.dueAt) === today, kind: a.kind })) } };
  }

  private async needsMe(org: string) {
    const [emails, tasks] = await Promise.all([this.emailsRecent(org, 14), this.tasksDue(org)]);
    const free = (tasks.result.tasks as any[]).filter((t) => t.kind === 'FREE_TIME');
    return { result: { emailsNeedingDecision: emails.result.needsYou, noOrderYet: emails.result.noOrderYet.length, overdueTasks: (tasks.result.tasks as any[]).filter((t) => t.overdue), dueToday: (tasks.result.tasks as any[]).filter((t) => t.dueToday), freeTimeEndingSoon: free } };
  }

  private async sendDocument(ctx: OperatorContext, raw: string, docType: string | null): Promise<ShipToolOutcome> {
    const hit = await this.resolve(ctx.organizationId, raw);
    if (!hit) return { result: { error: `Nothing found for "${raw.slice(0, 60)}"` } };
    if ('many' in hit) return { result: { several: hit.many } };
    const q = hit.shipment ? { shipmentId: hit.shipment.id } : { orderId: hit.order!.id };
    const list: any = await this.files.list(ctx.organizationId, { ...q, pageSize: '50' } as any);
    const want = (docType ?? '').toLowerCase().replace(/[^a-z0-9/]/g, '');
    const items: any[] = (list.items ?? []).filter((f: any) => !want || `${f.docType} ${f.docTypeLabel ?? ''} ${f.fileName}`.toLowerCase().replace(/[^a-z0-9/]/g, '').includes(want.replace(/\//g, '')));
    if (!items.length) return { result: { error: `No ${docType ?? 'document'} on ${hit.shipment?.ref ?? hit.order?.label}`, available: (list.items ?? []).slice(0, 10).map((f: any) => `${f.docTypeLabel ?? f.docType}: ${f.fileName}`) } };
    if (items.length > 1 && !want) return { result: { several: items.slice(0, 10).map((f: any) => ({ docType: f.docTypeLabel ?? f.docType, fileName: f.fileName })) , hint: 'ask which document type' } };
    const f = items[0];
    const { url } = await this.files.getUrl(ctx.organizationId, f.id);
    this.log(ctx, 'VIEW', 'TradeFile', f.id, f.fileName, `sent on WhatsApp (${hit.shipment?.ref ?? hit.order?.label})`);
    return { result: { sent: f.fileName, docType: f.docTypeLabel ?? f.docType, record: hit.shipment?.ref ?? hit.order?.label }, preview: { url, filename: f.fileName, caption: `${f.docTypeLabel ?? f.docType} · ${hit.shipment?.ref ?? hit.order?.label}` } };
  }

  // ── writes → Confirm cards ─────────────────────────────────────────────────

  private async emailLink(ctx: OperatorContext, emailId: string, ref: string | null): Promise<ShipToolOutcome> {
    const row: any = await this.triage.row(ctx.organizationId, emailId);
    if (row.inboxState === 'PROCESSED') return { result: { error: 'That email is already processed (undo it in the portal first).' } };
    if (!ref) {
      if (row.matched) return { pending: { kind: 'shipments', summary: `"${subject60(row.subject)}" → ${row.matched}${this.plannedLine(row)}`, args: { op: 'email_accept', emailId }, createdAt: new Date().toISOString() }, result: { held: true } };
      const cands: any[] = (row.candidates ?? []).slice(0, 3);
      if (!cands.length) return { result: { error: 'No candidate record for this email; give me the order or shipment ("#21-1").' } };
      return { result: { askedToPick: cands.map((c) => c.ref) }, choice: { question: `"${subject60(row.subject)}" — which record?`, options: cands.map((c) => c.ref) } };
    }
    const hit = await this.resolve(ctx.organizationId, ref);
    if (!hit || 'many' in hit) return { result: { error: `"${ref}" is not one record${hit && 'many' in hit ? ` (${hit.many.map((m) => m.label).join(', ')})` : ''}` } };
    const label = hit.shipment?.ref ?? hit.order!.label;
    return {
      pending: { kind: 'shipments', summary: `"${subject60(row.subject)}" → ${label}${row.matched && row.matched !== label ? ` (instead of ${row.matched})` : ''}`, args: { op: 'email_assign', emailId, orderId: hit.order?.id ?? hit.shipment?.orderId ?? null, shipmentId: hit.shipment?.id ?? null, ref: label }, createdAt: new Date().toISOString() },
      result: { held: true },
    };
  }

  private async emailNotShipment(ctx: OperatorContext, emailId: string): Promise<ShipToolOutcome> {
    const row: any = await this.triage.row(ctx.organizationId, emailId);
    if (row.inboxState === 'PROCESSED') return { result: { error: 'That email is already processed.' } };
    return { pending: { kind: 'shipments', summary: `"${subject60(row.subject)}" (${domainOf(row.from)}) → not a shipment email`, args: { op: 'email_dismiss', emailId, subject: subject60(row.subject) }, createdAt: new Date().toISOString() }, result: { held: true } };
  }

  private async taskDone(ctx: OperatorContext, taskId: string, dismiss: boolean): Promise<ShipToolOutcome> {
    const t = await this.prisma.tradeAlert.findFirst({ where: { id: taskId, organizationId: ctx.organizationId }, select: { id: true, title: true, status: true } });
    if (!t) return { result: { error: 'Task not found' } };
    if (t.status === 'DONE' || t.status === 'DISMISSED') return { result: { error: `Already ${t.status.toLowerCase()}` } };
    return { pending: { kind: 'shipments', summary: `${dismiss ? 'Dismiss' : 'Mark done'}: ${t.title}`, args: { op: 'task_status', taskId, status: dismiss ? 'DISMISSED' : 'DONE' }, createdAt: new Date().toISOString() }, result: { held: true } };
  }

  private async setEta(ctx: OperatorContext, raw: string, eta: string | null, arrived: string | null): Promise<ShipToolOutcome> {
    if (!eta && !arrived) return { result: { error: 'Give an ETA or an arrival date (YYYY-MM-DD).' } };
    for (const d of [eta, arrived]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { result: { error: `Date must be YYYY-MM-DD, got "${d}"` } };
    const hit = await this.resolve(ctx.organizationId, raw);
    if (!hit || 'many' in hit || !hit.shipment) return { result: { error: `"${raw}" must name one shipment ("#19-1")${hit && 'many' in hit ? `: ${hit.many.map((m) => m.label).join(', ')}` : ''}` } };
    const cur = await this.prisma.shipment.findFirst({ where: { id: hit.shipment.id }, select: { eta: true, actualArrivalDate: true } });
    const parts = [eta ? `ETA ${dmy(cur?.eta) ?? '—'} → ${dmy(eta)}` : null, arrived ? `arrived ${dmy(cur?.actualArrivalDate) ?? '—'} → ${dmy(arrived)}` : null].filter(Boolean);
    return { pending: { kind: 'shipments', summary: `${hit.shipment.ref}: ${parts.join(', ')}`, args: { op: 'set_eta', shipmentId: hit.shipment.id, ref: hit.shipment.ref, eta, arrived }, createdAt: new Date().toISOString() }, result: { held: true } };
  }

  private async addNote(ctx: OperatorContext, raw: string, note: string): Promise<ShipToolOutcome> {
    if (!note.trim()) return { result: { error: 'The note is empty.' } };
    const hit = await this.resolve(ctx.organizationId, raw);
    if (!hit || 'many' in hit || !hit.shipment) return { result: { error: `"${raw}" must name one shipment ("#19-1")` } };
    return { pending: { kind: 'shipments', summary: `Note on ${hit.shipment.ref}: "${note.trim().slice(0, 200)}"`, args: { op: 'add_note', shipmentId: hit.shipment.id, ref: hit.shipment.ref, note: note.trim() }, createdAt: new Date().toISOString() }, result: { held: true } };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** "#19" / "#19-1" / a B/L / free text → one order or shipment, or the several that fit. */
  private async resolve(org: string, raw: string): Promise<{ order?: { id: string; label: string }; shipment?: { id: string; ref: string; orderId: string | null } } | { many: Array<{ label: string; detail: string }> } | null> {
    const ref = parseRecordRef(raw);
    if (!ref) return null;
    const shipSel = { id: true, seqNo: true, orderId: true, blNumber: true, vessel: true, eta: true, order: { select: { orderNo: true, customer: { select: { name: true } } } } };
    const shipOf = (s: any) => ({ id: s.id, ref: shipmentRefOf(s.order?.orderNo, s.seqNo), orderId: s.orderId ?? null });
    if (ref.kind === 'order') {
      const o = await this.prisma.tradeOrder.findFirst({ where: { organizationId: org, orderNo: ref.orderNo }, select: { id: true, orderNo: true } });
      return o ? { order: { id: o.id, label: `#${o.orderNo}` } } : null;
    }
    if (ref.kind === 'shipment') {
      const s = await this.prisma.shipment.findFirst({ where: { organizationId: org, seqNo: ref.seqNo, order: { orderNo: ref.orderNo } }, select: shipSel });
      return s ? { shipment: shipOf(s) } : null;
    }
    if (ref.kind === 'bl') {
      const rows: any[] = await this.prisma.shipment.findMany({ where: { organizationId: org, blNumber: { contains: ref.bl.replace(/^[A-Z]{0,4}(?=\d)/, ''), mode: 'insensitive' } }, select: shipSel, take: 5 });
      if (!rows.length) return null;
      if (rows.length === 1) return { shipment: shipOf(rows[0]) };
      return { many: rows.map((s) => ({ label: shipOf(s).ref, detail: `B/L ${s.blNumber}` })) };
    }
    // Free search: customer / grade / month words against open orders.
    const words = ref.q.toLowerCase().split(/\s+/).filter(Boolean);
    const orders: any[] = await this.prisma.tradeOrder.findMany({ where: { organizationId: org, status: 'OPEN', NOT: { isTest: true } }, select: { id: true, orderNo: true, grade: true, product: true, shipMonth: true, deliveryMonth: true, qtyMt: true, customer: { select: { name: true } }, shipments: { select: shipSel } }, take: 200 });
    const hay = (o: any) => `${o.customer?.name ?? ''} ${o.grade ?? ''} ${o.product ?? ''} ${o.shipMonth ?? ''} ${o.deliveryMonth ?? ''} ${monthWords(o.shipMonth)} ${monthWords(o.deliveryMonth)}`.toLowerCase();
    const hits = orders.filter((o) => words.every((w) => hay(o).includes(w)));
    if (!hits.length) return null;
    if (hits.length === 1) {
      const o = hits[0];
      if (o.shipments.length === 1) return { shipment: shipOf(o.shipments[0]) };
      return { order: { id: o.id, label: `#${o.orderNo}` } };
    }
    return { many: hits.slice(0, 6).map((o) => ({ label: `#${o.orderNo}`, detail: [o.customer?.name, o.grade, o.qtyMt ? `${Number(o.qtyMt)} MT` : null, o.shipMonth].filter(Boolean).join(' · ') })) };
  }

  private plannedLine(row: any): string {
    const files = (row?.planned ?? []).filter((a: any) => a.kind === 'file' && a.status === 'planned');
    return files.length ? ` — files ${files.length} document${files.length > 1 ? 's' : ''}` : '';
  }

  private filedLine(row: any): string {
    const n = (row?.done ?? []).filter((a: any) => a.kind === 'file' && a.status === 'done').length;
    return n ? ` · ${n} document${n > 1 ? 's' : ''} filed` : '';
  }

  private actorOf(ctx: OperatorContext): { id: string | null; name: string | null; via: 'whatsapp' } {
    return { id: ctx.actor.id, name: ctx.actor.name ?? ctx.actor.email ?? null, via: 'whatsapp' };
  }

  /** Audit trail (legacy AuditLog) + Activity Log row as the user, channel chat:whatsapp, via whatsapp. */
  private log(ctx: OperatorContext, action: string, resource: string, resourceId?: string, resourceName?: string | null, detail?: string) {
    this.audit
      .logAction({ userId: ctx.actor.id || 'whatsapp', userName: ctx.actor.name, userEmail: ctx.actor.email, action, resource, resourceId, resourceName: resourceName ?? undefined, organizationId: ctx.organizationId, details: { detail, channel: ctx.channel, via: 'whatsapp' } })
      .catch(() => null);
    void this.actionLog.log({
      actorType: 'USER',
      actorId: ctx.actor.id || 'whatsapp',
      actorName: ctx.actor.name,
      actorEmail: ctx.actor.email,
      organizationId: ctx.organizationId,
      channel: `chat:${ctx.channel}`,
      method: 'TOOL',
      path: `/operator/${ctx.channel}/shipments`,
      action,
      resource,
      resourceId,
      details: { name: resourceName, detail, via: 'whatsapp', channel: ctx.channel },
    });
  }
}

const STEP_SEL = { code: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, notApplicable: true };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'user';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthWords = (ym: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '');
  if (!m) return '';
  const name = MONTHS[Number(m[2]) - 1] ?? '';
  return `${name} ${name.slice(0, 3)} ${m[1].slice(2)} ${m[1]}`;
};
