/**
 * Round W (2026-10-22) — "no wrong links". Pure: compare a stored link with (a) the hard evidence the email
 * itself carries (a B/L / CI / PI / exact-tonnage key in an attachment, the own text or the subject; order-level
 * cues) and (b) the independent second pass (a fresh reasoner call that never saw the current link).
 *
 *   AGREE            the second pass names the same record(s)
 *   AGREE_WEAK       the second pass has no confident answer, but a hard key in the email supports the link
 *   NO_ANSWER        neither the second pass nor a hard key says anything — kept, reported
 *   DISAGREE_CLEAR   the second pass names ANOTHER record, verified by a hard key in the email's own content, and
 *                    no hard key supports the current link → a clear mistake (the audit moves it)
 *   DISAGREE_UNCLEAR the second pass points elsewhere without that proof (or says "not shipment mail", or a
 *                    general email looks like a shipment's) → back to Unprocessed as a question
 *   NOT_OPEN         the linked record is closed; the second pass only sees open records — skipped
 */
import { KeyHit, MatchRecord, recordRef } from './email-match.rules';
import { ReasonerJudgement } from './email-reasoner';

export type AuditVerdict = 'AGREE' | 'AGREE_WEAK' | 'NO_ANSWER' | 'DISAGREE_CLEAR' | 'DISAGREE_UNCLEAR' | 'NOT_OPEN';

export interface LinkRef {
  orderId: string;
  shipmentId: string | null;
}

export interface AuditInput {
  /** The stored link(s): the row's targets (several for a multi-link email); empty for a General email. */
  current: LinkRef[];
  general: boolean;
  /** Strong key hits only (attachment / own text / subject — never the quoted history). */
  hits: KeyHit[];
  /** Order-level cue matches (customer + month + grade + qty). */
  orderCues: Array<{ orderId: string }>;
  second: ReasonerJudgement | null;
  records: MatchRecord[];
}

export interface AuditResult {
  verdict: AuditVerdict;
  /** "#18-2" / "#18-2 + #19-1" / "general". */
  currentRefs: string[];
  /** What the second pass answered: refs, or "not shipment mail" / "no confident answer". */
  secondRefs: string[];
  secondText: string;
  /** Hard keys supporting the current link / the second pass's answer. */
  hardCurrent: string[];
  hardSecond: string[];
  evidence: string;
  /** DISAGREE_CLEAR: where the link moves (the verified second-pass targets, each with its attachments). */
  move: ReasonerJudgement['targets'] | null;
  /** The second pass's records (verified or not) — the question card's other options. */
  secondTargets: LinkRef[];
}

const same = (a: LinkRef, b: LinkRef) => a.orderId === b.orderId && (!a.shipmentId || !b.shipmentId || a.shipmentId === b.shipmentId);
const refOf = (records: MatchRecord[], l: LinkRef) => {
  const r = records.find((x) => x.orderId === l.orderId && (l.shipmentId ? x.shipmentId === l.shipmentId : true));
  return r ? (l.shipmentId ? recordRef(r) : `#${r.orderNo}`) : '?';
};
const KIND: Record<KeyHit['kind'], string> = { bl: 'B/L', pi: 'PI', ci: 'CI', net: 'net' };
const whereOf = (h: KeyHit) => (h.where.includes('attachment') ? 'attachment' : h.where.includes('body') ? 'own text' : 'subject');

export function auditLink(i: AuditInput): AuditResult {
  const open = (l: LinkRef) => i.records.some((r) => r.orderId === l.orderId && (l.shipmentId ? r.shipmentId === l.shipmentId : true) && r.orderStatus === 'OPEN' && r.shipStatus !== 'CANCELLED');
  const currentRefs = i.general ? ['general'] : i.current.map((l) => refOf(i.records, l));
  const strong = i.hits.filter((h) => h.where.some((w) => w !== 'quoted'));
  const hardFor = (ls: LinkRef[]) => [...new Set(strong.filter((h) => ls.some((l) => same(l, { orderId: h.orderId, shipmentId: h.shipmentId }))).map((h) => `${KIND[h.kind]} ${h.value} (${whereOf(h)})`)), ...i.orderCues.filter((o) => ls.some((l) => l.orderId === o.orderId)).map(() => 'order-level cues')];
  const second = i.second;
  const picks = second?.apply ? second.targets.map((t) => ({ orderId: t.orderId, shipmentId: t.shipmentId })) : (second?.picks ?? []).filter((p) => p.confidence !== 'low').map((p) => ({ orderId: p.orderId, shipmentId: p.shipmentId }));
  const secondRefs = [...new Set(picks.map((l) => refOf(i.records, l)))];
  const hardCurrent = hardFor(i.current);
  const hardSecond = hardFor(picks);
  const evidence = [second?.evidence, second?.reason].filter(Boolean).join(' — ').slice(0, 300);
  const base = { currentRefs, secondRefs, hardCurrent, hardSecond, evidence, move: null as AuditResult['move'], secondTargets: picks };
  if (!i.general && i.current.length && !i.current.some(open)) return { ...base, verdict: 'NOT_OPEN', secondText: 'the linked record is closed — not checked' };
  if (!second) return { ...base, verdict: 'NO_ANSWER', secondText: 'no second pass' };
  if (second.isShipmentMail === false) {
    if (i.general) return { ...base, verdict: 'AGREE', secondText: 'not shipment mail (general)' };
    return { ...base, verdict: hardCurrent.length ? 'AGREE_WEAK' : 'DISAGREE_UNCLEAR', secondText: 'says this is not shipment mail' };
  }
  if (!picks.length) {
    if (i.general) return { ...base, verdict: 'AGREE', secondText: 'no shipment named (general)' };
    return { ...base, verdict: hardCurrent.length ? 'AGREE_WEAK' : 'NO_ANSWER', secondText: 'no confident answer' };
  }
  if (i.general) return { ...base, verdict: second.apply ? 'DISAGREE_UNCLEAR' : 'NO_ANSWER', secondText: `names ${secondRefs.join(' + ')}${second.apply ? ' (verified)' : ' (unverified)'}` };
  const covered = picks.every((p) => i.current.some((c) => same(c, p)));
  if (covered) return { ...base, verdict: 'AGREE', secondText: `names ${secondRefs.join(' + ')}` };
  const clear = second.apply && !hardCurrent.length && hardSecond.length > 0;
  return { ...base, verdict: clear ? 'DISAGREE_CLEAR' : 'DISAGREE_UNCLEAR', secondText: `names ${secondRefs.join(' + ')}${second.apply ? ' (verified by a hard key)' : ' (unverified)'}`, move: clear ? second.targets : null };
}

/** The question text when a self-check sends an email back (round W, rule 4). */
export const RECHECK_TEXT = { en: "AIMS re-checked this and isn't sure anymore", ja: 'AIMSが再確認したところ、確信が持てなくなりました' } as const;
