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

export type BacklogKind = 'HIDE' | 'AUTO' | 'CONFIRM' | 'AUTO_LINK' | 'HISTORY' | 'PICK' | 'NO_ORDER' | 'IS_SHIPMENT';

export interface BacklogInput {
  /** A person un-hid it: never hidden again. */
  unhidden?: boolean;
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
  /** Guards 1a–1e pass (files / fields may be applied by themselves). */
  wouldAuto: boolean;
  /** The target's state: the order closed, or its shipment past the port (step 10 done / delivered / completed). */
  targetClosed: boolean;
  /** The email names a record key (B/L / PI / CI / contract) that exists in AIMS. */
  keyInAims: boolean;
  /** The keys the triage read (for the NO_ORDER seed). */
  keys?: Partial<{ piNo: string | null; contractNo: string | null }> | null;
  date?: Date | null;
}

export interface BacklogVerdict {
  kind: BacklogKind;
  reason: string;
  /** For NO_ORDER: what the order form starts from. */
  seed?: OrderSeed;
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
const AUTO_REPLY = /^\s*(re:\s*)?(automatic reply|auto[- ]?reply|autoreply|out of office|out-of-office|自動応答|自動返信|不在|不在のご連絡|不在通知|休暇中)/i;
const NEWSLETTER = /(newsletter|メールマガジン|メルマガ|unsubscribe|配信停止|webinar|ウェビナー|キャンペーン|セミナーのご案内)/i;

/** Why an email is obvious non-shipment mail, else null. */
export function hideReason(subject: string | null | undefined, attachments: Array<{ name: string }> = []): string | null {
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
  const hide = i.unhidden ? null : hideReason(i.subject, i.attachments);
  if (hide) return { kind: 'HIDE', reason: hide };
  const talk = conversationOnly(i);
  const multi = i.multiOrderIds.length > 1;
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
export const backlogAutoLabel = (kind: BacklogKind): string | null => (kind === 'AUTO_LINK' ? 'linked (conversation)' : kind === 'HISTORY' ? 'history' : null);
