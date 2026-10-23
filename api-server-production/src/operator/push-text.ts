/**
 * WhatsApp pushes for the shipments assistant (ADH, round X, 2026-10-22; round AD layout, 2026-10-23) — the TEXT,
 * pure and tested.
 *
 * Owner's rules (round AD): no "…" anywhere — a subject or a summary is never cut; a blank line between sections;
 * labels only where needed (no "From:" / "Subject:" / "Says:"); the sender is the COMPANY only ("Vedanta", not
 * "Aluminium.Exports (Vedanta)"); the org's own name tail is dropped from subjects ("_アジアディールハブ"); the digest
 * is plain lines, no bullets, no "(19 emails)"; the link is a short one (https://app.ai-ms.io/go/abc123). Still: no
 * emojis, one fact per line, never list auto-filed emails one by one, the language follows the user's setting.
 *
 * Everything here is data in, text out. Nothing turns words into actions.
 */
export type Lang = 'en' | 'ja';

const JST_OFFSET_MS = 9 * 3600_000;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}]/gu;

/** Every emoji / pictograph removed, the spacing tidied (blank lines between sections are kept). */
export function stripEmoji(s: string): string {
  return String(s ?? '')
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\s*[·•]\s*$/gm, '')
    .trim();
}

/** The org's own name as a subject tail ("…_アジアディールハブ", "… ーアジアディールハブ", "… - Asia Deal Hub"). */
const OWN_NAME_TAIL_RE = /[\s_＿ー－\-–—~〜]+\s*(アジアディールハブ|Asia ?Deal ?Hub|ADH Japan|ADH)\s*$/i;

/** Round AD: the subject in full — whitespace collapsed, the own-name tail dropped, never cut; "(no subject)" when empty. */
export function cleanSubject(subject: string | null | undefined): string {
  const s = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '(no subject)';
  return s.replace(OWN_NAME_TAIL_RE, '').trim() || s;
}
/** Kept under its old name for callers: no trimming any more (owner: wrap, never "…"). */
export const trimSubject = (subject: string | null | undefined, _n?: number): string => cleanSubject(subject);

/** The display name of a From header ("Toshiro Takekoshi <t@asiadealhub.com>" → "Toshiro Takekoshi"; a bare address → its local part). */
export function senderName(from: string | null | undefined): string {
  const s = (from ?? '').trim();
  const m = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s);
  if (m) return (m[1].trim() || m[2].split('@')[0]).trim();
  return (s.replace(/^<|>$/g, '').split('@')[0] || '?').trim();
}

/** Round AD: who the push names — the COMPANY from the domain map ("Vedanta"), else the From header's name. */
export function senderWho(from: string | null | undefined, company: string | null | undefined): string {
  return (company ?? '').trim() || senderName(from);
}

/** "Toshiro Takekoshi (Asia Deal Hub)" — for chat replies (the pushes use senderWho). */
export function senderLine(from: string | null | undefined, company: string | null | undefined): string {
  const name = senderName(from);
  const c = (company ?? '').trim();
  return c && c.toLowerCase() !== name.toLowerCase() ? `${name} (${c})` : name;
}

export const jstParts = (d: Date) => {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return { y: j.getUTCFullYear(), mo: j.getUTCMonth() + 1, d: j.getUTCDate(), dow: j.getUTCDay(), hh: j.getUTCHours(), mm: j.getUTCMinutes() };
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** "22 Oct" / "10/22"; with time "22 Oct 11:50" / "10/22 11:50" (JST). */
export function dateLabel(d: Date | string | null | undefined, lang: Lang, withTime = false): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const p = jstParts(date);
  const time = withTime ? ` ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}` : '';
  return lang === 'ja' ? `${p.mo}/${p.d}${time}` : `${p.d} ${MON[p.mo - 1]}${time}`;
}

/** "Thu 22 Oct" / "10月22日（木）". */
export function dayLabel(d: Date, lang: Lang): string {
  const p = jstParts(d);
  return lang === 'ja' ? `${p.mo}月${p.d}日（${DOW_JA[p.dow]}）` : `${DOW_EN[p.dow]} ${p.d} ${MON[p.mo - 1]}`;
}

/** "Sat 24 Oct" / "10/24（土）" for an ETA. */
export function etaLabel(d: Date | string | null | undefined, lang: Lang): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const p = jstParts(date);
  return lang === 'ja' ? `${p.mo}/${p.d}（${DOW_JA[p.dow]}）` : `${DOW_EN[p.dow]} ${p.d} ${MON[p.mo - 1]}`;
}

/** WhatsApp's hard size limit only (4096 chars) — never reached by our pushes; the one place a cut may happen. */
export const WHATSAPP_MAX = 4000;
export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

const URL_RE = /(https?:\/\/\S+)/;
const JA_RE = /[぀-ヿ一-鿿]/;
export const sections = (parts: Array<string | null | undefined>) => parts.filter((p): p is string => !!p && !!p.trim()).join('\n\n');

// ── (a) the morning digest ───────────────────────────────────────────────────

export type DigestInput = {
  /** JST now (the header's date). */
  at: Date;
  /** Emails filed by themselves since yesterday's digest — the COUNT only, never listed. */
  filedAuto: number;
  /** The Dashboard's own numbers: questions (threads waiting for a person) and the emails behind them (not shown since round AD). */
  questions: number;
  questionEmails: number;
  /** Overdue tasks as "#19-1 import tax funds" (already short). */
  overdue: string[];
  /** Shipments with an ETA this week, soonest first. */
  arriving: Array<{ ref: string; eta: Date | string | null }>;
  portalUrl: string;
};

/** A bell title ("#14-1: detention free time ends 2026-10-20") → "#14-1 detention" / "#14-1 ディテンション". */
export function shortTask(title: string, lang: Lang): string {
  const m = /^(#\d+(?:-\d+)?)\s*[:：]?\s*(.*)$/.exec(title.trim());
  const ref = m ? m[1] : '';
  let rest = (m ? m[2] : title).trim();
  const known: Array<[RegExp, string, string]> = [
    [/detention/i, 'detention', 'ディテンション'],
    [/demurrage/i, 'demurrage', 'デマレージ'],
    [/import tax|tax fund|tax payment|関税/i, 'import tax funds', '輸入税の資金'],
    [/arrival notice|A\/N/i, 'arrival notice', '到着通知'],
    [/import permit|permit/i, 'import permit', '輸入許可'],
    [/ci payment|commercial invoice|vedanta payment/i, 'CI payment', 'CI支払'],
    [/deposit/i, 'deposit', '前受金'],
    [/customs/i, 'customs', '通関'],
    [/delivery|納品/i, 'delivery', '納品'],
  ];
  for (const [re, en, ja] of known) if (re.test(rest)) return `${ref} ${lang === 'ja' ? ja : en}`.trim();
  rest = rest.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\b(ends?|due|expected|by)\b.*$/i, '').replace(/\s+/g, ' ').trim();
  return `${ref} ${rest}`.trim();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function digestText(d: DigestInput, lang: Lang = 'en'): string {
  const ja = lang === 'ja';
  const facts: string[] = [];
  facts.push(ja ? `メール ${d.filedAuto} 件を自動処理` : `${plural(d.filedAuto, 'email')} filed automatically`);
  facts.push(d.questions > 0 ? (ja ? `${d.questions} 件の確認が必要です` : `${d.questions} need${d.questions === 1 ? 's' : ''} your check`) : ja ? '確認が必要なものはありません' : 'Nothing needs your check');
  if (d.overdue.length) {
    const shown = d.overdue.slice(0, 3).join(ja ? '、' : ', ');
    const more = d.overdue.length > 3 ? (ja ? ` ほか ${d.overdue.length - 3} 件` : ` and ${d.overdue.length - 3} more`) : '';
    facts.push(ja ? `期限超過のタスク ${d.overdue.length} 件: ${shown}${more}` : `${plural(d.overdue.length, 'task')} overdue: ${shown}${more}`);
  }
  if (d.arriving.length) {
    const first = d.arriving[0];
    const when = etaLabel(first.eta, lang);
    facts.push(ja ? `今週到着 ${d.arriving.length} 件、最初は ${first.ref}${when ? `（${when}）` : ''}` : `${plural(d.arriving.length, 'shipment')} arriving this week, first ${first.ref}${when ? ` on ${when}` : ''}`);
  }
  return stripEmoji(sections([ja ? `おはようございます。${dayLabel(d.at, 'ja')}` : `Good morning. ${dayLabel(d.at, 'en')}`, facts.join('\n'), d.portalUrl]));
}

// ── (b) (c) (d) an email needs a person ──────────────────────────────────────

export type NeedsCheckInput = {
  kind: 'CONFIRM' | 'WHICH' | 'CHECK' | 'IS_SHIPMENT' | 'NEW_DEAL' | 'RECHECK';
  from: string | null;
  company: string | null;
  date: Date | string | null;
  subject: string | null;
  /** The card's options in order (not shown since round AA — the person answers with the shipment number). */
  options: Array<{ ref: string }>;
  /** CHECK: what the subject says ("6063") — unused since round AA, kept for callers. */
  says?: string | null;
  /** Round AB: the stored one-line summary of the email (display text only) — its own section under the subject. */
  summary?: string | null;
  portalUrl: string;
};

const TITLE = {
  shipment: { en: 'New email needs a shipment', ja: '新しいメールに出荷の指定が必要です' },
  is_shipment: { en: 'Is this email about a shipment?', ja: 'このメールは出荷の件ですか？' },
  new_deal: { en: 'New email looks like a new deal', ja: '新しい案件のようなメールです' },
  recheck: { en: "AIMS re-checked an email and isn't sure anymore", ja: 'AIMSがメールを再確認したところ、確信が持てなくなりました' },
} as const;
const CLOSING = {
  shipment: { en: 'Reply with the shipment number (e.g. 18-1), or open AIMS:', ja: '出荷番号で返信してください（例: 18-1）。またはAIMSを開く:' },
  is_shipment: { en: 'Reply 1 if it is, X if not, or open AIMS:', ja: '出荷の件なら 1、違えば X と返信、またはAIMSを開く:' },
  new_deal: { en: "It isn't in AIMS yet. Open AIMS to create the order:", ja: 'AIMSにはまだありません。AIMSで注文を作成:' },
  recheck: { en: 'Please confirm the shipment in AIMS:', ja: 'AIMSで出荷を確認してください:' },
} as const;
type PushForm = keyof typeof TITLE;
const formOf = (kind: NeedsCheckInput['kind']): PushForm => (kind === 'NEW_DEAL' ? 'new_deal' : kind === 'RECHECK' ? 'recheck' : kind === 'IS_SHIPMENT' ? 'is_shipment' : 'shipment');
const QUESTION = {
  shipment: { en: 'Which shipment?', ja: 'どの出荷？' },
  is_shipment: { en: 'About a shipment?', ja: '出荷の件？' },
  new_deal: { en: 'New deal?', ja: '新しい案件？' },
  recheck: { en: 'Re-check', ja: '再確認' },
} as const;

/** "SUS · 23 Oct 06:53" (a new deal / re-check: the date only). */
export function whoLine(i: Pick<NeedsCheckInput, 'from' | 'company' | 'date' | 'kind'>, lang: Lang): string {
  const when = dateLabel(i.date, lang, i.kind !== 'NEW_DEAL' && i.kind !== 'RECHECK');
  return [senderWho(i.from, i.company), when || null].filter(Boolean).join(' · ');
}

/**
 * One push for one email (round AD layout):
 *   title / "Company · date time" / subject / blank / summary / blank / what to do / short link
 */
export function needsCheckText(i: NeedsCheckInput, lang: Lang = 'en'): string {
  const form = formOf(i.kind);
  const summary = (i.summary ?? '').replace(/\s+/g, ' ').trim();
  const head = [TITLE[form][lang], whoLine(i, lang), cleanSubject(i.subject)].join('\n');
  return stripEmoji(sections([head, summary || null, `${CLOSING[form][lang]}\n${i.portalUrl}`]));
}

/** One BLOCK of a batch: "Company · date time" / subject / "Which shipment?" (round AD: no "…", no bullets). */
export function needsCheckBlock(i: NeedsCheckInput, lang: Lang = 'en'): string {
  return [whoLine(i, lang), cleanSubject(i.subject), QUESTION[formOf(i.kind)][lang]].join('\n');
}
/** Kept under its old name: the block's lines joined with " · ". */
export const needsCheckLine = (i: NeedsCheckInput, lang: Lang = 'en') => needsCheckBlock(i, lang).split('\n').join(' · ');

const OPEN_AIMS = { en: 'Open AIMS:', ja: 'AIMSを開く:' } as const;
const batchHeader = (n: number, lang: Lang) => (lang === 'ja' ? `新しいメール ${n} 件の確認が必要です` : `${n} new emails need your check`);
const andMore = (n: number, lang: Lang) => (lang === 'ja' ? `ほか ${n} 件` : `and ${n} more`);

/** Several "needs a check" pushes due together → one message: a header, one block per email, the link once. */
export function needsCheckBatchText(items: NeedsCheckInput[], lang: Lang = 'en'): string {
  if (items.length === 1) return needsCheckText(items[0], lang);
  const blocks = items.slice(0, 6).map((i) => needsCheckBlock(i, lang));
  if (items.length > 6) blocks.push(andMore(items.length - 6, lang));
  return stripEmoji(sections([batchHeader(items.length, lang), ...blocks, `${OPEN_AIMS[lang]}\n${items[0].portalUrl}`]));
}

// ── (e) events, one line each ────────────────────────────────────────────────

export function etaChangedLine(ref: string, from: Date | string | null, to: Date | string | null, lang: Lang = 'en'): string {
  const a = dateLabel(from, lang) || '?';
  const b = dateLabel(to, lang) || '?';
  return lang === 'ja' ? `${ref} ETA 変更: ${a} -> ${b}` : `${ref} ETA changed: ${a} -> ${b}`;
}
export const arrivalNoticeLine = (ref: string, lang: Lang = 'en') => (lang === 'ja' ? `${ref} 到着通知を登録` : `${ref} arrival notice filed`);
export const importPermitLine = (ref: string, lang: Lang = 'en') => (lang === 'ja' ? `${ref} 輸入許可書を登録` : `${ref} import permit filed`);
export const filedLine = (ref: string, files: number, lang: Lang = 'en') => (lang === 'ja' ? `${ref} 書類 ${files} 件を登録` : `${ref} ${files} file${files === 1 ? '' : 's'} filed`);
export function freeTimeLine(ref: string, kind: 'detention' | 'demurrage', ended: Date | string | null, lang: Lang = 'en'): string {
  const when = dateLabel(ended, lang);
  const what = kind === 'detention' ? (lang === 'ja' ? 'ディテンション' : 'detention') : lang === 'ja' ? 'デマレージ' : 'demurrage';
  return lang === 'ja' ? `${ref} ${what}のフリータイム終了${when ? ` ${when}` : ''}、費用を確認` : `${ref} ${what} free time ended${when ? ` ${when}` : ''}, check costs`;
}
export const stepOverdueLine = (ref: string, step: string, lang: Lang = 'en') => (lang === 'ja' ? `${ref} 期限超過: ${step}` : `${ref} step overdue: ${step}`);

/** Several event lines due together: the lines, a blank line, the link once. */
export function eventsBatchText(lines: string[], portalUrl: string, lang: Lang = 'en'): string {
  const out = lines.map((l) => stripEmoji(l)).filter(Boolean).slice(0, 7);
  if (lines.length > 7) out.push(andMore(lines.length - 7, lang));
  return sections([out.join('\n'), portalUrl]);
}

/** Lines that read as "needs a check" pushes (their first line) — the outbox batches those separately from events. */
const NEEDS_TITLES: string[] = Object.values(TITLE).flatMap((t) => [t.en, t.ja]);
const OLD_NEEDS_RE = /^(New email needs your check|新しいメールの確認が必要です|New email from .*|.* から新しいメール、.*|.* からの新しいメールに出荷の指定が必要です|AIMS re-checked|AIMSがメールを再確認)/;
export const isNeedsCheckPush = (text: string) => {
  const first = text.split('\n')[0] ?? '';
  return NEEDS_TITLES.includes(first.trim()) || OLD_NEEDS_RE.test(first);
};

/** The push's form from its first line (round AD titles; the round X–AC titles still read). */
function formOfTitle(title: string): PushForm | null {
  for (const [k, v] of Object.entries(TITLE) as Array<[PushForm, { en: string; ja: string }]>) if (v.en === title || v.ja === title) return k;
  if (/re-checked|再確認/.test(title)) return 'recheck';
  if (/needs a shipment|出荷の指定が必要/.test(title)) return 'shipment';
  if (/^New email needs your check$|^新しいメールの確認が必要です$/.test(title)) return 'is_shipment';
  if (/^New email from|から新しいメール/.test(title)) return 'new_deal';
  return null;
}

/** A stored push (the outbox keeps text only) → its lines: title, who, subject, summary, url. Old-layout rows (From:/Subject:) still read. */
export function parsePush(text: string): { form: PushForm | null; lang: Lang; title: string; who: string; subject: string; summary: string | null; url: string | null } {
  const ls = text.split('\n').map((l) => l.trimEnd());
  const title = (ls[0] ?? '').trim();
  const lang: Lang = JA_RE.test(title) ? 'ja' : 'en';
  const url = URL_RE.exec([...ls].reverse().find((l) => URL_RE.test(l)) ?? '')?.[1] ?? null;
  const form = formOfTitle(title);
  const oldSubject = ls.map((l) => /^(?:Subject|件名): (.*)$/.exec(l)?.[1]).find((x): x is string => !!x);
  if (oldSubject !== undefined) {
    const who = ls.map((l) => /^(?:From|差出人): (.*)$/.exec(l)?.[1]).find((x): x is string => !!x) ?? /^New email from (.*?) needs a shipment \((.*)\)$/.exec(title)?.slice(1).join(', ') ?? /^(.*?) からの新しいメールに出荷の指定が必要です（(.*)）$/.exec(title)?.slice(1).join('、') ?? /^New email from (.*)$/.exec(title)?.[1] ?? /^(.*) から新しいメール、(.*)$/.exec(title)?.slice(1).join('、') ?? '?';
    const says = ls.map((l) => /^(?:Says|内容): (.*)$/.exec(l)?.[1]).find((x): x is string => !!x) ?? null;
    return { form, lang, title, who, subject: oldSubject, summary: says, url };
  }
  const who = (ls[1] ?? '').trim();
  const subject = (ls[2] ?? '').trim();
  // The summary is the section between the subject and the closing section (the last two lines).
  const body = ls.slice(3).map((l) => l.trim());
  const closing = Math.max(0, body.length - 2);
  const summary = body.slice(0, closing).join(' ').trim() || null;
  return { form, lang, title, who, subject, summary, url };
}

/** A stored "needs a check" push → its block in a batch ("Company · date" / subject / "Which shipment?"). */
export function pushToBlock(text: string, lang: Lang = 'en'): string {
  const p = parsePush(text);
  // "SUS · 23 Oct 06:53" (round AD) or "Name (Company), 22 Oct 14:31" (older rows) → "Company · 22 Oct 14:31".
  const [first, ...rest] = p.who.split(/ · |, |、/);
  const company = /\(([^()]+)\)\s*$/.exec(first)?.[1] ?? first;
  const line = [company.trim(), rest.join(' ').trim()].filter(Boolean).join(' · ');
  return [line, cleanSubject(p.subject), QUESTION[p.form ?? 'shipment'][lang]].join('\n');
}
/** Kept under its old name. */
export const pushToLine = (text: string, lang: Lang = 'en') => pushToBlock(text, lang).split('\n').join(' · ');

/** The whole due batch of one user: "needs a check" pushes as blocks, event lines together, the link once. */
export function batchText(items: Array<{ text: string }>, lang: Lang = 'en', portalUrl?: string): string {
  const texts = items.map((i) => stripEmoji(i.text)).filter(Boolean);
  if (texts.length === 1) return clip(texts[0], WHATSAPP_MAX);
  const needs = texts.filter(isNeedsCheckPush);
  const rest = texts.filter((t) => !isNeedsCheckPush(t));
  const url = portalUrl ?? texts.map((t) => parsePush(t).url).find((u): u is string => !!u) ?? '';
  const parts: string[] = [];
  if (needs.length === 1) parts.push(needs[0]);
  else if (needs.length > 1) {
    const blocks = needs.slice(0, 6).map((t) => pushToBlock(t, lang));
    if (needs.length > 6) blocks.push(andMore(needs.length - 6, lang));
    parts.push(sections([batchHeader(needs.length, lang), ...blocks, `${OPEN_AIMS[lang]}\n${url}`]));
  }
  if (rest.length) parts.push(rest.length === 1 && rest[0].includes('\n') ? rest[0] : eventsBatchText(rest.map((t) => t.split('\n')[0]), url, lang));
  return clip(parts.join('\n\n'), WHATSAPP_MAX);
}

// ── Meta templates (round X): one parameter per line of the push ─────────────
// A parameter may not hold a newline, a template may not start or end with one, and the fixed words must outnumber
// the variables — so the approved bodies (scripts/whatsapp-templates.ts) carry the fixed words and the pushes are
// read back into their values here. Our own text layout is stable and tested.

/** The aims_digest parameters: [day, filed, waiting, overdue, arriving, link]. */
export function digestTemplateParams(text: string, lang: Lang): string[] | null {
  const ls = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const ja = lang === 'ja';
  const day = (ja ? /^おはようございます。(.+)$/ : /^Good morning\. (.+)$/).exec(ls[0] ?? '')?.[1];
  const url = URL_RE.exec(ls[ls.length - 1] ?? '')?.[1];
  if (!day || !url) return null;
  const find = (re: RegExp) => ls.map((l) => re.exec(l)).find((m): m is RegExpExecArray => !!m) ?? null;
  const filed = ja ? find(/^-? ?メール (\d+ 件)を自動処理$/)?.[1] : find(/^-? ?(\d+ emails?) filed automatically$/)?.[1];
  let waiting: string | null = null;
  if (ja) {
    const m = find(/^-? ?(\d+) 件の確認が必要です(?:（メール (\d+) 件）)?$/);
    waiting = m ? `質問 ${m[1]} 件${m[2] ? `（メール ${m[2]} 件）` : ''}` : ls.some((l) => /確認が必要なものはありません/.test(l)) ? 'なし' : null;
  } else {
    const m = find(/^-? ?(\d+) needs? your check(?: \((\d+ emails?)\))?$/);
    waiting = m ? `${m[1]} question${m[1] === '1' ? '' : 's'}${m[2] ? ` (${m[2]})` : ''}` : ls.some((l) => /Nothing needs your check/.test(l)) ? 'nothing' : null;
  }
  const overdue = ja ? (find(/^-? ?期限超過のタスク (\d+ 件: .+)$/)?.[1] ?? 'なし') : (() => { const m = find(/^-? ?(\d+) tasks? overdue: (.+)$/); return m ? `${m[1]}: ${m[2]}` : 'none'; })();
  const arriving = ja
    ? (() => { const m = find(/^-? ?今週到着 (\d+ 件)(?:、最初は (.+?)(?:（(.+)）)?|（最初: (.+)）)$/); return m ? (m[4] ? `${m[1]}（最初: ${m[4]}）` : `${m[1]}（最初: ${m[2]}${m[3] ? `、${m[3]}` : ''}）`) : 'なし'; })()
    : (() => { const m = find(/^-? ?(\d+) (shipments?) arriving this week(?:, first (.+?)(?: on (.+))?| \(first: (.+)\))$/); return m ? (m[5] ? `${m[1]} ${m[2]} (first: ${m[5]})` : `${m[1]} ${m[2]} (first: ${m[3]}${m[4] ? `, ${m[4]}` : ''})`) : 'none'; })();
  if (!filed || !waiting) return null;
  return [day, filed, waiting, overdue, arriving, url];
}

export type PushTemplateKind = 'needs_check' | 'new_deal' | 'recheck';

/** A stored "needs a check" push → which approved template it maps to and its parameters, or null (a batch, an event, unknown). */
export function pushTemplateParams(text: string): { kind: PushTemplateKind; lang: Lang; params: string[] } | null {
  const p = parsePush(text);
  if (!p.form || !p.url || !p.subject || !p.who) return null;
  const ja = p.lang === 'ja';
  if (p.form === 'recheck') return { kind: 'recheck', lang: p.lang, params: [p.who, p.subject, p.url] };
  if (p.form === 'new_deal') return { kind: 'new_deal', lang: p.lang, params: [p.who, p.subject, p.url] };
  const found = p.form === 'is_shipment' ? (ja ? 'AIMSは出荷の件かどうか判断できません。' : "AIMS isn't sure this is about a shipment at all.") : ja ? '出荷の指定が必要です。' : 'It needs a shipment.';
  const next = `${CLOSING[p.form][p.lang]} ${p.url}`;
  return { kind: 'needs_check', lang: p.lang, params: [p.who, p.subject, p.summary ? `${found} ${p.summary}` : found, next] };
}
