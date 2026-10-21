/**
 * Inbox backlog classifier (round Q, 2026-10-21) — pure. Owner: "by right,
 * the system should be sure of each email". Every unprocessed email is one of:
 *
 *   HIDE        obvious non-shipment mail: a calendar response / invite, an
 *               auto-reply / out-of-office, a newsletter. Hidden, not purged
 *               (Settings → Email filter → Hidden; unhide brings it back).
 *   AUTO        files documents / fills fields and the round J guards pass —
 *               PARTIAL_AUTO applies it (never the backlog run: no files move).
 *   CONFIRM     files documents / fills fields: a person confirms.
 *   AUTO_LINK   conversation only (no attachment that maps to a document slot,
 *               nothing to fill) and the thread / a key / the subject points at
 *               exactly one order or shipment with no conflict → linked by
 *               itself, Processed "Auto · linked (conversation)".
 *   HISTORY     conversation only about a COMPLETED order (or a shipment past
 *               step 10) → linked as history, Processed "Auto · history".
 *   PICK        several orders / shipments fit — a person picks.
 *   NO_ORDER    no order in AIMS for this deal (no record key, nothing in the
 *               thread, no subject match) → grouped by thread under
 *               "No order yet — create one?", with a seed for the order form.
 *   IS_SHIPMENT the AI couldn't tell whether it is shipment mail (Unsure) and
 *               nothing above applies.
 */
import { subjectCues } from './email-match.rules';

/**
 * Round R follow-up (owner, 2026-10-21) — four more automatic rules:
 *   HIDE (empty)      no subject, no text, no attachment → hidden
 *   GENERAL           a customer-level price / cost sheet (or note) with no record reference → linked to the
 *                     customer only, Processed as "General"
 *   INHERIT_THREAD    a reply with no text of its own and nothing attached → the same links as its thread
 *                     (all of them for a combined thread), "Auto · thread"
 *   MULTI_LINK        a schedule sheet covering several shipments of the subject's month → linked to all of
 *                     them, nothing filed
 */
export type BacklogKind = 'HIDE' | 'AUTO' | 'CONFIRM' | 'AUTO_LINK' | 'HISTORY' | 'PICK' | 'NO_ORDER' | 'IS_SHIPMENT' | 'GENERAL' | 'INHERIT_THREAD' | 'MULTI_LINK';

export interface BacklogInput {
  /** A person un-hid it: never hidden again. */
  unhidden?: boolean;
  /** The raw MIME said Auto-Submitted / X-Autoreply (the store keeps it as rawMeta.autoSubmitted). */
  autoSubmitted?: boolean;
  inboxState: string | null;
  verdict: string | null;
  subject: string | null;
  /** Each attachment: its name and the slot it maps to (null = not a trade document). */
  attachments: Array<{ name: string; slot: string | null }>;
  /** The plan: something to file (a planned file action) / to fill (a planned field). */
  filesSomething: boolean;
  fillsSomething: boolean;
  /** The match decision. */
  target: { orderId: string; shipmentId: string | null } | null;
  confidence: 'exact' | 'thread' | 'cues' | 'manual' | 'none' | string | null;
  check: string[];
  multiOrderIds: string[];
  /** Round V: the ORDERS a multi-product subject names (link-only → all of them). */
  links?: Array<{ orderId: string; shipmentId: string | null }>;
  /** Round V: who the email is with (for General messages from a known counterparty). */
  counterparty?: string | null;
  /** Guards 1a–1e pass (files / fields may be applied by themselves). */
  wouldAuto: boolean;
  /** The target's state: the order closed, or its shipment past the port (step 10 done / delivered / completed). */
  targetClosed: boolean;
  /** The email names a record key (B/L / PI / CI / contract) that exists in AIMS. */
  keyInAims: boolean;
  /** The keys the triage read (for the NO_ORDER seed). */
  keys?: Partial<{ piNo: string | null; contractNo: string | null }> | null;
  date?: Date | null;
  // ── round R follow-up ──
  /** The email's own text (quoted history stripped) is empty. */
  ownTextEmpty?: boolean;
  /** The customer (profile key) the email is with, when it is a customer. */
  customerKey?: string | null;
  /** The distinct links of the email's thread (accepted / linked messages). */
  threadLinks?: Array<{ orderId: string; shipmentId: string | null }>;
  /** Open shipments the subject describes (same customer / month) when nothing matched exactly. */
  candidates?: Array<{ orderId: string; shipmentId: string | null; ref: string }>;
  /** Each attachment's name + a text snippet (to recognise a price / cost sheet or a schedule). */
  attachmentTexts?: Array<{ name: string; text: string }>;
}

const COST_SHEET = /価格推移|諸掛|単価|cost|price|料金|費用|見積|quotation|quote/i;
const SCHEDULE_SHEET = /納入予定|入庫予定|出荷予定|schedule|予定表|予定\.xlsx/i;

/** A customer-level price / cost sheet: a spreadsheet / note about prices or charges, naming no record. */
export const isCostSheet = (a: { name: string; text: string }) => /\.(xlsx?|csv)$/i.test(a.name) && (COST_SHEET.test(a.name) || COST_SHEET.test(a.text.slice(0, 400)));
/** A delivery / warehouse schedule sheet. */
export const isScheduleSheet = (a: { name: string; text: string }) => /\.(xlsx?|csv)$/i.test(a.name) && (SCHEDULE_SHEET.test(a.name) || /ETA|納品日|出庫日|デバン/i.test(a.text.slice(0, 400)));

export interface BacklogVerdict {
  kind: BacklogKind;
  reason: string;
  /** For NO_ORDER: what the order form starts from. */
  seed?: OrderSeed;
  /** INHERIT_THREAD / MULTI_LINK: the records it is linked to. */
  links?: Array<{ orderId: string; shipmentId: string | null }>;
  /** GENERAL: the customer. */
  customerKey?: string | null;
}

export interface OrderSeed {
  piNo: string | null;
  contractNo: string | null;
  grade: string | null;
  qtyMt: number | null;
  customerKey: string | null;
  deliveryMonth: string | null;
}

const CALENDAR_RESPONSE = /^\s*(accepted|declined|tentative|tentatively accepted|承諾|辞退|仮承諾|受諾|出席|欠席)\s*[:：]/i;
const INVITE = /^\s*(invitation|updated invitation|canceled|cancelled|招待|会議出席依頼|予定)\s*[:：]/i;
// A date / time prefix is allowed ("10/21 15:00~不在のご連絡 Re: …").
const AUTO_REPLY = /^\s*(re:\s*)?[\d/:~\-\s]{0,24}(automatic reply|auto[- ]?reply|autoreply|out of office|out-of-office|自動応答|自動返信|不在|不在のご連絡|不在通知|休暇中)/i;
const NEWSLETTER = /(newsletter|メールマガジン|メルマガ|unsubscribe|配信停止|webinar|ウェビナー|キャンペーン|セミナーのご案内)/i;
/** Round V: contact details / introductions / staff changes — a General message, never a shipment. */
const CONTACT = /(連絡先|担当者|ご挨拶|着任|異動|退職|contact (details|info|list)|new contact|introduc|out of office)/i;

/** Why an email is obvious non-shipment mail, else null. */
export function hideReason(subject: string | null | undefined, attachments: Array<{ name: string }> = [], headers: { autoSubmitted?: boolean } = {}): string | null {
  if (headers.autoSubmitted) return 'auto-reply / out of office (auto-submitted)';
  const s = (subject ?? '').normalize('NFKC');
  const names = attachments.map((a) => a.name.toLowerCase());
  const icsOnly = names.length > 0 && names.every((n) => /\.ics$/.test(n));
  if (CALENDAR_RESPONSE.test(s)) return 'calendar response';
  if (INVITE.test(s) || icsOnly) return 'meeting invite';
  if (AUTO_REPLY.test(s)) return 'auto-reply / out of office';
  if (NEWSLETTER.test(s)) return 'newsletter';
  return null;
}

/** Conversation only: no attachment that maps to a document slot, nothing to file or fill. */
export const conversationOnly = (i: Pick<BacklogInput, 'attachments' | 'filesSomething' | 'fillsSomething'>) => !i.filesSomething && !i.fillsSomething && !i.attachments.some((a) => !!a.slot);

export function classifyEmail(i: BacklogInput): BacklogVerdict {
  if (i.inboxState === 'PROCESSED' || i.inboxState === 'PURGED' || i.inboxState === 'HIDDEN') return { kind: i.inboxState === 'HIDDEN' ? 'HIDE' : 'AUTO', reason: `already ${i.inboxState?.toLowerCase()}` };
  const hide = i.unhidden ? null : hideReason(i.subject, i.attachments, { autoSubmitted: i.autoSubmitted });
  if (hide) return { kind: 'HIDE', reason: hide };
  const talk = conversationOnly(i);
  const multi = i.multiOrderIds.length > 1;
  const empty = !(i.subject ?? '').trim() && !!i.ownTextEmpty && !i.attachments.length;
  if (!i.unhidden && empty) return { kind: 'HIDE', reason: 'empty email' };
  // A reply with nothing of its own (no text, no attachment) on a thread that is linked: the same links.
  // Round V: a reply that only LINKS (nothing to file or fill) follows the set of records its thread covers — never Unprocessed.
  if (!i.target && talk && (i.threadLinks?.length ?? 0) >= 1) return { kind: 'INHERIT_THREAD', reason: `${i.ownTextEmpty ? 'no text of its own' : 'nothing to file'} — follows the thread's ${i.threadLinks!.length} link(s)` };
  // Round V: a multi-product subject naming several ORDERS — link-only emails link to all of them; one that files asks a person.
  if (!i.target && (i.links?.length ?? 0) > 1) return talk ? { kind: 'MULTI_LINK', reason: `the subject names ${i.links!.length} orders — linked to all, nothing filed` } : { kind: 'PICK', reason: `the subject names ${i.links!.length} orders and the email files documents — pick the record` };
  // A schedule sheet about several shipments: linked to all of them, nothing filed.
  const sched = (i.attachmentTexts ?? []).find(isScheduleSheet);
  if (!i.target && sched && (i.candidates?.length ?? 0) >= 2) return { kind: 'MULTI_LINK', reason: `${sched.name} covers ${i.candidates!.map((c) => c.ref).join(' / ')} — linked to all, nothing filed` };
  // A customer-level price / cost sheet naming no record: General, linked to the customer only.
  // Round V: contact details / introductions from a known counterparty → General (no shipment), not Unprocessed.
  const knownCp = i.counterparty && !['OTHER', 'INTERNAL'].includes(String(i.counterparty)) ? String(i.counterparty) : null;
  if (!i.target && !multi && talk && !(i.threadLinks?.length) && !i.keyInAims && knownCp && CONTACT.test(i.subject ?? '')) return { kind: 'GENERAL', reason: `contact / general message from ${knownCp} — general (no shipment)` };
  const cost = (i.attachmentTexts ?? []).find(isCostSheet);
  if (!i.target && !multi && !i.keyInAims && cost && i.customerKey) return { kind: 'GENERAL', reason: `${cost.name} is a price / cost sheet with no record reference — general (${i.customerKey})` };
  if (i.target && !i.check.length && !multi) {
    if (!talk) return i.wouldAuto ? { kind: 'AUTO', reason: 'files documents; the guards pass' } : { kind: 'CONFIRM', reason: i.filesSomething ? 'files documents' : 'fills fields' };
    if (i.targetClosed) return { kind: 'HISTORY', reason: 'conversation about a completed order / delivered shipment' };
    return { kind: 'AUTO_LINK', reason: `conversation only, one ${i.target.shipmentId ? 'shipment' : 'order'} (${i.confidence ?? 'match'})` };
  }
  if (i.target && i.check.length) return { kind: talk ? 'PICK' : 'CONFIRM', reason: `the subject disagrees (${i.check.join('; ')})` };
  if (multi) return { kind: 'PICK', reason: 'several orders / shipments fit' };
  if (i.verdict === 'UNSURE' && !i.keyInAims) return { kind: 'IS_SHIPMENT', reason: 'the AI could not tell whether it is shipment mail' };
  return { kind: 'NO_ORDER', reason: i.keyInAims ? 'its order / shipment is not in AIMS' : 'no record number, nothing in the thread, no subject match', seed: orderSeed(i) };
}

/** What the order form starts from for a "No order yet" thread: the keys and the subject's grade / qty / customer / month. */
export function orderSeed(i: { subject: string | null; keys?: Partial<{ piNo: string | null; contractNo: string | null }> | null; date?: Date | null }): OrderSeed {
  const c = subjectCues(i.subject, i.date ?? null);
  return {
    piNo: i.keys?.piNo ?? null,
    contractNo: i.keys?.contractNo ?? null,
    grade: c.grades[0] ?? null,
    qtyMt: c.qtys[0] ?? null,
    customerKey: c.customers[0] ?? null,
    deliveryMonth: c.months[0] ?? null,
  };
}

/** "Auto · linked (conversation)" / "Auto · history" — the Processed label. */
export const backlogAutoLabel = (kind: BacklogKind, customerKey?: string | null, links = 0): string | null =>
  kind === 'AUTO_LINK' ? 'linked (conversation)' : kind === 'HISTORY' ? 'history' : kind === 'INHERIT_THREAD' ? (links > 1 ? 'thread covers' : 'thread') : kind === 'MULTI_LINK' ? 'linked (schedule)' : kind === 'GENERAL' ? `general${customerKey ? ` (${customerKey})` : ''}` : null;
