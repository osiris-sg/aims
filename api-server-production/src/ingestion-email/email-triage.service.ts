import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { ActionLogService } from '../action-log/action-log.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { pdfText } from '../shipments/trade-coa';
import { sheetText } from '../shipments/trade-extract.service';
import { TradeConfigService } from '../shipments/trade-config.service';
import { sha256Of, TradeFilesService } from '../shipments/trade-files.service';
import { TradeStepsService } from '../shipments/trade-steps.service';
import { createSupplierOrderInTx } from '../shipments/trade-supplier-order';
import { StoredEmailMeta } from './email-store';
import {
  counterpartyByDomain,
  DeclarationRow,
  declarationMonthOf,
  directionOf,
  emailOf,
  guardVerdict,
  keepDomainsOf,
  keptDomain,
  keysByPattern,
  knownSender,
  MatchCandidate,
  mergeKeys,
  ORDER_DOC_TYPES,
  parseDeclarationTable,
  pickMatch,
  sentEvidence,
  SUPPLIER_ORDER_DOC_TYPES,
  threadKeyOf,
  TRIAGE_DOC_TYPES,
  triagePrompt,
  TriageKeys,
  TriageResult,
  validateTriage,
} from './email-triage.rules';

/** One thing PROCESS does (or would do, in TRIAGE mode) — each can be undone. */
export interface IntakeAction {
  kind: 'file' | 'field' | 'subtask';
  status: 'planned' | 'done' | 'skipped' | 'undone';
  reason?: string;
  // file
  attachmentIndex?: number;
  filename?: string;
  docType?: string;
  ownerKind?: 'order' | 'shipment' | 'supplierOrder';
  ownerId?: string;
  fileId?: string;
  reopenedStepIds?: string[];
  // field
  model?: 'shipment' | 'order';
  id?: string;
  field?: string;
  value?: string;
  // subtask
  stepId?: string;
  stepCode?: string;
  key?: string;
  label?: string;
}

export type InboxState = 'SUGGESTED' | 'UNMATCHED' | 'PROCESSED' | 'UNSURE' | 'PURGED';

const MODEL = 'claude-sonnet-4-6';
const UNSURE_DAYS = 14;
const DEFAULT_OWN_DOMAINS = ['asiadealhub.com'];
const SYSTEM_ACTOR = { id: 'system:email-intake', name: 'Email intake' };

/** Hashed Message-ID kept for purged (NOT_SHIPMENT) rows — still dedupes a re-delivery. */
export const hashedMessageId = (messageId: string) => `sha256:${createHash('sha256').update(messageId).digest('hex')}`;

type AiCall = (system: string, user: string) => Promise<unknown>;

/**
 * Email intake TRIAGE → PROCESS. Runs after the store (async; the webhook has
 * already answered): AI triage → NOT_SHIPMENT purged (only a hashed
 * Message-ID, date, verdict, counterparty kept) / UNSURE kept 14 days for
 * review / SHIPMENT matched (PI > B/L > CI > telex > contract, then the
 * thread) and planned: attach each attachment to the right step (sha256
 * dedupe, source EMAIL), fill empty fields, tick "sent" sub-tasks for
 * outgoing mail. AUTO executes the plan (auto-complete runs as for an upload);
 * TRIAGE leaves it as a suggestion for the Email inbox. Everything done can
 * be undone from the inbox.
 */
@Injectable()
export class EmailTriageService {
  private readonly logger = new Logger(EmailTriageService.name);
  /** Tests replace the model call. */
  ai: AiCall = (system, user) => this.callClaude(system, user);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly files: TradeFilesService,
    private readonly config: TradeConfigService,
    private readonly steps: TradeStepsService,
    private readonly actionLog: ActionLogService,
  ) {}

  /** After the webhook stored an email: triage it in the background (the provider isn't kept waiting). */
  schedule(organizationId: string, logId: string) {
    setImmediate(() =>
      runAsOrg(organizationId, () =>
        this.triage(organizationId, logId).catch((e) => {
          this.logger.error(`[email-triage] org=${organizationId} log=${logId}: ${e?.message}`, e?.stack);
          this.actionLog.system('email-triage', 'FAILED', 'EmailIngestLog', { organizationId, resourceId: logId, status: 'FAILURE', details: { error: String(e?.message ?? e).slice(0, 500) } });
        }),
      ),
    );
  }

  // ── triage ──────────────────────────────────────────────────────────────
  async triage(organizationId: string, logId: string): Promise<{ verdict: string; inboxState: InboxState }> {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta> & IntakeExtras;
    if (!meta.emlKey) throw new BadRequestException('This email was not stored');
    const cfg = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { routingMode: true } });
    const mode = cfg?.routingMode === 'AUTO' ? 'AUTO' : 'TRIAGE';
    const settings = await this.config.getSettings(organizationId);
    const ownDomains = ownDomainsOf(settings.docDefaults);
    const customerDomains = Object.values(settings.customerProfiles ?? {})
      .filter((p) => p.key && p.emailDomains?.length)
      .map((p) => ({ key: String(p.key).toUpperCase(), domains: p.emailDomains! }));

    // First page of each attachment (PDF text, spreadsheet rows) for the model.
    const firstPages: Array<{ filename: string; firstPage: string }> = [];
    for (const a of meta.attachments ?? []) {
      let text = '';
      try {
        const buf = await this.s3.downloadFile(a.key);
        if (a.contentType === 'application/pdf' || /\.pdf$/i.test(a.name)) text = (await pdfText(buf)).slice(0, 1500);
        else if (/\.(xlsx?|csv|txt|tsv)$/i.test(a.name)) text = sheetText(buf).slice(0, 1500);
      } catch {
        text = '';
      }
      firstPages.push({ filename: a.name, firstPage: text });
    }
    const addrs = { from: log.fromAddress, to: meta.headerTo ?? [], cc: meta.cc ?? [] };
    const [system, user] = triagePrompt({
      subject: log.subject ?? '',
      from: log.fromAddress,
      to: addrs.to,
      cc: addrs.cc,
      date: meta.date ?? null,
      body: meta.bodyText ?? '',
      attachments: firstPages,
      ownDomains,
    });
    let result: TriageResult | null = null;
    let error: string | null = null;
    try {
      result = validateTriage(await this.ai(system, user));
      if (!result) error = 'The AI answer did not fit the schema';
    } catch (e: any) {
      error = String(e?.message ?? e).slice(0, 300);
    }
    // Known senders / subjects (Wan Hai A/N, Mitsui Soko NO.取りリスト, 輸入許可書, Vedanta declaration) win over the AI.
    const known = knownSender({ from: log.fromAddress, subject: log.subject, attachments: (meta.attachments ?? []).map((a, i) => ({ name: a.name, text: firstPages[i]?.firstPage ?? '' })) });
    if (known && result) {
      const typed = new Map(Object.entries(known.attachmentTypes));
      const forbid = new Set(known.forbidTypes ?? []);
      result = {
        ...result,
        attachments: [
          // The rule's types win; a type the rule rules out (Copy documents → never PAYMENT_PROOF) becomes OTHER.
          ...result.attachments.filter((a) => !typed.has(a.filename)).map((a) => (forbid.has(a.docType) ? { ...a, docType: 'OTHER', confidence: 0 } : a)),
          ...[...typed].map(([filename, docType]) => ({ filename, docType, confidence: 1 })),
        ],
      };
    }
    // Direction and counterparty: deterministic rules first, the AI's guess only as a fallback.
    const direction = directionOf(log.fromAddress, ownDomains);
    const counterparty = counterpartyByDomain(addrs, ownDomains, customerDomains) ?? known?.counterparty ?? result?.counterparty ?? 'OTHER';
    // Mail with a known counterparty (or on its thread) is never purged automatically: NOT_SHIPMENT → UNSURE.
    const keep = keepDomainsOf(settings.docDefaults, customerDomains.flatMap((c) => c.domains));
    const kept = keptDomain({ ...addrs, body: meta.bodyText ?? '' }, keep) ?? (await this.keptThread(organizationId, logId, log.subject));
    const verdict = known ? 'SHIPMENT' : guardVerdict(result?.verdict ?? 'UNSURE', kept);
    const text = [log.subject, meta.bodyText?.slice(0, 4000), ...(meta.attachments ?? []).map((a) => a.name), ...firstPages.map((p) => p.firstPage)].join('\n');
    const keys = mergeKeys(result?.keys ?? null, { ...keysByPattern(text), ...(known?.blNo ? { blNo: known.blNo } : {}) });
    // Vedanta's PI table → supplier-order suggestions (applied from the inbox).
    const supplierOrderSuggestions = known?.rule === 'VEDANTA_DECLARATION' ? parseDeclarationTable(meta.bodyText ?? '') : [];
    const triage = {
      ...(result ?? { attachments: Object.entries(known?.attachmentTypes ?? {}).map(([filename, docType]) => ({ filename, docType, confidence: 1 })) }),
      verdict,
      direction,
      counterparty,
      keys,
      error,
      model: MODEL,
      at: new Date().toISOString(),
      ...(known ? { knownRule: known.rule } : {}),
      ...(kept ? { keptBy: kept, ...(result?.verdict === 'NOT_SHIPMENT' && verdict === 'UNSURE' ? { aiVerdict: 'NOT_SHIPMENT' } : {}) } : {}),
      ...(supplierOrderSuggestions.length ? { supplierOrderSuggestions } : {}),
    };

    if (verdict === 'NOT_SHIPMENT') {
      await this.purge(organizationId, logId, { verdict, counterparty });
      this.actionLog.system('email-triage', 'PURGE', 'EmailIngestLog', { organizationId, resourceId: logId, details: { verdict, counterparty } });
      return { verdict, inboxState: 'PURGED' };
    }
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        verdict,
        direction,
        counterparty,
        triage: triage as any,
        threadKey: threadKeyOf(log.subject),
        inReplyTo: meta.inReplyTo ?? null,
        emailDate: meta.date ? new Date(meta.date) : null,
        // A re-run of an UNSURE email that is now SHIPMENT keeps it (no 14-day purge).
        ...(verdict === 'SHIPMENT' ? { purgeAfter: null } : {}),
      },
    });
    if (verdict === 'UNSURE') {
      await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { inboxState: 'UNSURE', purgeAfter: new Date(Date.now() + UNSURE_DAYS * 86_400_000) } });
      this.actionLog.system('email-triage', 'TRIAGE', 'EmailIngestLog', { organizationId, resourceId: logId, details: { verdict, counterparty, error } });
      return { verdict, inboxState: 'UNSURE' };
    }
    const state = await this.matchAndPlan(organizationId, logId, keys, mode);
    this.actionLog.system('email-triage', mode === 'AUTO' && state === 'PROCESSED' ? 'PROCESS' : 'TRIAGE', 'EmailIngestLog', {
      organizationId,
      resourceId: logId,
      details: { verdict, direction, counterparty, inboxState: state },
    });
    return { verdict, inboxState: state };
  }

  /** "thread: …" when an earlier email of this thread is with a counterparty (an internal reply on a Vedanta thread). */
  private async keptThread(organizationId: string, logId: string, subject: string | null): Promise<string | null> {
    const key = threadKeyOf(subject);
    if (!key) return null;
    const hit = await this.prisma.emailIngestLog.findFirst({
      where: { organizationId, threadKey: key, id: { not: logId }, counterparty: { in: ['VEDANTA', 'SUS', 'KATO', 'HOEI', 'MITSUI_SOKO', 'SHIPPING_LINE'] } },
      select: { counterparty: true },
    });
    return hit ? `thread with ${hit.counterparty}` : null;
  }

  /** Match the email to an order / shipment and build the plan; AUTO executes it. */
  async matchAndPlan(organizationId: string, logId: string, keys: TriageKeys, mode: 'AUTO' | 'TRIAGE', manual?: { orderId?: string | null; shipmentId?: string | null }): Promise<InboxState> {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    let target = manual ? await this.resolveManual(organizationId, manual) : await this.match(organizationId, log, keys);
    // An order match with one live shipment: the shipment documents go there.
    if (target && !target.shipmentId && target.orderId) {
      const ships: Array<{ id: string }> = await this.prisma.shipment.findMany({ where: { organizationId, orderId: target.orderId, status: { not: 'CANCELLED' } }, select: { id: true } });
      if (ships.length === 1) target = { ...target, shipmentId: ships[0].id };
    }
    if (target?.shipmentId && !target.orderId) {
      const s = await this.prisma.shipment.findFirst({ where: { id: target.shipmentId, organizationId }, select: { orderId: true } });
      target = { ...target, orderId: s?.orderId ?? null };
    }
    const plan = target ? await this.plan(organizationId, log, keys, target) : [];
    const needsShipment = plan.some((a) => a.kind === 'file' && a.status === 'skipped' && a.reason === 'pick the shipment');
    const state: InboxState = !target || needsShipment ? 'UNMATCHED' : 'SUGGESTED';
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: { orderId: target?.orderId ?? null, shipmentId: target?.shipmentId ?? null, actions: { planned: plan, matchedBy: target?.kind ?? null } as any, inboxState: state },
    });
    if (state === 'SUGGESTED' && mode === 'AUTO') {
      await this.execute(organizationId, logId, SYSTEM_ACTOR);
      return 'PROCESSED';
    }
    return state;
  }

  private async resolveManual(organizationId: string, m: { orderId?: string | null; shipmentId?: string | null }) {
    if (m.shipmentId) {
      const s = await this.prisma.shipment.findFirst({ where: { id: m.shipmentId, organizationId }, select: { id: true, orderId: true } });
      if (!s) throw new BadRequestException('Shipment not found');
      return { kind: 'manual' as const, orderId: s.orderId, shipmentId: s.id, count: 1 };
    }
    if (m.orderId) {
      const o = await this.prisma.tradeOrder.findFirst({ where: { id: m.orderId, organizationId }, select: { id: true } });
      if (!o) throw new BadRequestException('Order not found');
      return { kind: 'manual' as const, orderId: o.id, shipmentId: null, count: 1 };
    }
    throw new BadRequestException('Pick an order or a shipment');
  }

  /** PI > B/L > CI > telex > contract (one OPEN order), then the thread: an earlier matched email of the same thread. */
  private async match(organizationId: string, log: { id: string; threadKey: string | null; inReplyTo: string | null }, keys: TriageKeys): Promise<MatchCandidate | null> {
    const cands: MatchCandidate[] = [];
    if (keys.piNo) {
      // The PI is on the supplier order (round E) — or, on older orders, on the order itself.
      const os: Array<{ id: string }> = await this.prisma.tradeOrder.findMany({ where: { organizationId, OR: [{ piNo: keys.piNo }, { supplierOrder: { piNo: keys.piNo } }] }, select: { id: true } });
      cands.push({ kind: 'pi', orderId: os[0]?.id ?? null, count: os.length });
    }
    if (keys.blNo) {
      const ss: Array<{ id: string; orderId: string | null }> = await this.prisma.shipment.findMany({ where: { organizationId, blNumber: keys.blNo }, select: { id: true, orderId: true } });
      cands.push({ kind: 'bl', shipmentId: ss[0]?.id ?? null, orderId: ss[0]?.orderId ?? null, count: ss.length });
    }
    if (keys.ciNo) {
      const ss: Array<{ id: string; orderId: string | null }> = await this.prisma.shipment.findMany({ where: { organizationId, ciNumber: keys.ciNo }, select: { id: true, orderId: true } });
      cands.push({ kind: 'ci', shipmentId: ss[0]?.id ?? null, orderId: ss[0]?.orderId ?? null, count: ss.length });
    }
    if (keys.telexCode) {
      const ss: Array<{ id: string; orderId: string | null }> = await this.prisma.shipment.findMany({
        where: { organizationId, telexReleaseCode: keys.telexCode },
        select: { id: true, orderId: true },
      });
      cands.push({ kind: 'telex', shipmentId: ss[0]?.id ?? null, orderId: ss[0]?.orderId ?? null, count: ss.length });
    }
    if (keys.contractNo) {
      const os: Array<{ id: string }> = await this.prisma.tradeOrder.findMany({ where: { organizationId, status: 'OPEN', contract: { contractNo: keys.contractNo } }, select: { id: true } });
      cands.push({ kind: 'contract', orderId: os[0]?.id ?? null, count: os.length });
    }
    const direct = pickMatch(cands);
    if (direct || cands.some((c) => c.count > 1)) return direct;
    // Thread fallback: In-Reply-To → that email's match; else the same normalised subject.
    const prior = await this.prisma.emailIngestLog.findFirst({
      where: {
        organizationId,
        id: { not: log.id },
        OR: [{ orderId: { not: null } }, { shipmentId: { not: null } }],
        AND: [{ OR: [...(log.inReplyTo ? [{ messageId: log.inReplyTo }] : []), ...(log.threadKey ? [{ threadKey: log.threadKey }] : [])] }],
      },
      orderBy: { createdAt: 'desc' },
      select: { orderId: true, shipmentId: true },
    });
    if (prior && (log.inReplyTo || log.threadKey)) return { kind: 'thread', orderId: prior.orderId, shipmentId: prior.shipmentId, count: 1 };
    return null;
  }

  /** What PROCESS would do for this email on this order / shipment. */
  private async plan(organizationId: string, log: any, keys: TriageKeys, target: { orderId?: string | null; shipmentId?: string | null }): Promise<IntakeAction[]> {
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const triage = (log.triage ?? {}) as Partial<TriageResult> & { direction?: string; counterparty?: string };
    const out: IntakeAction[] = [];
    const typeOf = (name: string) => {
      const t = (triage.attachments ?? []).find((a) => a.filename === name);
      return t && t.confidence >= 0.5 ? (TRIAGE_DOC_TYPES[t.docType] ?? null) : null;
    };
    const fileTypes: string[] = [];
    const soId: string | null = target.orderId
      ? ((await this.prisma.tradeOrder.findFirst({ where: { id: target.orderId, organizationId }, select: { supplierOrderId: true } }))?.supplierOrderId ?? null)
      : null;
    (meta.attachments ?? []).forEach((a, i) => {
      const docType = typeOf(a.name);
      if (!docType) return out.push({ kind: 'file', status: 'skipped', reason: 'not a trade document', attachmentIndex: i, filename: a.name });
      fileTypes.push(docType);
      // PI / contract / deposit proof belong to the supplier side (steps 0 / 1 on the supplier order).
      if (SUPPLIER_ORDER_DOC_TYPES.has(docType) && soId) {
        return out.push({ kind: 'file', status: 'planned', attachmentIndex: i, filename: a.name, docType, ownerKind: 'supplierOrder', ownerId: soId });
      }
      const onOrder = ORDER_DOC_TYPES.has(docType);
      const ownerId = onOrder ? target.orderId : target.shipmentId;
      if (!ownerId) return out.push({ kind: 'file', status: 'skipped', reason: onOrder ? 'no order' : 'pick the shipment', attachmentIndex: i, filename: a.name, docType });
      out.push({ kind: 'file', status: 'planned', attachmentIndex: i, filename: a.name, docType, ownerKind: onOrder ? 'order' : 'shipment', ownerId });
    });
    // Empty shipment fields the email names (never overwrites).
    if (target.shipmentId) {
      const s = await this.prisma.shipment.findFirst({
        where: { id: target.shipmentId, organizationId },
        select: { blNumber: true, ciNumber: true, telexReleaseCode: true, vessel: true, voyageNo: true },
      });
      const fill = (field: 'blNumber' | 'ciNumber' | 'telexReleaseCode' | 'vessel' | 'voyageNo', value: string | null) => {
        if (value && s && !s[field]) out.push({ kind: 'field', status: 'planned', model: 'shipment', id: target.shipmentId!, field, value });
      };
      fill('blNumber', keys.blNo);
      fill('ciNumber', keys.ciNo);
      fill('telexReleaseCode', keys.telexCode);
      fill('vessel', keys.vessel);
      fill('voyageNo', keys.voyage);
    }
    // Outgoing mail: "sent" sub-tasks.
    for (const ev of sentEvidence((triage.direction ?? log.direction) as any, (triage.counterparty ?? log.counterparty) as any, fileTypes)) {
      const owner = ev.scope === 'ORDER' ? (target.orderId ? { orderId: target.orderId } : null) : target.shipmentId ? { shipmentId: target.shipmentId } : null;
      if (!owner) continue;
      const step: { id: string; title: string; subtasks: unknown; notApplicable: boolean } | null = await this.prisma.tradeStep.findFirst({
        where: { organizationId, ...owner, code: ev.stepCode },
        select: { id: true, title: true, subtasks: true, notApplicable: true },
      });
      const st = Array.isArray(step?.subtasks) ? (step!.subtasks as Array<{ key: string; label: string; done?: boolean; na?: boolean }>).find((t) => t.key === ev.key) : null;
      if (!step || !st || st.na || step.notApplicable) continue;
      out.push({
        kind: 'subtask',
        status: st.done ? 'skipped' : 'planned',
        reason: st.done ? 'already ticked' : undefined,
        stepId: step.id,
        stepCode: ev.stepCode,
        key: ev.key,
        label: `${st.label} (${step.title})`,
      });
    }
    return out;
  }

  // ── execute / undo ──────────────────────────────────────────────────────
  /** Do the planned actions (AUTO, or "Accept" in the inbox). */
  async execute(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const acts = (((log.actions ?? {}) as any).planned ?? []) as IntakeAction[];
    const done: IntakeAction[] = [];
    for (const a of acts) {
      if (a.status !== 'planned') {
        done.push(a);
        continue;
      }
      try {
        if (a.kind === 'file') {
          const att = meta.attachments?.[a.attachmentIndex!];
          if (!att) {
            done.push({ ...a, status: 'skipped', reason: 'attachment missing' });
            continue;
          }
          const buf = await this.s3.downloadFile(att.key);
          const sha = sha256Of(buf);
          const dup = await this.prisma.tradeFile.findFirst({ where: { organizationId, sha256: sha }, select: { id: true } });
          if (dup) {
            done.push({ ...a, status: 'skipped', reason: 'already have this file', fileId: dup.id });
            continue;
          }
          const owner = a.ownerKind === 'order' ? { orderId: a.ownerId! } : a.ownerKind === 'supplierOrder' ? { supplierOrderId: a.ownerId! } : { shipmentId: a.ownerId! };
          const step = await this.prisma.tradeStep.findFirst({
            where: { organizationId, ...owner, OR: [{ requiredDocTypes: { has: a.docType } }, { optionalDocTypes: { has: a.docType } }] },
            orderBy: { sortOrder: 'asc' },
            select: { id: true },
          });
          const f = await this.files.upload(
            organizationId,
            { originalname: att.name, mimetype: att.contentType, size: buf.length, buffer: buf } as Express.Multer.File,
            {
              docType: a.docType!,
              ...(a.ownerKind === 'order' ? { orderIds: [a.ownerId] } : a.ownerKind === 'supplierOrder' ? { supplierOrderIds: [a.ownerId] } : { shipmentIds: [a.ownerId] }),
              ...(step ? { stepId: step.id } : {}),
              notes: `From email: ${log.subject ?? ''}`.slice(0, 2000),
            } as any,
            actor,
            { source: 'EMAIL', emailLogId: logId, sha256: sha },
          );
          done.push({ ...a, status: 'done', fileId: f.id });
        } else if (a.kind === 'field') {
          const cur: any = await this.prisma.shipment.findFirst({ where: { id: a.id, organizationId }, select: { [a.field!]: true } as any });
          if (!cur || cur[a.field!]) {
            done.push({ ...a, status: 'skipped', reason: 'already filled' });
            continue;
          }
          await this.prisma.shipment.update({ where: { id: a.id!, organizationId }, data: { [a.field!]: a.value } });
          await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: a.id! }], actor, { fields: [a.field!] });
          done.push({ ...a, status: 'done' });
        } else {
          await this.steps.setSubtask(organizationId, a.stepId!, a.key!, true, actor as any, { kind: 'EMAIL', emailLogId: logId });
          done.push({ ...a, status: 'done' });
        }
      } catch (e: any) {
        done.push({ ...a, status: 'skipped', reason: String(e?.message ?? e).slice(0, 200) });
      }
    }
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: { actions: { ...((log.actions as object) ?? {}), planned: acts, done } as any, inboxState: 'PROCESSED', status: 'PROCESSED' },
    });
    return this.row(organizationId, logId);
  }

  /** Undo everything the email did: remove its files (reopening steps they completed), clear the fields it filled, untick its sub-tasks. */
  async undo(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const acts = (((log.actions ?? {}) as any).done ?? []) as IntakeAction[];
    if (!acts.some((a) => a.status === 'done')) throw new BadRequestException('Nothing to undo');
    const out: IntakeAction[] = [];
    for (const a of [...acts].reverse()) {
      if (a.status !== 'done') {
        out.unshift(a);
        continue;
      }
      if (a.kind === 'file' && a.fileId) {
        const f = await this.prisma.tradeFile.findFirst({
          where: { id: a.fileId, organizationId },
          select: { id: true, docType: true, links: { select: { orderId: true, shipmentId: true, contractId: true } } },
        });
        const reopened: string[] = [];
        if (f) {
          // Steps this file completed: back to in progress (reopened), so the file can go.
          for (const l of f.links) {
            const owner = l.orderId ? { orderId: l.orderId } : l.shipmentId ? { shipmentId: l.shipmentId } : { contractId: l.contractId };
            const present = await this.config.presentDocTypes(this.prisma, organizationId, owner as any, { fileId: f.id });
            const broken: Array<{ id: string }> = await this.prisma.tradeStep.findMany({
              where: { organizationId, ...owner, status: 'DONE', requiredDocTypes: { has: f.docType } },
              select: { id: true },
            });
            for (const s of broken) {
              if (present.includes(f.docType)) continue;
              await this.prisma.tradeStep.update({ where: { id: s.id }, data: { status: 'IN_PROGRESS', completedAt: null, holdOpen: true, updatedById: actor.id, updatedByName: actor.name } });
              reopened.push(s.id);
            }
            // A shipment / order the file had completed is reopened with its step.
            if (reopened.length && l.shipmentId) await this.prisma.shipment.updateMany({ where: { id: l.shipmentId, organizationId, status: 'COMPLETED' }, data: { status: 'OPEN' } });
            if (reopened.length && l.orderId) await this.prisma.tradeOrder.updateMany({ where: { id: l.orderId, organizationId, status: 'COMPLETED' }, data: { status: 'OPEN' } });
          }
          await this.files.remove(organizationId, f.id);
        }
        out.unshift({ ...a, status: 'undone', reopenedStepIds: reopened });
      } else if (a.kind === 'field') {
        const cur: any = await this.prisma.shipment.findFirst({ where: { id: a.id, organizationId }, select: { [a.field!]: true } as any });
        if (cur && cur[a.field!] === a.value) await this.prisma.shipment.update({ where: { id: a.id!, organizationId }, data: { [a.field!]: null } });
        out.unshift({ ...a, status: 'undone' });
      } else if (a.kind === 'subtask') {
        await this.steps.setSubtask(organizationId, a.stepId!, a.key!, false, actor as any).catch(() => undefined);
        out.unshift({ ...a, status: 'undone' });
      }
    }
    // Back to a suggestion: it can be accepted again, or dismissed.
    const planned = out.map((a) => (a.status === 'undone' ? { ...a, status: 'planned' as const, fileId: undefined, reopenedStepIds: undefined } : a));
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: { actions: { ...((log.actions as object) ?? {}), planned, done: [], undone: out } as any, inboxState: 'SUGGESTED', status: 'STORED' },
    });
    return this.row(organizationId, logId);
  }

  /** NOT_SHIPMENT: the stored mail and attachments are deleted; the row keeps a hashed Message-ID, date, verdict, counterparty. */
  async purge(organizationId: string, logId: string, keep: { verdict: string; counterparty?: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) return;
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    for (const key of [meta.emlKey, ...(meta.attachments ?? []).map((a) => a.key)].filter((k): k is string => !!k)) {
      await this.s3.deleteFile(key).catch((e) => this.logger.warn(`[email-triage] could not delete ${key}: ${e?.message}`));
    }
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        messageId: log.messageId.startsWith('sha256:') ? log.messageId : hashedMessageId(log.messageId),
        fromAddress: '',
        subject: null,
        reason: null,
        attachmentCount: 0,
        rawMeta: { purged: true, date: meta.date ?? null } as any,
        triage: null as any,
        actions: null as any,
        threadKey: null,
        inReplyTo: null,
        orderId: null,
        shipmentId: null,
        verdict: keep.verdict,
        counterparty: keep.counterparty ?? log.counterparty,
        inboxState: 'PURGED',
        status: 'IGNORED',
        purgeAfter: null,
      },
    });
  }

  /** UNSURE emails nobody reviewed in 14 days are purged (daily, every org). */
  @Cron('17 3 * * *')
  async sweepUnsure() {
    const due: Array<{ id: string; organizationId: string; counterparty: string | null }> = await this.prisma.emailIngestLog.findMany({
      where: { inboxState: 'UNSURE', purgeAfter: { lt: new Date() } },
      select: { id: true, organizationId: true, counterparty: true },
      take: 500,
    });
    for (const r of due) {
      await runAsOrg(r.organizationId, () => this.purge(r.organizationId, r.id, { verdict: 'UNSURE', counterparty: r.counterparty }));
      this.actionLog.system('email-triage-sweep', 'PURGE', 'EmailIngestLog', { organizationId: r.organizationId, resourceId: r.id, details: { reason: 'UNSURE for 14 days' } });
    }
    return due.length;
  }

  // ── inbox ───────────────────────────────────────────────────────────────
  async inbox(organizationId: string, tab: InboxState) {
    const logs: any[] = await this.prisma.emailIngestLog.findMany({ where: { organizationId, inboxState: tab }, orderBy: { createdAt: 'desc' }, take: 200 });
    const counts = Object.fromEntries(
      await Promise.all(
        (['SUGGESTED', 'UNMATCHED', 'PROCESSED', 'UNSURE'] as InboxState[]).map(async (s) => [s, await this.prisma.emailIngestLog.count({ where: { organizationId, inboxState: s } })]),
      ),
    );
    const refs = await this.refs(organizationId, logs.map((l) => l.orderId).filter(Boolean), logs.map((l) => l.shipmentId).filter(Boolean));
    return { items: logs.map((l) => this.shape(l, refs)), counts };
  }

  async row(organizationId: string, logId: string) {
    const l: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!l) throw new NotFoundException('Email not found');
    return this.shape(l, await this.refs(organizationId, l.orderId ? [l.orderId] : [], l.shipmentId ? [l.shipmentId] : []));
  }

  private async refs(organizationId: string, orderIds: string[], shipmentIds: string[]) {
    const [orders, ships]: [Array<{ id: string; orderNo: number }>, Array<{ id: string; seqNo: number | null; blNumber: string | null; order: { orderNo: number } | null }>] = await Promise.all([
      orderIds.length ? this.prisma.tradeOrder.findMany({ where: { organizationId, id: { in: orderIds } }, select: { id: true, orderNo: true } }) : [],
      shipmentIds.length
        ? this.prisma.shipment.findMany({ where: { organizationId, id: { in: shipmentIds } }, select: { id: true, seqNo: true, blNumber: true, order: { select: { orderNo: true } } } })
        : [],
    ]);
    return {
      order: new Map(orders.map((o) => [o.id, `#${o.orderNo}`])),
      ship: new Map(ships.map((s) => [s.id, s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : (s.blNumber ?? 'shipment')])),
    };
  }

  private shape(l: any, refs: { order: Map<string, string>; ship: Map<string, string> }) {
    const meta = (l.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const actions = (l.actions ?? {}) as { planned?: IntakeAction[]; done?: IntakeAction[]; matchedBy?: string | null };
    const triage = (l.triage ?? {}) as Partial<TriageResult> & { error?: string | null };
    return {
      id: l.id,
      date: l.emailDate ?? meta.date ?? l.createdAt,
      receivedAt: l.createdAt,
      direction: l.direction,
      counterparty: l.counterparty,
      verdict: l.verdict,
      inboxState: l.inboxState,
      subject: l.subject,
      from: l.fromAddress,
      attachments: (meta.attachments ?? []).map((a, i) => ({ index: i, name: a.name, docType: (triage.attachments ?? []).find((t) => t.filename === a.name)?.docType ?? null })),
      orderId: l.orderId,
      shipmentId: l.shipmentId,
      matched: l.shipmentId ? refs.ship.get(l.shipmentId) : l.orderId ? refs.order.get(l.orderId) : null,
      matchedOrder: l.orderId ? refs.order.get(l.orderId) : null,
      matchedBy: actions.matchedBy ?? null,
      keys: triage.keys ?? null,
      planned: actions.planned ?? [],
      done: actions.done ?? [],
      canUndo: (actions.done ?? []).some((a) => a.status === 'done'),
      purgeAfter: l.purgeAfter,
      error: triage.error ?? null,
      knownRule: (triage as { knownRule?: string }).knownRule ?? null,
      keptBy: (triage as { keptBy?: string }).keptBy ?? null,
      /** Vedanta declaration: the PI table rows, and what "Apply" did. */
      supplierOrderSuggestions: (triage as { supplierOrderSuggestions?: DeclarationRow[] }).supplierOrderSuggestions ?? [],
      supplierOrderResults: (l.actions as { supplierOrders?: unknown[] } | null)?.supplierOrders ?? [],
    };
  }

  /** Inbox "Accept": do a suggested email's plan. */
  accept(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    return this.execute(organizationId, logId, actor);
  }

  /** Inbox "Assign": match an email to an order / shipment by hand, then plan it (AUTO also executes). */
  async assign(organizationId: string, logId: string, target: { orderId?: string | null; shipmentId?: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    const triage = (log.triage ?? {}) as { keys?: TriageKeys };
    const cfg = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { routingMode: true } });
    if (log.verdict !== 'SHIPMENT') await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { verdict: 'SHIPMENT', purgeAfter: null } });
    await this.matchAndPlan(organizationId, logId, triage.keys ?? mergeKeys(null, {}), cfg?.routingMode === 'AUTO' ? 'AUTO' : 'TRIAGE', target);
    return this.row(organizationId, logId);
  }

  /** Inbox "Not shipment mail": purge it now. */
  /**
   * Vedanta's declaration PI table → supplier orders: each row updates the
   * supplier order with its PI no. (else the one for the same contract, grade
   * and month without a PI yet) or creates one; a PI PDF named with the PI no.
   * is attached to step 1. Blank fields are filled, typed ones kept.
   */
  async applySupplierOrders(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const rows = (((log.triage ?? {}) as any).supplierOrderSuggestions ?? []) as DeclarationRow[];
    if (!rows.length) throw new BadRequestException('This email has no PI table to apply');
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const results: Array<{ contractNo: string; piNo: string | null; supplierOrderId: string | null; action: string; reason?: string }> = [];
    for (const r of rows) {
      const contract = await this.prisma.contract.findFirst({ where: { organizationId, contractNo: r.contractNo }, select: { id: true, supplierId: true } });
      if (!contract) {
        results.push({ contractNo: r.contractNo, piNo: r.piNo, supplierOrderId: null, action: 'skipped', reason: 'contract not in AIMS' });
        continue;
      }
      const month = declarationMonthOf(r.qpBasis) ?? (log.emailDate ? log.emailDate.toISOString().slice(0, 7) : null);
      let so: { id: string; piNo: string | null; qtyMt: unknown; provisionalPricePerMt: unknown; qpBasis: string | null } | null = r.piNo
        ? await this.prisma.supplierOrder.findFirst({ where: { organizationId, piNo: r.piNo }, select: { id: true, piNo: true, qtyMt: true, provisionalPricePerMt: true, qpBasis: true } })
        : null;
      so ??= await this.prisma.supplierOrder.findFirst({
        where: { organizationId, contractId: contract.id, piNo: null, status: 'OPEN', ...(month ? { declarationMonth: month } : {}), ...(r.grade ? { grade: r.grade } : {}) },
        select: { id: true, piNo: true, qtyMt: true, provisionalPricePerMt: true, qpBasis: true },
      });
      let id: string;
      if (so) {
        const data: Record<string, unknown> = {};
        if (!so.piNo && r.piNo) data.piNo = r.piNo;
        if (so.qtyMt === null && r.qtyMt !== null) data.qtyMt = r.qtyMt;
        if (so.provisionalPricePerMt === null && r.pricePerMt !== null) data.provisionalPricePerMt = r.pricePerMt;
        if (!so.qpBasis && r.qpBasis) data.qpBasis = r.qpBasis;
        if (Object.keys(data).length) await this.prisma.supplierOrder.update({ where: { id: so.id }, data });
        id = so.id;
        results.push({ contractNo: r.contractNo, piNo: r.piNo, supplierOrderId: id, action: Object.keys(data).length ? `updated ${Object.keys(data).join(', ')}` : 'already up to date' });
      } else {
        id = await this.prisma.$transaction((tx: any) =>
          createSupplierOrderInTx(
            tx,
            this.config,
            organizationId,
            { contractId: contract.id, supplierId: contract.supplierId, declarationMonth: month, grade: r.grade ?? undefined, qtyMt: r.qtyMt, qpBasis: r.qpBasis, provisionalPricePerMt: r.pricePerMt, piNo: r.piNo },
            actor as any,
          ),
        );
        results.push({ contractNo: r.contractNo, piNo: r.piNo, supplierOrderId: id, action: 'created' });
      }
      // The PI PDF (named with its PI no.) goes onto step 1.
      const att = r.piNo ? (meta.attachments ?? []).find((a) => a.name.includes(r.piNo!) && /\.pdf$/i.test(a.name)) : undefined;
      if (att) {
        const buf = await this.s3.downloadFile(att.key);
        const sha = sha256Of(buf);
        const have = await this.prisma.tradeFile.findFirst({ where: { organizationId, sha256: sha }, select: { id: true } });
        if (!have) {
          const step = await this.prisma.tradeStep.findFirst({ where: { organizationId, supplierOrderId: id, code: 'PI_PAYMENT' }, select: { id: true } });
          await this.files.upload(
            organizationId,
            { originalname: att.name, mimetype: att.contentType, size: buf.length, buffer: buf } as Express.Multer.File,
            { docType: 'PI', supplierOrderIds: [id], ...(step ? { stepId: step.id } : {}), notes: `From email: ${log.subject ?? ''}`.slice(0, 2000) } as any,
            actor as any,
            { source: 'EMAIL', emailLogId: logId, sha256: sha },
          );
        }
      }
    }
    await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { actions: { ...((log.actions as object) ?? {}), supplierOrders: results } as any } });
    this.actionLog.system('email-triage', 'UPDATE', 'SupplierOrder', { organizationId, resourceId: logId, details: { rows: results.length } });
    return { results, row: await this.row(organizationId, logId) };
  }

  async dismiss(organizationId: string, logId: string) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    await this.purge(organizationId, logId, { verdict: 'NOT_SHIPMENT', counterparty: log.counterparty });
    return { id: logId, purged: true };
  }

  // ── model ───────────────────────────────────────────────────────────────
  private async callClaude(system: string, user: string): Promise<unknown> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({ model: MODEL, max_tokens: 1500, temperature: 0, system, messages: [{ role: 'user', content: user }] });
    const block = r.content.find((b) => b.type === 'text');
    const raw = block && 'text' in block ? (block as any).text.trim() : '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in the triage answer');
    return JSON.parse(m[0]);
  }
}

/** Extra fields the store keeps for triage (header To / Cc, thread headers, the body's text). */
export interface IntakeExtras {
  headerTo?: string[];
  cc?: string[];
  inReplyTo?: string | null;
  references?: string[];
  bodyText?: string;
}

/** The org's own mail domains (OUT direction): docDefaults.intakeOwnDomains, default asiadealhub.com. */
export function ownDomainsOf(docDefaults: Record<string, unknown> | null | undefined): string[] {
  const v = docDefaults?.intakeOwnDomains;
  const list = typeof v === 'string' ? v.split(/[,\s]+/) : Array.isArray(v) ? v.map(String) : [];
  const clean = list.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return clean.length ? clean : DEFAULT_OWN_DOMAINS;
}

export { emailOf };
