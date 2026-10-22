/**
 * Round W, Part B (2026-10-22) — the QUESTION CARD. Pure. Instead of reason chips ("PICK_SHIPMENT", "CHECK —
 * subject disagrees", "No order yet") an unprocessed thread gets one plain-language question, one line of what
 * AIMS found, and big answer options (each a record with its summary and why it might be that one), plus
 * "New deal → Create order", "Not about a shipment" and "Ask later". English + Japanese. No jargon.
 */
import { subjectCues } from './email-match.rules';

export type Lang = 'en' | 'ja';
export type QuestionKind = 'CONFIRM' | 'WHICH' | 'CHECK' | 'NEW_DEAL' | 'IS_SHIPMENT' | 'RECHECK';

export interface QuestionOption {
  /** "r:<orderId>:<shipmentId>" */
  id: string;
  orderId: string;
  shipmentId: string | null;
  ref: string;
  /** "#18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct" */
  summary: string;
  /** Why it might be this one, in plain words. */
  why: string;
  /** AIMS's own suggestion (shown first, filled). */
  suggested: boolean;
}

export interface QuestionCard {
  kind: QuestionKind;
  lang: Lang;
  title: string;
  /** "What AIMS found" — one line. */
  found: string;
  options: QuestionOption[];
  /** The extra answers this card offers. */
  extras: { createOrder: boolean; notShipment: boolean; notDeal: boolean; askLater: boolean };
  /** NEW_DEAL: the PI / contract details AIMS found ("PI SIAE_PI_26100906", "6063 · 50 t"). */
  details: string[];
  /** The WhatsApp line: "Reply 1, 2 or 3 · 0 = ask later · X = not a shipment". */
  replyHint: string;
}

export interface QuestionInput {
  lang: Lang;
  reasonCode: 'CONFIRM' | 'PICK_ORDER' | 'PICK_SHIPMENT' | 'CHECK' | 'IS_SHIPMENT' | 'NO_ORDER' | null;
  subject: string | null;
  /** The company behind the sender (round W company chip), or the domain. */
  company: string | null;
  attachments: string[];
  keys?: { blNo?: string | null; piNo?: string | null; ciNo?: string | null; contractNo?: string | null } | null;
  threadSize: number;
  threadSubject?: string | null;
  /** AIMS's suggestion, when it has one. */
  suggested: { orderId: string; shipmentId: string | null; ref: string; why: string[] } | null;
  /** Other records that fit (the picker's shortlist, thread links, orders named), with why. */
  candidates: Array<{ orderId: string; shipmentId: string | null; ref: string; why: string[] }>;
  check: string[];
  /** A self-check sent it back: what was filed before and what the second pass said. */
  recheck?: { current: string[]; second: Array<{ orderId: string; shipmentId: string | null; ref: string }>; secondText: string } | null;
  /** NO_ORDER: the order-form seed(s) of the thread. */
  seed?: { piNo: string | null; contractNo: string | null; grade: string | null; qtyMt: number | null; customerKey: string | null; deliveryMonth: string | null } | null;
  /** The record summary ("#18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct"). */
  summaryOf: (orderId: string, shipmentId: string | null) => string | null;
  date?: Date | null;
}

const T = {
  en: {
    confirm: (ref: string) => `Is this email about ${ref}?`,
    whichShipment: 'Which shipment is this about?',
    whichOrder: 'Which order is this about?',
    check: (ref: string, what: string) => `The subject says ${what}, but AIMS matched ${ref} — which is right?`,
    isShipment: 'Is this email about a shipment at all?',
    newDeal: 'New deal not in AIMS yet — create the order?',
    newDealKnown: (what: string) => `Is this about the new ${what} deal? It isn't in AIMS yet.`,
    recheck: "AIMS re-checked this and isn't sure anymore — which is right?",
    from: (c: string) => `From ${c}`,
    files: (n: number) => `${n} file${n === 1 ? '' : 's'}`,
    mentions: (x: string) => `mentions ${x}`,
    noBl: 'no B/L number',
    thread: (s: string) => `reply in the "${s}" thread`,
    suggestedWhy: 'AIMS’s pick',
    before: 'what AIMS filed before',
    replyHint: (n: number) => `Reply ${n <= 1 ? '1' : n === 2 ? '1 or 2' : `1, 2 or ${n}`} · 0 = ask later · X = not a shipment`,
    replyHintDeal: 'Reply 1 = create the order · 2 = not a deal · 0 = ask later',
    vs: 'not',
  },
  ja: {
    confirm: (ref: string) => `このメールは ${ref} の件ですか？`,
    whichShipment: 'どの出荷の件ですか？',
    whichOrder: 'どの注文の件ですか？',
    check: (ref: string, what: string) => `件名は「${what}」ですが、AIMSは ${ref} と判断しました — どちらが正しいですか？`,
    isShipment: 'このメールは出荷に関するものですか？',
    newDeal: 'AIMSにまだない新しい案件です — 注文を作成しますか？',
    newDealKnown: (what: string) => `新しい ${what} の案件ですか？ AIMSにはまだありません。`,
    recheck: 'AIMSが再確認したところ、確信が持てなくなりました — どちらが正しいですか？',
    from: (c: string) => `${c} から`,
    files: (n: number) => `添付 ${n} 件`,
    mentions: (x: string) => `${x} に言及`,
    noBl: 'B/L番号なし',
    thread: (s: string) => `「${s}」スレッドへの返信`,
    suggestedWhy: 'AIMSの候補',
    before: '以前AIMSが登録した先',
    replyHint: (n: number) => `${n <= 1 ? '1' : n === 2 ? '1 か 2' : `1〜${n}`} で返信 · 0 = 後で · X = 出荷ではない`,
    replyHintDeal: '1 = 注文を作成 · 2 = 案件ではない · 0 = 後で',
    vs: 'ではなく',
  },
} as const;

/** The matcher's reasons ("B/L 198GX06003 in the attachment", "grade 6005 (subject)", "subject only") in plain words. */
export function plainReason(r: string, lang: Lang): string {
  const ja = lang === 'ja';
  let s = r.trim();
  const m = /^(B\/L|PI|CI|net) (\S+) (in the attachment|in the email text|in the subject|only in quoted history)$/.exec(s);
  if (m) {
    const where = { 'in the attachment': ja ? '添付に' : 'in the attachment', 'in the email text': ja ? '本文に' : 'in the email text', 'in the subject': ja ? '件名に' : 'in the subject', 'only in quoted history': ja ? '引用部分のみに' : 'only in the quoted history' }[m[3]]!;
    const key = m[1] === 'net' ? (ja ? `正味 ${m[2]} t` : `net ${m[2]} t`) : `${m[1]} ${m[2]}`;
    return ja ? `${where}${key}` : `${key} ${where}`;
  }
  if (s === 'subject only') return ja ? '件名のみ一致' : 'the subject describes it';
  s = s.replace(/\s*\(subject\)/g, ja ? '（件名）' : ' (subject)').replace(/\s*\(text\)/g, ja ? '（本文）' : ' (email text)');
  s = s.replace(/^grade /, ja ? '材質 ' : '').replace(/^qty /, ja ? '数量 ' : '').replace(/^customer /, ja ? '顧客 ' : '').replace(/^delivery /, ja ? '納入 ' : 'delivery ').replace(/^size /, ja ? 'サイズ ' : 'size ');
  s = s.replace(/^an earlier email of this thread was linked to (\S+)$/, ja ? 'このスレッドの前のメールが $1 に紐付け済み' : 'an earlier email in this thread went to $1');
  s = s.replace(/^the subject names the order \((.*)\)$/, ja ? '件名が注文を示す（$1）' : 'the subject names the order ($1)').replace(/^the email text names the order \((.*)\)$/, ja ? '本文が注文を示す（$1）' : 'the email text names the order ($1)');
  s = s.replace(/^the subject describes it \((.*)\)$/, ja ? '件名が一致（$1）' : 'the subject describes it ($1)').replace(/^the email text describes it \((.*)\)$/, ja ? '本文が一致（$1）' : 'the email text describes it ($1)');
  return s;
}

/** "grade 6063 ≠ 6005" → "6063" (what the subject says). */
const checkWhat = (c: string) => c.replace(/^(grade|qty|customer|delivery|size)\s+/, '').split(/\s*≠\s*/)[0];

export function questionOf(i: QuestionInput): QuestionCard {
  const t = T[i.lang];
  const ja = i.lang === 'ja';
  const opt = (c: { orderId: string; shipmentId: string | null; ref: string; why: string[] }, suggested: boolean): QuestionOption => ({
    id: `r:${c.orderId}:${c.shipmentId ?? ''}`,
    orderId: c.orderId,
    shipmentId: c.shipmentId,
    ref: c.ref,
    summary: i.summaryOf(c.orderId, c.shipmentId) ?? c.ref,
    why: [...new Set(c.why.map((w) => plainReason(w, i.lang)).filter(Boolean))].slice(0, 2).join(' · '),
    suggested,
  });
  // Options: the suggestion first, then the other candidates (never the same record twice), at most 4.
  const options: QuestionOption[] = [];
  const seen = new Set<string>();
  const push = (o: QuestionOption) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    options.push(o);
  };
  if (i.recheck) {
    if (i.suggested) push(opt({ ...i.suggested, why: [t.before] }, true));
    for (const s of i.recheck.second) push(opt({ ...s, why: [i.recheck.secondText] }, false));
  } else if (i.suggested) push(opt(i.suggested, true));
  for (const c of i.candidates) push(opt(c, false));
  // An order-level option is redundant when one of its shipments is already an option ("#20" next to "#20-1").
  const opts = options.filter((o) => o.shipmentId || !options.some((x) => x.shipmentId && x.orderId === o.orderId)).slice(0, 4);

  // "What AIMS found": from · files · keys or mentions · thread.
  const cues = subjectCues(i.subject, i.date ?? null);
  const mentions = [...cues.grades, ...cues.qtys.map((q) => `${q} t`)].slice(0, 3).join(ja ? '・' : ' and ');
  const keyLine = i.keys?.blNo ? `B/L ${i.keys.blNo}` : i.keys?.piNo ? `PI ${i.keys.piNo}` : i.keys?.ciNo ? `CI ${i.keys.ciNo}` : i.keys?.contractNo ? (ja ? `契約 ${i.keys.contractNo}` : `contract ${i.keys.contractNo}`) : t.noBl;
  const found = [i.company ? t.from(i.company) : null, i.attachments.length ? t.files(i.attachments.length) : null, mentions ? t.mentions(mentions) : null, keyLine, i.threadSize > 1 && i.threadSubject ? t.thread(i.threadSubject.replace(/\s+/g, ' ').trim().slice(0, 30)) : null].filter(Boolean).join(' · ');

  const base = { lang: i.lang, found, options: opts, details: [] as string[], extras: { createOrder: true, notShipment: true, notDeal: false, askLater: true } };
  if (i.recheck) return { ...base, kind: 'RECHECK', title: t.recheck, replyHint: t.replyHint(opts.length) };
  if (i.reasonCode === 'NO_ORDER') {
    const s = i.seed;
    const what = [s?.grade, s?.qtyMt ? `${s.qtyMt} t` : null].filter(Boolean).join(' · ');
    const details = [s?.piNo ? `PI ${s.piNo}` : null, s?.contractNo ? (ja ? `契約 ${s.contractNo}` : `Contract ${s.contractNo}`) : null, [s?.grade, s?.qtyMt ? `${s.qtyMt} t` : null].filter(Boolean).join(' · ') || null, s?.customerKey ?? null, s?.deliveryMonth ? (ja ? `納入 ${s.deliveryMonth}` : `delivery ${s.deliveryMonth}`) : null, ...i.attachments.filter((a) => /\bPI\b|_PI_|proforma|contract/i.test(a)).slice(0, 2)].filter((x): x is string => !!x);
    return { ...base, kind: 'NEW_DEAL', title: what ? t.newDealKnown(what) : t.newDeal, options: [], details, extras: { createOrder: true, notShipment: false, notDeal: true, askLater: true }, replyHint: t.replyHintDeal };
  }
  if (i.reasonCode === 'IS_SHIPMENT') return { ...base, kind: 'IS_SHIPMENT', title: t.isShipment, replyHint: t.replyHint(opts.length) };
  if (i.check.length && i.suggested) return { ...base, kind: 'CHECK', title: t.check(i.suggested.ref, i.check.map(checkWhat).join(', ')), replyHint: t.replyHint(opts.length) };
  if (i.suggested && opts.length === 1) return { ...base, kind: 'CONFIRM', title: t.confirm(i.suggested.ref), replyHint: t.replyHint(1) };
  const orderLevel = opts.length > 0 && opts.every((o) => !o.shipmentId);
  return { ...base, kind: 'WHICH', title: orderLevel ? t.whichOrder : t.whichShipment, replyHint: t.replyHint(opts.length) };
}

/** The WhatsApp text of a card: the question, what AIMS found, numbered options, the reply hint. */
export function questionWhatsAppText(q: QuestionCard, subject60: string): string {
  const lines = [`❓ ${q.title}`, `"${subject60}"`, q.found ? `— ${q.found}` : null];
  if (q.kind === 'NEW_DEAL') lines.push(...q.details.map((d) => `· ${d}`), q.lang === 'ja' ? '1. 注文を作成' : '1. Create the order', q.lang === 'ja' ? '2. 案件ではない' : '2. Not a deal');
  else q.options.forEach((o, n) => lines.push(`${n + 1}. ${o.summary}${o.why ? ` — ${o.why}` : ''}`));
  lines.push(q.replyHint);
  return lines.filter((l): l is string => !!l).join('\n');
}

/** After an answer: "Linked to #18-2 · 2 files filed" / "Hidden — not about a shipment" / "Asked again tomorrow". */
export function answerText(kind: 'record' | 'not_shipment' | 'not_deal' | 'later', lang: Lang, o: { refs?: string[]; files?: number; emails?: number } = {}): string {
  const ja = lang === 'ja';
  const refs = (o.refs ?? []).join(' + ');
  const files = o.files ?? 0;
  const n = o.emails ?? 1;
  if (kind === 'record') return ja ? `${refs} に紐付けました${files ? ` · 書類 ${files} 件を登録` : ''}${n > 1 ? `（メール ${n} 件）` : ''}` : `Linked to ${refs}${files ? ` · ${files} file${files === 1 ? '' : 's'} filed` : ''}${n > 1 ? ` (${n} emails)` : ''}`;
  if (kind === 'not_shipment') return ja ? '非表示にしました — 出荷ではない' : 'Hidden — not about a shipment';
  if (kind === 'not_deal') return ja ? '非表示にしました — 案件ではない' : 'Hidden — not a deal';
  return ja ? '明日もう一度お聞きします' : 'Asked again tomorrow';
}

/** The reply numbers of a WhatsApp question: 1..n = options, 0 = later, X = not a shipment (or not a deal). */
export function parseNumberedReply(text: string, q: Pick<QuestionCard, 'kind' | 'options'>): { kind: 'record'; option: QuestionOption } | { kind: 'later' } | { kind: 'not_shipment' } | { kind: 'not_deal' } | { kind: 'create_order' } | null {
  const s = text.trim().toLowerCase();
  if (s === '0') return { kind: 'later' };
  if (s === 'x' || s === '×') return { kind: q.kind === 'NEW_DEAL' ? 'not_deal' : 'not_shipment' };
  if (!/^[1-9]$/.test(s)) return null;
  const n = Number(s);
  if (q.kind === 'NEW_DEAL') return n === 1 ? { kind: 'create_order' } : n === 2 ? { kind: 'not_deal' } : null;
  const o = q.options[n - 1];
  return o ? { kind: 'record', option: o } : null;
}
