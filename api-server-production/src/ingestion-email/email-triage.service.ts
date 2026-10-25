import { CarrierTrackingService } from '../shipments/carrier-tracking.service';
import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
import { ShipmentsNotifyService } from '../shipments/shipments-notify.service';
import { StoredEmailMeta } from './email-store';
import { companyOf, companyOverridesOf } from './email-companies';
import { attachmentHits, attachmentTarget, autoTier, DEFAULT_CI_PATTERNS, DEFAULT_CONTRACT_PATTERNS, decideMatch, EmailEvidence, findKeyHits, MatchDecision, MatchRecord, orderCuesMatch, ownTextCues, recordRef, SourceFamily, subjectCues, telexTiedTo, ThreadContext, validCiNo } from './email-match.rules';
import { auditLink, AuditResult, RECHECK_TEXT } from './email-audit';
import { answerText, Lang, QuestionCard, QuestionInput, questionOf } from './email-question';
import { arrivalNoticeLine, filedLine, importPermitLine, needsCheckText, NeedsCheckInput, senderLine } from '../operator/push-text';
import { splitQuoted, missingQuotedEmails, quotedEmailHeaders } from './email-quote';
import { blockRemoteContent, parseEmail, ParsedEmail } from './email-mime';
import { buildReasonerPrompt, judgeReasoner, parseReasonerOutput, ReasonerContext, ReasonerJudgement, ReasonerRecordRow, ReasonerThreadMessage } from './email-reasoner';
import { groupThreads, normMessageId, threadHeadersFromEml, threadLink, unprocessedReason } from './email-threads';
import { backlogAutoLabel, BacklogInput, BacklogVerdict, classifyEmail } from './email-backlog';
import { ShortLinksService } from '../short-links/short-links.service';
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
  cleanSummary,
  cleanSummaries,
  domainOf,
  fallbackSummary,
  isJapaneseText,
  Summaries,
  summaryForLang,
  summaryPrompt,
  isInlineImage,
  summaryTooLong,
} from './email-triage.rules';

/** Round AC: the stored summaries of a row (triage.summaryEn / summaryJa; an older row's single `summary` counts for the email's language). */
export function storedSummaries(l: { triage?: unknown; rawMeta?: unknown }): Summaries {
  const t = (l.triage ?? {}) as { summary?: unknown; summaryEn?: unknown; summaryJa?: unknown };
  const both: Summaries = { en: cleanSummary(t.summaryEn), ja: cleanSummary(t.summaryJa) };
  if (both.en || both.ja) return both;
  const one = cleanSummary(t.summary);
  return one ? (isJapaneseText(one) ? { en: null, ja: one } : { en: one, ja: null }) : both;
}

/**
 * Round AB / AC: an inbox row's one-line summary in the viewer's language — stored at triage time (English and
 * Japanese), else the first real sentence of the sender's own text (greetings / addressees / quoted headers
 * skipped). Display text only.
 */
export function summaryOfLog(l: { triage?: unknown; rawMeta?: unknown }, lang: 'en' | 'ja' = 'en'): string | null {
  const stored = summaryForLang(storedSummaries(l), lang);
  if (stored) return stored;
  return fallbackSummary(splitQuoted(String(((l.rawMeta ?? {}) as { bodyText?: string }).bodyText ?? '')).own);
}

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
/** Round AD: what a dry-run re-match WOULD do (nothing written) — the owner's "re-run on the open questions" script. */
export interface RematchPreview {
  state: InboxState;
  /** How it would apply by itself (null = stays a question). */
  apply: 'AUTO' | 'AUTO_LINK' | 'HISTORY' | 'GENERAL' | 'INHERIT_THREAD' | 'MULTI_LINK' | 'HIDE' | null;
  label: string | null;
  targets: IntakeTarget[];
  links: Array<{ orderId: string; shipmentId: string | null }>;
  plan: IntakeAction[];
  decision: { kind: string | null; source: string | null; reason: string | null; blocked: string[]; check: string[]; notes: string[]; sources: string[]; sourceLines: string[]; candidates: string[] };
  verdict: BacklogVerdict | null;
  reasoner: { apply: boolean; reason: string; evidence: string } | null;
  tier: string | null;
}
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
/** Who reviewed; `via` marks a decision made outside the portal (round S: 'whatsapp'). */
export type EmailActor = { id: string | null; name: string | null; via?: 'whatsapp' | null };
/** Round W: a question card's answer. */
/** Round AA: `targets` = several shipments picked in the Choose-shipment dialog (the email is linked to all of them). */
export type AnswerBody = { kind: 'record'; orderId?: string | null; shipmentId?: string | null; targets?: Array<{ orderId: string | null; shipmentId: string | null }> } | { kind: 'not_shipment' } | { kind: 'not_deal' } | { kind: 'later' };

const MODEL = 'claude-sonnet-4-6';
/** Round R: the thread reasoner (reads the whole thread + attachment text against the open records). */
const REASONER_MODEL = 'claude-opus-5-5';
const UNSURE_DAYS = 14;
const DEFAULT_OWN_DOMAINS = ['asiadealhub.com'];
const SYSTEM_ACTOR = { id: 'system:email-intake', name: 'Email intake' };
/** Document types that repeat per delivery — a second file of these never "replaces" anything (round R gate, shared since round U). */
export const REPEATABLE_DOC_TYPES = new Set(['DELIVERY_NOTE', 'VENDOR_INVOICE', 'PAYMENT_PROOF', 'DELIVERY_SCHEDULE', 'BUNDLE_LIST', 'OTHER']);

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
    @Optional() private readonly whatsapp?: ShipmentsNotifyService,
    @Optional() private readonly shortLinks?: ShortLinksService,
    @Optional() private readonly tracking?: CarrierTrackingService,
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
    const known = knownSender({ from: log.fromAddress, subject: log.subject, body: meta.bodyText ?? '', attachments: (meta.attachments ?? []).map((a, i) => ({ name: a.name, text: firstPages[i]?.firstPage ?? '' })) });
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
      // Round R follow-up: an Unsure email still goes through the rules — an empty email is hidden, a customer's
      // price / cost sheet becomes General, a no-text reply follows its thread; otherwise it stays Unsure.
      const kept = await this.matchAndPlan(organizationId, logId, keys, mode, undefined, { keepState: 'UNSURE' });
      this.actionLog.system('email-triage', kept === 'PROCESSED' ? 'PROCESS' : 'TRIAGE', 'EmailIngestLog', { organizationId, resourceId: logId, details: { verdict, counterparty, error, inboxState: kept } });
      return { verdict, inboxState: kept };
    }
    const state = await this.matchAndPlan(organizationId, logId, keys, mode);
    // Round AL: a carrier status / ETA notice → the latest ETA (unless typed by hand) + empty fields, history kept.
    if (known?.rule === 'CARRIER_TRACKING' && this.tracking) {
      const r = await this.tracking.fromEmail(organizationId, logId, `${log.subject ?? ''}\n${meta.bodyText ?? ''}`, known.blNo ?? ((keys as any)?.blNo ?? null));
      await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { triage: { ...(triage as any), tracking: r } as any } }).catch(() => null);
    }
    this.actionLog.system('email-triage', state === 'PROCESSED' ? 'PROCESS' : 'TRIAGE', 'EmailIngestLog', {
      organizationId,
      resourceId: logId,
      details: { verdict, direction, counterparty, inboxState: state },
    });
    await this.notifyNeedsMe(organizationId, logId, state);
    return { verdict, inboxState: state };
  }

  /** Round S: an email that now waits for a person → WhatsApp "needs you" (batched; once per email). */
  /** Round W: the WhatsApp question — the card's title, what AIMS found, numbered options, "Reply 1, 2 or 3" (in the user's language). */
  private async notifyNeedsMe(organizationId: string, logId: string, state: InboxState) {
    if (!this.whatsapp || (state !== 'SUGGESTED' && state !== 'UNMATCHED' && state !== 'UNSURE')) return;
    try {
      const q = await this.questionOfLog(organizationId, logId, 'en');
      if (!q) return;
      const ja = await this.questionOfLog(organizationId, logId, 'ja');
      const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId }, select: { fromAddress: true, emailDate: true, createdAt: true, subject: true, triage: true, rawMeta: true } });
      const company = companyOf(log?.fromAddress, await this.companyOverrides(organizationId)).name;
      // Round AB: the same one-line summary as the card, under the subject. Round AD: a short link.
      const base = { from: log?.fromAddress ?? null, company, date: log?.emailDate ?? log?.createdAt ?? null, subject: log?.subject ?? null, summary: log ? summaryOfLog(log, 'en') : null, portalUrl: await this.portalUrl(organizationId, 'emails') };
      // Round AC: the recipient's language picks the summary too.
      const baseJa = { ...base, summary: log ? summaryOfLog(log, 'ja') : null };
      const input = (card: QuestionCard, b = base): NeedsCheckInput => ({ ...b, kind: card.kind, options: card.options.map((o) => ({ ref: o.ref })), says: /says (.+?), but/.exec(q.card.title)?.[1] ?? null });
      const text = needsCheckText(input(q.card), 'en');
      await this.whatsapp.queue(organizationId, 'NEEDS_ME', text, { linkUrl: '/portal', dedupeKey: `needs:${logId}`, textFor: (prefs) => (prefs.lang === 'ja' && ja ? needsCheckText(input(ja.card, baseJa), 'ja') : text) });
    } catch {
      /* best effort */
    }
  }

  /** The Dashboard link the pushes point at — round AD: a short link (https://app.ai-ms.io/go/<token>; login required; 30 days). */
  async portalUrl(organizationId?: string, view?: 'emails'): Promise<string> {
    // Round Z: the Sales dashboard is the portal home (/portal; ?view=emails = the full email view).
    const path = `/portal${view ? `?view=${view}` : ''}`;
    if (organizationId && this.shortLinks) return this.shortLinks.url(organizationId, path);
    return `${process.env.PORTAL_URL || 'https://app.ai-ms.io'}${path}${organizationId ? `${view ? '&' : '?'}aorg=${organizationId}` : ''}`;
  }

  /** "Toshiro Takekoshi (Asia Deal Hub)" for a From header — the org's company map applied (round X, for chat replies). */
  async senderLabel(organizationId: string, from: string | null | undefined): Promise<string> {
    return senderLine(from, companyOf(from, await this.companyOverrides(organizationId)).name);
  }

  /** The company behind a From header ("Vedanta"), else the domain. */
  async companyLabel(organizationId: string, from: string | null | undefined): Promise<string> {
    const c = companyOf(from, await this.companyOverrides(organizationId));
    return c.name ?? c.domain ?? '?';
  }

  /** Round W: the question card of one unprocessed email (its thread's card) — for WhatsApp and the numbered reply. */
  async questionOfLog(organizationId: string, logId: string, lang: Lang): Promise<{ card: QuestionCard; answerIds: string[]; subject60: string } | null> {
    const { threads } = await this.threads(organizationId, 'UNPROCESSED', { lang });
    const t = threads.find((x) => x.answerIds.includes(logId));
    if (!t?.question) return null;
    return { card: t.question, answerIds: t.answerIds, subject60: (t.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) };
  }

  /**
   * Round W: ONE-TAP ANSWER of a question card, for every unprocessed email it covers.
   *   record        link (and file) each email to that order / shipment — "Linked to #18-2 · 2 files filed"
   *   not_shipment  hide them (Settings → Email filter → Hidden brings them back) — never deleted
   *   not_deal      the same, for a "new deal" card
   *   later         ask again tomorrow (snoozed a day)
   */
  async answer(organizationId: string, body: { ids: string[]; answer: AnswerBody }, actor: EmailActor, lang: Lang = 'en') {
    const ids = [...new Set((body.ids ?? []).filter((x) => typeof x === 'string'))].slice(0, 50);
    if (!ids.length) throw new BadRequestException('Nothing to answer');
    const a = body.answer;
    const done: string[] = [];
    const refs = new Set<string>();
    let files = 0;
    for (const id of ids) {
      const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id, organizationId } });
      if (!log || log.inboxState === 'PROCESSED' || log.inboxState === 'HIDDEN' || log.inboxState === 'PURGED') continue;
      if (a.kind === 'record') {
        const targets = (a.targets?.length ? a.targets : [{ orderId: a.orderId ?? null, shipmentId: a.shipmentId ?? null }]).filter((t) => t.orderId || t.shipmentId).slice(0, 10);
        if (!targets.length) throw new BadRequestException('Pick an order or a shipment');
        const row = await this.assign(organizationId, id, { targets, accept: true }, actor);
        if (row.matched) refs.add(row.matched);
        if (targets.length > 1) {
          const named = await this.refs(organizationId, targets.map((t) => t.orderId).filter((x): x is string => !!x), targets.map((t) => t.shipmentId).filter((x): x is string => !!x));
          for (const t of targets) { const r = t.shipmentId ? named.ship.get(t.shipmentId) : t.orderId ? named.order.get(t.orderId) : null; if (r) refs.add(r); }
        }
        files += (row.done ?? []).filter((x: IntakeAction) => x.kind === 'file' && x.status === 'done').length;
      } else if (a.kind === 'not_shipment' || a.kind === 'not_deal') {
        await this.prisma.emailIngestLog.update({
          where: { id },
          data: {
            inboxState: 'HIDDEN',
            purgeAfter: null,
            actions: { ...((log.actions as object) ?? {}), answered: { kind: a.kind, at: new Date().toISOString(), by: actor.name ?? actor.id, via: actor.via ?? null }, backlog: { kind: 'HIDE', reason: a.kind === 'not_deal' ? 'not a deal (answered)' : 'not about a shipment (answered)', at: new Date().toISOString() } } as any,
          },
        });
      } else if (a.kind === 'later') {
        await this.prisma.emailIngestLog.update({ where: { id }, data: { actions: { ...((log.actions as object) ?? {}), snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(), answered: { kind: 'later', at: new Date().toISOString(), by: actor.name ?? actor.id } } as any } });
      } else throw new BadRequestException('Unknown answer');
      done.push(id);
      this.actionLog.system('email-question', a.kind === 'record' ? 'PROCESS' : 'UPDATE', 'EmailIngestLog', { organizationId, resourceId: id, details: { answer: a.kind, by: actor.name ?? actor.id, via: actor.via ?? 'portal', subject: (log.subject ?? '').slice(0, 60) } });
    }
    return { kind: a.kind, ids: done, refs: [...refs], files, text: answerText(a.kind, lang, { refs: [...refs], files, emails: done.length }) };
  }

  /** Round W: Undo of an answer — files back out (undo), hidden emails back, a snooze cleared. */
  async answerUndo(organizationId: string, body: { ids: string[]; kind: AnswerBody['kind'] }, actor: EmailActor) {
    const ids = [...new Set((body.ids ?? []).filter((x) => typeof x === 'string'))].slice(0, 50);
    let n = 0;
    for (const id of ids) {
      const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id, organizationId } });
      if (!log) continue;
      if (body.kind === 'record') {
        if ((((log.actions ?? {}) as any).done ?? []).some((x: IntakeAction) => x.status === 'done')) await this.undo(organizationId, id, actor);
        else if (log.inboxState === 'PROCESSED') {
          const { review: _r, ...rest } = ((log.actions ?? {}) as Record<string, any>) ?? {};
          await this.prisma.emailIngestLog.update({ where: { id }, data: { inboxState: 'SUGGESTED', status: 'STORED', actions: { ...rest, done: [] } as any } });
        } else continue;
      } else if (body.kind === 'not_shipment' || body.kind === 'not_deal') {
        if (log.inboxState !== 'HIDDEN') continue;
        await this.unhide(organizationId, id);
      } else if (body.kind === 'later') {
        const { snoozedUntil: _s, ...rest } = ((log.actions ?? {}) as Record<string, any>) ?? {};
        await this.prisma.emailIngestLog.update({ where: { id }, data: { actions: rest as any } });
      }
      n++;
    }
    return { undone: n };
  }

  /** Round S: what an email filed → WhatsApp (AN arrived / import permit as events; any auto-filed file as the quiet "filed" kind). */
  private async notifyFiled(organizationId: string, log: any, done: IntakeAction[], review: ReviewOutcome | undefined) {
    if (!this.whatsapp) return;
    try {
      const files = done.filter((a) => a.kind === 'file' && a.status === 'done');
      if (!files.length) return;
      const refs = await this.refs(organizationId, files.filter((a) => a.ownerKind === 'order').map((a) => a.ownerId!), files.filter((a) => a.ownerKind !== 'order' && a.ownerKind !== 'supplierOrder').map((a) => a.ownerId!));
      const refOf = (a: IntakeAction) => (a.ownerKind === 'order' ? refs.order.get(a.ownerId!) : refs.ship.get(a.ownerId!)) ?? 'record';
      const subj = (log?.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
      for (const a of files) {
        // Round X: one plain line per event, no emojis, in the user's language.
        if (a.docType === 'ARRIVAL_NOTICE') await this.whatsapp.queue(organizationId, 'EVENT', arrivalNoticeLine(refOf(a), 'en'), { linkUrl: '/portal', dedupeKey: `an:${log.id}:${a.ownerId}`, textFor: (p) => arrivalNoticeLine(refOf(a), p.lang) });
        else if (a.docType === 'IMPORT_PERMIT') await this.whatsapp.queue(organizationId, 'EVENT', importPermitLine(refOf(a), 'en'), { linkUrl: '/portal', dedupeKey: `permit:${log.id}:${a.ownerId}`, textFor: (p) => importPermitLine(refOf(a), p.lang) });
      }
      void subj;
      if (review === 'AUTO') {
        const refs2 = [...new Set(files.map(refOf))].join(', ');
        await this.whatsapp.queue(organizationId, 'FILED', filedLine(refs2, files.length, 'en'), { linkUrl: '/portal', dedupeKey: `filed:${log.id}`, textFor: (p) => filedLine(refs2, files.length, p.lang) });
      }
    } catch {
      /* best effort */
    }
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
    opts: { safe?: boolean; keepState?: InboxState; dryRun?: boolean; capture?: (p: RematchPreview) => void } = {},
  ): Promise<InboxState> {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const prev = ((log.actions ?? {}) as Record<string, any>) ?? {};
    // Round AD: `dryRun` computes everything (rules, reasoner, plan, verdict) and hands it to `capture` — nothing is written.
    const dry = !!opts.dryRun;
    const ev = await this.evidence(log);
    const manualList = manual ? (Array.isArray(manual) ? manual : [manual]) : null;
    let decision: MatchDecision;
    let targets: IntakeTarget[];
    if (manualList?.length) {
      targets = [];
      for (const m of manualList) targets.push({ ...(await this.resolveManual(organizationId, m)), attachmentIndexes: m.attachmentIndexes });
      decision = { quoted: [], target: null, kind: null, confidence: 'exact', auto: false, blocked: ['picked by hand'], check: [], notes: [], source: null, sources: [], sourceLines: [], multiOrderIds: [], candidates: prev.candidates ?? [], keyLabel: null, reason: 'picked by hand', threadFrom: null };
    } else {
      decision = await this.decide(organizationId, log, ev);
      targets = decision.target ? [decision.target] : [];
      // Round R: attachment-content keys count per attachment (guard 1b per file) — one email can file to several
      // shipments. When the attachments' own content names different records, each goes to its own.
      const split = await this.splitByAttachment(organizationId, log, ev, decision);
      if (split) {
        targets = split.targets;
        decision = { ...decision, target: split.targets[0] ? { orderId: split.targets[0].orderId!, shipmentId: split.targets[0].shipmentId ?? null } : decision.target, kind: 'bl', confidence: 'exact', auto: split.auto, blocked: split.auto ? [] : decision.blocked, check: [], source: 'attachment', multiOrderIds: [], reason: split.reason, keyLabel: split.keyLabel, threadFrom: null, sources: split.sources, sourceLines: split.sourceLines, links: undefined };
      }
    }
    // An order with one live shipment: the shipment documents go there.
    targets = await Promise.all(targets.map((t) => this.withSingleShipment(organizationId, t)));
    let plan = await this.buildPlan(organizationId, log, keys, targets, ev);
    // Round R: the thread reasoner — when the rules can't decide (no target, several candidates, or a conflict) and
    // the org has it on. It may only pick rows from the open-records table; applied by itself only when its evidence
    // is verified (a hard key in the email's own content, or a unique product match) and nothing conflicts.
    let reasoned: ReasonerJudgement | null = null;
    let reasonerSources: { sources: SourceFamily[]; sourceLines: string[] } | null = null;
    if (!manualList && !opts.safe && (!targets.length || decision.multiOrderIds.length > 1 || decision.check.length || decision.source === 'own-cues' || decision.threadFrom === 'followed') && (await this.reasonerOn(organizationId))) {
      reasoned = await this.reason(organizationId, log, ev).catch((e) => {
        this.logger.warn(`[email-reasoner] ${logId}: ${(e as Error)?.message}`);
        return null;
      });
      // Round W, rule 3: the reasoner's verified answer is ONE source. It applies by itself only when a second,
      // independent one agrees — the thread's accepted link, a rules key hit for that record, or the order-level
      // cues. Otherwise its answer becomes the suggestion (the question card shows it first).
      if (reasoned?.apply) {
        const first = reasoned.targets[0];
        const recs = await this.matchRecords(organizationId);
        const tc = await this.threadContext(organizationId, log, recs);
        const strong = findKeyHits(ev, recs, await this.ciPatterns(organizationId)).filter((h) => h.where.some((w) => w !== 'quoted') && h.orderId === first.orderId && (!h.shipmentId || !first.shipmentId || h.shipmentId === first.shipmentId));
        const { own: ownTxt } = splitQuoted(ev.body ?? '');
        const oc = orderCuesMatch(ev, recs, subjectCues(ev.subject, ev.date), ownTextCues(ownTxt, recs, ev.date));
        const strongFamily = (h: { where: string[] }): SourceFamily => (h.where.includes('attachment') ? 'attachment' : h.where.includes('subject') ? 'subject' : 'own-text');
        const secondSources: Array<{ family: SourceFamily; line: string }> = [
          tc.accepted && tc.accepted.orderId === first.orderId && (!tc.accepted.shipmentId || !first.shipmentId || tc.accepted.shipmentId === first.shipmentId) ? { family: 'thread' as SourceFamily, line: 'an earlier email of this thread was linked to the same record' } : null,
          strong.length ? { family: strongFamily(strong[0]), line: `${strong[0].kind === 'bl' ? 'B/L' : strong[0].kind.toUpperCase()} ${strong[0].value} in the ${strongFamily(strong[0]) === 'own-text' ? 'email text' : strongFamily(strong[0])}` } : null,
          oc && !oc.ambiguous.length && oc.orders.length === 1 && oc.orders[0].orderId === first.orderId ? { family: 'subject' as SourceFamily, line: `the subject names the order (${oc.orders[0].why})` } : null,
        ].filter((x): x is { family: SourceFamily; line: string } => !!x);
        const second = secondSources.map((x) => x.line);
        // Round AD: the reasoner's verified reading is one source, the agreeing rule hit the other — recorded so the two-source gate sees them.
        reasonerSources = { sources: ['reasoner', ...secondSources.map((x) => x.family)].filter((f, i, a) => a.indexOf(f) === i) as SourceFamily[], sourceLines: [`AIMS read the email and thread: ${reasoned.evidence}`, ...second] };
        if (!second.length) {
          const picked = reasoned.targets.map((t) => ({ orderId: t.orderId, shipmentId: t.shipmentId, attachmentIndexes: t.attachmentIndexes }));
          targets = picked;
          decision = { ...decision, target: { orderId: picked[0].orderId!, shipmentId: picked[0].shipmentId ?? null }, kind: 'bl', confidence: 'cues', auto: false, blocked: [...decision.blocked.filter((b) => !/^a:/.test(b)), 'w: the reasoner is one source — a second one must agree (two-source rule)'], check: [], multiOrderIds: [], reason: `reasoner: ${reasoned.evidence}`, keyLabel: reasoned.keyLabel, threadFrom: null, sources: ['own-text'], sourceLines: [`AIMS read the email and thread: ${reasoned.evidence}`] };
          reasoned = { ...reasoned, apply: false, reason: `one source only — ${reasoned.reason}` };
          plan = await this.buildPlan(organizationId, log, keys, targets, ev);
        }
      }
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
        if (!dry) await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { triage: { ...triage, attachments: typed } as any } });
        log.triage = { ...triage, attachments: typed } as any;
        decision = { ...decision, target: { orderId: targets[0].orderId!, shipmentId: targets[0].shipmentId ?? null }, kind: 'bl', confidence: 'exact', auto: true, blocked: [], check: [], multiOrderIds: [], reason: `reasoner: ${reasoned.evidence}`, keyLabel: reasoned.keyLabel, threadFrom: null, links: undefined, ...(reasonerSources ?? {}) };
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
    // Round W, rule 3: anything that FILES a document or FILLS a field needs two agreeing sources to apply by itself.
    // A link-only reply that follows its thread (nothing changed on the record) still links by itself — the nightly
    // self-check re-verifies those.
    const changesSomething = plan.some((a) => (a.kind === 'file' || a.kind === 'field') && a.status === 'planned');
    const threadAuto = decision.kind === 'thread' ? decision.threadFrom === 'accepted' && decision.auto && !filesSomething && !decision.check.length : true;
    if (decision.kind === 'thread' && !threadAuto && decision.threadFrom === 'accepted' && filesSomething) blocked.push('thread: files documents — confirm');
    const auto =
      !opts.safe &&
      !manualList &&
      state === 'SUGGESTED' &&
      threadAuto &&
      (mode === 'AUTO' ? !decision.check.length : mode === 'PARTIAL_AUTO' ? decision.auto && !unsupported.length && !needsShipment && (!changesSomething || ((decision.sources?.length ?? 0) >= 2 && (await this.slotsFree(organizationId, plan)))) : false);
    if (!opts.safe && !manualList && state === 'SUGGESTED' && mode === 'PARTIAL_AUTO' && decision.auto && changesSomething && (decision.sources?.length ?? 0) < 2) blocked.push('w: one source only — filing needs two sources that agree');
    // Round Q: what kind of email this is (hide / auto-link / history / confirm / pick / no order) — stored on the
    // row for the inbox; applied live below (never with `safe`, never in TRIAGE).
    // Round U: apply by itself when the decision is sure — HIGH (a hard key in an attachment / the own text, no
    // conflict, no other order) or MEDIUM (a thread / cue decision that agrees with the thread's most recent
    // accepted link) — into EMPTY slots only, behind the org's reasoner flag; labelled "Auto · reviewed · …".
    const tier = !opts.safe && !manualList && state === 'SUGGESTED' && !reasoned?.apply ? autoTier(decision, await this.threadContext(organizationId, log, await this.matchRecords(organizationId))) : null;
    const tierAuto = !auto && !!tier && mode === 'PARTIAL_AUTO' && !unsupported.length && !needsShipment && !decision.check.length && (await this.reasonerOn(organizationId)) && (await this.slotsFree(organizationId, plan));
    const applyNow = auto || tierAuto;
    const verdict = manualList ? null : await this.classify(organizationId, log, decision, plan, targets, keys, applyNow);
    if (dry) {
      const linkOnlyKind = verdict && (verdict.kind === 'AUTO_LINK' || verdict.kind === 'HISTORY') && mode !== 'TRIAGE' && state === 'SUGGESTED' && !plan.some((a) => a.kind === 'file' && a.status === 'planned');
      const inherit = verdict && mode !== 'TRIAGE' && (verdict.kind === 'GENERAL' || verdict.kind === 'INHERIT_THREAD' || verdict.kind === 'MULTI_LINK');
      const apply: RematchPreview['apply'] = verdict?.kind === 'HIDE' ? 'HIDE' : applyNow ? 'AUTO' : linkOnlyKind ? (verdict!.kind as 'AUTO_LINK' | 'HISTORY') : inherit ? (verdict!.kind as 'GENERAL' | 'INHERIT_THREAD' | 'MULTI_LINK') : null;
      const label = apply === 'AUTO' ? (tierAuto ? `reviewed · ${decision.keyLabel ?? (decision.source === 'thread' ? 'thread' : 'subject')}` : verdict?.kind === 'HISTORY' ? 'history' : reasoned?.apply ? `reasoned · ${reasoned.keyLabel ?? 'thread'}` : decision.kind === 'thread' ? 'thread' : decision.keyLabel) : apply && apply !== 'HIDE' ? backlogAutoLabel(verdict!.kind, verdict!.customerKey, verdict!.links?.length ?? 0, verdict!.reason) : null;
      opts.capture?.({ state: apply ? (apply === 'HIDE' ? 'HIDDEN' : 'PROCESSED') : state, apply, label, targets, links: verdict?.links ?? decision.links ?? [], plan, decision: { kind: decision.kind, source: decision.source, reason: decision.reason, blocked, check: decision.check, notes: decision.notes ?? [], sources: decision.sources ?? [], sourceLines: decision.sourceLines ?? [], candidates: decision.candidates.map((c) => c.ref) }, verdict, reasoner: reasoned ? { apply: reasoned.apply, reason: reasoned.reason, evidence: reasoned.evidence } : null, tier });
      return apply ? (apply === 'HIDE' ? 'HIDDEN' : 'PROCESSED') : state;
    }
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
          // Round T: informational notes (multi-product subject, quoted mentions) and which cue decided.
          notes: decision.notes ?? [],
          source: decision.source ?? null,
          sources: decision.sources ?? [],
          sourceLines: decision.sourceLines ?? [],
          blocked,
          candidates: decision.candidates,
          quoted: decision.quoted ?? [],
          multiOrderIds: decision.multiOrderIds,
          keyLabel: decision.keyLabel,
          reason: manualList ? 'picked by hand' : decision.reason,
          threadFrom: decision.threadFrom ?? null,
          ...(reasoned ? { reasoner: { apply: reasoned.apply, reason: reasoned.reason, evidence: reasoned.evidence, at: new Date().toISOString() }, evidence: reasoned.evidence } : {}),
          ...(tierAuto ? { autoTier: tier, evidence: decision.reason } : tier ? { autoTier: tier } : {}),
          targets: targets.map((t) => ({ orderId: t.orderId ?? null, shipmentId: t.shipmentId ?? null, ...(t.attachmentIndexes ? { attachmentIndexes: t.attachmentIndexes } : {}) })),
          // What the intake suggested first — "Accept" vs "Change order…" is measured against it.
          suggested: prev.suggested ?? (manualList ? null : (targets[0] ?? null)),
          ...(prev.review ? { review: prev.review } : {}),
          // A person's Unhide (round Q) survives every re-match.
          ...(prev.unhidden ? { unhidden: true } : {}),
        } as any,
        inboxState: state,
      },
    });
    if (applyNow) {
      // The label in Processed: "history" for a closed record (round Q), "reasoned" (round R), else "thread" / the key.
      const label = tierAuto ? `reviewed · ${decision.keyLabel ?? (decision.source === 'thread' ? 'thread' : 'subject')}` : verdict?.kind === 'HISTORY' ? 'history' : reasoned?.apply ? `reasoned · ${reasoned.keyLabel ?? 'thread'}` : decision.kind === 'thread' ? 'thread' : decision.keyLabel;
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
    // Round R follow-up: general (customer-level sheet), inherit the thread's links, multi-link a schedule sheet.
    if (verdict && !opts.safe && !manualList && mode !== 'TRIAGE' && (verdict.kind === 'GENERAL' || verdict.kind === 'INHERIT_THREAD' || verdict.kind === 'MULTI_LINK')) {
      await this.applyLinkOnly(organizationId, logId, verdict);
      return 'PROCESSED';
    }
    return state;
  }

  /**
   * Round R follow-up: Processed without filing anything — GENERAL (customer only, no order), INHERIT_THREAD (the
   * thread's links) or MULTI_LINK (every candidate shipment). The links are stored as targets; the first is the
   * row's orderId / shipmentId; "Auto · general (SUS)" / "Auto · thread" / "Auto · linked (schedule)".
   */
  private async applyLinkOnly(organizationId: string, logId: string, verdict: BacklogVerdict) {
    const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const targets = (verdict.links ?? []).map((t) => ({ orderId: t.orderId, shipmentId: t.shipmentId ?? null, attachmentIndexes: [] as number[] }));
    const first = targets[0];
    const prev = ((log.actions ?? {}) as Record<string, any>) ?? {};
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        orderId: first?.orderId ?? null,
        shipmentId: first?.shipmentId ?? null,
        verdict: 'SHIPMENT',
        purgeAfter: null,
        actions: {
          ...prev,
          planned: [],
          targets,
          matchedBy: verdict.kind === 'GENERAL' ? null : 'thread',
          confidence: verdict.kind === 'GENERAL' ? 'none' : 'thread',
          reason: verdict.reason,
          backlog: { ...verdict, at: new Date().toISOString() },
          ...(verdict.kind === 'GENERAL' ? { general: { customerKey: verdict.customerKey ?? null } } : {}),
        } as any,
      },
    });
    await this.execute(organizationId, logId, SYSTEM_ACTOR, { review: 'AUTO', autoLabel: backlogAutoLabel(verdict.kind, verdict.customerKey, verdict.links?.length ?? 0, verdict.reason) });
  }

  /**
   * Round R: when at least two typed attachments' own content name different records (or one names a record
   * other than the email's target), each attachment goes to the record its content names; attachments naming
   * nothing follow the email's target. Auto only when every typed attachment is keyed (guard 1b per file).
   */
  private async splitByAttachment(organizationId: string, log: any, ev: EmailEvidence, decision: MatchDecision): Promise<{ targets: IntakeTarget[]; auto: boolean; reason: string; keyLabel: string | null; sources: SourceFamily[]; sourceLines: string[] } | null> {
    const triage = (log.triage ?? {}) as Partial<TriageResult>;
    // Round AD: only attachments that map to a document slot count (an inline signature image or an untyped file never blocks the split's auto).
    const typedIdx = (triage.attachments ?? []).filter((a) => a.confidence >= 0.5 && TRIAGE_DOC_TYPES[a.docType] && !isInlineImage(a.filename)).map((a) => ev.attachments.findIndex((x) => x.name === a.filename)).filter((i) => i >= 0);
    if (!typedIdx.length) return null;
    const records = await this.matchRecords(organizationId);
    const per = attachmentHits(ev, records, await this.ciPatterns(organizationId)).map((h) => ({ index: h.index, target: attachmentTarget(h.hits) }));
    const keyed = per.filter((p) => typedIdx.includes(p.index) && p.target);
    const distinct = new Set(keyed.map((p) => `${p.target!.orderId}:${p.target!.shipmentId ?? ''}`));
    const emailKey = decision.target ? `${decision.target.orderId}:${decision.target.shipmentId ?? ''}` : null;
    if (!keyed.length || (distinct.size === 1 && (!emailKey || distinct.has(emailKey)))) return null;
    const byTarget = new Map<string, IntakeTarget>();
    // Round V: the email's own link comes first (its row's orderId / shipmentId); attachments naming other records follow.
    if (decision.target) byTarget.set(`${decision.target.orderId}:${decision.target.shipmentId ?? ''}`, { orderId: decision.target.orderId, shipmentId: decision.target.shipmentId, attachmentIndexes: [] });
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
    // Round AD (owner): attachment key + the subject's order description = two sources. The subject names every
    // keyed target's order (a multi-product subject names each product's order) → 'subject' agrees.
    const { own: ownTxt } = splitQuoted(ev.body ?? '');
    const oc = orderCuesMatch(ev, records, subjectCues(ev.subject, ev.date), ownTextCues(ownTxt, records, ev.date));
    const keyedOrders = [...new Set(keyed.map((p) => p.target!.orderId))];
    const subjectAgrees = !!oc && !oc.ambiguous.length && keyedOrders.every((o) => oc.orders.some((x) => x.orderId === o));
    const sources: SourceFamily[] = subjectAgrees ? ['attachment', 'subject'] : ['attachment'];
    const sourceLines = [...keyed.map((p) => `${p.target!.keyLabel} in the attachment ${ev.attachments[p.index].name}`), ...(subjectAgrees ? [`the subject names the order${keyedOrders.length > 1 ? 's' : ''} (${oc!.orders.map((o) => o.why).join('; ')})`] : [])];
    return { targets: [...byTarget.values()], auto: rest.length === 0, reason: `each attachment's own content names its shipment: ${keyed.map((p) => `${ev.attachments[p.index].name} → ${p.target!.keyLabel}`).join(', ')} (${refs.join(' / ')})`, keyLabel: keyed[0].target!.keyLabel, sources, sourceLines };
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
  /**
   * Round W: `independent` = the second pass. The model does NOT see the email's current link, nor any link in its
   * thread that AIMS applied by itself — only links a person confirmed or changed. The audit and the nightly
   * self-check compare its answer with the stored link.
   */
  async reason(organizationId: string, log: any, ev: EmailEvidence, opts: { independent?: boolean } = {}): Promise<ReasonerJudgement> {
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
    const human = (l: any) => ['ACCEPTED', 'CHANGED'].includes(String(l?.actions?.review?.outcome ?? ''));
    const threadRows = (await this.threadRows(organizationId, log)).slice(-8);
    const thread: ReasonerThreadMessage[] = [];
    for (const t of threadRows) {
      const m = await toMsg(t, await this.evidence(t));
      thread.push(opts.independent && !human(t) ? { ...m, linkedRef: null } : m);
    }
    const self = await toMsg(log, ev);
    const ctx: ReasonerContext = { email: opts.independent ? { ...self, linkedRef: null } : self, thread, rows };
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
    // Round R follow-up inputs: own text, the customer, the thread's links, the subject's candidates, attachment texts.
    const ev = await this.evidence(log);
    const { own } = splitQuoted(ev.body);
    const records = await this.matchRecords(organizationId);
    const thread = await this.threadContext(organizationId, log, records);
    const threadLinks = thread.accepted && !thread.candidates.length ? [thread.accepted] : thread.candidates;
    const customerKey = ['SUS', 'KATO', 'HOEI'].includes(String(log.counterparty)) ? String(log.counterparty) : null;
    const candidates = decision.candidates.filter((c) => c.score >= 3 && !c.reasons.includes('key in the email')).map((c) => ({ orderId: c.orderId, shipmentId: c.shipmentId, ref: c.ref }));
    const input: BacklogInput = {
      unhidden,
      autoSubmitted: !!(meta as { autoSubmitted?: boolean }).autoSubmitted,
      ownTextEmpty: !own.trim(),
      customerKey,
      threadLinks,
      candidates,
      attachmentTexts: ev.attachments.map((a) => ({ name: a.name, text: a.text ?? '' })),
      inboxState: log.inboxState ?? null,
      verdict: log.verdict ?? null,
      subject: log.subject ?? null,
      // Round V: inline signature images never count as a document to file.
      attachments: (meta.attachments ?? []).map((a) => ({ name: a.name, slot: isInlineImage(a.name) ? null : slotOf(a.name) })),
      filesSomething: plan.some((a) => a.kind === 'file' && a.status === 'planned'),
      fillsSomething: plan.some((a) => a.kind === 'field' && a.status === 'planned'),
      target: t ? { orderId: t.orderId!, shipmentId: t.shipmentId ?? null } : null,
      confidence: decision.confidence,
      check: decision.check,
      multiOrderIds: decision.multiOrderIds,
      links: decision.links ?? [],
      counterparty: log.counterparty ?? null,
      wouldAuto,
      targetClosed,
      keyInAims: decision.kind === 'pi' || decision.kind === 'bl' || decision.kind === 'ci' || decision.multiOrderIds.length > 0,
      quotedRecords: decision.quoted ?? [],
      cueCandidates: decision.candidates.filter((c) => (c.reasons ?? []).length && c.score > 0).map((c) => ({ orderId: c.orderId, shipmentId: c.shipmentId, ref: c.ref })),
      keys: { piNo: keys.piNo ?? null, contractNo: keys.contractNo ?? null },
      date: log.emailDate ?? null,
      // Round AD: links from hard keys, the agreeing sources, the order's live shipments (schedule sheets link to all).
      linksByKey: !!decision.links?.length && /several records named/.test((decision.blocked ?? []).join(' ')),
      sources: decision.sources ?? [],
      orderShipments: t?.orderId && !t.shipmentId ? records.filter((r) => r.orderId === t.orderId && r.shipmentId && r.shipStatus !== 'CANCELLED').map((r) => ({ orderId: r.orderId, shipmentId: r.shipmentId!, ref: recordRef(r) })) : [],
    };
    const v = classifyEmail(input);
    if (v.kind === 'INHERIT_THREAD') v.links = threadLinks;
    if (v.kind === 'GENERAL' && !v.customerKey) v.customerKey = customerKey ?? (log.counterparty && !['OTHER', 'INTERNAL'].includes(String(log.counterparty)) ? String(log.counterparty) : null);
    if (v.kind === 'MULTI_LINK') v.links = decision.links?.length ? decision.links : candidates.map((c) => ({ orderId: c.orderId, shipmentId: c.shipmentId }));
    if (v.kind === 'GENERAL') v.customerKey = customerKey;
    return v;
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
    return { subject: log.subject ?? '', body: meta.bodyText ?? '', attachments, date: log.emailDate ?? (meta.date ? new Date(meta.date) : null), counterparty: log.counterparty ?? null };
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
      // A multi-link message (round R) keeps every target in actions.targets; the row's own ids are the first.
      const list: Array<{ orderId: string | null; shipmentId: string | null }> = Array.isArray(r.actions?.targets) && r.actions.targets.length ? r.actions.targets : [{ orderId: r.orderId, shipmentId: r.shipmentId ?? null }];
      for (const t of list) {
        if (!t.orderId) continue;
        const k = `${t.orderId}:${t.shipmentId ?? ''}`;
        if (!seen.has(k)) seen.set(k, { orderId: t.orderId, shipmentId: t.shipmentId ?? null });
      }
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
  /**
   * Round U AUTO-GATE: a planned file may go only where that owner has no file of its type yet (single-slot types
   * are never replaced; delivery notes / vendor invoices / proofs / schedules / bundle lists repeat per delivery).
   */
  async slotsFree(organizationId: string, plan: IntakeAction[]): Promise<boolean> {
    for (const a of plan) {
      if (a.kind !== 'file' || a.status !== 'planned' || !a.docType || !a.ownerId) continue;
      if (REPEATABLE_DOC_TYPES.has(a.docType)) continue;
      const key = a.ownerKind === 'order' ? 'orderId' : a.ownerKind === 'supplierOrder' ? 'supplierOrderId' : 'shipmentId';
      const files: Array<{ links?: Array<Record<string, string | null>> }> = await this.prisma.tradeFile.findMany({ where: { organizationId, docType: a.docType }, select: { id: true, links: { select: { shipmentId: true, orderId: true, supplierOrderId: true } } } });
      if (files.some((f) => (f.links ?? []).some((l) => l[key] === a.ownerId))) return false;
    }
    return true;
  }

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
      // Round V: inline signature images (image001.png …) are never "something to file".
      if (isInlineImage(a.name)) {
        out.push({ kind: 'file', status: 'skipped', reason: 'inline image', attachmentIndex: i, filename: a.name });
        continue;
      }
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
      // Round W follow-up: a CI no. is ONE invoice's (XP2652102551 ≠ XP2652102552) — never filled by a split (multi-target)
      // email, and never when another shipment already carries it.
      const ciNo = validCiNo(keys.ciNo, await this.ciPatterns(organizationId));
      if (ciNo && !multi && s && !s.ciNumber) {
        const other = await this.prisma.shipment.findFirst({ where: { organizationId, ciNumber: ciNo, NOT: { id: target.shipmentId } }, select: { id: true } });
        if (!other) fill('ciNumber', ciNo);
      }
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
          } else if (v.kind === 'GENERAL' || v.kind === 'INHERIT_THREAD' || v.kind === 'MULTI_LINK') {
            const cur: any = await this.prisma.emailIngestLog.findFirst({ where: { id: r.id }, select: { actions: true } });
            const planned: IntakeAction[] = cur?.actions?.planned ?? [];
            if (planned.some((a) => a.kind === 'file' && a.status === 'planned')) throw new Error('AUTO-GATE: a link-only verdict has something to file');
            await this.applyLinkOnly(organizationId, r.id, v);
            applied = v.kind === 'GENERAL' ? `general (${v.customerKey})` : `linked → ${(v.links ?? []).length} record(s)`;
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
  async execute(organizationId: string, logId: string, actor: EmailActor, opts: { review?: ReviewOutcome; autoLabel?: string | null } = {}) {
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
          ...(opts.review ? { review: { outcome: opts.review, at: new Date().toISOString(), by: actor.name ?? actor.id, ...(actor.via ? { via: actor.via } : {}) } } : {}),
          ...(opts.review === 'AUTO' ? { autoLabel: opts.autoLabel ?? null } : {}),
        } as any,
        inboxState: 'PROCESSED',
        status: 'PROCESSED',
      },
    });
    await this.notifyFiled(organizationId, log, done, opts.review);
    return this.row(organizationId, logId);
  }

  /** Undo everything the email did: remove its files (reopening steps they completed), clear the fields it filled, untick its sub-tasks. */
  async undo(organizationId: string, logId: string, actor: EmailActor) {
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
  async purge(organizationId: string, logId: string, keep: { verdict: string; counterparty?: string | null; review?: { outcome: ReviewOutcome; at: string; by: string | null; via?: string | null } }) {
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

  // ── round W: the second pass (audit + nightly self-check) ────────────────
  /**
   * Re-verify one stored link: the hard evidence the email carries (strong key hits, order-level cues) and the
   * independent second pass (the reasoner without the current link) against what is stored. Pure comparison in
   * email-audit.ts. `store` keeps the result on the row (actions.selfCheck) for the "Why?" panel.
   */
  async secondPass(organizationId: string, logId: string, opts: { store?: boolean } = {}): Promise<AuditResult & { logId: string; subject: string | null; fromDomain: string }> {
    const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const a = (log.actions ?? {}) as Record<string, any>;
    const general = !!a.general && !log.orderId && !log.shipmentId;
    const current: Array<{ orderId: string; shipmentId: string | null }> = (Array.isArray(a.targets) && a.targets.length ? a.targets : log.orderId ? [{ orderId: log.orderId, shipmentId: log.shipmentId ?? null }] : []).filter((t: any) => t?.orderId).map((t: any) => ({ orderId: t.orderId, shipmentId: t.shipmentId ?? null }));
    const ev = await this.evidence(log);
    const records = await this.matchRecords(organizationId);
    const hits = findKeyHits(ev, records, await this.ciPatterns(organizationId));
    const { own } = splitQuoted(ev.body ?? '');
    const oc = orderCuesMatch(ev, records, subjectCues(ev.subject, ev.date), ownTextCues(own, records, ev.date));
    const second = await this.reason(organizationId, log, ev, { independent: true }).catch((e) => {
      this.logger.warn(`[second-pass] ${logId}: ${(e as Error)?.message}`);
      return null;
    });
    const result = auditLink({ current, general, hits, orderCues: oc && !oc.ambiguous.length ? oc.orders : [], second, records });
    if (opts.store) {
      const fresh = await this.prisma.emailIngestLog.findFirst({ where: { id: logId }, select: { actions: true } });
      await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { actions: { ...((fresh?.actions as object) ?? {}), selfCheck: { at: new Date().toISOString(), verdict: result.verdict, current: result.currentRefs, second: result.secondRefs, text: result.secondText, evidence: result.evidence } } as any } });
    }
    return { ...result, logId, subject: log.subject ?? null, fromDomain: (/@([^>\s]+)/.exec(log.fromAddress ?? '')?.[1] ?? '?').toLowerCase() };
  }

  /**
   * Round W: a link the second pass disagrees with goes back to Unprocessed as a QUESTION — what it did is undone
   * (files removed, steps reopened), the stored link stays as the first answer option, the second pass's answer is
   * the other, and the card says "AIMS re-checked this and isn't sure anymore".
   */
  async sendBackAsQuestion(organizationId: string, logId: string, result: AuditResult, actor: EmailActor, source: 'audit' | 'self-check') {
    const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    const did = (((log.actions ?? {}) as any).done ?? []).some((x: IntakeAction) => x.status === 'done');
    if (did) await this.undo(organizationId, logId, actor);
    const fresh: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId }, select: { actions: true, orderId: true, shipmentId: true } });
    const prev = (fresh?.actions ?? {}) as Record<string, any>;
    const second = (result.secondTargets ?? []).map((t) => ({ orderId: t.orderId, shipmentId: t.shipmentId }));
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        inboxState: fresh?.orderId || fresh?.shipmentId ? 'SUGGESTED' : 'UNMATCHED',
        status: 'STORED',
        purgeAfter: null,
        actions: {
          ...prev,
          done: [],
          review: undefined,
          autoLabel: null,
          question: { kind: 'RECHECK', at: new Date().toISOString(), source, text: RECHECK_TEXT.en, textJa: RECHECK_TEXT.ja, current: result.currentRefs, second: result.secondRefs, secondTargets: second, secondText: result.secondText, evidence: result.evidence, hardCurrent: result.hardCurrent, hardSecond: result.hardSecond },
          selfCheck: { at: new Date().toISOString(), verdict: result.verdict, current: result.currentRefs, second: result.secondRefs, text: result.secondText, evidence: result.evidence },
        } as any,
      },
    });
    this.actionLog.system(source === 'audit' ? 'email-audit' : 'email-self-check', 'UPDATE', 'EmailIngestLog', { organizationId, resourceId: logId, details: { verdict: result.verdict, current: result.currentRefs, second: result.secondRefs, subject: (log.subject ?? '').slice(0, 60) } });
    await this.notifyNeedsMe(organizationId, logId, 'SUGGESTED');
    return this.row(organizationId, logId);
  }

  /**
   * Round W, rule 4 — nightly self-check: the second pass runs again on every email AIMS linked by itself in the
   * last 7 days (orgs with the reasoner on). A disagreement goes back to Unprocessed as a question; the nightly
   * never moves a link by itself.
   */
  @Cron('47 3 * * *')
  async selfCheck(orgId?: string): Promise<{ checked: number; sentBack: number }> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows: Array<{ id: string; organizationId: string; actions: any }> = await this.prisma.emailIngestLog.findMany({
      where: { ...(orgId ? { organizationId: orgId } : {}), inboxState: 'PROCESSED', updatedAt: { gte: since } },
      select: { id: true, organizationId: true, actions: true },
      take: 400,
    });
    let checked = 0;
    let sentBack = 0;
    const orgs = new Map<string, boolean>();
    for (const r of rows) {
      const review = r.actions?.review;
      if (review?.outcome !== 'AUTO' || !review.at || new Date(review.at) < since) continue;
      if (!orgs.has(r.organizationId)) orgs.set(r.organizationId, await this.reasonerOn(r.organizationId));
      if (!orgs.get(r.organizationId)) continue;
      await runAsOrg(r.organizationId, async () => {
        const res = await this.secondPass(r.organizationId, r.id, { store: true }).catch((e) => {
          this.logger.warn(`[self-check] ${r.id}: ${(e as Error)?.message}`);
          return null;
        });
        if (!res) return;
        checked++;
        if (res.verdict === 'DISAGREE_CLEAR' || res.verdict === 'DISAGREE_UNCLEAR') {
          await this.sendBackAsQuestion(r.organizationId, r.id, res, SYSTEM_ACTOR, 'self-check');
          sentBack++;
        }
      });
    }
    if (checked) this.logger.log(`[self-check] checked ${checked}, sent back ${sentBack}`);
    return { checked, sentBack };
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
  /**
   * Round T — the whole email for the portal's email view: headers, text (own + quoted), raw HTML with remote
   * content defused (the client sanitises and sandboxes it), attachments with a 1-hour download URL. Read from
   * the stored .eml (raw from the worker, or the reconstructed one for old rows). Nothing in it is executed.
   */
  async message(organizationId: string, logId: string) {
    const l: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!l) throw new NotFoundException('Email not found');
    const meta = (l.rawMeta ?? {}) as Partial<StoredEmailMeta> & { source?: string; bodyText?: string };
    let parsed: ParsedEmail | null = null;
    if (meta.emlKey) {
      try {
        parsed = parseEmail(await this.s3.downloadFile(meta.emlKey));
      } catch (e) {
        this.logger.warn(`message ${logId}: could not read the .eml (${(e as Error)?.message})`);
      }
    }
    const text = parsed?.text ?? meta.bodyText ?? null;
    const { own, quoted } = splitQuoted(text ?? '');
    const html = parsed?.html ? blockRemoteContent(parsed.html) : null;
    const attachments = await Promise.all(
      (meta.attachments ?? []).map(async (a, index) => ({ index, name: a.name, contentType: a.contentType, size: a.size, url: await this.s3.getSignedUrl(a.key, 3600).catch(() => null) })),
    );
    return {
      id: l.id,
      headers: { from: parsed?.headers.from || l.fromAddress, to: parsed?.headers.to || meta.to || '', cc: parsed?.headers.cc || (meta.cc ?? []).join(', '), date: parsed?.headers.date || l.emailDate?.toISOString() || meta.date || null, subject: parsed?.headers.subject || l.subject || '' },
      text: own || text,
      quoted: quoted || null,
      html: html?.html ?? null,
      blockedRemote: html?.blocked ?? 0,
      attachments,
      source: meta.source === 'whatsapp' ? 'whatsapp' : 'email',
      reconstructed: meta.emlSource === 'reconstructed',
      inboxState: l.inboxState,
    };
  }

  /** Round T — the thread of an email (itself included), oldest → newest, as inbox messages. */
  async thread(organizationId: string, logId: string) {
    const l: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!l) throw new NotFoundException('Email not found');
    const rows: any[] = [...(await this.threadRows(organizationId, l)), l].sort((a, b) => new Date(a.emailDate ?? a.createdAt).getTime() - new Date(b.emailDate ?? b.createdAt).getTime());
    const full: any[] = await this.prisma.emailIngestLog.findMany({ where: { organizationId, id: { in: rows.map((r) => r.id) } } });
    const byId = new Map(full.map((r) => [r.id, r]));
    const refs = await this.refs(organizationId, [...new Set(full.map((r) => r.orderId).filter(Boolean))], [...new Set(full.map((r) => r.shipmentId).filter(Boolean))]);
    const labels = await this.stepLabels(organizationId, full.flatMap((r) => [...((r.actions as any)?.planned ?? []), ...((r.actions as any)?.done ?? [])]));
    // Round AF (owner): every attachment of every stored email in the thread (inline signature images left out), newest
    // first, with its date and sender; and how many earlier emails the replies QUOTE that AIMS never received.
    const companies = await this.companyOverrides(organizationId);
    const files = full
      .flatMap((r) => (((r.rawMeta ?? {}) as Partial<StoredEmailMeta>).attachments ?? []).map((a, index) => ({ emailId: r.id as string, index, name: a.name, contentType: a.contentType ?? null, size: a.size ?? null, date: (r.emailDate ?? r.createdAt) as Date, from: r.fromAddress as string, company: companyOf(r.fromAddress, companies).name })))
      .filter((f) => !isInlineImage(f.name))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const quotedHeaders = quotedEmailHeaders(full.map((r) => splitQuoted(String(((r.rawMeta ?? {}) as { bodyText?: string }).bodyText ?? '')).quoted).join('\n\n'));
    const quotedMissing = missingQuotedEmails(quotedHeaders, full.map((r) => ({ from: r.fromAddress, date: r.emailDate ?? r.createdAt })));
    return { id: l.id, messages: rows.map((r) => this.shapeMessage(byId.get(r.id), refs, labels, rows.length)), files, quotedMissing, quotedTotal: quotedHeaders.length };
  }

  async attachmentUrl(organizationId: string, logId: string, index: number) {
    const l: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId }, select: { rawMeta: true } });
    const a = ((l?.rawMeta ?? {}) as Partial<StoredEmailMeta>).attachments?.[index];
    if (!a) throw new NotFoundException('Attachment not found');
    return { name: a.name, contentType: a.contentType, size: a.size, url: await this.s3.getSignedUrl(a.key, 3600) };
  }

  async rawMeta(organizationId: string, logId: string) {
    const l = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId }, select: { rawMeta: true } });
    return (l?.rawMeta ?? null) as unknown;
  }

  async row(organizationId: string, logId: string) {
    const l: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!l) throw new NotFoundException('Email not found');
    return this.shape(l, await this.refs(organizationId, l.orderId ? [l.orderId] : [], l.shipmentId ? [l.shipmentId] : []));
  }

  /** Round W (C.4): the org's domain → company list (docDefaults.emailCompanies), cached 60 s per org. */
  private companyCache = new Map<string, { at: number; map: Record<string, string> }>();
  private async companyOverrides(organizationId: string): Promise<Record<string, string>> {
    const hit = this.companyCache.get(organizationId);
    if (hit && Date.now() - hit.at < 60_000) return hit.map;
    const map = companyOverridesOf((await this.config.getSettings(organizationId).catch(() => null))?.docDefaults);
    this.companyCache.set(organizationId, { at: Date.now(), map });
    return map;
  }

  private async refs(organizationId: string, orderIds: string[], shipmentIds: string[]) {
    const companies = await this.companyOverrides(organizationId);
    const oSel = { id: true, orderNo: true, grade: true, qtyMt: true, customer: { select: { name: true } } };
    const [orders, ships]: [any[], any[]] = await Promise.all([
      orderIds.length ? this.prisma.tradeOrder.findMany({ where: { organizationId, id: { in: orderIds } }, select: oSel }) : [],
      shipmentIds.length ? this.prisma.shipment.findMany({ where: { organizationId, id: { in: shipmentIds } }, select: { id: true, seqNo: true, blNumber: true, netWeightMt: true, vessel: true, eta: true, order: { select: oSel } } }) : [],
    ]);
    // Round W: the question card's record summary — "#18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct".
    const etaShort = (v: unknown) => (v ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', day: 'numeric', month: 'short' }).format(new Date(v as string)) : null);
    const summary = (ref: string, o: any, s?: any) => [ref, [(o?.customer?.name ?? '').split(/[\s,]+/)[0] || null, o?.grade].filter(Boolean).join(' ') || null, s?.netWeightMt != null ? `${Number(s.netWeightMt) % 1 ? Number(s.netWeightMt).toFixed(1) : Number(s.netWeightMt)} t` : o?.qtyMt != null ? `${Number(o.qtyMt)} t` : null, s?.vessel ?? null, s?.eta ? `ETA ${etaShort(s.eta)}` : null].filter(Boolean).join(' · ');
    // "#20-1 · Kato 6005 40t · B/L 276956322" — the record in one line (round P).
    const short = (name: string | null | undefined) => (name ?? '').split(/[\s,]+/)[0] || null;
    const qty = (v: unknown) => (v === null || v === undefined || v === '' ? null : `${Number(v) % 1 ? Number(v).toFixed(1) : Number(v)}t`);
    const label = (ref: string, o: any, bl?: string | null, net?: unknown) => [ref, [short(o?.customer?.name), o?.grade, qty(net ?? o?.qtyMt)].filter(Boolean).join(' ') || null, bl ? `B/L ${bl}` : null].filter(Boolean).join(' · ');
    return {
      companies,
      order: new Map<string, string>(orders.map((o) => [o.id, `#${o.orderNo}`])),
      ship: new Map<string, string>(ships.map((s) => [s.id, s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : (s.blNumber ?? 'shipment')])),
      orderLabel: new Map<string, string>(orders.map((o) => [o.id, label(`#${o.orderNo}`, o)])),
      shipLabel: new Map<string, string>(ships.map((s) => [s.id, label(s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : 'shipment', s.order, s.blNumber, s.netWeightMt)])),
      summary: new Map<string, string>([
        ...orders.map((o): [string, string] => [`${o.id}:`, summary(`#${o.orderNo}`, o)]),
        ...ships.map((s): [string, string] => [`${s.order?.id ?? ''}:${s.id}`, summary(s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : 'shipment', s.order, s)]),
      ]),
    };
  }

  /** Round W: the question card of an unprocessed message (see email-question.ts). */
  private questionFor(m: any, refs: { order: Map<string, string>; ship: Map<string, string>; summary: Map<string, string> }, lang: Lang, thread: { size: number; subject: string | null; seed?: any; links?: Array<{ orderId: string; shipmentId: string | null }> }): QuestionCard | null {
    if (!m.reason && !m.question) return null;
    const refOf = (orderId: string, shipmentId: string | null) => (shipmentId ? refs.ship.get(shipmentId) : refs.order.get(orderId)) ?? '#?';
    const summaryOf = (orderId: string, shipmentId: string | null) => refs.summary.get(`${orderId}:${shipmentId ?? ''}`) ?? (shipmentId ? [...refs.summary.entries()].find(([k]) => k.endsWith(`:${shipmentId}`))?.[1] : null) ?? refs.summary.get(`${orderId}:`) ?? null;
    const suggested = m.orderId || m.shipmentId ? { orderId: m.orderId, shipmentId: m.shipmentId ?? null, ref: m.matched ?? refOf(m.orderId, m.shipmentId), why: (m.sourceLines?.length ? m.sourceLines : m.matchReason ? [m.matchReason] : []) as string[] } : null;
    const candidates: QuestionInput['candidates'] = [];
    // Only candidates that fit for a reason (the picker's shortlist pads to 3 with zero-score records).
    for (const c of (m.candidates ?? []) as Array<{ orderId: string; shipmentId: string | null; ref: string; score?: number; reasons: string[] }>) if ((c.reasons ?? []).length && (c.score ?? 1) > 0) candidates.push({ orderId: c.orderId, shipmentId: c.shipmentId, ref: c.ref, why: c.reasons ?? [] });
    for (const l of [...((m.targets ?? []) as Array<{ orderId: string | null; shipmentId: string | null }>), ...(thread.links ?? [])]) if (l.orderId) candidates.push({ orderId: l.orderId, shipmentId: l.shipmentId ?? null, ref: refOf(l.orderId, l.shipmentId ?? null), why: [lang === 'ja' ? 'このスレッドの出荷' : 'one of this thread\u2019s shipments'] });
    for (const id of (m.multiOrderIds ?? []) as string[]) candidates.push({ orderId: id, shipmentId: null, ref: refOf(id, null), why: [lang === 'ja' ? 'メールに記載' : 'named in the email'] });
    for (const r of (m.quoted ?? []) as Array<{ orderId: string; shipmentId: string | null; ref: string }>) candidates.push({ orderId: r.orderId, shipmentId: r.shipmentId, ref: refOf(r.orderId, r.shipmentId), why: [lang === 'ja' ? '引用部分に記載' : 'named in the quoted text'] });
    const q = m.question as { kind?: string; current?: string[]; secondTargets?: Array<{ orderId: string; shipmentId: string | null }>; secondText?: string } | null;
    const recheck = q?.kind === 'RECHECK' ? { current: q.current ?? [], second: (q.secondTargets ?? []).map((s) => ({ ...s, ref: refOf(s.orderId, s.shipmentId) })), secondText: q.secondText ?? '' } : null;
    return questionOf({
      lang,
      reasonCode: m.reason?.code ?? null,
      subject: m.subject,
      company: m.company ?? null,
      attachments: (m.attachments ?? []).map((a: any) => a.name),
      keys: m.keys,
      threadSize: thread.size,
      threadSubject: thread.subject,
      suggested,
      candidates,
      check: m.check ?? [],
      recheck,
      seed: thread.seed ?? m.backlog?.seed ?? null,
      summaryOf,
      date: m.date ? new Date(m.date) : null,
    });
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
  async threads(organizationId: string, tab: 'UNPROCESSED' | 'PROCESSED', opts: { limit?: number; sinceDays?: number; lang?: Lang } = {}) {
    const states = tab === 'PROCESSED' ? ['PROCESSED'] : ['SUGGESTED', 'UNMATCHED', 'UNSURE'];
    const lang: Lang = opts.lang === 'ja' ? 'ja' : 'en';
    const now = Date.now();
    // Round W: "Ask later" snoozes a message for a day — it leaves Unprocessed until then.
    const snoozed = (l: any) => !!l.actions?.snoozedUntil && new Date(l.actions.snoozedUntil).getTime() > now;
    const all: any[] = await this.prisma.emailIngestLog.findMany({
      where: { organizationId, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE', 'PROCESSED'] } },
      orderBy: { createdAt: 'desc' },
      take: 600,
    });
    const counts = { unprocessed: all.filter((l) => l.inboxState !== 'PROCESSED' && !snoozed(l)).length, processed: all.filter((l) => l.inboxState === 'PROCESSED').length, snoozed: all.filter((l) => l.inboxState !== 'PROCESSED' && snoozed(l)).length };
    // Round W: the question card's other options (the second pass's records, a multi-link email's targets) need refs too.
    const extra = all.flatMap((l) => [...(((l.actions ?? {}) as any).question?.secondTargets ?? []), ...(((l.actions ?? {}) as any).targets ?? []), ...(((l.actions ?? {}) as any).candidates ?? [])] as Array<{ orderId?: string | null; shipmentId?: string | null }>);
    const refs = { ...(await this.refs(organizationId, [...new Set([...all.map((l) => l.orderId), ...extra.map((t) => t.orderId)].filter(Boolean))], [...new Set([...all.map((l) => l.shipmentId), ...extra.map((t) => t.shipmentId)].filter(Boolean))])), lang };
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
        const inTab = t.messages.filter((r) => states.includes(r.inboxState ?? '') && (!since || new Date(r.date ?? 0).getTime() >= since) && (tab === 'PROCESSED' || !snoozed(byId.get(r.id))));
        if (!inTab.length) return null;
        const link = threadLink(t.messages);
        const messages = inTab.map((r) => this.shapeMessage(byId.get(r.id), refs, labels, t.messages.length));
        // Round W: ONE question per thread — asked about the newest unprocessed message; answering covers them all.
        const newestMsg = messages[0] ?? null;
        const seed = messages.map((m) => m.backlog?.seed).find((s) => s && (s.piNo || s.grade || s.qtyMt)) ?? messages.map((m) => m.backlog?.seed).find(Boolean) ?? null;
        const question = tab === 'UNPROCESSED' && newestMsg ? this.questionFor(newestMsg, refs, lang, { size: t.messages.length, subject: byId.get(t.messages[t.messages.length - 1].id)?.subject ?? null, seed, links: link?.combined?.length ? link.combined : link ? [{ orderId: link.orderId, shipmentId: link.shipmentId }] : [] }) : null;
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
          /** Round R follow-up: a customer-level sheet (cost / price list) — "General · SUS", no order to link. */
          general: t.messages.map((r) => ((byId.get(r.id)?.actions ?? {}) as { general?: { customerKey: string | null } | null }).general).find(Boolean) ?? null,
          messages,
          /** Messages of the thread outside this tab (a Processed one on an Unprocessed thread, and the other way round). */
          otherCount: t.messages.length - inTab.length,
          /** Round W: the question card (Unprocessed), the ids it answers for, and how many earlier emails the timeline holds. */
          question,
          answerIds: tab === 'UNPROCESSED' ? inTab.map((r) => r.id) : [],
          earlier: t.messages.length - 1,
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
      /** Round W: the email's first lines (own text, quoted history stripped) — shown under the question card. */
      preview: splitQuoted(String(((l.rawMeta ?? {}) as any).bodyText ?? '')).own.replace(/\s+/g, ' ').trim().slice(0, 320),
      /** Round Q: the backlog kind (HIDE / AUTO_LINK / HISTORY / NO_ORDER / CONFIRM / PICK / IS_SHIPMENT) and the order-form seed. */
      backlog: a.backlog ? { kind: a.backlog.kind, reason: a.backlog.reason, seed: a.backlog.seed ?? null } : null,
      matchReason: a.reason ?? null,
      threadFrom: a.threadFrom ?? null,
      threadSize,
      linked: link ? { ...link, files, fields, linkOnly: !files.length && !fields.length } : null,
      /** "Confirmed by Sayaka · 21 Oct 10:12" / "Auto · B/L 198GX…" (Processed). */
      by: base.review ? { outcome: (base.review as any).outcome, name: (base.review as any).by ?? null, at: (base.review as any).at ?? null, autoLabel: base.autoLabel ?? null, via: (base.review as any).via ?? null } : null,
    };
  }

  /**
   * Round AB: the one-line summary of an email already in the inbox, made ONCE and stored in `triage.summary` (new mail
   * gets it from the triage call itself). Returns the stored or new summary; `dryRun` only computes it.
   */
  async summarize(organizationId: string, logId: string, opts: { dryRun?: boolean; force?: boolean } = {}): Promise<{ summary: string | null; en: string | null; ja: string | null; before: string | null; stored: boolean; source: 'stored' | 'ai' | 'fallback' | 'none' }> {
    const log: any = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId }, select: { id: true, subject: true, fromAddress: true, triage: true, rawMeta: true } });
    if (!log) throw new NotFoundException('Email not found');
    // Round AC: what the English card shows today (a stored summary, else the fallback sentence) — the backfill prints before → after.
    const before = summaryOfLog(log, 'en');
    const existing = storedSummaries(log);
    if (existing.en && existing.ja && !opts.force) return { summary: existing.en, en: existing.en, ja: existing.ja, before, stored: true, source: 'stored' };
    const meta = (log.rawMeta ?? {}) as Partial<StoredEmailMeta> & { bodyText?: string };
    const own = splitQuoted(String(meta.bodyText ?? '')).own;
    let both: Summaries = { en: null, ja: null };
    let source: 'ai' | 'fallback' | 'none' = 'none';
    try {
      const input = { subject: log.subject ?? '', from: log.fromAddress, body: own || String(meta.bodyText ?? ''), attachments: (meta.attachments ?? []).map((a) => a.name) };
      const [system, user] = summaryPrompt(input);
      const r = (await this.ai(system, user)) as Record<string, unknown> | null;
      both = cleanSummaries(r && typeof r === 'object' && 'summary' in r ? r.summary : r);
      // Round AD (owner): never cut a summary — when the model runs long (over ~20 words / ~40 characters a clause), ask once more, shorter.
      if ((both.en && summaryTooLong(both.en, 'en')) || (both.ja && summaryTooLong(both.ja, 'ja'))) {
        const [system2, user2] = summaryPrompt(input, { shorter: true });
        const r2 = (await this.ai(system2, user2).catch(() => null)) as Record<string, unknown> | null;
        const again = cleanSummaries(r2 && typeof r2 === 'object' && 'summary' in r2 ? r2.summary : r2);
        both = { en: again.en && !summaryTooLong(again.en, 'en') ? again.en : (again.en && both.en && summaryTooLong(both.en, 'en') ? again.en : both.en), ja: again.ja && !summaryTooLong(again.ja, 'ja') ? again.ja : (again.ja && both.ja && summaryTooLong(both.ja, 'ja') ? again.ja : both.ja) };
      }
      if (both.en || both.ja) source = 'ai';
    } catch {
      /* fall back below */
    }
    if (!both.en && !both.ja) {
      const fb = fallbackSummary(own);
      if (fb) {
        both = isJapaneseText(fb) ? { en: null, ja: fb } : { en: fb, ja: null };
        source = 'fallback';
      }
    }
    const summary = isJapaneseText(own) ? (both.ja ?? both.en) : (both.en ?? both.ja);
    // A forced re-run never trades a stored AI summary for the fallback sentence (the AI call failed this time).
    if (source !== 'ai' && (existing.en || existing.ja) && (log.triage ?? {})?.summarySource === 'ai') return { summary: summaryForLang(existing, 'en'), en: existing.en, ja: existing.ja, before, stored: false, source: 'stored' };
    if (opts.dryRun || !summary) return { summary, en: both.en, ja: both.ja, before, stored: false, source };
    await this.prisma.emailIngestLog.update({ where: { id: logId }, data: { triage: { ...((log.triage ?? {}) as Record<string, unknown>), summary, summaryEn: both.en, summaryJa: both.ja, summaryAt: new Date().toISOString(), summarySource: source } as any } });
    return { summary, en: both.en, ja: both.ja, before, stored: true, source };
  }

  /** Round AB: the open questions (Unprocessed) without a stored summary in both languages — the backfill's work list (`all`: every open question). */
  async summariesMissing(organizationId: string, all: boolean | 'missing' | 'all' | 'long' = false): Promise<Array<{ id: string; fromDomain: string; subject60: string }>> {
    const mode = all === true ? 'all' : all === false ? 'missing' : all;
    // Round AD: `long` = every row (open or processed, last 60 days) whose stored summary runs over the limit — re-made, never cut.
    const where = mode === 'long' ? { organizationId, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE', 'PROCESSED'] }, createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } } : { organizationId, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } };
    const rows: any[] = await this.prisma.emailIngestLog.findMany({ where, orderBy: { createdAt: 'desc' }, select: { id: true, fromAddress: true, subject: true, triage: true } });
    const pick = (r: any) => {
      const st = storedSummaries(r);
      if (mode === 'all') return true;
      if (mode === 'long') return (!!st.en && summaryTooLong(st.en, 'en')) || (!!st.ja && summaryTooLong(st.ja, 'ja'));
      return !(st.en && st.ja);
    };
    return rows.filter(pick).map((r) => ({ id: r.id, fromDomain: domainOf(emailOf(r.fromAddress)), subject60: (r.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) }));
  }

  /** Round P — the Sales dashboard: emails to confirm (threads, newest first) and what was filed by itself in the last 3 days. */
  async dashboard(organizationId: string, lang: Lang = 'en') {
    const [todo, done] = await Promise.all([this.threads(organizationId, 'UNPROCESSED', { limit: 10, lang }), this.threads(organizationId, 'PROCESSED', { sinceDays: 3, lang })]);
    const filedAuto = done.threads
      .flatMap((t) => t.messages.map((m) => ({ ...m, threadSubject: t.subject })))
      .filter((m) => m.by?.outcome === 'AUTO')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { toConfirm: { emails: todo.counts.unprocessed, threads: todo.threads, total: todo.total }, filedAuto };
  }

  private shape(l: any, refs: { order: Map<string, string>; ship: Map<string, string>; companies?: Record<string, string>; lang?: Lang }) {
    const meta = (l.rawMeta ?? {}) as Partial<StoredEmailMeta>;
    const actions = (l.actions ?? {}) as { planned?: IntakeAction[]; done?: IntakeAction[]; matchedBy?: string | null };
    const triage = (l.triage ?? {}) as Partial<TriageResult> & { error?: string | null };
    return {
      id: l.id,
      date: l.emailDate ?? meta.date ?? l.createdAt,
      receivedAt: l.createdAt,
      direction: l.direction,
      counterparty: l.counterparty,
      company: companyOf(l.fromAddress, refs.companies).name,
      companyDomain: companyOf(l.fromAddress, refs.companies).domain,
      verdict: l.verdict,
      inboxState: l.inboxState,
      subject: l.subject,
      from: l.fromAddress,
      /** Round AB / AC: the one-line summary in the viewer's language (stored at triage time); the body's first real sentence when there is none. Display text only. */
      summary: summaryOfLog(l, refs.lang ?? 'en'),
      attachments: (meta.attachments ?? []).map((a, i) => ({ index: i, name: a.name, docType: (triage.attachments ?? []).find((t) => t.filename === a.name)?.docType ?? null })),
      orderId: l.orderId,
      shipmentId: l.shipmentId,
      matched: l.shipmentId ? refs.ship.get(l.shipmentId) : l.orderId ? refs.order.get(l.orderId) : null,
      matchedOrder: l.orderId ? refs.order.get(l.orderId) : null,
      matchedBy: actions.matchedBy ?? null,
      /** Subject words that disagree with the match ("grade 6005 ≠ 6063") — shown as "check". */
      check: (actions as { check?: string[] }).check ?? [],
      notes: (actions as { notes?: string[] }).notes ?? [],
      autoTier: (actions as { autoTier?: string | null }).autoTier ?? null,
      source: (actions as { source?: string | null }).source ?? null,
      /** Round W: the independent sources that agree (two needed for auto) and the self-check result. */
      sources: (actions as { sources?: string[] }).sources ?? [],
      sourceLines: (actions as { sourceLines?: string[] }).sourceLines ?? [],
      selfCheck: (actions as { selfCheck?: unknown }).selfCheck ?? null,
      question: (actions as { question?: unknown }).question ?? null,
      snoozedUntil: (actions as { snoozedUntil?: string | null }).snoozedUntil ?? null,
      confidence: (actions as { confidence?: string }).confidence ?? null,
      /** Which guard kept it a suggestion. */
      blocked: (actions as { blocked?: string[] }).blocked ?? [],
      /** The picker's top 3 (ref, score, reasons). */
      candidates: (actions as { candidates?: unknown[] }).candidates ?? [],
      /** Round X: records named only in the quoted text (the "which shipment?" options of a reply with no key of its own). */
      quoted: (actions as { quoted?: unknown[] }).quoted ?? [],
      multiOrderIds: (actions as { multiOrderIds?: string[] }).multiOrderIds ?? [],
      targets: (actions as { targets?: unknown[] }).targets ?? [],
      review: (actions as { review?: unknown }).review ?? null,
      /** "B/L 198GX04630" on an auto-applied email. */
      autoLabel: (actions as { autoLabel?: string | null }).autoLabel ?? null,
      /** Round R follow-up: a customer-level "General" email (no order), linked to the customer only. */
      general: (actions as { general?: { customerKey: string | null } | null }).general ?? null,
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
  async accept(organizationId: string, logId: string, actor: EmailActor) {
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
    actor: EmailActor = SYSTEM_ACTOR,
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
  async ignore(organizationId: string, logId: string, actor: EmailActor) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        inboxState: 'PROCESSED',
        purgeAfter: null,
        actions: { ...((log.actions as object) ?? {}), done: [], review: { outcome: 'IGNORED', at: new Date().toISOString(), by: actor.name ?? actor.id, ...(actor.via ? { via: actor.via } : {}) } } as any,
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
  async applyPiTable(organizationId: string, logId: string, actor: EmailActor) {
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

  async dismiss(organizationId: string, logId: string, actor?: EmailActor) {
    const log = await this.prisma.emailIngestLog.findFirst({ where: { id: logId, organizationId } });
    if (!log) throw new NotFoundException('Email not found');
    if (((log.actions as any)?.done ?? []).some((a: IntakeAction) => a.status === 'done')) throw new BadRequestException('Undo what this email did first');
    await this.purge(organizationId, logId, { verdict: 'NOT_SHIPMENT', counterparty: log.counterparty, review: { outcome: 'REJECTED', at: new Date().toISOString(), by: actor?.name ?? actor?.id ?? null, ...(actor?.via ? { via: actor.via } : {}) } });
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
