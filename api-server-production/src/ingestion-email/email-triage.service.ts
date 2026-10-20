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
import { StoredEmailMeta } from './email-store';
import { DEFAULT_CI_PATTERNS, decideMatch, EmailEvidence, findKeyHits, MatchDecision, MatchRecord, telexTiedTo, validCiNo } from './email-match.rules';
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
  KnownSenderHit,
  sanitizeKeys,
  TriageAttachment,
  PiTableOrder,
  piTableMatch,
  subjectMismatch,
  pickMatch,
  sentEvidence,
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
  /** A step of the record takes this type (guard e). */
  stepOk?: boolean;
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
/** STORE (keep only) · TRIAGE (suggest) · PARTIAL_AUTO (apply only when the guards hold) · AUTO (apply every clean match). */
export type IntakeMode = 'TRIAGE' | 'PARTIAL_AUTO' | 'AUTO';
export const ROUTING_MODES = ['STORE', 'TRIAGE', 'PARTIAL_AUTO', 'AUTO'] as const;
export const intakeModeOf = (v: string | null | undefined): IntakeMode => (v === 'AUTO' ? 'AUTO' : v === 'PARTIAL_AUTO' ? 'PARTIAL_AUTO' : 'TRIAGE');
/** An order / shipment the email goes to (the picker may give several, each with its own attachments). */
export interface IntakeTarget {
  orderId?: string | null;
  shipmentId?: string | null;
  attachmentIndexes?: number[];
}
/** How a person handled the suggestion (accept-rate tracking). */
export type ReviewOutcome = 'AUTO' | 'ACCEPTED' | 'CHANGED' | 'REJECTED' | 'IGNORED';

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
    const mode = intakeModeOf(cfg?.routingMode);
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
    if (known && result) result = { ...result, attachments: withKnownTypes(result.attachments, known) };
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
    this.actionLog.system('email-triage', state === 'PROCESSED' ? 'PROCESS' : 'TRIAGE', 'EmailIngestLog', {
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

  /**
   * Match the email and build the plan (see email-match.rules.ts). PARTIAL_AUTO applies it only when the guards
   * a–e hold; AUTO when it matched without a "check"; TRIAGE never. `manual` targets (the inbox picker) replace
   * the match; `opts.safe` never applies (the re-match run); `opts.keepState` keeps an UNSURE row UNSURE.
   */
  async matchAndPlan(
    organizationId: string,
    logId: string,
    keys: TriageKeys,
    mode: IntakeMode,
    manual?: IntakeTarget | IntakeTarget[],
    opts: { safe?: boolean; keepState?: InboxState } = {},
  ): Promise<InboxState> {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const prev = ((log.actions ?? {}) as Record<string, any>) ?? {};
    const ev = await this.evidence(log);
    const manualList = manual ? (Array.isArray(manual) ? manual : [manual]) : null;
    let decision: MatchDecision;
    let targets: IntakeTarget[];
    if (manualList?.length) {
      targets = [];
      for (const m of manualList) targets.push({ ...(await this.resolveManual(organizationId, m)), attachmentIndexes: m.attachmentIndexes });
      decision = { target: null, kind: null, confidence: 'exact', auto: false, blocked: ['picked by hand'], check: [], multiOrderIds: [], candidates: prev.candidates ?? [], keyLabel: null };
    } else {
      decision = await this.decide(organizationId, log, ev);
      targets = decision.target ? [decision.target] : [];
    }
    // An order with one live shipment: the shipment documents go there.
    targets = await Promise.all(targets.map((t) => this.withSingleShipment(organizationId, t)));
    const plan = await this.buildPlan(organizationId, log, keys, targets, ev);
    const needsShipment = plan.some((a) => a.kind === 'file' && a.status === 'skipped' && a.reason === 'pick the shipment');
    const unsupported = plan.filter((a) => a.kind === 'file' && a.status === 'planned' && a.stepOk === false);
    const blocked = [...decision.blocked, ...(unsupported.length ? [`e: no step takes ${[...new Set(unsupported.map((a) => a.docType))].join(', ')}`] : [])];
    const state: InboxState = opts.keepState ?? (!targets.length || needsShipment ? 'UNMATCHED' : 'SUGGESTED');
    const auto =
      !opts.safe && !manualList && state === 'SUGGESTED' && (mode === 'AUTO' ? !decision.check.length : mode === 'PARTIAL_AUTO' ? decision.auto && !unsupported.length && !needsShipment : false);
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        orderId: targets[0]?.orderId ?? null,
        shipmentId: targets[0]?.shipmentId ?? null,
        actions: {
          planned: plan,
          matchedBy: manualList ? 'manual' : decision.kind,
          confidence: manualList ? 'manual' : decision.confidence,
          ...(decision.check.length ? { check: decision.check } : {}),
          blocked,
          candidates: decision.candidates,
          multiOrderIds: decision.multiOrderIds,
          keyLabel: decision.keyLabel,
          targets: targets.map((t) => ({ orderId: t.orderId ?? null, shipmentId: t.shipmentId ?? null, ...(t.attachmentIndexes ? { attachmentIndexes: t.attachmentIndexes } : {}) })),
          // What the intake suggested first — "Accept" vs "Change order…" is measured against it.
          suggested: prev.suggested ?? (manualList ? null : (targets[0] ?? null)),
          ...(prev.review ? { review: prev.review } : {}),
        } as any,
        inboxState: state,
      },
    });
    if (auto) {
      await this.execute(organizationId, logId, SYSTEM_ACTOR, { review: 'AUTO', autoLabel: decision.keyLabel });
      return 'PROCESSED';
    }
    return state;
  }

  /** The decision for a stored email: its record keys, the accepted thread, its subject. */
  async decide(organizationId: string, log: any, ev?: EmailEvidence): Promise<MatchDecision> {
    const e = ev ?? (await this.evidence(log));
    const records = await this.matchRecords(organizationId);
    const hits = findKeyHits(e, records, await this.ciPatterns(organizationId));
    const thread = await this.acceptedThread(organizationId, log);
    return decideMatch({ ev: e, records, hits, thread });
  }

  /** Subject, body and each attachment's name + first-page text (PDF text layer / spreadsheet rows). */
  async evidence(log: any): Promise<EmailEvidence> {
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta> & IntakeExtras;
    const attachments: EmailEvidence['attachments'] = [];
    for (const a of meta.attachments ?? []) attachments.push({ name: a.name, text: await this.attachmentText(a) });
    return { subject: log.subject ?? '', body: meta.bodyText ?? '', attachments, date: log.emailDate ?? (meta.date ? new Date(meta.date) : null) };
  }

  private async attachmentText(a: { key: string; name: string; contentType?: string }): Promise<string> {
    try {
      const buf = await this.s3.downloadFile(a.key);
      if (a.contentType === 'application/pdf' || /\.pdf$/i.test(a.name)) return (await pdfText(buf)).slice(0, 4000);
      if (/\.(xlsx?|csv|txt|tsv)$/i.test(a.name)) return sheetText(buf).slice(0, 4000);
    } catch {
      /* unreadable: the name still counts */
    }
    return '';
  }

  /** Every order (and its shipments) an email can match — cancelled ones left out. */
  async matchRecords(organizationId: string): Promise<MatchRecord[]> {
    const settings = await this.config.getSettings(organizationId);
    const keyOf = (customerId: string) => (settings.customerProfiles?.[customerId] as { key?: string } | undefined)?.key?.toUpperCase() ?? null;
    // Two flat reads (orders, then their shipments) — no nested selects.
    const orders: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, status: { not: 'CANCELLED' } },
      select: { id: true, orderNo: true, status: true, piNo: true, grade: true, size: true, qtyMt: true, deliveryMonth: true, destinationPort: true, customerId: true },
    });
    const shipments: any[] = orders.length
      ? await this.prisma.shipment.findMany({
          where: { organizationId, orderId: { in: orders.map((o) => o.id) } },
          select: { id: true, orderId: true, seqNo: true, status: true, blNumber: true, ciNumber: true, netWeightMt: true, portOfDischarge: true },
        })
      : [];
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const portOf = (v: string | null | undefined) => (/nagoya/i.test(v ?? '') ? 'NAGOYA' : /yokohama/i.test(v ?? '') ? 'YOKOHAMA' : null);
    const out: MatchRecord[] = [];
    for (const o of orders) {
      const base = {
        orderId: o.id,
        orderNo: o.orderNo,
        orderStatus: o.status,
        piNo: o.piNo,
        customerKey: keyOf(o.customerId),
        customerName: null,
        grade: o.grade,
        size: o.size,
        qtyMt: num(o.qtyMt),
        deliveryMonth: o.deliveryMonth,
      };
      const ships = shipments.filter((s: { orderId: string; status: string }) => s.orderId === o.id && s.status !== 'CANCELLED');
      if (!ships.length) out.push({ ...base, shipmentId: null, seqNo: null, shipStatus: null, bl: null, ciNo: null, netMt: null, port: portOf(o.destinationPort) });
      for (const s of ships)
        out.push({ ...base, shipmentId: s.id, seqNo: s.seqNo, shipStatus: s.status, bl: s.blNumber, ciNo: s.ciNumber, netMt: num(s.netWeightMt), port: portOf(s.portOfDischarge ?? o.destinationPort) });
    }
    return out;
  }

  /** Supplier CI-number formats: Vedanta's defaults plus any a supplier profile adds (ciNoPatterns). */
  private async ciPatterns(organizationId: string): Promise<string[]> {
    const s = await this.config.getSettings(organizationId);
    const extra = Object.values(s.supplierProfiles ?? {}).flatMap((p) => ((p as { ciNoPatterns?: string[] }).ciNoPatterns ?? []).filter((x) => typeof x === 'string'));
    return [...DEFAULT_CI_PATTERNS, ...extra];
  }

  /** Thread follow: the order an earlier email of this thread was ACCEPTED (or auto-applied) to. */
  private async acceptedThread(organizationId: string, log: { id: string; threadKey: string | null; inReplyTo: string | null }): Promise<{ orderId: string; shipmentId: string | null } | null> {
    if (!log.threadKey && !log.inReplyTo) return null;
    const prior: Array<{ orderId: string | null; shipmentId: string | null; actions: any }> = await this.prisma.emailIngestLog.findMany({
      where: {
        organizationId,
        id: { not: log.id },
        inboxState: 'PROCESSED',
        orderId: { not: null },
        OR: [...(log.inReplyTo ? [{ messageId: log.inReplyTo }] : []), ...(log.threadKey ? [{ threadKey: log.threadKey }] : [])],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { orderId: true, shipmentId: true, actions: true },
    });
    const hit = prior.find((p) => p.actions?.review?.outcome !== 'IGNORED');
    return hit?.orderId ? { orderId: hit.orderId, shipmentId: hit.shipmentId } : null;
  }

  private async withSingleShipment(organizationId: string, t: IntakeTarget): Promise<IntakeTarget> {
    let out = { ...t };
    if (!out.shipmentId && out.orderId) {
      const ships: Array<{ id: string }> = await this.prisma.shipment.findMany({ where: { organizationId, orderId: out.orderId, status: { not: 'CANCELLED' } }, select: { id: true } });
      if (ships.length === 1) out = { ...out, shipmentId: ships[0].id };
    }
    if (out.shipmentId && !out.orderId) {
      const s = await this.prisma.shipment.findFirst({ where: { id: out.shipmentId, organizationId }, select: { orderId: true } });
      out = { ...out, orderId: s?.orderId ?? null };
    }
    return out;
  }

  private async resolveManual(organizationId: string, m: IntakeTarget): Promise<IntakeTarget> {
    if (m.shipmentId) {
      const s = await this.prisma.shipment.findFirst({ where: { id: m.shipmentId, organizationId }, select: { id: true, orderId: true } });
      if (!s) throw new BadRequestException('Shipment not found');
      return { orderId: s.orderId, shipmentId: s.id };
    }
    if (m.orderId) {
      const o = await this.prisma.tradeOrder.findFirst({ where: { id: m.orderId, organizationId }, select: { id: true } });
      if (!o) throw new BadRequestException('Order not found');
      return { orderId: o.id, shipmentId: null };
    }
    throw new BadRequestException('Pick an order or a shipment');
  }

  /** The plan over every target (multi-order emails: each target's own attachments). */
  private async buildPlan(organizationId: string, log: any, keys: TriageKeys, targets: IntakeTarget[], ev: EmailEvidence): Promise<IntakeAction[]> {
    const out: IntakeAction[] = [];
    const multi = targets.length > 1;
    for (const t of targets) {
      const p = await this.plan(organizationId, log, keys, t, ev, multi);
      // An attachment goes to one target only (the first that takes it).
      for (const a of p) if (!(a.kind === 'file' && out.some((b) => b.kind === 'file' && b.attachmentIndex === a.attachmentIndex && b.status === 'planned'))) out.push(a);
    }
    return out;
  }

  /** What PROCESS would do for this email on this order / shipment. */
  private async plan(organizationId: string, log: any, keys: TriageKeys, target: IntakeTarget, ev: EmailEvidence, multi = false): Promise<IntakeAction[]> {
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const triage = (log.triage ?? {}) as Partial<TriageResult> & { direction?: string; counterparty?: string };
    const out: IntakeAction[] = [];
    const typeOf = (name: string) => {
      const t = (triage.attachments ?? []).find((a) => a.filename === name);
      return t && t.confidence >= 0.5 ? (TRIAGE_DOC_TYPES[t.docType] ?? null) : null;
    };
    const fileTypes: string[] = [];
    const stepTakes = async (owner: { orderId?: string } | { shipmentId?: string }, docType: string) =>
      !!(await this.prisma.tradeStep.findFirst({ where: { organizationId, ...owner, notApplicable: false, OR: [{ requiredDocTypes: { has: docType } }, { optionalDocTypes: { has: docType } }] }, select: { id: true } }));
    const atts = (meta.attachments ?? []).map((a, i) => ({ a, i })).filter(({ i }) => !target.attachmentIndexes || target.attachmentIndexes.includes(i));
    for (const { a, i } of atts) {
      const docType = typeOf(a.name);
      if (!docType) {
        if (!multi) out.push({ kind: 'file', status: 'skipped', reason: 'not a trade document', attachmentIndex: i, filename: a.name });
        continue;
      }
      fileTypes.push(docType);
      const onOrder = ORDER_DOC_TYPES.has(docType);
      const ownerId = onOrder ? target.orderId : target.shipmentId;
      if (!ownerId) {
        out.push({ kind: 'file', status: 'skipped', reason: onOrder ? 'no order' : 'pick the shipment', attachmentIndex: i, filename: a.name, docType });
        continue;
      }
      const stepOk = await stepTakes(onOrder ? { orderId: ownerId } : { shipmentId: ownerId }, docType);
      out.push({ kind: 'file', status: 'planned', attachmentIndex: i, filename: a.name, docType, ownerKind: onOrder ? 'order' : 'shipment', ownerId, stepOk });
    }
    // Empty shipment fields the email names — validated formats only, never overwritten.
    if (target.shipmentId) {
      const s = await this.prisma.shipment.findFirst({
        where: { id: target.shipmentId, organizationId },
        select: { blNumber: true, ciNumber: true, telexReleaseCode: true, vessel: true, voyageNo: true },
      });
      const fill = (field: 'blNumber' | 'ciNumber' | 'telexReleaseCode' | 'vessel' | 'voyageNo', value: string | null) => {
        if (value && s && !s[field]) out.push({ kind: 'field', status: 'planned', model: 'shipment', id: target.shipmentId!, field, value });
      };
      // A B/L already on another shipment is that shipment's (a quoted email), not this one's.
      if (keys.blNo && s && !s.blNumber) {
        const other = await this.prisma.shipment.findFirst({ where: { organizationId, blNumber: { contains: keys.blNo }, NOT: { id: target.shipmentId } }, select: { id: true } });
        if (!other) fill('blNumber', keys.blNo);
      }
      fill('ciNumber', validCiNo(keys.ciNo, await this.ciPatterns(organizationId)));
      if (keys.telexCode && s && !s.telexReleaseCode) {
        // Only when the email ties the code to this B/L (subject, or the same line / paragraph).
        if (telexTiedTo(ev, keys.telexCode, s.blNumber ?? keys.blNo)) fill('telexReleaseCode', keys.telexCode);
        else out.push({ kind: 'field', status: 'skipped', model: 'shipment', id: target.shipmentId, field: 'telexReleaseCode', value: keys.telexCode, reason: 'check: the email does not say which B/L this telex code is for' });
      }
      if (!multi) {
        fill('vessel', keys.vessel);
        fill('voyageNo', keys.voyage);
      }
    }
    // Outgoing mail: "sent" sub-tasks.
    for (const evd of sentEvidence((triage.direction ?? log.direction) as any, (triage.counterparty ?? log.counterparty) as any, fileTypes)) {
      const owner = evd.scope === 'ORDER' ? (target.orderId ? { orderId: target.orderId } : null) : target.shipmentId ? { shipmentId: target.shipmentId } : null;
      if (!owner) continue;
      const step: { id: string; title: string; subtasks: unknown; notApplicable: boolean } | null = await this.prisma.tradeStep.findFirst({
        where: { organizationId, ...owner, code: evd.stepCode },
        select: { id: true, title: true, subtasks: true, notApplicable: true },
      });
      const st = Array.isArray(step?.subtasks) ? (step!.subtasks as Array<{ key: string; label: string; done?: boolean; na?: boolean }>).find((t) => t.key === evd.key) : null;
      if (!step || !st || st.na || step.notApplicable) continue;
      out.push({
        kind: 'subtask',
        status: st.done ? 'skipped' : 'planned',
        reason: st.done ? 'already ticked' : undefined,
        stepId: step.id,
        stepCode: evd.stepCode,
        key: evd.key,
        label: `${st.label} (${step.title})`,
      });
    }
    return out;
  }

  /**
   * Re-run the MATCHING on a stored email with today's rules — no AI call, never auto-applied (the re-match run):
   * its attachments re-typed by the known-sender rules (Vedanta copy documents, 納品明細, carrier debit notes), its
   * keys re-validated (CI / contract formats), then matched and planned. `apply` saves it (an UNSURE row stays UNSURE).
   */
  async rematchStored(organizationId: string, logId: string, apply: boolean) {
    const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('This email already did something — undo it first');
    const ev = await this.evidence(log);
    const t = (log.triage ?? {}) as Partial<TriageResult> & Record<string, unknown>;
    const known = knownSender({ from: log.fromAddress, subject: log.subject, attachments: ev.attachments });
    const ciPatterns = await this.ciPatterns(organizationId);
    const keys = sanitizeKeys({ ...mergeKeys(null, {}), ...((t.keys ?? {}) as TriageKeys) }, ciPatterns);
    const triage = { ...t, attachments: known ? withKnownTypes((t.attachments ?? []) as TriageAttachment[], known) : (t.attachments ?? []), keys, ...(known ? { knownRule: known.rule } : {}) };
    const draft = { ...log, triage };
    const decision = await this.decide(organizationId, draft, ev);
    const targets = decision.target ? [await this.withSingleShipment(organizationId, decision.target)] : [];
    const plan = await this.buildPlan(organizationId, draft, keys, targets, ev);
    const needsShipment = plan.some((a) => a.kind === 'file' && a.status === 'skipped' && a.reason === 'pick the shipment');
    const unsupported = plan.filter((a) => a.kind === 'file' && a.status === 'planned' && a.stepOk === false);
    const blocked = [...decision.blocked, ...(unsupported.length ? [`e: no step takes ${[...new Set(unsupported.map((a) => a.docType))].join(', ')}`] : []), ...(needsShipment ? ['a: pick the shipment'] : [])];
    const wouldAuto = decision.auto && !!targets.length && !unsupported.length && !needsShipment;
    if (apply) {
      await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { triage: triage as any } });
      const cfg = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { routingMode: true } });
      await this.matchAndPlan(organizationId, logId, keys, intakeModeOf(cfg?.routingMode), undefined, { safe: true, keepState: log.inboxState === 'UNSURE' ? 'UNSURE' : undefined });
    }
    return { decision, targets, wouldAuto, blocked, plan };
  }

  /** The inbox picker's preview: what choosing these shipments / orders would file and fill (nothing is saved). */
  async preview(organizationId: string, logId: string, targets: IntakeTarget[]) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const keys = ((log.triage ?? {}) as { keys?: TriageKeys }).keys ?? mergeKeys(null, {});
    const resolved: IntakeTarget[] = [];
    for (const t of targets) resolved.push(await this.withSingleShipment(organizationId, { ...(await this.resolveManual(organizationId, t)), attachmentIndexes: t.attachmentIndexes }));
    return { planned: await this.buildPlan(organizationId, log, keys, resolved, await this.evidence(log)) };
  }

  // ── execute / undo ──────────────────────────────────────────────────────
  /** Do the planned actions (AUTO, or "Accept" in the inbox). */
  async execute(organizationId: string, logId: string, actor: { id: string | null; name: string | null }, opts: { review?: ReviewOutcome; autoLabel?: string | null } = {}) {
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
      data: {
        actions: {
          ...((log.actions as object) ?? {}),
          planned: acts,
          done,
          // Accept-rate tracking; an auto-apply is labelled "Auto · B/L 198GX…" in Processed.
          ...(opts.review ? { review: { outcome: opts.review, at: new Date().toISOString(), by: actor.name ?? actor.id } } : {}),
          ...(opts.review === 'AUTO' ? { autoLabel: opts.autoLabel ?? null } : {}),
        } as any,
        inboxState: 'PROCESSED',
        status: 'PROCESSED',
      },
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

  /** NOT_SHIPMENT: the stored mail and attachments are deleted; the row keeps a hashed Message-ID, date, verdict, counterparty (and how a person handled it). */
  async purge(organizationId: string, logId: string, keep: { verdict: string; counterparty?: string | null; review?: { outcome: ReviewOutcome; at: string; by: string | null } }) {
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
        actions: (keep.review ? { review: keep.review } : null) as any,
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
      /** Subject words that disagree with the match ("grade 6005 ≠ 6063") — shown as "check". */
      check: (actions as { check?: string[] }).check ?? [],
      confidence: (actions as { confidence?: string }).confidence ?? null,
      /** Which guard kept it a suggestion. */
      blocked: (actions as { blocked?: string[] }).blocked ?? [],
      /** The picker's top 3 (ref, score, reasons). */
      candidates: (actions as { candidates?: unknown[] }).candidates ?? [],
      multiOrderIds: (actions as { multiOrderIds?: string[] }).multiOrderIds ?? [],
      targets: (actions as { targets?: unknown[] }).targets ?? [],
      review: (actions as { review?: unknown }).review ?? null,
      /** "B/L 198GX04630" on an auto-applied email. */
      autoLabel: (actions as { autoLabel?: string | null }).autoLabel ?? null,
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

  /** Inbox "Accept": do the email's plan as it stands (as suggested, or as re-planned by "Change order…"). */
  async accept(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId }, select: { actions: true } });
    const pending = ((log?.actions ?? {}) as { reviewPending?: ReviewOutcome }).reviewPending;
    return this.execute(organizationId, logId, actor, { review: pending ?? 'ACCEPTED' });
  }

  /**
   * Inbox "Change order…": the email goes to these orders / shipments (several for a multi-order email, each with
   * its own attachments) — re-planned for them; `accept` also does it at once. Counted as CHANGED when it differs
   * from what the intake suggested.
   */
  async assign(
    organizationId: string,
    logId: string,
    body: { orderId?: string | null; shipmentId?: string | null; targets?: IntakeTarget[]; accept?: boolean },
    actor: { id: string | null; name: string | null } = SYSTEM_ACTOR,
  ) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    const targets = body.targets?.length ? body.targets : [{ orderId: body.orderId ?? null, shipmentId: body.shipmentId ?? null }];
    const triage = (log.triage ?? {}) as { keys?: TriageKeys };
    const cfg = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { routingMode: true } });
    if (log.verdict !== 'SHIPMENT') await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { verdict: 'SHIPMENT', purgeAfter: null } });
    await this.matchAndPlan(organizationId, logId, triage.keys ?? mergeKeys(null, {}), intakeModeOf(cfg?.routingMode), targets);
    // Same as suggested (one target, same order / shipment) → ACCEPTED; anything else → CHANGED.
    const after = await this.prisma.emailIngestLog.findFirst({ where: { id: logId }, select: { actions: true } });
    const a = (after?.actions ?? {}) as { suggested?: IntakeTarget | null; targets?: IntakeTarget[] };
    const same = !!a.suggested && a.targets?.length === 1 && a.targets[0].orderId === a.suggested.orderId && (a.targets[0].shipmentId ?? null) === (a.suggested.shipmentId ?? null);
    const reviewPending: ReviewOutcome = same ? 'ACCEPTED' : 'CHANGED';
    await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { actions: { ...((after?.actions as object) ?? {}), reviewPending } as any } });
    if (body.accept) return this.execute(organizationId, logId, actor, { review: reviewPending });
    return this.row(organizationId, logId);
  }

  /** Inbox "Ignore": a shipment email with nothing to file — kept, marked handled (Processed), nothing done. */
  async ignore(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        inboxState: 'PROCESSED',
        purgeAfter: null,
        actions: { ...((log.actions as object) ?? {}), done: [], review: { outcome: 'IGNORED', at: new Date().toISOString(), by: actor.name ?? actor.id } } as any,
      },
    });
    return this.row(organizationId, logId);
  }

  /**
   * Sender filter preview (SHADOW): the rows the filter would drop — and how many it keeps — over the last `days`.
   * Only the from-domain and the subject's first 60 characters are shown (email content is untrusted data).
   */
  async filterPreview(organizationId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows: Array<{ id: string; createdAt: Date; fromAddress: string; subject: string | null; verdict: string | null; inboxState: string | null; filterVerdict: string | null; filterReason: string | null }> =
      await this.prisma.emailIngestLog.findMany({
        where: { organizationId, createdAt: { gte: since }, filterVerdict: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { id: true, createdAt: true, fromAddress: true, subject: true, verdict: true, inboxState: true, filterVerdict: true, filterReason: true },
      });
    const dropped = rows.filter((r) => r.filterVerdict === 'DROP');
    return {
      days,
      kept: rows.length - dropped.length,
      dropped: dropped.length,
      // Would-drop first (newest first), then the kept ones.
      items: [...dropped, ...rows.filter((r) => r.filterVerdict !== 'DROP')].map((r) => ({
        id: r.id,
        filterVerdict: r.filterVerdict as 'KEEP' | 'DROP',
        date: r.createdAt,
        fromDomain: (/@([^>\s]+)/.exec(r.fromAddress ?? '')?.[1] ?? '').toLowerCase().replace(/[>;,]+$/, '') || '—',
        subject: (r.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
        verdict: r.verdict,
        inboxState: r.inboxState,
        reason: r.filterReason,
        /** A shipment / unsure email the filter would drop: a false drop to fix before ENFORCE. */
        falseDrop: r.filterVerdict === 'DROP' && (r.verdict === 'SHIPMENT' || r.verdict === 'UNSURE'),
      })),
    };
  }

  /**
   * Accept-rate over the last `days`: emails a person accepted as suggested, changed the order of, rejected (not
   * shipment) or ignored, and the ones applied by themselves — how we decide when to widen auto.
   */
  async stats(organizationId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    // The review time is what counts (filtered below); the newest 2,000 rows are plenty for 30 days of ADH mail.
    const rows: Array<{ actions: any }> = await this.prisma.emailIngestLog.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 2000, select: { actions: true } });
    const counts: Record<ReviewOutcome, number> = { AUTO: 0, ACCEPTED: 0, CHANGED: 0, REJECTED: 0, IGNORED: 0 };
    for (const r of rows) {
      const rv = r.actions?.review;
      if (rv?.outcome && rv.at && new Date(rv.at) >= since && rv.outcome in counts) counts[rv.outcome as ReviewOutcome]++;
    }
    const reviewed = counts.ACCEPTED + counts.CHANGED + counts.REJECTED;
    return { days, ...counts, reviewed, acceptedAsIsPct: reviewed ? Math.round((counts.ACCEPTED / reviewed) * 100) : null };
  }

  /** Inbox "Not shipment mail": purge it now. */
  /**
   * Vedanta's PI table (round H — the PI is on the order): per row, the order
   * it fills (that PI no., else the month's open order on the contract and
   * grade without a PI) and the blank fields it would fill. Read-only.
   */
  async piTablePlan(organizationId: string, logId: string) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const rows = (((log.triage ?? {}) as any).supplierOrderSuggestions ?? []) as DeclarationRow[];
    const orders: PiTableOrder[] = (
      await this.prisma.tradeOrder.findMany({
        where: { organizationId },
        select: { id: true, year: true, orderNo: true, contractId: true, shipMonth: true, grade: true, qtyMt: true, piNo: true, piAmount: true, status: true },
      })
    ).map((o: any) => ({ ...o, qtyMt: o.qtyMt === null ? null : Number(o.qtyMt), piAmount: o.piAmount === null ? null : Number(o.piAmount) }));
    const out: Array<{ row: DeclarationRow; month: string | null; orderId: string | null; orderLabel: string | null; fields: Record<string, string | number>; reason?: string }> = [];
    for (const r of rows) {
      const contract = await this.prisma.contract.findFirst({ where: { organizationId, contractNo: r.contractNo }, select: { id: true } });
      const month = declarationMonthOf(r.qpBasis) ?? (log.emailDate ? log.emailDate.toISOString().slice(0, 7) : null);
      if (!contract) {
        out.push({ row: r, month, orderId: null, orderLabel: null, fields: {}, reason: 'contract not in AIMS' });
        continue;
      }
      const m = piTableMatch(r, contract.id, month, orders);
      out.push({ row: r, month, orderId: m.order?.id ?? null, orderLabel: m.order ? `#${m.order.orderNo}` : null, fields: m.fields, reason: m.reason });
    }
    return { rows: out };
  }

  /** Apply the PI table: fill the blank PI fields on the matched orders; a PI PDF named with its PI no. goes onto step 1. */
  async applyPiTable(organizationId: string, logId: string, actor: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const plan = await this.piTablePlan(organizationId, logId);
    if (!plan.rows.length) throw new BadRequestException('This email has no PI table to apply');
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const results: Array<{ contractNo: string; piNo: string | null; orderId: string | null; orderLabel: string | null; action: string; reason?: string }> = [];
    for (const p of plan.rows) {
      const r = p.row;
      if (!p.orderId) {
        results.push({ contractNo: r.contractNo, piNo: r.piNo, orderId: null, orderLabel: null, action: 'skipped', reason: p.reason });
        continue;
      }
      if (Object.keys(p.fields).length) {
        await this.prisma.tradeOrder.update({ where: { id: p.orderId, organizationId }, data: p.fields });
        await this.config.syncSteps(this.prisma, organizationId, [{ orderId: p.orderId }], actor as any, { fields: Object.keys(p.fields) });
      }
      results.push({ contractNo: r.contractNo, piNo: r.piNo, orderId: p.orderId, orderLabel: p.orderLabel, action: Object.keys(p.fields).length ? `filled ${Object.keys(p.fields).join(', ')}` : 'already up to date' });
      const att = r.piNo ? (meta.attachments ?? []).find((a) => a.name.includes(r.piNo!) && /\.pdf$/i.test(a.name)) : undefined;
      if (att) {
        const buf = await this.s3.downloadFile(att.key);
        const sha = sha256Of(buf);
        const have = await this.prisma.tradeFile.findFirst({ where: { organizationId, sha256: sha }, select: { id: true } });
        if (!have) {
          const step = await this.prisma.tradeStep.findFirst({ where: { organizationId, orderId: p.orderId, code: 'PI_PAYMENT' }, select: { id: true } });
          await this.files.upload(
            organizationId,
            { originalname: att.name, mimetype: att.contentType, size: buf.length, buffer: buf } as Express.Multer.File,
            { docType: 'PI', orderIds: [p.orderId], ...(step ? { stepId: step.id } : {}), notes: `From email: ${log.subject ?? ''}`.slice(0, 2000) } as any,
            actor as any,
            { source: 'EMAIL', emailLogId: logId, sha256: sha },
          );
        }
      }
    }
    await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { actions: { ...((log.actions as object) ?? {}), supplierOrders: results } as any } });
    this.actionLog.system('email-triage', 'UPDATE', 'TradeOrder', { organizationId, resourceId: logId, details: { rows: results.length } });
    return { results, row: await this.row(organizationId, logId) };
  }

  async dismiss(organizationId: string, logId: string, actor?: { id: string | null; name: string | null }) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    await this.purge(organizationId, logId, { verdict: 'NOT_SHIPMENT', counterparty: log.counterparty, review: { outcome: 'REJECTED', at: new Date().toISOString(), by: actor?.name ?? actor?.id ?? null } });
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

/** The known-sender rule's attachment types win; a type the rule rules out (Copy documents → never PAYMENT_PROOF) becomes OTHER. */
export function withKnownTypes(attachments: TriageAttachment[], known: KnownSenderHit): TriageAttachment[] {
  const typed = new Map(Object.entries(known.attachmentTypes));
  const forbid = new Set(known.forbidTypes ?? []);
  return [
    ...attachments.filter((a) => !typed.has(a.filename)).map((a) => (forbid.has(a.docType) ? { ...a, docType: 'OTHER', confidence: 0 } : a)),
    ...[...typed].map(([filename, docType]) => ({ filename, docType, confidence: 1 })),
  ];
}
