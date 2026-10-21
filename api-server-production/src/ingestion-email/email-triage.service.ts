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
import { attachmentHits, attachmentTarget, DEFAULT_CI_PATTERNS, DEFAULT_CONTRACT_PATTERNS, decideMatch, EmailEvidence, findKeyHits, MatchDecision, MatchRecord, recordRef, telexTiedTo, ThreadContext, validCiNo } from './email-match.rules';
import { splitQuoted } from './email-quote';
import { buildReasonerPrompt, judgeReasoner, parseReasonerOutput, ReasonerContext, ReasonerJudgement, ReasonerRecordRow, ReasonerThreadMessage } from './email-reasoner';
import { groupThreads, normMessageId, threadHeadersFromEml, threadLink, unprocessedReason } from './email-threads';
import { backlogAutoLabel, BacklogInput, BacklogVerdict, classifyEmail } from './email-backlog';
import { supplierKeyPatterns } from '../shipments/trade-profile';
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

/** HIDDEN (round Q): obvious non-shipment mail kept out of both tabs (Settings → Email filter → Hidden). */
export type InboxState = 'SUGGESTED' | 'UNMATCHED' | 'PROCESSED' | 'UNSURE' | 'PURGED' | 'HIDDEN';
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
/** Round R: the thread reasoner (reads the whole thread + attachment text against the open records). */
const REASONER_MODEL = 'claude-opus-5-5';
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
    // Round P: thread headers. A worker deployed before header support posts none; the raw .eml still has them.
    if (((!meta.inReplyTo && !meta.references?.length) || meta.autoSubmitted === undefined) && meta.emlSource === 'raw') {
      try {
        const head = (await this.s3.downloadFile(meta.emlKey)).subarray(0, 32_000).toString('latin1');
        const th = threadHeadersFromEml(head);
        if (!meta.inReplyTo && !meta.references?.length && (th.inReplyTo || th.references.length)) {
          meta.inReplyTo = th.inReplyTo;
          meta.references = th.references;
        }
        meta.autoSubmitted = th.autoSubmitted;
        await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { rawMeta: { ...(log.rawMeta as object), inReplyTo: meta.inReplyTo ?? null, references: meta.references ?? [], autoSubmitted: th.autoSubmitted } as any } });
      } catch (e) {
        this.logger.warn(`[email-triage] thread headers of ${logId}: ${(e as Error)?.message}`);
      }
    }
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
      decision = { target: null, kind: null, confidence: 'exact', auto: false, blocked: ['picked by hand'], check: [], multiOrderIds: [], candidates: prev.candidates ?? [], keyLabel: null, reason: 'picked by hand', threadFrom: null };
    } else {
      decision = await this.decide(organizationId, log, ev);
      targets = decision.target ? [decision.target] : [];
      // Round R: attachment-content keys count per attachment (guard 1b per file) — one email can file to several
      // shipments. When the attachments' own content names different records, each goes to its own.
      const split = await this.splitByAttachment(organizationId, log, ev, decision);
      if (split) {
        targets = split.targets;
        decision = { ...decision, target: split.targets[0] ? { orderId: split.targets[0].orderId!, shipmentId: split.targets[0].shipmentId ?? null } : decision.target, kind: 'bl', confidence: 'exact', auto: split.auto, blocked: split.auto ? [] : decision.blocked, check: [], multiOrderIds: [], reason: split.reason, keyLabel: split.keyLabel, threadFrom: null };
      }
    }
    // An order with one live shipment: the shipment documents go there.
    targets = await Promise.all(targets.map((t) => this.withSingleShipment(organizationId, t)));
    let plan = await this.buildPlan(organizationId, log, keys, targets, ev);
    // Round R: the thread reasoner — when the rules can't decide (no target, several candidates, or a conflict) and
    // the org has it on. It may only pick rows from the open-records table; applied by itself only when its evidence
    // is verified (a hard key in the email's own content, or a unique product match) and nothing conflicts.
    let reasoned: ReasonerJudgement | null = null;
    if (!manualList && !opts.safe && (!targets.length || decision.multiOrderIds.length > 1 || decision.check.length) && (await this.reasonerOn(organizationId))) {
      reasoned = await this.reason(organizationId, log, ev).catch((e) => {
        this.logger.warn(`[email-reasoner] ${logId}: ${(e as Error)?.message}`);
        return null;
      });
      if (reasoned?.apply) {
        targets = reasoned.targets.map((t) => ({ orderId: t.orderId, shipmentId: t.shipmentId, attachmentIndexes: t.attachmentIndexes }));
        // The reasoner's slot choice types the attachment (the planner files by the triage type).
        const triage = (log.triage ?? {}) as Partial<TriageResult>;
        const atts = ((log.rawMeta ?? {}) as Partial<StoredEmailMeta>).attachments ?? [];
        const typed = [...(triage.attachments ?? [])];
        for (const t of reasoned.targets) for (const [i, dt] of Object.entries(t.docTypes)) {
          const name = atts[Number(i)]?.name;
          if (!name) continue;
          const j = typed.findIndex((x) => x.filename === name);
          const entry = { filename: name, docType: dt, confidence: 1 };
          if (j >= 0) typed[j] = entry;
          else typed.push(entry);
        }
        await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { triage: { ...triage, attachments: typed } as any } });
        log.triage = { ...triage, attachments: typed } as any;
        decision = { ...decision, target: { orderId: targets[0].orderId!, shipmentId: targets[0].shipmentId ?? null }, kind: 'bl', confidence: 'exact', auto: true, blocked: [], check: [], multiOrderIds: [], reason: `reasoner: ${reasoned.evidence}`, keyLabel: reasoned.keyLabel, threadFrom: null };
        plan = await this.buildPlan(organizationId, log, keys, targets, ev);
      } else if (reasoned) decision = { ...decision, reason: `reasoner: ${reasoned.reason}` };
    }
    const needsShipment = plan.some((a) => a.kind === 'file' && a.status === 'skipped' && a.reason === 'pick the shipment');
    const unsupported = plan.filter((a) => a.kind === 'file' && a.status === 'planned' && a.stepOk === false);
    const blocked = [...decision.blocked, ...(unsupported.length ? [`e: no step takes ${[...new Set(unsupported.map((a) => a.docType))].join(', ')}`] : [])];
    const state: InboxState = opts.keepState ?? (!targets.length || needsShipment ? 'UNMATCHED' : 'SUGGESTED');
    // Round P: a thread-inherited link applies by itself only when it is link-only (nothing to file) and came from an
    // accepted / auto-applied message with no conflict (guards 1a–1e otherwise unchanged). Anything that files
    // documents stays "Confirm match".
    const filesSomething = plan.some((a) => a.kind === 'file' && a.status === 'planned');
    const threadAuto = decision.kind === 'thread' ? decision.threadFrom === 'accepted' && decision.auto && !filesSomething && !decision.check.length : true;
    if (decision.kind === 'thread' && !threadAuto && decision.threadFrom === 'accepted' && filesSomething) blocked.push('thread: files documents — confirm');
    const auto =
      !opts.safe &&
      !manualList &&
      state === 'SUGGESTED' &&
      threadAuto &&
      (mode === 'AUTO' ? !decision.check.length : mode === 'PARTIAL_AUTO' ? decision.auto && !unsupported.length && !needsShipment : false);
    // Round Q: what kind of email this is (hide / auto-link / history / confirm / pick / no order) — stored on the
    // row for the inbox; applied live below (never with `safe`, never in TRIAGE).
    const verdict = manualList ? null : await this.classify(organizationId, log, decision, plan, targets, keys, auto);
    if (verdict?.kind === 'HIDE') {
      await this.prisma.emailIngestLog.update({
        where: { id: logId },
        data: { orderId: null, shipmentId: null, inboxState: 'HIDDEN', purgeAfter: null, actions: { ...prev, planned: plan, backlog: { ...verdict, at: new Date().toISOString() } } as any },
      });
      return 'HIDDEN';
    }
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        orderId: targets[0]?.orderId ?? null,
        shipmentId: targets[0]?.shipmentId ?? null,
        actions: {
          ...(verdict ? { backlog: { ...verdict, at: new Date().toISOString() } } : {}),
          planned: plan,
          matchedBy: manualList ? 'manual' : decision.kind,
          confidence: manualList ? 'manual' : decision.confidence,
          ...(decision.check.length ? { check: decision.check } : {}),
          blocked,
          candidates: decision.candidates,
          multiOrderIds: decision.multiOrderIds,
          keyLabel: decision.keyLabel,
          reason: manualList ? 'picked by hand' : decision.reason,
          threadFrom: decision.threadFrom ?? null,
          ...(reasoned ? { reasoner: { apply: reasoned.apply, reason: reasoned.reason, evidence: reasoned.evidence, at: new Date().toISOString() }, evidence: reasoned.evidence } : {}),
          targets: targets.map((t) => ({ orderId: t.orderId ?? null, shipmentId: t.shipmentId ?? null, ...(t.attachmentIndexes ? { attachmentIndexes: t.attachmentIndexes } : {}) })),
          // What the intake suggested first — "Accept" vs "Change order…" is measured against it.
          suggested: prev.suggested ?? (manualList ? null : (targets[0] ?? null)),
          ...(prev.review ? { review: prev.review } : {}),
        } as any,
        inboxState: state,
      },
    });
    if (auto) {
      // The label in Processed: "history" for a closed record (round Q), "reasoned" (round R), else "thread" / the key.
      const label = verdict?.kind === 'HISTORY' ? 'history' : reasoned?.apply ? `reasoned · ${reasoned.keyLabel ?? 'thread'}` : decision.kind === 'thread' ? 'thread' : decision.keyLabel;
      await this.execute(organizationId, logId, SYSTEM_ACTOR, { review: 'AUTO', autoLabel: label });
      return 'PROCESSED';
    }
    // Round Q: a conversation-only email with one clear order / shipment is linked by itself (nothing to file);
    // about a completed order it is linked as history.
    const linkOnly = verdict && (verdict.kind === 'AUTO_LINK' || verdict.kind === 'HISTORY');
    if (linkOnly && !opts.safe && !manualList && mode !== 'TRIAGE' && state === 'SUGGESTED' && !plan.some((a) => a.kind === 'file' && a.status === 'planned')) {
      await this.execute(organizationId, logId, SYSTEM_ACTOR, { review: 'AUTO', autoLabel: backlogAutoLabel(verdict!.kind) });
      return 'PROCESSED';
    }
    return state;
  }

  /**
   * Round R: when at least two typed attachments' own content name different records (or one names a record
   * other than the email's target), each attachment goes to the record its content names; attachments naming
   * nothing follow the email's target. Auto only when every typed attachment is keyed (guard 1b per file).
   */
  private async splitByAttachment(organizationId: string, log: any, ev: EmailEvidence, decision: MatchDecision): Promise<{ targets: IntakeTarget[]; auto: boolean; reason: string; keyLabel: string | null } | null> {
    const triage = (log.triage ?? {}) as Partial<TriageResult>;
    const typedIdx = (triage.attachments ?? []).map((a) => ev.attachments.findIndex((x) => x.name === a.filename)).filter((i) => i >= 0);
    if (!typedIdx.length) return null;
    const records = await this.matchRecords(organizationId);
    const per = attachmentHits(ev, records, await this.ciPatterns(organizationId)).map((h) => ({ index: h.index, target: attachmentTarget(h.hits) }));
    const keyed = per.filter((p) => typedIdx.includes(p.index) && p.target);
    const distinct = new Set(keyed.map((p) => `${p.target!.orderId}:${p.target!.shipmentId ?? ''}`));
    const emailKey = decision.target ? `${decision.target.orderId}:${decision.target.shipmentId ?? ''}` : null;
    if (!keyed.length || (distinct.size === 1 && (!emailKey || distinct.has(emailKey)))) return null;
    const byTarget = new Map<string, IntakeTarget>();
    for (const p of keyed) {
      const k = `${p.target!.orderId}:${p.target!.shipmentId ?? ''}`;
      const t = byTarget.get(k) ?? { orderId: p.target!.orderId, shipmentId: p.target!.shipmentId, attachmentIndexes: [] };
      t.attachmentIndexes!.push(p.index);
      byTarget.set(k, t);
    }
    const rest = typedIdx.filter((i) => !keyed.some((p) => p.index === i));
    if (rest.length && decision.target) {
      const k = `${decision.target.orderId}:${decision.target.shipmentId ?? ''}`;
      const t = byTarget.get(k) ?? { orderId: decision.target.orderId, shipmentId: decision.target.shipmentId, attachmentIndexes: [] };
      t.attachmentIndexes!.push(...rest);
      byTarget.set(k, t);
    }
    const refs = [...byTarget.keys()].map((k) => recordRef(records.find((r) => r.orderId === k.split(':')[0] && (k.split(':')[1] ? r.shipmentId === k.split(':')[1] : true))!));
    return { targets: [...byTarget.values()], auto: rest.length === 0, reason: `each attachment's own content names its shipment: ${keyed.map((p) => `${ev.attachments[p.index].name} → ${p.target!.keyLabel}`).join(', ')} (${refs.join(' / ')})`, keyLabel: keyed[0].target!.keyLabel };
  }

  /** The org flag enableEmailReasoner (default off). */
  private async reasonerOn(organizationId: string): Promise<boolean> {
    try {
      const o = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { uiConfig: true } });
      return !!((o?.uiConfig as any)?.features?.enableEmailReasoner);
    } catch {
      return false;
    }
  }

  /** Tests replace the model call. */
  reasonerAi: AiCall = (system, user) => this.callClaude(system, user, REASONER_MODEL);

  /** Round R: the thread reasoner — build the context, ask the model, verify its answer (email-reasoner.ts). */
  async reason(organizationId: string, log: any, ev: EmailEvidence): Promise<ReasonerJudgement> {
    const records = await this.matchRecords(organizationId);
    const open = records.filter((r) => r.orderStatus === 'OPEN');
    // (No container-number column yet: the containers list stays empty until the B/L read stores them.)
    const ships: any[] = await this.prisma.shipment.findMany({ where: { organizationId, status: 'OPEN' }, select: { id: true, vessel: true, voyageNo: true, eta: true } }).catch(() => []);
    const shipOf = (id: string | null) => ships.find((s) => s.id === id);
    const rows: ReasonerRecordRow[] = open.map((r) => {
      const sh = shipOf(r.shipmentId);
      return {
        id: r.shipmentId ? `s:${r.shipmentId}` : `o:${r.orderId}`,
        ref: recordRef(r),
        customer: r.customerKey,
        grade: r.grade,
        size: r.size,
        qtyMt: r.qtyMt,
        netMt: r.netMt,
        deliveryMonth: r.deliveryMonth,
        bl: r.bl,
        vessel: sh ? [sh.vessel, sh.voyageNo].filter(Boolean).join(' / ') || null : null,
        eta: sh?.eta ? new Date(sh.eta).toISOString().slice(0, 10) : null,
        containers: [],
      };
    });
    const refs = await this.refs(organizationId, [...new Set(open.map((r) => r.orderId))], open.map((r) => r.shipmentId).filter((x): x is string => !!x));
    const toMsg = async (l: any, e: EmailEvidence): Promise<ReasonerThreadMessage> => {
      const { own, quoted } = splitQuoted(e.body);
      return {
        date: l.emailDate ? new Date(l.emailDate).toISOString().slice(0, 16) : null,
        fromDomain: (/@([^>\s]+)/.exec(l.fromAddress ?? '')?.[1] ?? '?').toLowerCase(),
        direction: l.direction ?? null,
        subject: e.subject,
        own,
        quoted,
        attachments: e.attachments.map((a, index) => ({ index, name: a.name, text: a.text })),
        linkedRef: l.shipmentId ? (refs.ship.get(l.shipmentId) ?? null) : l.orderId ? (refs.order.get(l.orderId) ?? null) : null,
      };
    };
    const threadRows = (await this.threadRows(organizationId, log)).slice(-8);
    const thread: ReasonerThreadMessage[] = [];
    for (const t of threadRows) thread.push(await toMsg(t, await this.evidence(t)));
    const ctx: ReasonerContext = { email: await toMsg(log, ev), thread, rows };
    const { system, user } = buildReasonerPrompt(ctx);
    const raw = await this.reasonerAi(system, user);
    const out = parseReasonerOutput(raw, rows, ev.attachments.length);
    if (!out) return { apply: false, targets: [], evidence: '', reason: 'the reasoner answer did not fit the schema', keyLabel: null };
    return judgeReasoner(out, ctx, records, ev);
  }

  /** Round Q: the backlog kind of an email given its decision and plan (see email-backlog.ts). */
  private async classify(organizationId: string, log: any, decision: MatchDecision, plan: IntakeAction[], targets: IntakeTarget[], keys: TriageKeys, wouldAuto: boolean): Promise<BacklogVerdict> {
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const triage = (log.triage ?? {}) as Partial<TriageResult>;
    const slotOf = (name: string) => {
      const t = (triage.attachments ?? []).find((a) => a.filename === name);
      return t && t.confidence >= 0.5 ? (TRIAGE_DOC_TYPES[t.docType] ?? null) : null;
    };
    const t = targets[0] ?? null;
    let targetClosed = false;
    if (t?.shipmentId) {
      const sh = await this.prisma.shipment.findFirst({ where: { id: t.shipmentId, organizationId }, select: { status: true } });
      // Past the port: steps 9 and 10 (A/N & instructions, import permit) done.
      const past: Array<{ code: string; status: string }> = sh ? await this.prisma.tradeStep.findMany({ where: { organizationId, shipmentId: t.shipmentId, code: { in: ['AN_INSTRUCTIONS', 'IMPORT_PERMIT'] } }, select: { code: true, status: true } }) : [];
      targetClosed = !!sh && (sh.status !== 'OPEN' || (past.length === 2 && past.every((x) => x.status === 'DONE')));
    } else if (t?.orderId) {
      const o = await this.prisma.tradeOrder.findFirst({ where: { id: t.orderId, organizationId }, select: { status: true } });
      targetClosed = !!o && o.status !== 'OPEN';
    }
    // A person brought it back from Hidden: it is mail, whatever the subject looks like.
    const unhidden = !!(log.actions as any)?.unhidden;
    const input: BacklogInput = {
      unhidden,
      autoSubmitted: !!(meta as { autoSubmitted?: boolean }).autoSubmitted,
      inboxState: log.inboxState ?? null,
      verdict: log.verdict ?? null,
      subject: log.subject ?? null,
      attachments: (meta.attachments ?? []).map((a) => ({ name: a.name, slot: slotOf(a.name) })),
      filesSomething: plan.some((a) => a.kind === 'file' && a.status === 'planned'),
      fillsSomething: plan.some((a) => a.kind === 'field' && a.status === 'planned'),
      target: t ? { orderId: t.orderId!, shipmentId: t.shipmentId ?? null } : null,
      confidence: decision.confidence,
      check: decision.check,
      multiOrderIds: decision.multiOrderIds,
      wouldAuto,
      targetClosed,
      keyInAims: decision.kind === 'pi' || decision.kind === 'bl' || decision.kind === 'ci' || decision.multiOrderIds.length > 0,
      keys: { piNo: keys.piNo ?? null, contractNo: keys.contractNo ?? null },
      date: log.emailDate ?? null,
    };
    return classifyEmail(input);
  }

  /** The decision for a stored email: its record keys, the accepted thread, its subject. */
  async decide(organizationId: string, log: any, ev?: EmailEvidence): Promise<MatchDecision> {
    const e = ev ?? (await this.evidence(log));
    const records = await this.matchRecords(organizationId);
    const hits = findKeyHits(e, records, await this.ciPatterns(organizationId));
    const thread = await this.threadContext(organizationId, log, records);
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
    return [...DEFAULT_CI_PATTERNS, ...supplierKeyPatterns(s.supplierProfiles).ci];
  }

  /** Supplier contract-number formats (round M): Vedanta's 4540xxxxx plus a profile's (SIAE_SC_xxxxxxxx). */
  private async contractPatterns(organizationId: string): Promise<string[]> {
    const s = await this.config.getSettings(organizationId);
    return [...DEFAULT_CONTRACT_PATTERNS, ...supplierKeyPatterns(s.supplierProfiles).contract];
  }

  /** The stored earlier / later messages of this email's thread: its Message-ID chain (In-Reply-To / References, both ways), else the same normalised subject. */
  private async threadRows(organizationId: string, log: { id: string; messageId?: string | null; threadKey: string | null; inReplyTo: string | null; rawMeta?: unknown }): Promise<any[]> {
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const ids = [log.inReplyTo ?? meta.inReplyTo, ...(meta.references ?? [])].map(normMessageId).filter((x): x is string => !!x);
    const mine = normMessageId(log.messageId);
    const or: any[] = [];
    if (ids.length) or.push({ messageId: { in: [...new Set(ids.flatMap((i) => [i, `<${i}>`]))] } });
    if (mine) or.push({ inReplyTo: { in: [mine, `<${mine}>`] } });
    if (log.threadKey) or.push({ threadKey: log.threadKey });
    if (!or.length) return [];
    return this.prisma.emailIngestLog.findMany({
      where: { organizationId, id: { not: log.id }, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'PROCESSED', 'UNSURE'] }, OR: or },
      orderBy: { createdAt: 'asc' },
      take: 60,
      select: { id: true, messageId: true, subject: true, orderId: true, shipmentId: true, inboxState: true, actions: true, emailDate: true, createdAt: true, rawMeta: true, triage: true },
    });
  }

  /**
   * Round P — what the thread already knows (see ThreadContext): the accepted / auto-applied link, the distinct
   * links of a combined thread, and the earliest message whose own subject / attachment NAMES carry a record key
   * (trace-back; attachment contents are not re-read here).
   */
  private async threadContext(organizationId: string, log: any, records: MatchRecord[]): Promise<ThreadContext> {
    const rows = await this.threadRows(organizationId, log);
    const out: ThreadContext = { accepted: null, traced: null, candidates: [] };
    if (!rows.length) return out;
    const processed = rows.filter((r) => r.inboxState === 'PROCESSED' && r.orderId && r.actions?.review?.outcome !== 'IGNORED');
    const newest = [...processed].reverse()[0];
    if (newest) out.accepted = { orderId: newest.orderId, shipmentId: newest.shipmentId ?? null };
    const seen = new Map<string, { orderId: string; shipmentId: string | null }>();
    for (const r of processed.length ? processed : rows.filter((r) => r.orderId && r.actions?.confidence !== 'cues')) {
      if (!r.orderId) continue;
      const k = `${r.orderId}:${r.shipmentId ?? ''}`;
      if (!seen.has(k)) seen.set(k, { orderId: r.orderId, shipmentId: r.shipmentId ?? null });
    }
    out.candidates = [...seen.values()];
    const ci = await this.ciPatterns(organizationId);
    for (const r of rows) {
      const meta = (r.rawMeta ?? {}) as Partial<StoredEmailMeta>;
      const ev: EmailEvidence = { subject: r.subject ?? '', body: '', attachments: (meta.attachments ?? []).map((a) => ({ name: a.name, text: '' })), date: r.emailDate ?? null };
      const hit = findKeyHits(ev, records, ci).find((h) => h.where.includes('subject') || h.where.includes('attachment'));
      if (!hit) continue;
      const rec = records.find((x) => x.orderId === hit.orderId && (hit.shipmentId === null || x.shipmentId === hit.shipmentId));
      out.traced = {
        orderId: hit.orderId,
        shipmentId: hit.shipmentId,
        keyLabel: `${hit.kind === 'bl' ? 'B/L' : hit.kind === 'pi' ? 'PI' : 'CI'} ${hit.value}`,
        date: r.emailDate ? new Date(r.emailDate).toISOString().slice(0, 10) : null,
      };
      void rec;
      break;
    }
    return out;
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
    const keys = sanitizeKeys({ ...mergeKeys(null, {}), ...((t.keys ?? {}) as TriageKeys) }, ciPatterns, await this.contractPatterns(organizationId));
    const triage = { ...t, attachments: known ? withKnownTypes((t.attachments ?? []) as TriageAttachment[], known) : (t.attachments ?? []), keys, ...(known ? { knownRule: known.rule } : {}) };
    const draft = { ...log, triage };
    const decision = await this.decide(organizationId, draft, ev);
    const targets = decision.target ? [await this.withSingleShipment(organizationId, decision.target)] : [];
    const plan = await this.buildPlan(organizationId, draft, keys, targets, ev);
    const needsShipment = plan.some((a) => a.kind === 'file' && a.status === 'skipped' && a.reason === 'pick the shipment');
    const unsupported = plan.filter((a) => a.kind === 'file' && a.status === 'planned' && a.stepOk === false);
    const blocked = [...decision.blocked, ...(unsupported.length ? [`e: no step takes ${[...new Set(unsupported.map((a) => a.docType))].join(', ')}`] : []), ...(needsShipment ? ['a: pick the shipment'] : [])];
    const wouldAuto = decision.auto && !!targets.length && !unsupported.length && !needsShipment;
    const verdict = await this.classify(organizationId, draft, decision, plan, targets, keys, wouldAuto);
    if (apply) {
      await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { triage: triage as any } });
      const cfg = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { routingMode: true } });
      await this.matchAndPlan(organizationId, logId, keys, intakeModeOf(cfg?.routingMode), undefined, { safe: true, keepState: log.inboxState === 'UNSURE' ? 'UNSURE' : undefined });
    }
    return { decision, targets, wouldAuto, blocked, plan, verdict };
  }

  /**
   * Round Q — clear the backlog: every unprocessed email is re-matched (today's rules, no AI), classified, and —
   * with `apply` — hidden (calendar / auto-reply / newsletter), linked by itself when conversation only with one
   * clear record ("Auto · linked (conversation)"), linked as history to a completed order ("Auto · history"), or
   * marked "No order yet". AUTO-GATE: nothing that files a document or fills a field is applied by this run —
   * those stay for Confirm (an email whose guards pass is reported as "would auto").
   */
  async backlog(organizationId: string, apply: boolean) {
    const rows: any[] = await this.prisma.emailIngestLog.findMany({
      where: { organizationId, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fromAddress: true, subject: true, inboxState: true, orderId: true, shipmentId: true, actions: true },
    });
    const out: Array<{ id: string; subject: string | null; from: string; before: string; kind: string; reason: string; ref: string | null; applied: string | null }> = [];
    for (const r of rows) {
      const before = `${r.inboxState}${r.orderId ? ` ${((r.actions ?? {}) as any).confidence ?? ''}`.trimEnd() : ''}`;
      try {
        const m = await this.rematchStored(organizationId, r.id, apply);
        const t = m.targets[0] ?? null;
        const refs = t ? await this.refs(organizationId, t.orderId ? [t.orderId] : [], t.shipmentId ? [t.shipmentId] : []) : null;
        const ref = t ? ((t.shipmentId ? refs!.ship.get(t.shipmentId) : refs!.order.get(t.orderId!)) ?? null) : null;
        let applied: string | null = null;
        if (apply) {
          const v = m.verdict;
          if (v.kind === 'HIDE') {
            const cur = await this.prisma.emailIngestLog.findFirst({ where: { id: r.id }, select: { actions: true } });
            await this.prisma.emailIngestLog.update({ where: { id: r.id }, data: { orderId: null, shipmentId: null, inboxState: 'HIDDEN', purgeAfter: null, actions: { ...((cur?.actions as object) ?? {}), backlog: { ...v, at: new Date().toISOString() } } as any } });
            applied = 'hidden';
          } else if ((v.kind === 'AUTO_LINK' || v.kind === 'HISTORY') && t) {
            // AUTO-GATE: a conversation-only email has no file / field action planned.
            const cur: any = await this.prisma.emailIngestLog.findFirst({ where: { id: r.id }, select: { actions: true, inboxState: true } });
            const planned: IntakeAction[] = cur?.actions?.planned ?? [];
            if (planned.some((a) => (a.kind === 'file' || a.kind === 'field') && a.status === 'planned')) throw new Error('AUTO-GATE: a conversation-only email has something to file');
            if (cur?.inboxState === 'UNSURE') await this.prisma.emailIngestLog.update({ where: { id: r.id }, data: { verdict: 'SHIPMENT', inboxState: 'SUGGESTED', purgeAfter: null } });
            await this.execute(organizationId, r.id, SYSTEM_ACTOR, { review: 'AUTO', autoLabel: backlogAutoLabel(v.kind) });
            applied = `linked → ${ref}`;
          } else applied = v.kind === 'NO_ORDER' ? 'marked "No order yet"' : 'left for a person';
        }
        out.push({ id: r.id, subject: r.subject, from: r.fromAddress, before, kind: m.verdict.kind, reason: m.verdict.reason, ref, applied });
      } catch (e) {
        out.push({ id: r.id, subject: r.subject, from: r.fromAddress, before, kind: 'FAILED', reason: String((e as Error)?.message ?? e).slice(0, 160), ref: null, applied: null });
      }
    }
    return out;
  }

  /** Round Q — Settings → Email filter → Hidden: the emails hidden as obvious non-shipment mail (from-domain + subject 60 only). */
  async hidden(organizationId: string) {
    const rows: any[] = await this.prisma.emailIngestLog.findMany({ where: { organizationId, inboxState: 'HIDDEN' }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, fromAddress: true, subject: true, emailDate: true, createdAt: true, actions: true } });
    return rows.map((r) => ({
      id: r.id,
      date: r.emailDate ?? r.createdAt,
      fromDomain: (/@([^>\s]+)/.exec(r.fromAddress ?? '')?.[1] ?? '').toLowerCase().replace(/[>;,]+$/, '') || '—',
      subject: (r.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      reason: (r.actions as any)?.backlog?.reason ?? null,
    }));
  }

  /** Unhide: back to the inbox, matched again with today's rules (never auto-applied). */
  async unhide(organizationId: string, logId: string) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log || log.inboxState !== 'HIDDEN') throw new NotFoundException('Hidden email not found');
    await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { inboxState: 'UNMATCHED', verdict: log.verdict ?? 'UNSURE', actions: { ...((log.actions as object) ?? {}), backlog: null, unhidden: true } as any } });
    const cfg = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId }, select: { routingMode: true } });
    await this.matchAndPlan(organizationId, logId, ((log.triage ?? {}) as { keys?: TriageKeys }).keys ?? mergeKeys(null, {}), intakeModeOf(cfg?.routingMode), undefined, { safe: true });
    return this.row(organizationId, logId);
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
          // Undo takes back only this email's own file — allowed on a completed (e.g. imported) shipment too.
          await this.files.remove(organizationId, f.id, { allowClosed: true });
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

  /** The stored email's raw meta (attachment keys) — for the controller's PI prefill. */
  async rawMeta(organizationId: string, logId: string) {
    const l = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId }, select: { rawMeta: true } });
    return (l?.rawMeta ?? null) as unknown;
  }

  async row(organizationId: string, logId: string) {
    const l: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!l) throw new NotFoundException('Email not found');
    return this.shape(l, await this.refs(organizationId, l.orderId ? [l.orderId] : [], l.shipmentId ? [l.shipmentId] : []));
  }

  private async refs(organizationId: string, orderIds: string[], shipmentIds: string[]) {
    const oSel = { id: true, orderNo: true, grade: true, qtyMt: true, customer: { select: { name: true } } };
    const [orders, ships]: [any[], any[]] = await Promise.all([
      orderIds.length ? this.prisma.tradeOrder.findMany({ where: { organizationId, id: { in: orderIds } }, select: oSel }) : [],
      shipmentIds.length ? this.prisma.shipment.findMany({ where: { organizationId, id: { in: shipmentIds } }, select: { id: true, seqNo: true, blNumber: true, netWeightMt: true, order: { select: oSel } } }) : [],
    ]);
    // "#20-1 · Kato 6005 40t · B/L 276956322" — the record in one line (round P).
    const short = (name: string | null | undefined) => (name ?? '').split(/[\s,]+/)[0] || null;
    const qty = (v: unknown) => (v === null || v === undefined || v === '' ? null : `${Number(v) % 1 ? Number(v).toFixed(1) : Number(v)}t`);
    const label = (ref: string, o: any, bl?: string | null, net?: unknown) => [ref, [short(o?.customer?.name), o?.grade, qty(net ?? o?.qtyMt)].filter(Boolean).join(' ') || null, bl ? `B/L ${bl}` : null].filter(Boolean).join(' · ');
    return {
      order: new Map<string, string>(orders.map((o) => [o.id, `#${o.orderNo}`])),
      ship: new Map<string, string>(ships.map((s) => [s.id, s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : (s.blNumber ?? 'shipment')])),
      orderLabel: new Map<string, string>(orders.map((o) => [o.id, label(`#${o.orderNo}`, o)])),
      shipLabel: new Map<string, string>(ships.map((s) => [s.id, label(s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : 'shipment', s.order, s.blNumber, s.netWeightMt)])),
    };
  }

  /** Round P: the step a filed / planned document goes to ("3b · Shipping documents") and the document types' labels. */
  private async stepLabels(organizationId: string, actions: IntakeAction[]) {
    const types: Array<{ code: string; label: string }> = await Promise.resolve(this.prisma.tradeDocType?.findMany({ where: { organizationId }, select: { code: true, label: true } }) ?? []).catch(() => []);
    const typeLabel = new Map(types.map((t) => [t.code, t.label]));
    const steps = new Map<string, { id: string; displayNo: string | null; title: string } | null>();
    for (const a of actions) {
      if (a.kind !== 'file' || !a.ownerId || !a.docType) continue;
      const k = `${a.ownerKind}:${a.ownerId}:${a.docType}`;
      if (steps.has(k)) continue;
      const owner = a.ownerKind === 'order' ? { orderId: a.ownerId } : a.ownerKind === 'supplierOrder' ? { supplierOrderId: a.ownerId } : { shipmentId: a.ownerId };
      const st = await this.prisma.tradeStep.findFirst({
        where: { organizationId, ...owner, OR: [{ requiredDocTypes: { has: a.docType } }, { optionalDocTypes: { has: a.docType } }] },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, displayNo: true, title: true },
      });
      steps.set(k, st ?? null);
    }
    return { typeLabel, stepOf: (a: IntakeAction) => steps.get(`${a.ownerKind}:${a.ownerId}:${a.docType}`) ?? null };
  }

  /**
   * Round P — Shipments › Inbox as threads: UNPROCESSED (Suggested + Unmatched + Unsure, each with the reason it
   * needs a person) or PROCESSED (accepted / auto-applied / ignored, with who and when). One row per thread
   * (Message-ID chain, else the subject), its messages newest first, the thread's link and counts.
   */
  async threads(organizationId: string, tab: 'UNPROCESSED' | 'PROCESSED', opts: { limit?: number; sinceDays?: number } = {}) {
    const states = tab === 'PROCESSED' ? ['PROCESSED'] : ['SUGGESTED', 'UNMATCHED', 'UNSURE'];
    const all: any[] = await this.prisma.emailIngestLog.findMany({
      where: { organizationId, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE', 'PROCESSED'] } },
      orderBy: { createdAt: 'desc' },
      take: 600,
    });
    const counts = { unprocessed: all.filter((l) => l.inboxState !== 'PROCESSED').length, processed: all.filter((l) => l.inboxState === 'PROCESSED').length };
    const refs = await this.refs(organizationId, [...new Set(all.map((l) => l.orderId).filter(Boolean))], [...new Set(all.map((l) => l.shipmentId).filter(Boolean))]);
    const labels = await this.stepLabels(organizationId, all.flatMap((l) => [...(((l.actions ?? {}) as any).planned ?? []), ...(((l.actions ?? {}) as any).done ?? [])]));
    const rowOf = (l: any) => {
      const m = (l.rawMeta ?? {}) as Partial<StoredEmailMeta>;
      const a = (l.actions ?? {}) as Record<string, any>;
      return { id: l.id, messageId: l.messageId, inReplyTo: l.inReplyTo ?? m.inReplyTo ?? null, references: m.references ?? [], threadKey: l.threadKey, date: l.emailDate ?? m.date ?? l.createdAt, inboxState: l.inboxState, orderId: l.orderId, shipmentId: l.shipmentId, confidence: a.confidence ?? null, outcome: a.review?.outcome ?? null };
    };
    const since = opts.sinceDays ? Date.now() - opts.sinceDays * 86_400_000 : null;
    const grouped = groupThreads(all.map(rowOf));
    const byId = new Map(all.map((l) => [l.id, l]));
    const linkOf = (orderId: string | null, shipmentId: string | null) => ({ orderId, shipmentId, ref: shipmentId ? (refs.ship.get(shipmentId) ?? null) : orderId ? (refs.order.get(orderId) ?? null) : null, label: shipmentId ? (refs.shipLabel.get(shipmentId) ?? null) : orderId ? (refs.orderLabel.get(orderId) ?? null) : null });
    const threads = grouped
      .map((t) => {
        const inTab = t.messages.filter((r) => states.includes(r.inboxState ?? '') && (!since || new Date(r.date ?? 0).getTime() >= since));
        if (!inTab.length) return null;
        const link = threadLink(t.messages);
        const messages = inTab.map((r) => this.shapeMessage(byId.get(r.id), refs, labels, t.messages.length));
        const files = t.messages.reduce((n, r) => n + ((((byId.get(r.id)?.rawMeta ?? {}) as Partial<StoredEmailMeta>).attachments ?? []).length), 0);
        const latest = byId.get(t.messages[0].id);
        return {
          id: t.id,
          by: t.by,
          /** Round Q: "No order yet — create one?" when every message of the thread in this tab has no order in AIMS. */
          section: tab === 'UNPROCESSED' && messages.length && messages.every((m) => m.reason?.code === 'NO_ORDER') ? ('NO_ORDER' as const) : null,
          subject: latest?.subject ?? null,
          latest: t.latest,
          emails: t.messages.length,
          files,
          link: link ? { ...linkOf(link.orderId, link.shipmentId), from: link.from, combined: link.combined.map((c) => linkOf(c.orderId, c.shipmentId)) } : null,
          messages,
          /** Messages of the thread outside this tab (a Processed one on an Unprocessed thread, and the other way round). */
          otherCount: t.messages.length - inTab.length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return { tab, counts, total: threads.length, threads: opts.limit ? threads.slice(0, opts.limit) : threads };
  }

  /** The inbox row plus (round P) the reason it needs a person, how it was matched, and what is / would be filed where. */
  private shapeMessage(l: any, refs: Awaited<ReturnType<EmailTriageService['refs']>>, labels: Awaited<ReturnType<EmailTriageService['stepLabels']>>, threadSize: number) {
    const base = this.shape(l, refs);
    const a = (l.actions ?? {}) as Record<string, any>;
    const list: IntakeAction[] = base.done.length ? base.done : base.planned;
    const multiRefs = (a.multiOrderIds ?? []).map((id: string) => refs.order.get(id) ?? null).filter(Boolean);
    const needsShipment = base.planned.some((x) => x.kind === 'file' && x.status === 'skipped' && x.reason === 'pick the shipment');
    const files = list
      .filter((x) => x.kind === 'file' && (x.status === 'planned' || x.status === 'done'))
      .map((x) => {
        const st = labels.stepOf(x);
        return {
          name: x.filename ?? '',
          docType: x.docType ?? null,
          docLabel: (x.docType && labels.typeLabel.get(x.docType)) || x.docType || null,
          status: x.status,
          ownerKind: x.ownerKind ?? null,
          ownerId: x.ownerId ?? null,
          ref: x.ownerKind === 'order' ? (refs.order.get(x.ownerId!) ?? null) : (refs.ship.get(x.ownerId!) ?? null),
          stepId: st?.id ?? null,
          stepNo: st?.displayNo ?? null,
          stepTitle: st?.title ?? null,
        };
      });
    const fields = list.filter((x) => x.kind === 'field' && (x.status === 'planned' || x.status === 'done')).map((x) => ({ field: x.field ?? '', value: x.value ?? '', status: x.status }));
    const link = base.orderId || base.shipmentId ? { orderId: base.orderId, shipmentId: base.shipmentId, ref: base.matched, label: base.shipmentId ? (refs.shipLabel.get(base.shipmentId) ?? base.matched) : base.orderId ? (refs.orderLabel.get(base.orderId) ?? base.matched) : null } : null;
    return {
      ...base,
      reason: unprocessedReason({ inboxState: base.inboxState, orderId: base.orderId, shipmentId: base.shipmentId, check: base.check, multiOrderRefs: multiRefs, needsShipment, backlogKind: a.backlog?.kind ?? null }),
      /** Round Q: the backlog kind (HIDE / AUTO_LINK / HISTORY / NO_ORDER / CONFIRM / PICK / IS_SHIPMENT) and the order-form seed. */
      backlog: a.backlog ? { kind: a.backlog.kind, reason: a.backlog.reason, seed: a.backlog.seed ?? null } : null,
      matchReason: a.reason ?? null,
      threadFrom: a.threadFrom ?? null,
      threadSize,
      linked: link ? { ...link, files, fields, linkOnly: !files.length && !fields.length } : null,
      /** "Confirmed by Sayaka · 21 Oct 10:12" / "Auto · B/L 198GX…" (Processed). */
      by: base.review ? { outcome: (base.review as any).outcome, name: (base.review as any).by ?? null, at: (base.review as any).at ?? null, autoLabel: base.autoLabel ?? null } : null,
    };
  }

  /** Round P — the Sales dashboard: emails to confirm (threads, newest first) and what was filed by itself in the last 3 days. */
  async dashboard(organizationId: string) {
    const [todo, done] = await Promise.all([this.threads(organizationId, 'UNPROCESSED', { limit: 10 }), this.threads(organizationId, 'PROCESSED', { sinceDays: 3 })]);
    const filedAuto = done.threads
      .flatMap((t) => t.messages.map((m) => ({ ...m, threadSubject: t.subject })))
      .filter((m) => m.by?.outcome === 'AUTO')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { toConfirm: { emails: todo.counts.unprocessed, threads: todo.threads, total: todo.total }, filedAuto };
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
      /** Round R: the one-line evidence note (hand review / the thread reasoner). */
      evidence: (actions as { evidence?: string | null }).evidence ?? null,
      reviewConfidence: (actions as { reviewConfidence?: string | null }).reviewConfidence ?? null,
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
  private async callClaude(system: string, user: string, model: string = MODEL): Promise<unknown> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey });
    // The reasoner runs on Claude Opus 5.5 (adaptive thinking is on by default there; no temperature / prefill).
    const r =
      model === REASONER_MODEL
        ? await client.messages.create({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] })
        : await client.messages.create({ model, max_tokens: 1500, temperature: 0, system, messages: [{ role: 'user', content: user }] });
    if (r.stop_reason === 'refusal') throw new Error('the model declined the request');
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
