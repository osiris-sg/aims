/**
 * Round W, Part B (2026-10-22) — the QUESTION CARD. Pure. Instead of reason chips ("PICK_SHIPMENT", "CHECK —
 * subject disagrees", "No order yet") an unprocessed thread gets one plain-language question, one line of what
 * AIMS found, and big answer options (each a record with its summary and why it might be that one), plus
 * "New deal → Create order", "Not about a shipment" and "Ask later". English + Japanese. No jargon.
 */
import { subjectCues } from './email-match.rules';

export type Lang = 'en' | 'ja';
export type QuestionKind = 'CONFIRM' | 'WHICH' | 'CHECK' | 'NEW_DEAL' | 'IS_SHIPMENT' | 'RECHECK' | 'NEW_SHIPMENT';

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
  /** Round AR: the suggested options belong together (the email names several shipments exactly) — tick them all. */
  multi?: boolean;
  /** Round AS: a file kept waiting from an earlier email — its casts are now on this shipment's PL / COA; attach it? */
  waitingFile?: { emailId: string; index: number; name: string; docType: string } | null;
  /** Round AR: AIMS reads a general issue (process / policy change), proposed as "General issue" with this draft. */
  issue?: { title: string; summaryEn: string | null; summaryJa: string | null; effectiveFrom: string | null } | null;
  /** The WhatsApp line: "Reply 1, 2 or 3 · 0 = ask later · X = not a shipment". */
  replyHint: string;
  /** Round BB: the concrete question with AIMS's guess ("This looks like a new shipment of #27 (Kato 6005 40 t). Create it?"); `title` carries the same text. */
  headline?: string;
  /** Round BB: ONE best guess, at most 2 alternatives, the evidence (marked), what Yes does, a hand-over to the admins. */
  guess?: CardChoice | null;
  alternatives?: CardChoice[];
  evidence?: CardEvidence[];
  /** Round BC: the ONE evidence line on the card, ~80 characters: the strongest keys only. */
  evidenceLine?: EvidenceSegment[];
  yesLine?: string | null;
  asked?: { by: string; at: string; note: string | null } | null;
  batchKey?: string | null;
}

/** Round BB — what Yes means: link / file to a record, open a new shipment of an order, a general issue, hide, or a new deal. */
export type GuessKind = 'record' | 'new_shipment' | 'general' | 'not_shipment' | 'new_deal';
export interface CardChoice {
  kind: GuessKind;
  orderId: string | null;
  shipmentId: string | null;
  ref: string | null;
  label: string;
  /** Round BC: the chip text ("#18-2 · 20.4 t"). */
  short?: string;
}
/** Round BC: one part of the card's single evidence line — `ok` = it names the guess (✓), `conflict` = it contradicts it (red). */
export interface EvidenceSegment {
  text: string;
  ok: boolean;
  conflict: boolean;
}
/** One line of evidence in the user's language; `mark` = the part to highlight (a B/L, a grade); `conflict` = shown in red. */
export interface CardEvidence {
  text: string;
  mark: string | null;
  file: string | null;
  conflict: boolean;
}

/** Round BB — what the match stored for the card (actions.card): ids, never refs (refs change when orders are renumbered). */
export type RecordId = { orderId: string; shipmentId: string | null };
export type EvidenceItem =
  | { t: 'key'; key: 'bl' | 'pi' | 'ci' | 'net' | 'contract'; value: string; where: 'attachment' | 'subject' | 'body' | 'quoted'; file: string | null; on: RecordId | null }
  | { t: 'doc'; file: string | null; grade: string | null; netMt: number | null; etd: string | null }
  | { t: 'conflict'; field: 'grade' | 'contract'; email: string; record: string; on: RecordId }
  | { t: 'thread'; on: RecordId }
  | { t: 'free'; on: RecordId };
export interface StoredCard {
  guess: ({ kind: GuessKind } & Partial<RecordId>) | null;
  alternatives: Array<{ kind: GuessKind } & Partial<RecordId>>;
  evidence: EvidenceItem[];
  /** Documents a Yes would file (the plan's planned files). */
  files: number;
  /** The new B/L (on no record yet) — the new shipment gets it. */
  bl?: string | null;
  /** Each attachment names a different shipment: their refs (no single guess). */
  split?: string[];
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
  /** Round AR: shipments named exactly (B/L / CI / cast / bundle no.) — several = proposed together. */
  multi?: Array<{ orderId: string; shipmentId: string | null; ref: string; why: string[] }>;
  /** Round AR: the reasoner's general-issue reading. */
  issue?: { title: string; summaryEn: string | null; summaryJa: string | null; effectiveFrom: string | null } | null;
  /** The record summary ("#18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct"). */
  summaryOf: (orderId: string, shipmentId: string | null) => string | null;
  date?: Date | null;
  /** Round BB: the match's stored card (guess, alternatives, evidence), the hand-over to admins, how many emails the answer covers. */
  card?: StoredCard | null;
  asked?: { by: string; at: string; note: string | null } | null;
  emails?: number;
  /** Round BB: documents a Yes files across the thread's open emails (overrides the newest email's own count). */
  files?: number;
  /** Round BB: a shipment AIMS may offer on soft cues (open, not sailed long ago, not undone for this email). */
  offerable?: (orderId: string, shipmentId: string | null) => boolean;
  refOf?: (orderId: string, shipmentId: string | null) => string;
}

const T = {
  en: {
    confirm: (ref: string) => `Is this email about ${ref}?`,
    whichShipment: 'Which shipment is this about?',
    whichOrder: 'Which order is this about?',
    check: (ref: string, what: string) => `The subject says ${what}, but AIMS matched ${ref}. Which is right?`,
    isShipment: 'Is this email about a shipment at all?',
    newDeal: 'New deal not in AIMS yet. Create the order?',
    newDealKnown: (what: string) => `Is this about the new ${what} deal? It isn't in AIMS yet.`,
    recheck: "AIMS re-checked this and isn't sure anymore. Which is right?",
    multi: (n: number, refs: string) => `This email is about ${n} shipments (${refs}). Link it to all of them?`,
    general: (title: string) => `Looks like a general issue, not one shipment: "${title}". Add it as an issue?`,
    from: (c: string) => `From ${c}`,
    files: (n: number) => `${n} file${n === 1 ? '' : 's'}`,
    mentions: (x: string) => `mentions ${x}`,
    noBl: 'no B/L number',
    thread: (s: string) => `reply in the "${s}" thread`,
    suggestedWhy: 'AIMS’s pick',
    before: 'what AIMS filed before',
    replyHint: (n: number) => `Reply ${n <= 1 ? '1' : n === 2 ? '1 or 2' : `1 to ${n}`} · 0 = ask later · X = not a shipment`,
    replyHintDeal: 'Reply 1 = create the order · 2 = not a deal · 0 = ask later',
    vs: 'not',
  },
  ja: {
    confirm: (ref: string) => `このメールは ${ref} の件ですか？`,
    whichShipment: 'どの出荷の件ですか？',
    whichOrder: 'どの注文の件ですか？',
    check: (ref: string, what: string) => `件名は「${what}」ですが、AIMSは ${ref} と判断しました。どちらが正しいですか？`,
    isShipment: 'このメールは出荷に関するものですか？',
    newDeal: 'AIMSにまだない新しい案件です。注文を作成しますか？',
    newDealKnown: (what: string) => `新しい ${what} の案件ですか？ AIMSにはまだありません。`,
    recheck: 'AIMSが再確認したところ、確信が持てなくなりました。どちらが正しいですか？',
    multi: (n: number, refs: string) => `このメールは ${n} 件の出荷（${refs}）に関するものです。すべてに紐付けますか？`,
    general: (title: string) => `特定の出荷ではない全般的な課題のようです：「${title}」。課題として追加しますか？`,
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
  s = s.replace(/^names (\S+) \(unverified\)$/, ja ? '$1 の可能性（未確認）' : 'it may be $1 (not confirmed)');
  s = s.replace(/^the subject describes it \((.*)\)$/, ja ? '件名が一致（$1）' : 'the subject describes it ($1)').replace(/^the email text describes it \((.*)\)$/, ja ? '本文が一致（$1）' : 'the email text describes it ($1)');
  return s;
}

/** Round BB: a reason the translation didn't cover (English words left) — never shown on a Japanese card. */
export const leaksEnglish = (s: string) => /\b(the|in|of|and|names?|unverified|subject|email|text|order|thread|attachment|describes|only|linked|earlier|record|reasoner|quoted|history|went|one|this)\b/i.test(s);

/** "grade 6063 ≠ 6005" → "6063" (what the subject says). */
const checkWhat = (c: string) => c.replace(/^(grade|qty|customer|delivery|size)\s+/, '').split(/\s*≠\s*/)[0];

function questionBase(i: QuestionInput): QuestionCard {
  const t = T[i.lang];
  const ja = i.lang === 'ja';
  const opt = (c: { orderId: string; shipmentId: string | null; ref: string; why: string[] }, suggested: boolean): QuestionOption => ({
    id: `r:${c.orderId}:${c.shipmentId ?? ''}`,
    orderId: c.orderId,
    shipmentId: c.shipmentId,
    ref: c.ref,
    summary: i.summaryOf(c.orderId, c.shipmentId) ?? c.ref,
    why: [...new Set(c.why.map((w) => plainReason(w, i.lang)).filter((w) => !!w && (i.lang !== 'ja' || !leaksEnglish(w))))].slice(0, 2).join(' · '),
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
  // Round AR: every shipment the email names exactly is proposed (ticked) together.
  for (const c of i.multi ?? []) push(opt(c, true));
  for (const c of i.candidates) push(opt(c, false));
  // An order-level option is redundant when one of its shipments is already an option ("#20" next to "#20-1").
  // Round X: up to 8 options — a detention request quoting every Wan Hai shipment names them all.
  const opts = options.filter((o) => o.shipmentId || !options.some((x) => x.shipmentId && x.orderId === o.orderId)).slice(0, 8);

  // "What AIMS found": from · files · keys or mentions · thread.
  const cues = subjectCues(i.subject, i.date ?? null);
  const mentions = [...cues.grades, ...cues.qtys.map((q) => `${q} t`)].slice(0, 3).join(ja ? '・' : ' and ');
  const keyLine = i.keys?.blNo ? `B/L ${i.keys.blNo}` : i.keys?.piNo ? `PI ${i.keys.piNo}` : i.keys?.ciNo ? `CI ${i.keys.ciNo}` : i.keys?.contractNo ? (ja ? `契約 ${i.keys.contractNo}` : `contract ${i.keys.contractNo}`) : t.noBl;
  const found = [i.company ? t.from(i.company) : null, i.attachments.length ? t.files(i.attachments.length) : null, mentions ? t.mentions(mentions) : null, keyLine, i.threadSize > 1 && i.threadSubject ? t.thread(i.threadSubject.replace(/\s+/g, ' ').trim().slice(0, 30)) : null].filter(Boolean).join(' · ');

  const multi = !i.recheck && (i.multi?.length ?? 0) > 1;
  const base = { lang: i.lang, found, options: opts, details: [] as string[], extras: { createOrder: true, notShipment: true, notDeal: false, askLater: true }, ...(multi ? { multi: true } : {}), ...(i.issue ? { issue: i.issue } : {}) };
  if (i.recheck) return { ...base, kind: 'RECHECK', title: t.recheck, replyHint: t.replyHint(opts.length) };
  if (multi) return { ...base, kind: 'WHICH', title: t.multi(opts.filter((o) => o.suggested).length, opts.filter((o) => o.suggested).map((o) => o.ref).join(ja ? '、' : ', ')), replyHint: t.replyHint(opts.length) };
  if (i.issue && !i.suggested) return { ...base, kind: 'WHICH', title: t.general(i.issue.title), replyHint: t.replyHint(opts.length) };
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

export function questionOf(i: QuestionInput): QuestionCard {
  return decorate(questionBase(i), i);
}

// ── Round BB: the new card format ──────────────────────────────────────────────────────────────────────────
const BB = {
  en: {
    newShipment: (ref: string, rest: string) => `New shipment of ${ref}${rest ? ` (${rest})` : ''}`,
    newShort: (ref: string) => `New shipment of ${ref}`,
    general: 'General issue',
    notShipment: 'Not about a shipment',
    newDeal: 'New deal',
    hRecordFiles: (ref: string, rest: string, n: number) => `File ${n === 1 ? '1 document' : `${n} documents`} to ${ref}${rest ? ` (${rest})` : ''}?`,
    hRecord: (ref: string, rest: string) => `Link to ${ref}${rest ? ` (${rest})` : ''}?`,
    hNewShipment: (ref: string, rest: string, bl: string | null) => `Create a new shipment of ${ref}${rest ? ` (${rest})` : ''}${bl ? ` with B/L ${bl}` : ''}?`,
    hNotShipment: "This doesn't look like a shipment email. Hide it?",
    hSplit: (refs: string) => `The documents name different shipments (${refs}). Check where each one goes?`,
    hOpen: 'What is this email about?',
    hNewDeal: (what: string) => (what ? `No open order fits. Is this a new ${what} deal?` : 'No open order fits. Is this a new deal?'),
    yRecord: (ref: string, n: number, files: number) => `Links ${n === 1 ? 'the email' : `${n} emails`} to ${ref}${files ? ` and files ${files} document${files === 1 ? '' : 's'}` : ''}.`,
    yNewShipment: (ref: string, bl: string | null) => `Opens a new shipment of ${ref}${bl ? ` with B/L ${bl}` : ''} filled in from the email; you check it, then the documents are filed.`,
    yGeneral: 'Adds it as an issue and marks the email done.',
    yNotShipment: 'Moves it to "Not about a shipment" (you can bring it back).',
    yNewDeal: 'Opens the new-order form filled in from the email.',
    where: { attachment: 'the attachment', subject: 'the subject', body: 'the email text', quoted: 'the quoted history' } as Record<string, string>,
    key: { bl: 'B/L', pi: 'PI', ci: 'CI', net: 'net', contract: 'contract' } as Record<string, string>,
    keyOn: (k: string, where: string, ref: string) => `${k} in ${where} = ${ref}`,
    keyNew: (k: string, where: string) => `${k} in ${where}, not on any shipment yet`,
    conflict: (field: string, email: string, ref: string, rec: string) => `The documents say ${field} ${email}; ${ref} has ${rec}`,
    field: { grade: 'grade', contract: 'contract' } as Record<string, string>,
    thread: (ref: string) => `An earlier email of this thread went to ${ref}`,
    free: (ref: string) => `${ref} has no shipment yet`,
    recheck: (refs: string) => (refs ? `AIMS checked again: it may be ${refs} instead` : 'AIMS checked again and is not sure about this'),
  },
  ja: {
    newShipment: (ref: string, rest: string) => `${ref}${rest ? `（${rest}）` : ''}の新しい出荷`,
    newShort: (ref: string) => `${ref} の新しい出荷`,
    general: '全般的な課題',
    notShipment: '出荷ではない',
    newDeal: '新しい案件',
    hRecordFiles: (ref: string, rest: string, n: number) => `${ref}${rest ? `（${rest}）` : ''}に${n}件のファイルを登録しますか？`,
    hRecord: (ref: string, rest: string) => `${ref}${rest ? `（${rest}）` : ''}に紐付けますか？`,
    hNewShipment: (ref: string, rest: string, bl: string | null) => `${ref}${rest ? `（${rest}）` : ''}の新しい出荷を${bl ? `B/L ${bl} で` : ''}作成しますか？`,
    hNotShipment: '出荷のメールではないようです。非表示にしますか？',
    hSplit: (refs: string) => `書類ごとに出荷が異なります（${refs}）。それぞれの登録先を確認しますか？`,
    hOpen: 'このメールは何の件ですか？',
    hNewDeal: (what: string) => (what ? `合う注文がありません。新しい ${what} の案件ですか？` : '合う注文がありません。新しい案件ですか？'),
    yRecord: (ref: string, n: number, files: number) => `メール${n}件を ${ref} に紐付け${files ? `、書類${files}件を登録` : ''}します。`,
    yNewShipment: (ref: string, bl: string | null) => `${ref} の新しい出荷をメールの内容で開きます${bl ? `（B/L ${bl}）` : ''}。確認後に書類を登録します。`,
    yGeneral: '課題として追加し、メールを処理済みにします。',
    yNotShipment: '「出荷ではないメール」に移します（元に戻せます）。',
    yNewDeal: 'メールの内容で新しい注文フォームを開きます。',
    where: { attachment: '添付', subject: '件名', body: '本文', quoted: '引用部分' } as Record<string, string>,
    key: { bl: 'B/L', pi: 'PI', ci: 'CI', net: '正味', contract: '契約' } as Record<string, string>,
    keyOn: (k: string, where: string, ref: string) => `${k}：${where}（= ${ref}）`,
    keyNew: (k: string, where: string) => `${k}：${where}（まだどの出荷にもありません）`,
    conflict: (field: string, email: string, ref: string, rec: string) => `書類は${field} ${email}、${ref} は ${rec}`,
    field: { grade: '材質', contract: '契約' } as Record<string, string>,
    thread: (ref: string) => `このスレッドの前のメールは ${ref} に紐付け済み`,
    free: (ref: string) => `${ref} にはまだ出荷がありません`,
    recheck: (refs: string) => (refs ? `AIMSの再確認では ${refs} の可能性もあります` : 'AIMSの再確認で確信が持てなくなりました'),
  },
} as const;

/** "#27 · Kato 6005 · 40 t" → ["#27", "Kato 6005 · 40 t"]. */
const splitSummary = (summary: string | null, ref: string): string => {
  if (!summary) return '';
  const parts = summary.split(' · ');
  return (parts[0] === ref ? parts.slice(1) : parts).join(' · ');
};
/** A long attachment name, shortened in the middle for an evidence line ("Remittance statement…en.pdf"). */
const shortFile = (n: string) => (n.length > 40 ? `${n.slice(0, 26)}…${n.slice(-10)}` : n);
/** "#18-2" + "#18-2 · SUS 6005 · 20.4 t · WAN HAI 366" → "#18-2 · 20.4 t". */
const shortOf = (ref: string, summary: string | null) => {
  const t = (summary ?? '').split(' · ').find((x) => /^\d[\d.,]* t$/.test(x));
  return t ? `${ref} · ${t}` : ref;
};

/**
 * Round BC (owner: less text) — the card's ONE evidence line, ~80 characters: the B/L / PI / CI, the grade, the net
 * weight, the contract, each "✓" when it names the guess; a conflict ("6005 ≠ 6063") in red. Built from the stored
 * evidence; rows matched before round BB fall back to the first evidence text.
 */
function evidenceLineOf(stored: StoredCard | null, guess: CardChoice | null, evidence: CardEvidence[], lang: Lang): EvidenceSegment[] {
  const out: EvidenceSegment[] = [];
  const onGuess = (on: RecordId | null) => !!on && !!guess?.orderId && on.orderId === guess.orderId && (!guess.shipmentId || !on.shipmentId || on.shipmentId === guess.shipmentId);
  const seen = new Set<string>();
  const push = (text: string, ok: boolean, conflict = false) => {
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ text: ok ? `${text} ✓` : text, ok, conflict });
  };
  const items = stored?.evidence ?? [];
  for (const e of items) if (e.t === 'conflict') push(`${e.email} ≠ ${e.record}`, false, true);
  for (const e of items) if (e.t === 'key' && e.key !== 'net' && e.key !== 'contract') push(`${e.key === 'bl' ? 'B/L' : e.key.toUpperCase()} ${e.value}`, onGuess(e.on));
  const doc = items.find((e) => e.t === 'doc') as Extract<EvidenceItem, { t: 'doc' }> | undefined;
  const conflictGrade = items.some((e) => e.t === 'conflict' && e.field === 'grade');
  if (doc?.grade && !conflictGrade) push(doc.grade, false);
  const net = items.find((e) => e.t === 'key' && e.key === 'net') as Extract<EvidenceItem, { t: 'key' }> | undefined;
  if (net) push(`${net.value} t`, onGuess(net.on));
  else if (doc?.netMt !== null && doc?.netMt !== undefined) push(`${doc.netMt} t`, false);
  for (const e of items) if (e.t === 'key' && e.key === 'contract') push(e.value, onGuess(e.on));
  if (!out.length && evidence[0]) out.push({ text: evidence[0].text, ok: false, conflict: evidence[0].conflict });
  // ~80 characters: drop trailing parts, never a conflict.
  while (out.length > 1 && out.map((p) => p.text).join(' · ').length > 80) {
    const k = [...out].reverse().findIndex((p) => !p.conflict);
    if (k < 0) break;
    out.splice(out.length - 1 - k, 1);
  }
  void lang;
  return out;
}

const KEY_RE = /\b(\d{3}[A-Z]{2}\d{5}|(?:KMTC|MEDU|SITG|GGVC)[A-Z0-9]{6,}|9331\d{6}|XP\d{10}|4540\d{5}|\d{1,4}\.\d{3})\b/;

function decorate(q: QuestionCard, i: QuestionInput): QuestionCard {
  if (q.waitingFile) return { ...q, headline: q.title, guess: null, alternatives: [], evidence: [], yesLine: null, asked: i.asked ?? null };
  const W = BB[i.lang];
  const stored = i.card ?? null;
  const refOf = (o: string, sh: string | null) => (i.refOf ? i.refOf(o, sh) : (q.options.find((x) => x.orderId === o && x.shipmentId === sh)?.ref ?? '#?'));
  const same = (a: Partial<RecordId>, b: Partial<RecordId>) => a.orderId === b.orderId && (a.shipmentId ?? null) === (b.shipmentId ?? null);
  const exactFor = (id: Partial<RecordId>) => !!stored?.evidence.some((e) => e.t === 'key' && e.on && same(e.on, id) && e.key !== 'contract');
  const usable = (c: { kind: GuessKind } & Partial<RecordId>) => c.kind !== 'record' || !c.orderId || !i.offerable || i.offerable(c.orderId, c.shipmentId ?? null) || exactFor(c);
  // The guess: the match's stored one, else what the old fields say (rows matched before round BB).
  let g: ({ kind: GuessKind } & Partial<RecordId>) | null = stored?.guess ?? null;
  if (!stored) {
    if (q.kind === 'NEW_DEAL') g = { kind: 'new_deal' };
    else if (q.issue && !i.suggested) g = { kind: 'general' };
    else if (i.suggested && !q.multi) g = { kind: 'record', orderId: i.suggested.orderId, shipmentId: i.suggested.shipmentId };
  }
  if (g && !usable(g)) g = null;
  const choice = (c: { kind: GuessKind } & Partial<RecordId>): CardChoice => {
    const o = c.orderId ?? null;
    const sh = c.shipmentId ?? null;
    if (c.kind === 'record' && o) {
      const ref = refOf(o, sh);
      return { kind: 'record', orderId: o, shipmentId: sh, ref, label: i.summaryOf(o, sh) ?? ref, short: shortOf(ref, i.summaryOf(o, sh)) };
    }
    if (c.kind === 'new_shipment' && o) {
      const ref = refOf(o, null);
      return { kind: 'new_shipment', orderId: o, shipmentId: null, ref, label: W.newShipment(ref, splitSummary(i.summaryOf(o, null), ref)), short: W.newShort(ref) };
    }
    if (c.kind === 'general') return { kind: 'general', orderId: null, shipmentId: null, ref: null, label: q.issue?.title ?? W.general };
    if (c.kind === 'not_shipment') return { kind: 'not_shipment', orderId: null, shipmentId: null, ref: null, label: W.notShipment };
    return { kind: 'new_deal', orderId: null, shipmentId: null, ref: null, label: W.newDeal };
  };
  const guess = g ? choice(g) : null;
  const altSrc = stored ? stored.alternatives : q.options.filter((o) => !o.suggested).map((o) => ({ kind: 'record' as GuessKind, orderId: o.orderId, shipmentId: o.shipmentId }));
  const alternatives = altSrc.filter((a) => usable(a) && (!g || !(a.kind === g.kind && same(a, g)))).slice(0, 2).map(choice);
  // Evidence: the stored items in the user's language, else the guess's own reasons.
  const evidence: CardEvidence[] = [];
  for (const e of stored?.evidence ?? []) {
    if (evidence.length >= 4) break;
    if (e.t === 'key') {
      const k = `${W.key[e.key]} ${e.value}${e.key === 'net' ? ' t' : ''}`;
      const where = e.file ? shortFile(e.file) : (W.where[e.where] ?? e.where);
      evidence.push({ text: e.on ? W.keyOn(k, where, refOf(e.on.orderId, e.on.shipmentId)) : W.keyNew(k, where), mark: e.value, file: e.file ? shortFile(e.file) : null, conflict: false });
    } else if (e.t === 'doc') {
      const bits = [e.grade, e.netMt !== null ? `${e.netMt} t` : null, e.etd ? `ETD ${e.etd}` : null].filter(Boolean).join(' · ');
      if (bits) evidence.push({ text: `${e.file ? shortFile(e.file) : W.where.attachment}: ${bits}`, mark: e.grade ?? (e.netMt !== null ? `${e.netMt} t` : null), file: e.file ? shortFile(e.file) : null, conflict: false });
    } else if (e.t === 'conflict') {
      evidence.push({ text: W.conflict(W.field[e.field], e.email, refOf(e.on.orderId, e.on.shipmentId), e.record), mark: e.email, file: null, conflict: true });
    } else if (e.t === 'thread') evidence.push({ text: W.thread(refOf(e.on.orderId, e.on.shipmentId)), mark: refOf(e.on.orderId, e.on.shipmentId), file: null, conflict: false });
    else if (e.t === 'free') evidence.push({ text: W.free(refOf(e.on.orderId, e.on.shipmentId)), mark: null, file: null, conflict: false });
  }
  // A second look that doubts the link stays visible, in red.
  if (q.kind === 'RECHECK' && i.recheck) {
    const refs = i.recheck.second.map((x) => x.ref).join(', ');
    evidence.unshift({ text: W.recheck(refs), mark: i.recheck.second[0]?.ref ?? null, file: null, conflict: true });
  }
  // A subject that disagrees with the guess stays visible, in red.
  if (q.kind === 'CHECK' && i.check.length) evidence.unshift({ text: q.title, mark: i.check.map((c) => c.replace(/^(grade|qty|customer|delivery|size)\s+/, '').split(/\s*≠\s*/)[0])[0] ?? null, file: null, conflict: true });
  if (!stored && guess?.kind === 'record') {
    const why = q.options.find((o) => o.suggested && o.orderId === guess.orderId && o.shipmentId === guess.shipmentId)?.why ?? '';
    for (const w of why.split(' · ').filter(Boolean).slice(0, 3)) evidence.push({ text: w, mark: KEY_RE.exec(w)?.[1] ?? null, file: null, conflict: false });
  }
  const files = Math.max(i.files ?? 0, stored?.files ?? 0);
  const n = Math.max(1, i.emails ?? 1);
  const bl = stored?.bl ?? null;
  let headline = q.title;
  let yesLine: string | null = null;
  if (guess?.kind === 'record' && guess.ref) {
    const rest = splitSummary(guess.label, guess.ref);
    headline = files ? W.hRecordFiles(guess.ref, rest, files) : W.hRecord(guess.ref, rest);
    // Round BC: filing / linking is the question itself — no "Yes:" line.
    void n;
  } else if (guess?.kind === 'new_shipment' && guess.ref) {
    headline = W.hNewShipment(guess.ref, splitSummary(i.summaryOf(guess.orderId!, null), guess.ref), bl);
    yesLine = W.yNewShipment(guess.ref, bl);
  } else if (guess?.kind === 'general') yesLine = W.yGeneral;
  else if (guess?.kind === 'not_shipment') {
    headline = W.hNotShipment;
    yesLine = W.yNotShipment;
  } else if (guess?.kind === 'new_deal') {
    const sd = i.seed;
    headline = W.hNewDeal([sd?.grade, sd?.qtyMt ? `${sd.qtyMt} t` : null].filter(Boolean).join(' · '));
    yesLine = W.yNewDeal;
  }
  if (stored?.split?.length) headline = W.hSplit(stored.split.join(', '));
  // A "new deal" card that no longer guesses a deal never says "not in AIMS yet".
  else if (!guess && q.kind === 'NEW_DEAL' && stored) headline = W.hOpen;
  const kind: QuestionKind = guess?.kind === 'new_shipment' ? 'NEW_SHIPMENT' : guess?.kind === 'new_deal' ? 'NEW_DEAL' : q.kind === 'NEW_DEAL' && (guess || stored) ? (guess ? 'CONFIRM' : 'WHICH') : q.kind;
  // A card that no longer asks "new deal" offers the record answers, not "Create the order".
  const extras = kind === q.kind ? q.extras : { createOrder: true, notShipment: true, notDeal: false, askLater: true };
  return { ...q, kind, extras, title: headline, headline, guess, alternatives, evidence, evidenceLine: evidenceLineOf(stored, guess, evidence, i.lang), yesLine, asked: i.asked ?? null };
}

/**
 * Round BB — batches: every card whose guess is a NEW shipment of an order is one screen ("5 B/L drafts for orders
 * without that shipment yet"); several cards guessing the same record are another ("3 emails about #18-2: same answer?").
 * Cards handed to the admins stay single. Pure.
 */
export function batchesOf(items: Array<{ id: string; question: QuestionCard | null }>, lang: Lang): Array<{ key: string; title: string; threadIds: string[] }> {
  const ja = lang === 'ja';
  const orderRef = (ref: string | null) => (ref ? ref.replace(/-\d+$/, '') : '#?');
  // 1. Cards whose guess is the same ORDER (a shipment of it, or its next shipment) → one screen per order.
  const byOrder = new Map<string, { ids: string[]; ref: string }>();
  for (const it of items) {
    const q = it.question;
    const g = q?.guess;
    if (!q || !g || q.asked || !g.orderId || (g.kind !== 'record' && g.kind !== 'new_shipment')) continue;
    const e = byOrder.get(g.orderId) ?? byOrder.set(g.orderId, { ids: [], ref: orderRef(g.ref) }).get(g.orderId)!;
    e.ids.push(it.id);
  }
  const out: Array<{ key: string; title: string; threadIds: string[] }> = [];
  const used = new Set<string>();
  for (const [orderId, v] of byOrder) {
    if (v.ids.length < 2) continue;
    v.ids.forEach((id) => used.add(id));
    out.push({ key: `order:${orderId}`, threadIds: v.ids, title: ja ? `${v.ref} に関するメール${v.ids.length}件：AIMSの回答を確認` : `${v.ids.length} emails about ${v.ref}: check AIMS's answers` });
  }
  // 2. The remaining "new shipment of …" cards → one screen.
  const rest = items.filter((it) => !used.has(it.id) && !it.question?.asked && it.question?.guess?.kind === 'new_shipment').map((it) => it.id);
  if (rest.length >= 2) out.push({ key: 'new-shipments', threadIds: rest, title: ja ? `${rest.length}件：まだ出荷がない注文のB/Lドラフト・書類` : `${rest.length} B/L drafts and documents for orders without that shipment yet` });
  return out;
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
export function answerText(kind: 'record' | 'general' | 'not_shipment' | 'not_deal' | 'later' | 'ask_admin', lang: Lang, o: { refs?: string[]; files?: number; emails?: number; issue?: string | null } = {}): string {
  const ja = lang === 'ja';
  const refs = (o.refs ?? []).join(' + ');
  const files = o.files ?? 0;
  const n = o.emails ?? 1;
  // Round AR: a general issue (with or without linked shipments).
  const issue = o.issue ? (ja ? `課題「${o.issue}」を追加` : `Issue added: ${o.issue}`) : '';
  if ((kind === 'record' || kind === 'general') && !refs) return issue || (ja ? '処理しました' : 'Done');
  if (kind === 'general' || (kind === 'record' && issue)) return [issue, answerText('record', lang, { ...o, issue: null })].filter(Boolean).join(ja ? ' · ' : ' · ');
  if (kind === 'record') return ja ? `${refs} に紐付けました${files ? ` · 書類 ${files} 件を登録` : ''}${n > 1 ? `（メール ${n} 件）` : ''}` : `Linked to ${refs}${files ? ` · ${files} file${files === 1 ? '' : 's'} filed` : ''}${n > 1 ? ` (${n} emails)` : ''}`;
  if (kind === 'not_shipment') return ja ? '非表示にしました — 出荷ではない' : 'Hidden — not about a shipment';
  if (kind === 'not_deal') return ja ? '非表示にしました — 案件ではない' : 'Hidden — not a deal';
  if (kind === 'ask_admin') return ja ? 'Elroy・Takeに確認を依頼しました' : 'Asked Elroy and Take';
  return ja ? '明日もう一度お聞きします' : 'Asked again tomorrow';
}

/** The reply numbers of a WhatsApp question: 1..n = options, 0 = later, X = not a shipment (or not a deal). */
/** Round AE: the words a push (or its quick-reply button) invites — read as a typed reply, in both languages. */
export const REPLY_WORDS = /^\s*(?:[0-9]|x|×|new|later|ask later|not a shipment|not a deal|create order|新規|後で|出荷ではない|案件ではない|注文を作成)\s*$/i;

export function parseNumberedReply(text: string, q: Pick<QuestionCard, 'kind' | 'options'>): { kind: 'record'; option: QuestionOption } | { kind: 'later' } | { kind: 'not_shipment' } | { kind: 'not_deal' } | { kind: 'create_order' } | null {
  const s = text.trim().toLowerCase();
  if (s === '0' || s === 'later' || s === 'ask later' || s === '後で') return { kind: 'later' };
  if (s === 'x' || s === '×') return { kind: q.kind === 'NEW_DEAL' ? 'not_deal' : 'not_shipment' };
  if (s === 'not a shipment' || s === '出荷ではない') return { kind: 'not_shipment' };
  if (s === 'not a deal' || s === '案件ではない') return { kind: 'not_deal' };
  if (s === 'new' || s === 'create order' || s === '新規' || s === '注文を作成') return q.kind === 'NEW_DEAL' ? { kind: 'create_order' } : null;
  if (!/^[1-9]$/.test(s)) return null;
  const n = Number(s);
  if (q.kind === 'NEW_DEAL') return n === 1 ? { kind: 'create_order' } : n === 2 ? { kind: 'not_deal' } : null;
  const o = q.options[n - 1];
  return o ? { kind: 'record', option: o } : null;
}

/**
 * Round AS — the card of a file kept waiting ("COA 265C1701,265C1689 SUS 26th Oct.pdf"): a packing list / COA with one
 * of its casts / bundles arrived on a shipment, so AIMS proposes attaching it there. Yes = file it there, No = keep
 * waiting (that shipment is not proposed again), Ask later.
 */
export function waitingFileCard(lang: Lang, w: { emailId: string; index: number; name: string; docType: string; why: string }, target: { orderId: string; shipmentId: string; ref: string; summary: string | null }): QuestionCard {
  const ja = lang === 'ja';
  return {
    kind: 'CONFIRM',
    lang,
    title: ja ? `「${w.name}」を ${target.ref} に添付しますか？` : `Attach "${w.name}" to ${target.ref}?`,
    found: ja ? `待機中のファイル · ${w.why}` : `A file kept waiting · ${w.why}`,
    options: [{ id: `r:${target.orderId}:${target.shipmentId}`, orderId: target.orderId, shipmentId: target.shipmentId, ref: target.ref, summary: target.summary ?? target.ref, why: w.why, suggested: true }],
    extras: { createOrder: false, notShipment: true, notDeal: false, askLater: true },
    details: [],
    replyHint: ja ? '1 = 添付 · X = まだ待つ · 0 = 後で' : 'Reply 1 = attach · X = keep waiting · 0 = ask later',
    waitingFile: { emailId: w.emailId, index: w.index, name: w.name, docType: w.docType },
  };
}
