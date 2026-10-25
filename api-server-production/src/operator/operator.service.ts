import { Injectable, Logger } from '@nestjs/common';
import { stripEmoji } from './push-text';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { CHAT_UPLOAD_PROJECT_COST_FLAG, isOrgFeatureEnabled } from '../common/org-features';
import { matchProjectByAddress } from '../common/address-match';
import { REPLY_WORDS } from '../ingestion-email/email-question';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorToolsService } from './operator-tools.service';
import { ShipmentsToolsService } from './shipments-tools.service';
import { forbiddenAsk, refusalText, replyLanguage, shipmentsSystemPrompt } from './shipments-agent.rules';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { WebAdapter } from './adapters/web.adapter';
import { APP_KNOWLEDGE } from '../guide/app-knowledge';
import {
  ChannelAdapter,
  InboundMessage,
  OperatorChannel,
  OperatorContext,
  PendingAction,
  SessionState,
  TranscriptItem,
} from './operator.types';

// Financial actions run through this agent, so tool selection has to be right.
// (Deliberately NOT the Haiku the WhatsApp PA agent uses — that one only drafts text.)
const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ROUNDS = 8;
const HISTORY_TURNS = 20;
// Conversation memory does NOT expire — pick up where you left off days or
// months later. Size is bounded by HISTORY_TURNS, not by time. (expiresAt is
// still stamped far out to satisfy the column, but load ignores it.)
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// A held financial confirmation DOES expire — "confirm" tapped days after the
// fact must not silently post something the user has forgotten about.
const PENDING_TTL_MS = 30 * 60 * 1000;
// Display transcript cap per conversation (the model history is separate and
// much shorter).
const TRANSCRIPT_MAX = 300;

// Tools whose result is a document worth putting in the web chat's side panel.
// `fresh` = the tool changed it, so the panel re-renders instead of reusing a
// cached PDF.
/** House rule: no em dashes in anything a user reads. The model is told so
 *  (rule 8) and still slips them in; this is the backstop on every reply.
 *  "a — b" and "a—b" become "a, b". A spaced en dash goes the same way; a
 *  tight one ("31–60 days") is a range and stays. */
export const plainDashes = (t: string): string =>
  typeof t === 'string' ? t.replace(/\s*—\s*/g, ', ').replace(/\s+–\s+/g, ', ').replace(/([.,:;!?])\s*,\s/g, '$1 ') : t;

/** A chat's name from its first line, as a human would type it: pasted
 *  tables, markdown and symbols stripped, the first few real words kept. */
export function titleFromText(text: string): string {
  const cleaned = String(text || '')
    .replace(/[│┃┆┇┊┋║|┌┐└┘├┤┬┴┼─━═╔╗╚╝╠╣╦╩╬╭╮╰╯]+/g, ' ')
    .replace(/[*_`#>~]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Lead with the first clause that has real words in it, not with the
  // numbers of a pasted table.
  const words = cleaned.split(' ').filter((w) => /[a-z]/i.test(w));
  if (words.length < 2) return '';
  const start = cleaned.indexOf(words[0]);
  let title = cleaned.slice(start).split(/[.!?\n]/)[0].trim();
  if (title.length > 60) title = title.slice(0, 57).replace(/\s+\S*$/, '') + '…';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const PANEL_DOC_TOOLS: Record<string, boolean> = {
  create_quotation: true,
  create_invoice: true,
  create_invoice_from_quotation: true,
  edit_document: true,
  translate_quotation: true,
  create_delivery_order: true,
  create_credit_note: true,
  confirm_document: false,
  confirm_invoice: false,
  preview_document: false,
  get_document: false,
  email_document: false,
};

/**
 * Mark the end of the conversation so far as a cache breakpoint. The last
 * message is cloned with cache_control on its final block (a string becomes a
 * text block); the next request then reuses everything up to it.
 */
function withConversationCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  const mark = { type: 'ephemeral' as const };
  let content: any;
  if (typeof last.content === 'string') content = [{ type: 'text', text: last.content, cache_control: mark }];
  else if (Array.isArray(last.content) && last.content.length) {
    content = last.content.slice();
    content[content.length - 1] = { ...content[content.length - 1], cache_control: mark };
  } else return messages;
  return [...messages.slice(0, -1), { ...last, content }];
}

// What the user sees while a tool runs, so the bot never looks frozen.
const TOOL_STATUS: Record<string, string> = {
  find_customer: '🔎 Looking up the customer...',
  list_customers: '📇 Fetching customers...',
  create_customer: '👤 Creating the customer...',
  find_item: '🔎 Looking up items...',
  create_quotation: '📝 Creating the quotation...',
  create_invoice: '📝 Creating the invoice...',
  create_invoice_from_quotation: '📝 Raising the invoice from the quotation...',
  preview_document: '📄 Generating the PDF preview...',
  report_pdf: '📊 Building the report...',
  confirm_document: '🔒 Checking the document...',
  confirm_invoice: '🔒 Checking the invoice...',
  list_open_invoices: '📂 Fetching open invoices...',
  record_payment: '💵 Preparing the payment...',
  aged_receivables: '📊 Running aged receivables...',
  get_document: '📂 Fetching the document...',
  list_recent_documents: '📂 Fetching recent documents...',
  search_documents: '🔎 Searching documents...',
  update_customer: '✏️ Updating the customer...',
  find_supplier: '🔎 Looking up the supplier...',
  list_bills: '📂 Fetching bills...',
  create_bill: '📝 Recording the bill...',
  post_bill: '🔒 Checking the bill...',
  create_delivery_order: '📝 Creating the delivery order...',
  create_credit_note: '📝 Creating the credit note...',
  check_stock: '📦 Checking stock...',
  list_projects: '📂 Fetching projects...',
  sales_by_customer: '📊 Running sales by customer...',
  aged_payables: '📊 Running aged payables...',
  gst_report: '📊 Running the GST report...',
  email_document: '📧 Preparing the email...',
  edit_document: '✏️ Editing the document...',
  get_document_link: '🔗 Getting the link...',
  add_project_cost: '🧾 Recording the project cost...',
  edit_schedule: '🗓 Updating the schedule...',
  import_price_list: '📚 Adding the price list to the Work Library...',
  schedule_delivery: '🚚 Preparing the delivery...',
  find_sales_order: '🔎 Looking for the order or quotation...',
  api_write: '⚙️ Preparing the change...',
  ask_choice: '',
};

@Injectable()
export class OperatorService {
  private readonly logger = new Logger(OperatorService.name);
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: OperatorAuthService,
    private readonly tools: OperatorToolsService,
    private readonly telegram: TelegramAdapter,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly web: WebAdapter,
    private readonly shipTools: ShipmentsToolsService,
  ) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.anthropic = key ? new Anthropic({ apiKey: key }) : null;
  }

  private adapterFor(channel: OperatorChannel): ChannelAdapter {
    if (channel === 'telegram') return this.telegram;
    if (channel === 'whatsapp') return this.whatsapp;
    if (channel === 'web') return this.web;
    throw new Error(`No adapter for channel ${channel}`);
  }

  /**
   * One chat at a time.
   *
   * The webhook fires handleInbound per message without awaiting, so six
   * forwarded PDFs became six concurrent handlers. Each sends the invoice
   * then its Confirm card, and interleaved that way the pairs scrambled —
   * the card for INV-060 appeared under the PDF for INV-059 (guru
   * 2026-10-04). Worse, concurrent handlers load and save the SAME session,
   * so one could overwrite another's pendingAction or history.
   *
   * Serialising per sender fixes both. Different people still run in
   * parallel; only one message per chat is in flight at a time.
   */
  private readonly chatQueues = new Map<string, Promise<void>>();

  async handleInbound(msg: InboundMessage): Promise<void> {
    // Keyed by the CONVERSATION, not the channel: a WhatsApp thread continued
    // from the web shares one queue with the phone, so the two never interleave.
    const { channel: sc, channelUserId: su } = this.sessionOf(msg);
    const key = `${sc}:${su}`;
    const prev = this.chatQueues.get(key) ?? Promise.resolve();
    const next = prev.then(
      () => this.handleInboundSerial(msg),
      () => this.handleInboundSerial(msg), // a failed predecessor must not block the queue
    );
    // Swallow here only for the stored chain; the caller still sees the error.
    const tracked = next.catch(() => undefined);
    this.chatQueues.set(key, tracked);
    tracked.then(() => {
      // Drop the key once this is the last one through, so the map does not
      // grow one entry per person forever.
      if (this.chatQueues.get(key) === tracked) this.chatQueues.delete(key);
    });
    return next;
  }

  /** Entry point: one inbound chat message, end to end. */
  private async handleInboundSerial(msg: InboundMessage): Promise<void> {
    const adapter = this.recording(this.adapterFor(msg.channel), msg);
    // WhatsApp replies route back out through the business number that received
    // the inbound — prime the adapter before any send in this request.
    if (msg.channel === 'whatsapp' && msg.businessPhoneNumberId) {
      this.whatsapp.rememberContext(msg.chatId, msg.businessPhoneNumberId, msg.providerMessageId);
    }
    if (msg.callbackId) await adapter.answerCallback?.(msg.callbackId).catch(() => null);

    const text = (msg.text || '').trim();

    // The web chat is signed in already, and switches org through the portal's
    // own switcher: the chat-app identity commands do not apply there.
    if (msg.channel === 'web' && /^\/(link|orgs?)\b/i.test(text)) {
      await adapter.sendText(
        msg.chatId,
        /^\/link/i.test(text)
          ? 'No linking needed here: the dashboard chat already knows who you are.'
          : 'Switch organization with the org switcher at the top of the dashboard.',
      );
      return;
    }

    // /link is the only command available before an identity exists.
    if (/^\/link\b/i.test(text)) {
      const code = text.split(/\s+/)[1] || '';
      const res = await this.auth.redeemLinkCode(msg.channel, msg.channelUserId, code, msg.displayName);
      await adapter.sendText(msg.chatId, res.message);
      return;
    }

    const resolved = msg.presetCtx
      ? { ok: true, ctx: msg.presetCtx, reason: undefined as any, options: undefined as any }
      : await this.auth.resolve(msg.channel, msg.channelUserId);

    if (!resolved.ok || !resolved.ctx) {
      if (resolved.reason === 'unlinked') {
        await adapter.sendText(
          msg.chatId,
          "I don't recognise you yet. In AIMS go to Settings → Link chat account, then send me: /link <the 6-digit code>",
        );
      } else if (resolved.reason === 'no-org') {
        await adapter.sendText(msg.chatId, 'Your AIMS account is not assigned to any organization yet.');
      } else if (resolved.reason === 'needs-org-choice') {
        // The tap ANSWERING this picker arrives here too, because resolve()
        // still finds no stored org. Handling it before re-prompting is what
        // makes the picker escapable at all.
        if (msg.callbackData?.startsWith('org:')) {
          const picked = await this.auth.chooseOrgWhileUnset(msg.channel, msg.channelUserId, msg.callbackData.slice(4));
          if (picked) {
            await adapter.sendText(msg.chatId, `✅ Now working in ${picked.name}. What would you like to do?`);
            return;
          }
          await adapter.sendText(msg.chatId, "You don't have access to that organization.");
          return;
        }
        await this.presentOrgPicker(adapter, msg.chatId, resolved.options ?? []);
      }
      return;
    }
    let ctx: OperatorContext = resolved.ctx;

    // What the user said or tapped, for the display transcript.
    await this.recordInbound(msg, text);

    // Round S: a shipments org gets the shipments tool set only (no api_* tools, no invoice
    // upload path). On WhatsApp it answers only when the org flag enableWhatsAppAgent is on —
    // otherwise the message stays stored in the CRM thread and is ignored (logged, no reply).
    const profile = await this.profileOf(ctx.organizationId);
    ctx.profile = profile;
    if (profile === 'shipments') {
      msg.plain = true; // round X (owner): no emojis anywhere in the shipments assistant's replies
      if (msg.channel === 'whatsapp' && !(await isOrgFeatureEnabled(this.prisma, ctx.organizationId, 'enableWhatsAppAgent'))) {
        this.logger.log(`whatsapp agent off for ${ctx.organizationName}: ignored a message from a linked user`);
        return;
      }
      const lang = replyLanguage(text);
      if (!msg.callbackData && text) {
        const what = forbiddenAsk(text);
        if (what) {
          await adapter.sendText(msg.chatId, refusalText(what, lang));
          return;
        }
      }
      const files = msg.attachments?.length ? msg.attachments : msg.attachment ? [msg.attachment] : [];
      if (files.length) {
        await this.handleShipmentsFiles(ctx, adapter, msg, files, text, lang);
        return;
      }
      if (/^\/(start|help)\b/i.test(text)) {
        await adapter.sendText(msg.chatId, shipmentsHelp(ctx.organizationName, lang));
        return;
      }
      // Round AF: the step-by-step answer flow — YES / NO to the push, then "what is it then?" 1 / 2 / 3 — a Confirm card
      // before anything applies; a shipment number (below) ends the flow.
      if (ShipmentsToolsService.YES_RE.test(text) || ShipmentsToolsService.NO_RE.test(text) || /^\s*[123]\s*$/.test(text)) {
        const session = await this.loadSession(...this.sk(msg));
        const flow = await this.shipTools.answerFlow(ctx, msg.channelUserId, text, lang, session).catch((e) => {
          this.logger.warn(`answer flow failed: ${(e as Error)?.message}`);
          return null;
        });
        if (flow) {
          if (flow.pending) this.holdPending(session, flow.pending);
          await this.saveSession(...this.sk(msg), session);
          if (flow.reply) await adapter.sendText(msg.chatId, flow.reply);
          if (flow.pending) await adapter.sendButtons(msg.chatId, `${flow.pending.summary}\n\n${lang === 'ja' ? '確定しますか？' : 'Confirm?'}`, [{ label: 'Confirm', data: `confirm:${flow.pending.id}` }, { label: 'Cancel', data: `cancel:${flow.pending.id}` }]);
          return;
        }
      }
      // Round AA: "18-1" / "18-1 18-2" after a shipment question → a Confirm card first; nothing applies on the reply itself.
      if (ShipmentsToolsService.REFS_REPLY.test(text)) {
        const sessionForFlow = await this.loadSession(...this.sk(msg));
        if (sessionForFlow.answerFlow) {
          sessionForFlow.answerFlow = null;
          await this.saveSession(...this.sk(msg), sessionForFlow);
        }
        const pending = await this.shipTools.pendingForRefs(ctx, msg.channelUserId, text, lang).catch((e) => {
          this.logger.warn(`shipment reply failed: ${(e as Error)?.message}`);
          return null;
        });
        if (typeof pending === 'string') {
          await adapter.sendText(msg.chatId, pending);
          return;
        }
        if (pending) {
          const session = await this.loadSession(...this.sk(msg));
          this.holdPending(session, pending);
          await this.saveSession(...this.sk(msg), session);
          await adapter.sendButtons(msg.chatId, `${pending.summary}\n\n${lang === 'ja' ? '確定しますか？' : 'Confirm?'}`, [
            { label: 'Confirm', data: `confirm:${pending.id}` },
            { label: 'Cancel', data: `cancel:${pending.id}` },
          ]);
          return;
        }
      }
      // Round W: "1" / "2" / "0" / "X" answers the last question card sent to this number. Round AE: also NEW / later and the quick-reply button titles.
      if (REPLY_WORDS.test(text)) {
        const answered = await this.shipTools.answerNumbered(ctx, msg.channelUserId, text, lang).catch((e) => {
          this.logger.warn(`numbered answer failed: ${(e as Error)?.message}`);
          return null;
        });
        if (answered) {
          await adapter.sendText(msg.chatId, answered);
          return;
        }
      }
    }

    // Button taps
    if (msg.callbackData) {
      await this.handleCallback(ctx, adapter, msg, msg.callbackData);
      return;
    }

    // Voice note: echo what we heard (so a mis-transcription is caught), or say
    // we couldn't make it out. Then the transcript flows through as normal text.
    if (msg.fromVoice) {
      if (!text) {
        await adapter.sendText(msg.chatId, "Sorry, I couldn't make out that voice note. Try again, or type it.");
        return;
      }
      await adapter.sendText(msg.chatId, `🎙️ "${text}"`);
    }

    // An uploaded file (photo/PDF of an invoice) → extract it and file it as a
    // project cost: match the invoice's site address to a project, else offer
    // the projects as tappable buttons.
    const files = msg.attachments?.length ? msg.attachments : msg.attachment ? [msg.attachment] : [];
    if (files.length) {
      await adapter.sendTyping?.(msg.chatId).catch(() => null);
      const status =
        (await adapter.sendStatus?.(msg.chatId, files.length > 1 ? `📎 Reading ${files.length} files...` : '📎 Reading the uploaded file...')) ?? null;
      // Every file is read in parallel. All but the last are written straight
      // into the conversation; the last one goes through handleUpload, which
      // records it too and then decides what to do (run the caption, hold
      // the file, or file it as a cost), so a batch behaves like one upload.
      const ups = await Promise.all(
        files.map((f) => this.tools.extractUpload(ctx.organizationId, f.dataUri, f.mimetype, f.filename).catch(() => null)),
      );
      if (status) await adapter.deleteMessage?.(msg.chatId, status).catch(() => null);
      const session = await this.loadSession(...this.sk(msg));
      for (const up of ups.slice(0, -1)) if (up) this.rememberUpload(session, up);
      await this.handleUpload(ctx, adapter, msg, session, ups[ups.length - 1]);
      return;
    }

    if (/^\/(start|help)\b/i.test(text)) {
      await adapter.sendText(
        msg.chatId,
        `You're linked to ${ctx.organizationName}.\n\nAsk me things like:\n• "create a quotation for Acme, 2 fan coil units and 8 hours install"\n• "show me the last 5 quotations"\n• "what's QO2026-001?"\n\nI'll always show you a preview and ask before finalising anything.\n\nSend /org to switch organization.${ctx.isOsirisAdmin ? '\\n/as <name> to troubleshoot as another user, /whoami to check.' : ''}`,
      );
      return;
    }
    // Act as another user in this org, to reproduce what THEY see.
    // osirisadmin only, and it deliberately drops the admin bypass: the point
    // is to hit the same walls they hit. /whoami shows where you are.
    if (/^\/(as|actas|whoami)\b/i.test(text)) {
      const sess = await this.loadSession(...this.sk(msg));
      const arg = text.replace(/^\/(as|actas|whoami)\b/i, '').trim();

      if (/^\/whoami\b/i.test(text)) {
        await adapter.sendText(
          msg.chatId,
          sess.actingAs
            ? `👤 Acting as ${sess.actingAs.label} in ${ctx.organizationName}.\nSend /as off to stop.`
            : `You, in ${ctx.organizationName}${ctx.isOsirisAdmin ? ' (admin)' : ''}.`,
        );
        return;
      }
      if (!ctx.isOsirisAdmin && !sess.actingAs) {
        await adapter.sendText(msg.chatId, 'Only a platform admin can act as another user.');
        return;
      }
      if (/^(off|stop|end|exit|me)$/i.test(arg)) {
        sess.actingAs = null;
        await this.saveSession(...this.sk(msg), sess);
        await adapter.sendText(msg.chatId, '✅ Back to yourself.');
        return;
      }
      const matches = await this.auth.listOrgUsers(ctx.organizationId, arg);
      if (!arg || matches.length > 1) {
        if (!matches.length) {
          await adapter.sendText(msg.chatId, `No users found in ${ctx.organizationName}.`);
          return;
        }
        await this.presentUserPicker(adapter, msg.chatId, matches, ctx.organizationName);
        return;
      }
      if (!matches.length) {
        await adapter.sendText(msg.chatId, `Nobody in ${ctx.organizationName} matches "${arg}".`);
        return;
      }
      const t = matches[0];
      sess.actingAs = { userId: t.userId, label: t.name !== '(no name)' ? t.name : t.email || t.userId };
      await this.saveSession(...this.sk(msg), sess);
      await adapter.sendText(
        msg.chatId,
        `👤 Acting as ${sess.actingAs.label} (${t.roles}) in ${ctx.organizationName}.\n` +
          `You have exactly their permissions now, so you will hit the same walls they do.\n` +
          `/whoami to check, /as off when done.`,
      );
      return;
    }

    if (/^\/orgs?\b/i.test(text) || /^(switch|change) org/i.test(text)) {
      // Everything after the command is a name filter, so a long org list stays
      // reachable on channels that cap the picker at a handful of rows.
      const query = text.replace(/^\/orgs?\b/i, '').replace(/^(switch|change) org/i, '').trim();
      const options = await this.auth.listOrgOptions(ctx, query);
      if (!options.length) {
        await adapter.sendText(
          msg.chatId,
          query ? `No organization matches "${query}".` : 'You are not a member of any organization.',
        );
        return;
      }
      if (options.length === 1 && query) {
        // An unambiguous name: just switch, no tapping needed.
        await this.switchOrg(ctx, adapter, msg, options[0].id);
        return;
      }
      await this.presentOrgPicker(adapter, msg.chatId, options, ctx.organizationName);
      return;
    }

    // A typed yes/no answering a held confirmation
    const session = await this.loadSession(...this.sk(msg));

    // INTERNAL TROUBLESHOOTING: an osirisadmin can act as another user in this
    // org to reproduce what they see. Swap the context before anything runs, so
    // tools, permission checks and the audit trail all see that user — and the
    // admin's own cross-org bypass stops applying, which is the entire point.
    // `impersonating` keeps the real driver's id so nothing is anonymous.
    if (session.actingAs) {
      ctx = await this.auth.contextAs(ctx, session.actingAs.userId, session.actingAs.label);
      ctx.profile = profile;
    }
    // A typed answer acts on the NEWEST held card and takes it out of the
    // held list, exactly like a tap would. Clearing only the single slot left
    // the card live: its Confirm button still worked after a typed "no", and a
    // typed "yes" followed by a tap ran the action twice (found 2026-10-14).
    if (session.pendingAction && /^(yes|y|confirm|ok|okay|go ahead|do it)\b/i.test(text)) {
      const chosen = this.takePending(session, session.pendingAction.id || '');
      if (chosen) await this.executePending(ctx, adapter, msg, session, chosen);
      return;
    }
    if (session.pendingAction && /^(no|n|cancel|stop|nevermind|never mind)\b/i.test(text)) {
      const dropped = this.takePending(session, session.pendingAction.id || '');
      if (dropped) this.markDone(session, dropped, 'cancelled');
      await this.saveSession(...this.sk(msg), session);
      await adapter.sendText(msg.chatId, 'Cancelled. Nothing was changed.');
      return;
    }

    if (!text) return;
    // A file uploaded minutes ago is part of THIS conversation: hydrate it onto
    // the context so a reply like "charge it to 687 Jurong West" lets
    // add_project_cost attach the file and reuse its extracted fields.
    if (!ctx.upload && session.pendingUpload) ctx.upload = session.pendingUpload as any;
    await this.runAgent(ctx, adapter, msg, session, text);
  }

  // ── Invoice upload → project costing ──────────────────────────────────────

  /** File an uploaded invoice as a project cost: match its site address to a
   *  project, else offer the projects as tappable buttons. */
  /**
   * Put an uploaded file into the conversation.
   *
   * handleUpload answers every upload itself and returns, so the model never
   * learnt a file had arrived or what was in it. Asked "what's the total of
   * the invoices I just forwarded", it had nothing to add up and listed
   * recent documents instead — confidently, and wrongly (guru 2026-10-04).
   *
   * Recording each one as a turn means later questions are answered from the
   * files themselves, and a batch can be totalled.
   */
  private rememberUpload(session: SessionState, up: NonNullable<OperatorContext['upload']>) {
    const e: any = up.extracted || {};
    const parts = [
      up.filename ? `file: ${up.filename}` : null,
      e.supplierName ? `from: ${e.supplierName}` : null,
      e.billTo ? `bill to: ${e.billTo}` : null,
      e.invoiceNo ? `no: ${e.invoiceNo}` : null,
      e.amount != null ? `total: ${e.currency || 'SGD'} ${Number(e.amount).toFixed(2)}` : up.reading ? null : 'total: not readable',
      up.taxAmount ? `tax: ${Number(up.taxAmount).toFixed(2)}` : null,
      e.date ? `date: ${e.date}` : null,
    ].filter(Boolean);
    // The line items, in full. A one-line summary was all the model got
    // before, so "recreate this invoice in AIMS" ended in a request for the
    // quantities that were on the page the whole time (guru 2026-10-15).
    const lines = (up.lines || [])
      .slice(0, 40)
      .map((l: any, i: number) => {
        const desc = String(l.description || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const qty = l.quantity != null && l.quantity !== '' ? Number(l.quantity) : null;
        const unit = l.unitPrice != null && l.unitPrice !== '' ? Number(l.unitPrice) : null;
        const amt = l.amount != null && l.amount !== '' ? Number(l.amount) : null;
        const maths = [qty != null ? `qty ${qty}` : null, unit != null ? `@ ${unit.toFixed(2)}` : null, amt != null ? `= ${amt.toFixed(2)}` : null]
          .filter(Boolean)
          .join(' ');
        return `  ${i + 1}. ${desc}${maths ? ` (${maths})` : ''}`;
      });
    // What the file shows, for anything that is not an invoice (a screenshot
    // of a list, a chat, a report): the model answers from it directly.
    const reading = up.reading ? `\nwhat it shows: ${up.reading.replace(/\s+/g, ' ').trim().slice(0, 1200)}` : '';
    const body = parts.join(' | ') + (lines.length ? `\nlines:\n${lines.join('\n')}` : '') + reading;
    session.history = [...(session.history || []), { role: 'user' as const, content: `[the user forwarded a document] ${body}` }].slice(-40);
  }

  private async handleUpload(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
    up: OperatorContext['upload'] | null,
  ): Promise<void> {
    // Record the file FIRST, ahead of every branch below — including the
    // delivery one, which returns early. Saved immediately because not all
    // branches save before returning.
    if (up) {
      this.rememberUpload(session, up);
      await this.saveSession(...this.sk(msg), session);
    }

    // A delivery held for want of its order? Then this upload IS that order.
    // Registering it here is the whole point: the gap was named, the file was
    // sent, the run is filled in — no extra step asked of the user.
    const held = session.pendingAction;
    if (up && held?.kind === 'schedule_delivery' && !held.args?.dto?.saleOrderId) {
      const dto = held.args!.dto;
      const so = await this.tools
        .createSaleOrderFromUpload(ctx, up, held.args!.customerName, dto.projectId)
        .catch(() => null);
      if (so) {
        dto.saleOrderId = so.id;
        dto.poNumber = dto.poNumber || so.name;
        // With the order attached, a run that was a draft only for want of one
        // becomes a real booking — provided it still has its project.
        const nowLive = !!dto.projectId;
        dto.isDraft = !nowLive;
        held.args!.isDraft = !nowLive;
        held.summary = held.summary
          .replace(/^Order: \(none\)$/m, `Order: ${so.name}`)
          .replace(/\n\nMissing [^\n]*$/, '');
        if (!nowLive) held.summary += `\n\nStill missing a project, so this saves as a DRAFT.`;
        session.pendingAction = held;
        session.pendingUpload = null;
        this.holdPending(session, held);
        await this.saveSession(...this.sk(msg), session);
        await this.sendPendingCard(adapter, msg.chatId, held);
        return;
      }
      await adapter.sendText(
        msg.chatId,
        "I couldn't read that as an order. Send the PO or quotation number instead and I'll attach it.",
      );
      return;
    }

    // BULK INVOICE MODE (guru 2026-10-11, temp): she said "I'm going to send
    // bulk invoices" — every upload is extracted and QUEUED for the portal's
    // "Upload invoices" review pane. No per-invoice confirm, no agent turn.
    if (up && session.bulkInvoiceMode) {
      try {
        const r = await this.tools.queueBulkInvoice(ctx, up);
        session.pendingUpload = null;
        await this.saveSession(...this.sk(msg), session);
        const ex = up.extracted || ({} as any);
        const money = ex.amount != null ? ` ${ex.currency || 'SGD'} ${Number(ex.amount).toFixed(2)}` : '';
        await adapter.sendText(
          msg.chatId,
          `📥 Queued #${r.queued}: ${ex.supplierName || up.filename || 'invoice'}${money}${r.matchedProjectName ? ` → ${r.matchedProjectName}` : ' → no project match yet'}. Review in Projects → Upload invoices. Say "done" to leave bulk mode.`,
        );
      } catch {
        await adapter.sendText(msg.chatId, "That one didn't queue — send it again, or say \"done\" to leave bulk mode.");
      }
      return;
    }

    const e = up?.extracted;
    // A caption sent WITH the file says what the user wants ("what is this?",
    // "add it to the work library"): let the agent answer it, with the file
    // already in the conversation, instead of the canned "couldn't read an
    // amount" line that ignores what they wrote.
    const caption = (msg.text || '').trim();
    if (up && caption && this.anthropic && (e?.amount == null || !(await isOrgFeatureEnabled(this.prisma, ctx.organizationId, CHAT_UPLOAD_PROJECT_COST_FLAG)))) {
      session.pendingUpload = up;
      (session as any).pendingUploadAt = new Date().toISOString();
      await this.saveSession(...this.sk(msg), session);
      ctx.upload = up;
      await this.runAgent(ctx, adapter, msg, session, caption);
      return;
    }
    if (!up || e?.amount == null) {
      // Keep the stored file around — the next message may name what it really
      // is (e.g. "this is a contractor price list, add it to the work library").
      if (up) {
        session.pendingUpload = up;
        await this.saveSession(...this.sk(msg), session);
      }
      // A file that is not an invoice but could be read: say what it looks
      // like and ask what to do, instead of the invoice-amount line.
      const seen = up?.reading?.split('\n')[0]?.trim().replace(/\.$/, '');
      await adapter.sendText(
        msg.chatId,
        seen && !/unreadable|cannot read|can't read/i.test(seen)
          ? `📎 ${seen}. What would you like me to do with it?`
          : "I couldn't read an invoice amount from that file. If it's a supplier invoice, reply with the amount (and the project). If it's a contractor PRICE LIST, say \"add it to the work library\" and I'll import the rates.",
      );
      return;
    }
    // Filing an uploaded invoice as a PROJECT COST is the ID-firm workflow, not
    // a universal one. Off by default: an org that does not do project costing
    // was being pushed into confirming a cost it has no use for. When it is
    // off, hold the file and let the user say what it is — the agent can then
    // act on it in the next turn.
    const costUploadOn = await isOrgFeatureEnabled(this.prisma, ctx.organizationId, CHAT_UPLOAD_PROJECT_COST_FLAG);
    if (!costUploadOn) {
      session.pendingUpload = up;
      await this.saveSession(...this.sk(msg), session);
      const money = e?.amount != null ? ` (${e.currency || 'SGD'} ${Number(e.amount).toFixed(2)})` : '';
      const n = msg.attachments?.length || 1;
      await adapter.sendText(
        msg.chatId,
        n > 1 ? `Got ${n} files, the last one${money}. What should I do with them?` : `Got the file${money}. What should I do with it?`,
      );
      return;
    }

    const projects = await this.tools.listProjectsForMatch(ctx.organizationId);
    if (!projects.length) {
      await adapter.sendText(
        msg.chatId,
        'There are no projects yet to charge this to. Create a project in AIMS first, then resend the invoice.',
      );
      return;
    }
    const money = `${e.currency || 'SGD'} ${Number(e.amount).toFixed(2)}`;
    const who = e.supplierName || 'this supplier';

    // GLOBAL route (guru 2026-10-05: "I don't want our agent to be so rigid"):
    // the upload joins the conversation and the AGENT decides. It knows the
    // chat (a project named two turns ago), can list_projects, read the
    // invoice's site address, ask a question, or file the cost — instead of a
    // fixed match→picker pipeline that ignores context. The deterministic flow
    // below survives only as the fallback when the model is unavailable.
    if (this.anthropic) {
      ctx.upload = up;
      session.pendingUpload = up;
      (session as any).pendingUploadAt = new Date().toISOString();
      await this.saveSession(...this.sk(msg), session);
      await this.runAgent(
        ctx,
        adapter,
        msg,
        session,
        `I just uploaded a supplier invoice: ${who}, ${money}${e.invoiceNo ? `, invoice no ${e.invoiceNo}` : ''}${e.siteAddress ? `, site address on the invoice: ${e.siteAddress}` : ', no site address on the invoice'}. File it as a project cost (add_project_cost). Pick the project from our conversation so far or the invoice's site address — check with list_projects. Only ask me which project if you genuinely can't tell.`,
      );
      return;
    }

    // Pick a project: the only one, or a confident site-address match.
    let chosen = projects.length === 1 ? projects[0] : matchProjectByAddress(e.siteAddress, projects);

    // No address on the invoice (or no match)? The CONVERSATION may already
    // have named the project — e.g. the agent just said "upload it and I'll
    // add it to the 687 Jurong West project" (guru/Mike 2026-10-05: the picker
    // re-asked despite that). Match the last few turns' text the same way.
    if (!chosen) {
      const recent = (session.history || [])
        .slice(-6)
        .map((m: any) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((b: any) => b?.text || '').join(' ') : ''))
        .join('\n');
      if (recent.trim()) chosen = matchProjectByAddress(recent, projects);
    }

    if (chosen) {
      ctx.upload = up;
      const outcome = await this.tools.execute(ctx, 'add_project_cost', { projectId: chosen.id });
      session.pendingUpload = null;
      if (outcome.pending) {
        session.pendingAction = outcome.pending;
        this.holdPending(session, outcome.pending);
        await this.saveSession(...this.sk(msg), session);
        await this.sendPendingCard(adapter, msg.chatId, outcome.pending);
      } else {
        await this.saveSession(...this.sk(msg), session);
        await adapter.sendText(msg.chatId, outcome.result?.error || "I couldn't record that cost.");
      }
      return;
    }

    // Ambiguous → let them tap the project. Stash the upload for the tap.
    session.pendingUpload = up;
    (session as any).pendingUploadAt = new Date().toISOString();
    session.pendingAction = null;
    await this.saveSession(...this.sk(msg), session);
    const prompt = `Which project should I charge ${who} (${money}) to?`;
    if (projects.length > 3 && adapter.sendList) {
      // More than 3 → a scrollable list (up to 10).
      await adapter.sendList(
        msg.chatId,
        prompt,
        'Choose project',
        projects.slice(0, 10).map((p) => ({
          id: `costproj:${p.id}`,
          title: p.name || p.customer || 'Project',
          description: p.address || p.customer || undefined,
        })),
      );
      if (projects.length > 10) {
        await adapter.sendText(
          msg.chatId,
          `(${projects.length} projects total — showing 10. If it's a different one, tell me the project name.)`,
        );
      }
    } else {
      // 3 or fewer (or a channel without lists) → buttons.
      await adapter.sendButtons(
        msg.chatId,
        prompt,
        projects.slice(0, 3).map((p) => ({ label: this.projectButtonLabel(p), data: `costproj:${p.id}` })),
      );
      if (projects.length > 3) {
        await adapter.sendText(
          msg.chatId,
          `(${projects.length} projects total — showing the first 3. If it's a different one, just tell me the project name.)`,
        );
      }
    }
  }

  /** Confident site-address match: score projects by shared distinctive tokens
   *  (numbers weigh more), return the clear winner or null. */
  private projectButtonLabel(p: { name: string; customer: string | null }): string {
    return (p.name || p.customer || 'Project').slice(0, 20);
  }

  // ── The tool-use loop ─────────────────────────────────────────────────────

  private async runAgent(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
    text: string,
    opts: { quietIfIdle?: boolean } = {},
  ): Promise<void> {
    if (!this.anthropic) {
      await adapter.sendText(msg.chatId, 'The assistant is not configured (missing ANTHROPIC_API_KEY).');
      return;
    }

    const messages: Anthropic.MessageParam[] = [
      // trimHistory again on the way IN, so a session stored broken by an
      // earlier version heals itself instead of failing forever.
      ...this.trimHistory(session.history as Anthropic.MessageParam[]),
      { role: 'user', content: text },
    ];
    const toolDefs = ctx.profile === 'shipments' ? this.shipTools.definitions(ctx) : this.tools.definitions(ctx);
    // Every action held this turn, in order. One slot kept only the LAST
    // card when the model held two in a round ("delete those two" showed one
    // card and the other was forgotten, guru 2026-10-21).
    const pendingFromTools: PendingAction[] = [];
    let choiceFromTools: { question: string; options: string[] } | null = null;

    // Live progress: one status message that gets edited as work moves along,
    // plus the native typing indicator. Cleared before the final reply.
    let statusId: string | null = null;
    const showStatus = async (label: string) => {
      await adapter.sendTyping?.(msg.chatId).catch(() => null);
      try {
        if (!statusId) statusId = (await adapter.sendStatus?.(msg.chatId, label)) ?? null;
        else await adapter.editStatus?.(msg.chatId, statusId, label);
      } catch {
        /* status is cosmetic, never break the run for it */
      }
    };
    const clearStatus = async () => {
      if (!statusId) return;
      await adapter.deleteMessage?.(msg.chatId, statusId).catch(() => null);
      statusId = null;
    };

    await showStatus('💭 Thinking...');

    try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Prompt caching (guru 2026-10-15: "the tokens cost seems like a lot").
      // Three breakpoints: the tool list, the system prompt and the
      // conversation so far. Each turn, and each tool round inside a turn,
      // then re-reads the unchanged prefix at a tenth of the price instead of
      // paying for the ~60 tool definitions and the rules again.
      const cachedTools = toolDefs.map((t, i) => (i === toolDefs.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
      const systemBlocks: Anthropic.TextBlockParam[] = [
        { type: 'text', text: ctx.profile === 'shipments' ? this.shipmentsPrompt(ctx, text) : this.systemPrompt(ctx) + this.webPrompt(ctx), cache_control: { type: 'ephemeral' } },
      ];
      if (ctx.profile === 'shipments') {
        // The latest message decides the language; the history (often mixed JP / EN) must not.
        const lang = replyLanguage(text);
        systemBlocks.push({ type: 'text', text: lang === 'ja' ? 'REPLY LANGUAGE NOW: Japanese (日本語で答える). The latest message is Japanese.' : 'REPLY LANGUAGE NOW: English. The latest message is English, whatever language the earlier turns were in.' });
      }
      if (session.bulkInvoiceMode) {
        systemBlocks.push({
          type: 'text',
          text: 'BULK INVOICE MODE IS ON: the user is sending contractor invoices in bulk; each upload auto-queues to the portal review pane without confirmation. When they say they are done/finished, call bulk_invoice_mode with on=false.',
        });
      }
      const resp = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: systemBlocks,
        tools: cachedTools,
        messages: withConversationCache(messages),
      });

      // Token accounting per round, so cache hits can be checked in the log.
      const u: any = resp.usage || {};
      this.logger.log(
        `tokens in=${u.input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? 0}`,
      );
      messages.push({ role: 'assistant', content: resp.content });

      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!toolUses.length) {
        const say = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        await clearStatus();
        // After a confirmation the model is told to stay silent when nothing
        // is left, yet it often restates "X confirmed." The user already has
        // that line, so a short no-action reply on the first round is dropped.
        const restating = opts.quietIfIdle && round === 0 && say.length < 160;
        if (say && !restating) await adapter.sendText(msg.chatId, say);
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        await showStatus(TOOL_STATUS[use.name] || `⚙️ Working on ${use.name.replace(/_/g, ' ')}...`);
        const outcome = ctx.profile === 'shipments' ? await this.shipTools.execute(ctx, use.name, use.input) : await this.tools.execute(ctx, use.name, use.input);
        if ((outcome.result as any)?.__bulkInvoiceMode !== undefined) {
          session.bulkInvoiceMode = !!(outcome.result as any).__bulkInvoiceMode;
          await this.saveSession(...this.sk(msg), session);
        }
        if (outcome.preview) {
          await adapter.sendDocument(
            msg.chatId,
            outcome.preview.url,
            outcome.preview.filename,
            outcome.preview.caption,
            outcome.preview.documentId,
          );
        }
        // Round T: "send all docs" pushes up to 5 files.
        for (const p of ((outcome as any).previews ?? []).slice(1)) await adapter.sendDocument(msg.chatId, p.url, p.filename, p.caption).catch(() => null);
        if (adapter.sendUi) {
          if (outcome.ui) await adapter.sendUi(msg.chatId, outcome.ui).catch(() => null);
          const r: any = outcome.result || {};
          const docId = outcome.preview?.documentId || outcome.pending?.documentId || r.documentId || r.document?.id;
          if (docId && use.name in PANEL_DOC_TOOLS && !r.error) {
            await adapter.sendUi(msg.chatId, { type: 'document', documentId: docId, fresh: PANEL_DOC_TOOLS[use.name] }).catch(() => null);
          }
        }
        if (outcome.pending) pendingFromTools.push(outcome.pending);
        if ((outcome as any).choice) choiceFromTools = (outcome as any).choice;
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          // Once a tool asks for confirmation, the SYSTEM shows the user a
          // Confirm/Cancel button and executes on their tap. Tell the model to
          // stop so it doesn't loop calling the tool or re-ask in its own words.
          content: outcome.pending
            ? 'A Confirm/Cancel button has been shown to the user. STOP now: do not call this tool again, do not ask for confirmation yourself, and do not say it is done. The system will finalize it when the user taps Confirm.'
            : (outcome as any).choice
              ? 'The buttons have been shown to the user. STOP now and say nothing further: their tap arrives as the next message.'
              : JSON.stringify(outcome.result ?? {}).slice(0, 6000),
        });
      }
      messages.push({ role: 'user', content: results });
      // A confirmation is now pending — end the model loop and wait for the
      // user's decision rather than letting the model reason further.
      if (pendingFromTools.length || choiceFromTools) break;
      await showStatus('💭 Thinking...');
    }

    await clearStatus();

    // Persist trimmed history + any action now awaiting confirmation. The card
    // has to be held BEFORE the save, or its id never reaches the database and
    // every tap comes back "expired".
    session.history = this.trimHistory(messages) as SessionState['history'];
    // Cards already on screen keep their id (holdPending dedupes), so only
    // genuinely new ones are sent below.
    const heldBefore = new Set((session.pendingActions || []).map((p) => p.id));
    if (pendingFromTools.length) for (const p of pendingFromTools) this.holdPending(session, p);
    else session.pendingAction = null;
    await this.saveSession(...this.sk(msg), session);

    if (choiceFromTools) {
      await adapter.sendButtons(
        msg.chatId,
        choiceFromTools.question,
        choiceFromTools.options.slice(0, 3).map((o: string) => ({ label: o.slice(0, 20), data: `choice:${o}` })),
      );
    }

    for (const p of pendingFromTools) if (!heldBefore.has(p.id)) await this.sendPendingCard(adapter, msg.chatId, p);
    } catch (e: any) {
      // Never leave the user staring at a status line. Drop the (possibly
      // corrupted) history so the next message starts clean.
      this.logger.error(`agent run failed: ${e?.message}`);
      await clearStatus();
      session.history = [];
      session.pendingAction = null;
      await this.saveSession(...this.sk(msg), session);
      await adapter.sendText(
        msg.chatId,
        'Sorry, something went wrong on my side and I have reset our conversation. Please send that again.',
      );
    }
  }

  /**
   * Trim history to the last N turns WITHOUT orphaning tool blocks.
   *
   * A `tool_result` is only valid when the immediately preceding assistant
   * message carries the matching `tool_use`. A naive slice can cut between the
   * two, leaving a window that starts on a `tool_result` — the API then rejects
   * every subsequent call with a 400 and the conversation is bricked until the
   * session is cleared. So after slicing, drop from the front until the window
   * begins on a clean user turn.
   */
  private trimHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    let out = messages.slice(-HISTORY_TURNS);
    while (out.length && !this.isCleanStart(out[0])) out = out.slice(1);
    return out;
  }

  /** True when this message can safely be the first in a request. */
  private isCleanStart(m: Anthropic.MessageParam): boolean {
    if (!m || m.role !== 'user') return false;
    if (typeof m.content === 'string') return true;
    return Array.isArray(m.content) && !m.content.some((b: any) => b?.type === 'tool_result');
  }

  // ── Round S: shipments profile ─────────────────────────────────────────────

  private readonly profileCache = new Map<string, { at: number; profile: 'shipments' | null }>();

  /** 'shipments' when the org has the SHIPMENTS module on (ADH); cached a minute. */
  async profileOf(organizationId: string): Promise<'shipments' | null> {
    const hit = this.profileCache.get(organizationId);
    if (hit && Date.now() - hit.at < 60_000) return hit.profile;
    const mod = await this.prisma.organizationModule.findFirst({ where: { organizationId, moduleCode: 'SHIPMENTS', enabled: true }, select: { id: true } }).catch(() => null);
    const profile = mod ? ('shipments' as const) : null;
    this.profileCache.set(organizationId, { at: Date.now(), profile });
    return profile;
  }

  private shipmentsPrompt(ctx: OperatorContext, latest: string): string {
    const perms = ctx.isOsirisAdmin ? 'all permissions (admin)' : ctx.roles.flatMap((r) => r.permissions.map((p) => `${p.resource}:${p.action}`)).join(', ') || 'none';
    return shipmentsSystemPrompt({ actorName: ctx.actor.name || ctx.actor.email || 'a staff member', orgName: ctx.organizationName, now: new Date(), lang: replyLanguage(latest), perms });
  }

  /** A PDF / photo sent on WhatsApp: the same intake as an email attachment, then a Confirm card (or the result). */
  private async handleShipmentsFiles(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    files: Array<{ dataUri: string; mimetype: string; filename?: string }>,
    caption: string,
    lang: 'ja' | 'en',
  ): Promise<void> {
    const session = await this.loadSession(...this.sk(msg));
    await adapter.sendTyping?.(msg.chatId).catch(() => null);
    for (const f of files.slice(0, 5)) {
      const name = f.filename || (f.mimetype.includes('pdf') ? 'document.pdf' : 'photo.jpg');
      // Round AL: a screenshot of a carrier tracking page → "AIMS → tracking" + Confirm (not filed as a document).
      if (/^image\//i.test(f.mimetype)) {
        const ref = /#?\d{1,5}-\d{1,3}/.exec(caption ?? '')?.[0] ?? null;
        const t = await this.shipTools
          .trackingCard(ctx, { image: { buffer: Buffer.from(f.dataUri.replace(/^data:[^;]+;base64,/, ''), 'base64'), mimetype: f.mimetype } }, ref, lang)
          .catch((e: any) => ({ result: { error: String(e?.message ?? e) }, notTracking: true }) as any);
        if (t.pending) {
          this.holdPending(session, t.pending);
          await this.saveSession(...this.sk(msg), session);
          await adapter.sendButtons(msg.chatId, `${t.pending.summary}\n\n${lang === 'ja' ? '反映しますか？' : 'Apply?'}`, [
            { label: '\u2705 Confirm', data: `confirm:${t.pending.id}` },
            { label: '\u274c Cancel', data: `cancel:${t.pending.id}` },
          ]);
          session.history = [...(session.history || []), { role: 'user' as const, content: `[tracking screenshot ${name} → ${t.result?.ref}, awaiting the user's Confirm]` }, { role: 'assistant' as const, content: 'Noted.' }].slice(-40);
          await this.saveSession(...this.sk(msg), session);
          continue;
        }
        if (!t.notTracking) {
          const r: any = t.result ?? {};
          await adapter.sendText(msg.chatId, r.upToDate ? (lang === 'ja' ? `${r.ref} は追跡情報と一致しています。` : `${r.ref} already matches the tracking page.`) : String(r.error ?? 'Could not read the tracking page.'));
          continue;
        }
      }
      let out: Awaited<ReturnType<ShipmentsToolsService['intakeFile']>>;
      try {
        out = await this.shipTools.intakeFile(ctx, f, caption, msg.providerMessageId);
      } catch (e: any) {
        this.logger.error(`whatsapp intake failed: ${e?.message}`);
        await adapter.sendText(msg.chatId, lang === 'ja' ? `${name} を取り込めませんでした。もう一度送ってください。` : `I couldn't take in ${name}. Please send it again.`);
        continue;
      }
      const row: any = out.row;
      const filed = (row?.done ?? []).filter((a: any) => a.kind === 'file' && a.status === 'done').length;
      const evidence = row?.evidence ? `\n${String(row.evidence).slice(0, 200)}` : '';
      let note: string;
      if (out.inboxState === 'PROCESSED') {
        note = lang === 'ja' ? `✅ ${name} → ${row?.matched ?? 'リンク済み'}${filed ? `（${filed} 件保存）` : ''}${evidence}` : `✅ Filed ${name} → ${row?.matched ?? 'linked'}${filed ? ` (${filed} document${filed > 1 ? 's' : ''})` : ''}${evidence}`;
        await adapter.sendText(msg.chatId, note);
      } else if (out.inboxState === 'SUGGESTED' && row?.matched) {
        // Round T: "this is the AN for #19-1" — the caption's record beats the suggestion when they differ.
        const pending = (await this.shipTools.pendingForCaption(ctx, row, name, caption)) ?? this.shipTools.pendingForIntake(row, name);
        if (pending) {
          this.holdPending(session, pending);
          await this.saveSession(...this.sk(msg), session);
          await adapter.sendButtons(msg.chatId, `${pending.summary}\n\n${lang === 'ja' ? '確定しますか？' : 'Confirm?'}`, [
            { label: '\u2705 Confirm', data: `confirm:${pending.id}` },
            { label: '\u274c Cancel', data: `cancel:${pending.id}` },
          ]);
        }
        note = `[file ${name} → intake emailId=${out.logId}, suggested ${row.matched}, awaiting the user's Confirm]`;
      } else if (out.verdict === 'NOT_SHIPMENT' || out.inboxState === 'HIDDEN') {
        await adapter.sendText(msg.chatId, lang === 'ja' ? `${name} は出荷関連ではないと判断しました。関連する場合はレコード番号（例: #21-1）を教えてください。` : `${name} doesn't look like a shipment document. If it is, tell me the record (e.g. #21-1).`);
        note = `[file ${name} → intake emailId=${out.logId}, judged not a shipment document]`;
      } else if (await this.shipTools.pendingForCaption(ctx, row, name, caption)) {
        const pending = (await this.shipTools.pendingForCaption(ctx, row, name, caption))!;
        this.holdPending(session, pending);
        await this.saveSession(...this.sk(msg), session);
        await adapter.sendButtons(msg.chatId, `${pending.summary}\n\n${lang === 'ja' ? '確定しますか？' : 'Confirm?'}`, [
          { label: '\u2705 Confirm', data: `confirm:${pending.id}` },
          { label: '\u274c Cancel', data: `cancel:${pending.id}` },
        ]);
        note = `[file ${name} → intake emailId=${out.logId}, the caption names a record, awaiting the user's Confirm]`;
      } else {
        const cands: string[] = (row?.candidates ?? []).slice(0, 3).map((c: any) => c.ref);
        const ask = cands.length ? (lang === 'ja' ? `どのレコードですか？ ${cands.join(' / ')}` : `Which record? ${cands.join(' / ')}`) : lang === 'ja' ? 'どのレコードに紐づけますか？（例: #21-1）' : 'Which record should it go to? (e.g. #21-1)';
        await adapter.sendText(msg.chatId, `📎 ${name}${evidence}\n${ask}`);
        note = `[file ${name} → intake emailId=${out.logId}, state ${out.inboxState}, candidates ${cands.join(', ') || 'none'}; when the user names a record, call email_link with this emailId]`;
      }
      session.history = [...(session.history || []), { role: 'user' as const, content: note }, { role: 'assistant' as const, content: 'Noted.' }].slice(-40);
      await this.saveSession(...this.sk(msg), session);
    }
  }

  private systemPrompt(ctx: OperatorContext): string {
    const perms = ctx.isOsirisAdmin
      ? 'all permissions (admin)'
      : ctx.roles.flatMap((r) => r.permissions.map((p) => `${p.resource}:${p.action}`)).join(', ') || 'none';
    // Without this the model dates "tomorrow" from its training data — a real
    // schedule came back as 2 Sept when the user meant the 23rd.
    const now = new Date();
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' });
    const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const tomorrow = new Date(now.getTime() + 86400_000);
    return [
      `You are the AIMS Operator, an assistant that performs real work inside the AIMS business system on behalf of staff, over chat.`,
      `TODAY is ${fmt(now)} (${iso(now)}) in Singapore time. TOMORROW is ${fmt(tomorrow)} (${iso(tomorrow)}). Work out every relative date ("tomorrow", "next Tuesday", "end of the month") from these, never from memory, and always send dates as ISO-8601 with the +08:00 offset.`,
      `You are acting as ${ctx.actor.name || 'a staff user'} in the organization "${ctx.organizationName}". Their permissions: ${perms}.`,
      `Everything you do is scoped to this organization only.`,
      ``,
      `RULES:`,
      `1. NEVER invent a customer id, item id, price, or amount. Always resolve them with tools first (find_customer, find_item).`,
      `2. If a customer or item is ambiguous or missing, ask the user. Do not guess or silently pick the first match.`,
      `3. Creating a DRAFT is safe. Finalising/confirming/posting/paying is NOT. To finalise anything you MUST call the matching confirm tool (confirm_document, confirm_invoice, post_bill, record_payment) — NEVER ask the user to confirm in your own words, and never simulate it. When such a tool responds that a Confirm button has been shown, STOP: say one short line like "Sent for your confirmation" and wait. Do NOT call the tool again and do NOT claim it is done — the system finalises it only when the user taps Confirm. SEVERAL AT ONCE: when one request names several documents or actions ("delete those two", "confirm all four"), hold ALL of them in the SAME turn, one tool call and one card each, so the user confirms them together; never do the first and forget the rest. After a Confirm, re-read the request it came from and finish whatever is still undone before going quiet.`,
      `4. Amounts are in the organization's default currency unless stated otherwise.`,
      `5. Keep replies short and plain, because this is a chat app. No markdown tables, no headings. Use the document number when referring to a document.`,
      `5b. LANGUAGE: answer in the language of the user's LATEST message, not the language the conversation has been in. A Chinese question gets a Chinese answer; the very next message in English gets an English answer, and switching back switches you back. Judge each message on its own (guru 2026-10-16: he asked one question by voice in Chinese, then the next in English, and kept getting Chinese back). This governs what you SAY. Data you write into AIMS, line descriptions, document fields, search terms, is unaffected: keep that in the language the user dictated it in. Report titles, document numbers and customer names are never translated.`,
      `6. If a tool returns an error, tell the user plainly what went wrong and what you need from them.`,
      `7. If the user refers to something loosely ("send it again", "that quotation", "the last one") and it isn't in this conversation, DON'T ask them to repeat themselves. Call list_recent_documents and act on the most recent matching document. Only ask when there is genuine ambiguity (e.g. several plausible matches).`,
      `7c. FINDING DOCUMENTS: list_recent_documents shows only the newest 20. To find documents by month, period, customer, wording on a line, reference or number ("the April invoice", "anything for Biofuel", "INV-059"), call search_documents. NEVER tell the user a document does not exist, or that a month was never billed, unless search_documents came back empty for it. A document's period is usually in its line descriptions ("ESS Maintenance for April 2026"), not its date, so search by the words.`,
      `7b. BE SHORT (guru 2026-09-22: "always short and sweet, get to the point"). Lead with the answer or the gap, never a paragraph of preamble. When something is missing, say which field is missing in a few words and stop; do not explain the consequences at length or restate what the user just told you. When you need the user to pick between options, DO NOT write them out as "1. ... 2. ..." — call ask_choice and they tap a button. Offer to take an upload when a document would fill the gap.`,
      `8. PUNCTUATION: never use em dashes or en dashes ("—", "–") in your replies OR in any text you write into a document (line item descriptions, notes, terms). Use a comma, a full stop, a colon or brackets instead. Ordinary hyphens inside words (e.g. "Fan-Coil") are fine.`,
      `9. FULL DASHBOARD ACCESS: you can read ANYTHING the user's web dashboard shows, even without a dedicated tool. When asked about commissions, earnings, targets, dashboards, reports, schedules, quests, leads or any other screen's numbers: call api_docs with keywords to find the right GET endpoint, then api_get to fetch it (their permissions are enforced automatically). Examples: designer commissions/revenue live at /id-projects/dashboard; a project's P&L incl. commission at /projects/<id>/costing. NEVER answer "I don't have a tool for that" before trying api_docs.`,
      `10. CHANGING THINGS WITHOUT A DEDICATED TOOL: if no tool covers an action the user wants, do NOT invent one out of a tool that looks close (that is how a delivery schedule became a priced document). Search api_docs for the POST/PATCH/PUT/DELETE endpoint, build the body from the {field*:type} list it returns, then call api_write with a plain-English summary of what will change. Use the method the catalog shows: a document is removed with DELETE /documents/delete/{id}, never by POSTing to its URL. Ordinary changes run at once; money, finality and irreversible ones (confirm, post, void, approve, pay, delete, send, users and roles) are held until the user taps Confirm, so say what you are about to do. NOTHING is off limits: if the user's role can do it in AIMS, you can do it here, with that same confirmation. Never tell the user to go and do something in the app themselves. If the call comes back with a validation error, read the field names in it and fix the body rather than giving up. If a call fails, tell the user the method, path and error exactly as returned; do not retry with a guessed route.`,
      `12. NEVER mention tool names or internal mechanics to the user (no "create_customer", "api_get", "the tool"). Speak in terms of what AIMS does: "I'll add the customer", "the invoice list".`,
      `13. NON-FINANCIAL CREATES NEED NO PERMISSION: adding a customer, a supplier, a draft document or a note is safe and reversible. When the details are clear, do it and report the result in one line; only ask when something is genuinely ambiguous or missing. Do not read the details back and ask "shall I go ahead?". The confirm gate (rule 3) is for money and finality, not for drafts and master data.`,
      `11. RETRY, DON'T REMEMBER FAILURES: tool errors are often transient (deploys, config changes between messages). When the user asks again for something that failed earlier in this chat, ALWAYS call the tool again fresh. NEVER claim you "tried again" unless you actually called the tool this turn, and never present an old error as the current state.`,
    ].join('\n');
  }

  // ── Confirmation handling ─────────────────────────────────────────────────

  /** Tappable list of the org's users for /as. Typing a name still works;
   *  this is for when you do not remember who is in there. */
  private async presentUserPicker(
    adapter: ChannelAdapter,
    chatId: string,
    users: Array<{ userId: string; name: string; email: string; roles: string }>,
    orgName: string,
  ): Promise<void> {
    const rows = users.slice(0, 10).map((u) => ({
      id: `as:${u.userId}`.slice(0, 200),
      // WhatsApp caps a row title at 24 chars and a description at 72.
      title: (u.name !== '(no name)' ? u.name : u.email || u.userId).slice(0, 24),
      description: [u.roles, u.email].filter(Boolean).join(' · ').slice(0, 72),
    }));
    const prompt =
      `Who in ${orgName} should I act as?` +
      (users.length > 10 ? `\n\nShowing 10 of ${users.length}. Send "/as <name>" to narrow it.` : '');
    if (adapter.sendList) {
      await adapter.sendList(chatId, prompt, 'Choose user', rows);
      return;
    }
    await adapter.sendButtons(
      chatId,
      prompt,
      rows.slice(0, 3).map((r) => ({ label: r.title.slice(0, 20), data: r.id })),
    );
  }

  /**
   * Render the org picker. WhatsApp reply buttons cap at THREE (the adapter
   * silently drops the rest), so anything larger goes out as a tappable list,
   * which holds ten. Beyond that, `/org <name>` narrows it.
   */
  private async presentOrgPicker(
    adapter: ChannelAdapter,
    chatId: string,
    options: Array<{ id: string; name: string }>,
    currentName?: string,
  ): Promise<void> {
    const prompt = currentName
      ? `Currently working in ${currentName}. Switch to:`
      : 'Which organization should I work in?';
    if (options.length > 3 && adapter.sendList) {
      await adapter.sendList(
        chatId,
        options.length > 10
          ? `${prompt}\n\nShowing the first 10. Send "/org <name>" to narrow it down.`
          : prompt,
        'Choose org',
        options.slice(0, 10).map((o) => ({ id: `org:${o.id}`, title: o.name })),
      );
      return;
    }
    await adapter.sendButtons(
      chatId,
      prompt,
      options.slice(0, 3).map((o) => ({ label: o.name, data: `org:${o.id}` })),
    );
  }

  /** Persist the chosen org for this sender and confirm it. */
  private async switchOrg(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    organizationId: string,
  ): Promise<void> {
    const org = await this.auth.canUseOrg(ctx, organizationId);
    if (!org) {
      await adapter.sendText(msg.chatId, "You don't have access to that organization.");
      return;
    }
    await this.auth.setOrganization(msg.channel, msg.channelUserId, org.id);
    await adapter.sendText(msg.chatId, `✅ Now working in ${org.name}. Everything I do next applies to this org.`);
  }

  private async handleCallback(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    data: string,
  ): Promise<void> {
    if (data.startsWith('choice:')) {
      // The label the user tapped re-enters as ordinary text, so the model
      // picks up exactly where it left off with no special-casing.
      const picked = data.slice('choice:'.length);
      const choiceSession = await this.loadSession(...this.sk(msg));
      await this.runAgent(ctx, adapter, { ...msg, text: picked, callbackData: undefined }, choiceSession, picked);
      return;
    }

    if (data.startsWith('as:')) {
      // Re-resolve the pick so a stale card cannot name someone who has since
      // left the org, and so the label shown matches what is stored.
      const picked = data.slice(3);
      if (!ctx.isOsirisAdmin) {
        await adapter.sendText(msg.chatId, 'Only a platform admin can act as another user.');
        return;
      }
      const found = (await this.auth.listOrgUsers(ctx.organizationId)).find((u) => u.userId === picked);
      if (!found) {
        await adapter.sendText(msg.chatId, 'That user is no longer in this organization.');
        return;
      }
      const sess = await this.loadSession(...this.sk(msg));
      sess.actingAs = { userId: found.userId, label: found.name !== '(no name)' ? found.name : found.email || found.userId };
      await this.saveSession(...this.sk(msg), sess);
      await adapter.sendText(
        msg.chatId,
        `👤 Acting as ${sess.actingAs.label} (${found.roles}) in ${ctx.organizationName}.\n` +
          `You have exactly their permissions now. /whoami to check, /as off when done.`,
      );
      return;
    }

    if (data.startsWith('org:')) {
      await this.switchOrg(ctx, adapter, msg, data.slice(4));
      return;
    }

    const session = await this.loadSession(...this.sk(msg));

    // Project chosen for an uploaded invoice's cost.
    if (data.startsWith('costproj:')) {
      const projectId = data.slice('costproj:'.length);
      const up = session.pendingUpload;
      if (!up) {
        await adapter.sendText(msg.chatId, 'That invoice upload has expired — please resend it.');
        return;
      }
      ctx.upload = up;
      const outcome = await this.tools.execute(ctx, 'add_project_cost', { projectId });
      session.pendingUpload = null;
      if (outcome.pending) {
        session.pendingAction = outcome.pending;
        this.holdPending(session, outcome.pending);
        await this.saveSession(...this.sk(msg), session);
        await this.sendPendingCard(adapter, msg.chatId, outcome.pending);
      } else {
        await this.saveSession(...this.sk(msg), session);
        await adapter.sendText(msg.chatId, outcome.result?.error || "I couldn't record that cost.");
      }
      return;
    }

    if (data === 'cancel' || data.startsWith('cancel:')) {
      const id = data.startsWith('cancel:') ? data.slice(7) : '';
      const dropped = this.takePending(session, id);
      if (dropped) this.markDone(session, dropped, 'cancelled');
      await this.saveSession(...this.sk(msg), session);
      const done = !dropped && (session.doneActions || []).find((d) => d.id === id);
      await adapter.sendText(
        msg.chatId,
        dropped ? `❌ Cancelled — ${dropped.summary}. Nothing was changed.` : done ? this.doneReply(done) : 'That one is no longer waiting, so nothing was changed.',
      );
      return;
    }
    if (data.startsWith('confirm:')) {
      const id = data.slice(8);
      const chosen = this.takePending(session, id);
      if (!chosen) {
        // The card may already be finished — say so instead of "expired".
        const done = (session.doneActions || []).find((d) => d.id === id);
        await adapter.sendText(msg.chatId, done ? this.doneReply(done) : 'That confirmation has expired. Ask me again and I’ll redo it.');
        return;
      }
      await this.executePending(ctx, adapter, msg, session, chosen);
    }
  }

  /** Send a confirmation card: the invoice itself first (so the user sees
   *  WHAT they're confirming — guru 2026-10-02), then the Confirm buttons. */
  private async sendPendingCard(adapter: ChannelAdapter, chatId: string, pending: PendingAction): Promise<void> {
    if (pending.attachment?.url) {
      await adapter
        .sendDocument(chatId, pending.attachment.url, pending.attachment.filename || 'invoice.pdf', '📎 This is what you are confirming:', pending.documentId)
        .catch(() => null);
    }
    await adapter.sendButtons(chatId, `${pending.summary}\n\nConfirm?`, [
      { label: '\u2705 Confirm', data: `confirm:${pending.id}` },
      { label: '\u274c Cancel', data: `cancel:${pending.id}` },
    ]);
  }

  /** Remember a finished card so a re-tap answers honestly. */
  private markDone(session: SessionState, pending: PendingAction, result: 'confirmed' | 'cancelled' | 'failed') {
    const list = session.doneActions || [];
    list.push({ id: pending.id || '', summary: pending.summary || '', result, at: new Date().toISOString() });
    session.doneActions = list.slice(-6);
  }

  private doneReply(d: { summary: string; result: string; at: string }): string {
    const t = new Date(d.at).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' });
    if (d.result === 'confirmed') return `✅ Already confirmed at ${t} — ${d.summary}. I didn't do it a second time.`;
    if (d.result === 'cancelled') return `❌ That card was cancelled at ${t} — nothing was changed.`;
    return `⚠️ That one failed at ${t} — ask me again to retry.`;
  }

  /** Hold a card and return its id for the buttons. Keeps the last few so a
   *  tap on an older card still lands on the right action. */
  private holdPending(session: SessionState, pending: PendingAction): string {
    // The same action held twice (the model re-holding a card that is still
    // waiting) keeps the first card instead of showing a second one.
    const twin = (session.pendingActions || []).find(
      (p) => p.kind === pending.kind && (p.documentId || '') === (pending.documentId || '') && JSON.stringify(p.args || {}) === JSON.stringify(pending.args || {}),
    );
    if (twin?.id) {
      pending.id = twin.id;
      return twin.id;
    }
    const id = pending.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    pending.id = id;
    const list = (session.pendingActions || []).filter((p) => p.id !== id);
    list.push(pending);
    session.pendingActions = list.slice(-6);
    session.pendingAction = pending; // newest, for the typed "yes" path
    return id;
  }

  /** Find a card by the id its button carried, and drop it from the held set. */
  private takePending(session: SessionState, id: string): PendingAction | null {
    const list = session.pendingActions || (session.pendingAction ? [session.pendingAction] : []);
    const found = list.find((p) => p.id === id) || (!id || id === 'pending' ? list[list.length - 1] : null);
    if (!found) return null;
    session.pendingActions = list.filter((p) => p !== found);
    session.pendingAction = session.pendingActions[session.pendingActions.length - 1] ?? null;
    return found;
  }

  private async executePending(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
    chosen?: PendingAction,
  ): Promise<void> {
    const pending = chosen ?? session.pendingAction!;
    // Whatever path led here, the card is spent: drop it from the held list so
    // a later tap on the same button cannot run it a second time.
    session.pendingActions = (session.pendingActions || []).filter((p) => p.id !== pending.id);
    let res: { ok: boolean; message: string };
    try {
      res = pending.kind === 'shipments' ? await this.shipTools.runPending(ctx, pending) : await this.tools.runPending(ctx, pending);
    } catch (e: any) {
      // A thrown confirm used to vanish silently (the webhook swallows the
      // rejection) leaving the user with no feedback and a stuck pendingAction.
      // Surface the real reason and clear the action so they can retry.
      this.logger.error(`runPending(${pending.kind}) failed: ${e?.message}`);
      const detail = e?.response?.message ?? e?.message ?? 'Unknown error';
      res = {
        ok: false,
        message: `Sorry, I couldn't finalise that: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
      };
    }
    session.pendingAction = null;
    // A confirmed cost consumed its upload — clear it so the next file never
    // inherits a stale one.
    if (res.ok && pending.kind === 'add_project_cost') {
      session.pendingUpload = null;
      (session as any).pendingUploadAt = null;
    }
    this.markDone(session, pending, res.ok ? 'confirmed' : 'failed');
    await this.saveSession(...this.sk(msg), session);
    if (res.ok && pending.documentId && adapter.sendUi) {
      await adapter.sendUi(msg.chatId, { type: 'document', documentId: pending.documentId, fresh: true }).catch(() => null);
    }
    // The card "becomes confirmed": the reply always leads with the outcome.
    await adapter.sendText(msg.chatId, res.ok ? (/^✅/.test(res.message) ? res.message : `✅ Confirmed — ${res.message}`) : res.message);
    if (res.ok && pending.kind === 'shipments' && (pending.args as any)?.op === 'generated_doc_create') {
      const a: any = pending.args;
      const p = await this.shipTools.previewForLatestDraft(ctx, a.ref, a.docType).catch(() => null);
      if (p) await adapter.sendDocument(msg.chatId, p.url, p.filename, p.caption).catch(() => null);
    }

    // Hand the outcome back to the model so multi-step work continues.
    //
    // A confirmation used to END the turn. Asked to post TWO invoices, the
    // agent could only hold one pending action, posted it, and stopped — the
    // second stayed a draft with nothing said about it (guru 2026-10-02).
    // Each further step still needs its own tap, so this cannot run away.
    if (res.ok) {
      await this.continueAfterConfirm(ctx, adapter, msg, pending, res.message);
    }
  }

  /** Resume the user's request after a confirmed step, if anything is left. */
  private async continueAfterConfirm(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    done: PendingAction,
    outcome: string,
  ): Promise<void> {
    try {
      const session = await this.loadSession(...this.sk(msg));
      const stillHeld = (session.pendingActions || []).filter((p) => p.id !== done.id);
      await this.runAgent(
        ctx,
        adapter,
        msg,
        session,
        `[system] The user tapped Confirm and this completed: ${done.summary} -> ${outcome}\n` +
          (stillHeld.length
            ? `These are ALREADY held as cards and only need the user's tap, so do NOT hold or do them again: ${stillHeld.map((p) => p.summary).join(' | ')}\n`
            : '') +
          `If anything else from their earlier request is still outstanding and not listed above, do it now. ` +
          `If nothing remains, say nothing further — do NOT repeat the confirmation or start new work.`,
        { quietIfIdle: true },
      );
    } catch (e: any) {
      // The action itself already succeeded and was reported; a failed
      // continuation must not make it look otherwise.
      this.logger.warn(`continueAfterConfirm failed: ${e?.message}`);
    }
  }

  // ── Web channel ───────────────────────────────────────────────────────────

  /** Extra system prompt for the dashboard chat. Empty on chat apps. */
  private webPrompt(ctx: OperatorContext): string {
    if (ctx.channel !== 'web') return '';
    const screens = (ctx.web?.screens || []).map((s) => `${s.label}: ${s.path}`).join('\n');
    return [
      ``,
      ``,
      `WEB DASHBOARD CHAT: this conversation is in the AIMS web dashboard, not a phone. Rule 5 is relaxed here: you may use **bold**, short bullet lists and small markdown tables. Still short.`,
      `The screen has a SIDE PANEL. Any document you create, edit or preview opens there automatically with a live preview, so say "it's open on the right" instead of describing it line by line.`,
      `SIDE PANEL RIGHT NOW: ${this.panelState(ctx)}. You cannot see the panel, only this line. When the user asks to see, show, open or preview a document, ALWAYS call preview_document (even if you showed it earlier): the user may have closed the panel. Never say something is open on the right unless this line says so or you just called a tool that opens it.`,
      `To show the user a dashboard screen (a list, a report, a settings page) call open_screen with its path: it opens in the side panel and the chat stays open. Use it whenever the user wants to SEE or work on a screen. For "where is X" / "how do I change X" questions, OPEN the screen straight away (do not ask "want me to open it?") and answer in one line that says which tab or button to use.`,
      `Rule 8 holds here too: no em dashes or en dashes anywhere, including inside bullet lists; write "AsiaDealHub: S$8,000.00 (31 to 60 days overdue)".`,
      `For a list or report the user asked about, prefer show_view (a table or stat tiles in the side panel) over a long chat message, then summarise in one line.`,
      `Screens this user may open (label: path):`,
      screens || '(none sent)',
      ``,
      `HOW THE APP WORKS (for "how do I" questions; answer in one or two lines and open the screen):`,
      APP_KNOWLEDGE,
    ].join('\n');
  }

  private panelState(ctx: OperatorContext): string {
    const p = ctx.web?.panel;
    if (!p) return 'closed (nothing is showing)';
    if (p.type === 'document') return `showing document ${p.documentId}`;
    if (p.type === 'screen') return `showing the screen ${p.path}`;
    return `showing a table "${p.title}"`;
  }

  /** Where this message's conversation is stored. */
  private sessionOf(msg: InboundMessage): { channel: OperatorChannel; channelUserId: string } {
    return msg.session ?? { channel: msg.channel, channelUserId: msg.channelUserId };
  }

  private sk(msg: InboundMessage): [OperatorChannel, string] {
    const s = this.sessionOf(msg);
    return [s.channel, s.channelUserId];
  }

  /** Wrap an adapter so every reply is also written to the display transcript. */
  private recording(adapter: ChannelAdapter, msg: InboundMessage): ChannelAdapter {
    const [channel, channelUserId] = this.sk(msg);
    const via = msg.channel;
    const rec = (item: Partial<TranscriptItem>) =>
      this.appendTranscript(channel, channelUserId, [{ role: 'assistant', kind: 'text', via, ...item } as TranscriptItem]);
    // A WhatsApp thread continued from the dashboard: the phone gets a copy of
    // each reply too, so the conversation reads the same on both. Best-effort;
    // a missing connection (dev) or a Graph error never breaks the web reply.
    const mirror =
      msg.channel === 'web' && channel === 'whatsapp'
        ? async (fn: () => Promise<void>) => {
            try {
              const org = msg.presetCtx?.organizationId;
              if (org && (await this.whatsapp.primeForOrg(channelUserId, org))) await fn();
            } catch (e: any) {
              this.logger.warn(`whatsapp mirror skipped: ${e?.message}`);
            }
          }
        : null;
    const w: ChannelAdapter = {
      channel: adapter.channel,
      parse: (b) => adapter.parse(b),
      sendText: async (c, raw) => {
        const t = msg.plain ? stripEmoji(plainDashes(raw)) : plainDashes(raw);
        await adapter.sendText(c, t);
        await rec({ kind: 'text', text: t });
        if (mirror) await mirror(() => this.whatsapp.sendText(channelUserId, `💻 ${t}`));
      },
      sendDocument: async (c, url, filename, caption, documentId) => {
        await adapter.sendDocument(c, url, filename, caption);
        // Prefer the id the caller knows; otherwise pick the uuid out of the
        // S3 key (rendered PDFs are keyed `<docId>_<timestamp>.pdf`).
        const fromUrl = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^/?]*\.pdf/i.exec(url)?.[1];
        await rec({ kind: 'document', url, filename, text: caption, documentId: documentId || fromUrl });
        if (mirror) await mirror(() => this.whatsapp.sendDocument(channelUserId, url, filename, caption));
      },
      sendButtons: async (c, rawT, rawB) => {
        const t = msg.plain ? stripEmoji(plainDashes(rawT)) : rawT;
        const b = msg.plain ? rawB.map((x) => ({ ...x, label: stripEmoji(x.label) || x.label })) : rawB;
        await adapter.sendButtons(c, t, b);
        await rec({ kind: 'buttons', text: t, buttons: b });
        // Buttons stay on the web: a tap must land on the screen that holds them.
        if (mirror) await mirror(() => this.whatsapp.sendText(channelUserId, `💻 ${t}\n(answer on the dashboard)`));
      },
    };
    if (adapter.sendList) {
      w.sendList = async (c, rawT, label, rawRows) => {
        const t = msg.plain ? stripEmoji(plainDashes(rawT)) : rawT;
        const rows = msg.plain ? rawRows.map((r) => ({ ...r, title: stripEmoji(r.title) || r.title })) : rawRows;
        await adapter.sendList!(c, t, label, rows);
        await rec({ kind: 'list', text: t, buttons: rows.map((r) => ({ label: r.title, data: r.id })) });
      };
    }
    if (adapter.answerCallback) w.answerCallback = (id, t) => adapter.answerCallback!(id, t);
    if (adapter.sendTyping) w.sendTyping = (c) => adapter.sendTyping!(c);
    if (adapter.sendStatus) w.sendStatus = (c, t) => adapter.sendStatus!(c, t);
    if (adapter.editStatus) w.editStatus = (c, id, t) => adapter.editStatus!(c, id, t);
    if (adapter.deleteMessage) w.deleteMessage = (c, id) => adapter.deleteMessage!(c, id);
    if (adapter.sendUi) {
      w.sendUi = async (c, e) => {
        await adapter.sendUi!(c, e);
        // Remembered so reopening the chat brings its panel back.
        await this.patchThreadMeta(channel, channelUserId, { lastPanel: e }).catch(() => null);
      };
    }
    return w;
  }

  /** Record what the user sent: their words, the button they tapped, or the file. */
  private async recordInbound(msg: InboundMessage, text: string): Promise<void> {
    const [channel, channelUserId] = this.sk(msg);
    let shown = text;
    if (msg.callbackData) {
      const d = msg.callbackData;
      if (d.startsWith('confirm:')) shown = 'Confirm';
      else if (d.startsWith('cancel:') || d === 'cancel') shown = 'Cancel';
      else if (d.startsWith('choice:')) shown = d.slice(7);
      else {
        // Find the label of the button that carried this payload.
        const row = await this.prisma.operatorSession.findUnique({
          where: { channel_channelUserId: { channel, channelUserId } },
          select: { state: true },
        });
        const items: TranscriptItem[] = ((row?.state as any)?.transcript || []).slice().reverse();
        shown = items.flatMap((i) => i.buttons || []).find((b) => b.data === d)?.label || 'Selected an option';
      }
    } else if (msg.attachments?.length || msg.attachment) {
      const names = (msg.attachments?.length ? msg.attachments : [msg.attachment!]).map((a) => `📎 ${a.filename || 'Uploaded a file'}`);
      shown = `${names.join('\n')}${text ? `\n${text}` : ''}`;
    }
    if (!shown) return;
    await this.appendTranscript(channel, channelUserId, [
      { role: 'user', kind: 'text', text: msg.fromVoice ? `🎙️ ${shown}` : shown, via: msg.channel } as TranscriptItem,
    ]);
  }

  /**
   * Append to a conversation's display transcript. The ONLY writer of
   * `transcript`: saveSession carries the stored copy over, so a whole-session
   * save made from an older in-memory copy can never drop lines written since.
   */
  async appendTranscript(channel: OperatorChannel, channelUserId: string, items: TranscriptItem[]): Promise<void> {
    try {
      const row = await this.prisma.operatorSession.findUnique({
        where: { channel_channelUserId: { channel, channelUserId } },
      });
      const state: any = (row?.state as any) || { history: [] };
      // A conversation from before transcripts existed starts from what its
      // model history can still show.
      const base: TranscriptItem[] = Array.isArray(state.transcript)
        ? state.transcript
        : OperatorService.transcriptFromHistory(state.history || [], channel);
      const now = new Date().toISOString();
      const stamped = items.map((i, n) => ({
        ...i,
        id: i.id || `t${Date.now().toString(36)}${n}${Math.random().toString(36).slice(2, 6)}`,
        at: i.at || now,
      }));
      state.transcript = [...base, ...stamped].slice(-TRANSCRIPT_MAX);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await this.prisma.operatorSession.upsert({
        where: { channel_channelUserId: { channel, channelUserId } },
        update: { state },
        create: { channel, channelUserId, state, expiresAt },
      });
    } catch (e: any) {
      this.logger.warn(`transcript append failed: ${e?.message}`);
    }
  }

  /** Best-effort display lines from model history (no timestamps, no files). */
  static transcriptFromHistory(history: any[], via: OperatorChannel): TranscriptItem[] {
    const out: TranscriptItem[] = [];
    (history || []).forEach((m: any, i: number) => {
      let text = '';
      if (typeof m?.content === 'string') text = m.content;
      else if (Array.isArray(m?.content)) {
        if (m.content.some((b: any) => b?.type === 'tool_result')) return;
        text = m.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
      }
      text = (text || '').trim();
      if (!text || text.startsWith('[system]')) return;
      if (m.role === 'user' && text.startsWith('[the user forwarded a document]')) {
        text = `📎 ${text.replace('[the user forwarded a document]', '').split('\n')[0].trim()}`;
      }
      if (m.role === 'user' && text.startsWith('I just uploaded a supplier invoice')) return;
      out.push({ id: `h${i}`, at: '', role: m.role === 'user' ? 'user' : 'assistant', kind: 'text', text, via });
    });
    return out;
  }

  /** A conversation's stored state, for the web chat to render. */
  /** Name a chat the way ChatGPT does: a few words from what the user
   *  wanted, written by a small model. Falls back to the heuristic title. */
  async suggestTitle(userText: string, reply?: string): Promise<string> {
    const fallback = titleFromText(userText) || 'New chat';
    if (!this.anthropic) return fallback;
    try {
      const res = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 30,
        system:
          'Name a chat in 3 to 6 plain words, like a tab title: what the user wants done, no quotes, no trailing full stop, no dashes, no emoji. Output the title only.',
        messages: [
          {
            role: 'user',
            content: `User's first message:\n${String(userText || '').slice(0, 1500)}\n\nAssistant's reply:\n${String(reply || '').slice(0, 600)}`,
          },
        ],
      });
      const text = res.content.find((b) => b.type === 'text');
      const title = (text && 'text' in text ? String((text as any).text) : '')
        .split('\n')[0]
        .replace(/^["'“”]+|["'“”.]+$/g, '')
        .replace(/[—–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      return title.length >= 3 ? title : fallback;
    } catch {
      return fallback;
    }
  }

  async readThread(channel: OperatorChannel, channelUserId: string): Promise<{ state: SessionState; updatedAt: Date } | null> {
    const row = await this.prisma.operatorSession.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
    });
    if (!row) return null;
    const state = await this.loadSession(channel, channelUserId);
    if (!Array.isArray(state.transcript)) state.transcript = OperatorService.transcriptFromHistory(state.history, channel);
    return { state, updatedAt: row.updatedAt };
  }

  /** Rename / tag a web thread without touching its conversation. */
  async patchThreadMeta(channel: OperatorChannel, channelUserId: string, meta: { title?: string; organizationId?: string; lastPanel?: any }): Promise<void> {
    const row = await this.prisma.operatorSession.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
    });
    const state: any = (row?.state as any) || { history: [] };
    Object.assign(state, meta);
    await this.prisma.operatorSession.upsert({
      where: { channel_channelUserId: { channel, channelUserId } },
      update: { state },
      create: { channel, channelUserId, state, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }

  // ── Session ───────────────────────────────────────────────────────────────

  private async loadSession(channel: OperatorChannel, channelUserId: string): Promise<SessionState> {
    const row = await this.prisma.operatorSession.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
    });
    if (!row) return { history: [], pendingAction: null };
    const state = (row.state as any) || {};
    // History never expires. A stale pending confirmation is dropped so it can
    // never be executed long after the user asked for it.
    const fresh = (p: any) => p && (!p.createdAt || Date.now() - new Date(p.createdAt).getTime() <= PENDING_TTL_MS);
    let pendingAction = fresh(state.pendingAction) ? state.pendingAction : null;
    const pendingActions: PendingAction[] = (Array.isArray(state.pendingActions) ? state.pendingActions : []).filter(fresh);
    // Older sessions stored only the single slot — carry it into the list so a
    // card shown before this change still responds to its buttons.
    if (pendingAction && !pendingActions.some((p) => p.id && p.id === pendingAction.id)) pendingActions.push(pendingAction);
    if (!pendingAction && pendingActions.length) pendingAction = pendingActions[pendingActions.length - 1];
    // The stashed invoice upload behind "which project?" buttons MUST survive
    // the round-trip — this restore was lost in the pending-actions rework
    // (2026-09-30: every project tap answered "upload has expired"). 30 min
    // is plenty; after that the tap asks for a resend as designed.
    const uploadFresh = state.pendingUpload && (!state.pendingUploadAt || Date.now() - new Date(state.pendingUploadAt).getTime() <= 30 * 60 * 1000);
    return {
      // Spread the stored state FIRST so anything not named below survives the
      // round-trip. Enumerating every key has now lost two features: the
      // pendingUpload restore (note above), and bulkInvoiceMode — set by the
      // tool, saved, then silently dropped on the very next message, so every
      // invoice fell back to a per-invoice confirm and the flag was wiped from
      // the DB by the save that followed (guru 2026-10-11). The explicit
      // fields below still win; this only stops new state vanishing.
      ...state,
      history: Array.isArray(state.history) ? state.history : [],
      pendingAction,
      pendingActions,
      pendingUpload: uploadFresh ? state.pendingUpload : null,
      pendingUploadAt: uploadFresh ? state.pendingUploadAt : null,
      doneActions: Array.isArray(state.doneActions) ? state.doneActions.slice(-6) : [],
    } as SessionState;
  }

  private async saveSession(channel: OperatorChannel, channelUserId: string, state: SessionState): Promise<void> {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    // The transcript, title and org tag are written by their own methods;
    // carry the STORED copies over so this save cannot roll them back.
    const stored = await this.prisma.operatorSession
      .findUnique({ where: { channel_channelUserId: { channel, channelUserId } }, select: { state: true } })
      .catch(() => null);
    const prev: any = (stored?.state as any) || {};
    state = { ...state, transcript: prev.transcript, title: prev.title, organizationId: prev.organizationId, lastPanel: prev.lastPanel } as SessionState;
    await this.prisma.operatorSession
      .upsert({
        where: { channel_channelUserId: { channel, channelUserId } },
        update: { state: state as any, expiresAt },
        create: { channel, channelUserId, state: state as any, expiresAt },
      })
      .catch((e) => this.logger.warn(`session save failed: ${e.message}`));
  }
}

function shipmentsHelp(orgName: string, lang: 'ja' | 'en'): string {
  if (lang === 'ja')
    return `${orgName} のAIMSに接続しています。\n\n聞けること:\n• 「今日来たメールは？」\n• 「#19 の状況」「198GX06522」\n• 「今週到着は？」「期限超過は？」「私の確認待ちは？」\n• 「#16-2 の輸入許可書を送って」\n\nできること（確認ボタンの後に実行）:\n• メールのリンク確定・変更、「出荷関連ではない」\n• タスク完了、リマインダー解除\n• ETA / 到着日の更新、メモ追加\n\nPDFや写真を送ると、メールと同じ取り込みで処理し、紐づけ先を提案します。`;
  return `You're connected to ${orgName} in AIMS.\n\nAsk me:\n• "What came in today?"\n• "Status #19" / "198GX06522" / "SUS 6063 Sep"\n• "What's arriving this week?" / "What's overdue?" / "What needs me?"\n• "Send me the import permit for #16-2"\n\nI can also (after you tap Confirm):\n• confirm or change an email's link, mark one "not shipment"\n• mark a task done, dismiss a reminder\n• set an ETA / arrival date, add a note\n\nSend a PDF or photo and I'll run it through the same intake as email and propose where it goes.`;
}
