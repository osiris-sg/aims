/**
 * WhatsApp pushes for the shipments assistant (ADH) — the TEXT, pure and tested.
 *
 * Round AE (owner, 2026-10-23): the ONLY message AIMS sends on its own is "an email needs your answer", and it looks
 * the SAME every time, inside or outside the 24-hour window — so the plain text IS the template body with its
 * parameters filled in (ANSWER_TEMPLATES below is also what scripts/whatsapp-templates.ts submits). One family,
 * UTILITY, EN + JA: aims_answer (needs a shipment), aims_answer_deal, aims_answer_is_shipment, aims_answer_recheck,
 * aims_answer_batch (several within 10 minutes). No emojis, no greeting, no "Sent by AIMS", no "…".
 *
 * The digest and the event lines stay in the code (owner: keep it, default off) — see shipments-agent.rules.ts.
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

// ── (a) the morning digest (kept; off by default since round AE) ─────────────

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

// ── (b) the ONE message: "an email needs your answer" ────────────────────────

export type AnswerVariant = 'answer' | 'answer_deal' | 'answer_is_shipment' | 'answer_recheck';
export type AnswerTemplateKind = AnswerVariant | 'answer_batch';

export type NeedsCheckInput = {
  kind: 'CONFIRM' | 'WHICH' | 'CHECK' | 'IS_SHIPMENT' | 'NEW_DEAL' | 'RECHECK';
  from: string | null;
  company: string | null;
  date: Date | string | null;
  subject: string | null;
  /** The card's options in order (not shown — the person answers with the shipment number). */
  options: Array<{ ref: string }>;
  /** Unused since round AA, kept for callers. */
  says?: string | null;
  /** The stored one-line summary of the email (display text only). */
  summary?: string | null;
  portalUrl: string;
};

export const variantOf = (kind: NeedsCheckInput['kind']): AnswerVariant => (kind === 'NEW_DEAL' ? 'answer_deal' : kind === 'RECHECK' ? 'answer_recheck' : kind === 'IS_SHIPMENT' ? 'answer_is_shipment' : 'answer');

/**
 * The template bodies, EXACTLY as submitted to Meta (one {{n}} per value, a value never holds a newline, no variable
 * first or last). {{1}} company · {{2}} date time · {{3}} full subject · {{4}} one-sentence summary · {{5}} short link.
 * The plain-text push is renderTemplate(body, params) — identical to what the template shows.
 */
export const ANSWER_TEMPLATES: Record<AnswerTemplateKind, Record<Lang, string>> = {
  answer: {
    en: 'New email needs your answer\nFrom {{1}} · {{2}}\nSubject: {{3}}\nSummary: {{4}}\nReply with the shipment number, or open AIMS: {{5}} to answer.',
    ja: '新しいメールへの回答が必要です\n差出人 {{1}} · {{2}}\n件名: {{3}}\n要約: {{4}}\n出荷番号で返信するか、AIMS（{{5}}）を開いて回答してください。',
  },
  answer_deal: {
    en: "New email needs your answer\nFrom {{1}} · {{2}}\nSubject: {{3}}\nSummary: {{4}}\nReply NEW to create the order or X if it's not a deal, or open AIMS: {{5}} to answer.",
    ja: '新しいメールへの回答が必要です\n差出人 {{1}} · {{2}}\n件名: {{3}}\n要約: {{4}}\nNEW と返信すると注文を作成、案件でなければ X と返信、またはAIMS（{{5}}）を開いて回答してください。',
  },
  answer_is_shipment: {
    en: "New email needs your answer\nFrom {{1}} · {{2}}\nSubject: {{3}}\nSummary: {{4}}\nReply X if it's not about a shipment or send the shipment number, or open AIMS: {{5}} to answer.",
    ja: '新しいメールへの回答が必要です\n差出人 {{1}} · {{2}}\n件名: {{3}}\n要約: {{4}}\n出荷の件でなければ X と返信、出荷の件なら出荷番号を送るか、AIMS（{{5}}）を開いて回答してください。',
  },
  answer_recheck: {
    en: "AIMS isn't sure about an email anymore\nFrom {{1}} · {{2}}\nSubject: {{3}}\nSummary: {{4}}\nReply with the shipment number, or open AIMS: {{5}} to answer.",
    ja: 'AIMSがメールについて確信が持てなくなりました\n差出人 {{1}} · {{2}}\n件名: {{3}}\n要約: {{4}}\n出荷番号で返信するか、AIMS（{{5}}）を開いて回答してください。',
  },
  // Several within 10 minutes. A value cannot hold a line break, so: the count, the latest email, the link.
  answer_batch: {
    en: 'You have {{1}} new emails that need your answer. Latest: {{2}} · {{3}}. Open AIMS to answer them: {{4}} and reply with the shipment numbers.',
    ja: '新しいメール {{1}} 件への回答が必要です。最新: {{2}} · {{3}}。AIMS（{{4}}）を開いて回答するか、出荷番号で返信してください。',
  },
};
/** Meta template names, one per variant (UTILITY, en + ja). */
export const ANSWER_TEMPLATE_NAME: Record<AnswerTemplateKind, string> = { answer: 'aims_answer', answer_deal: 'aims_answer_deal', answer_is_shipment: 'aims_answer_is_shipment', answer_recheck: 'aims_answer_recheck', answer_batch: 'aims_answer_batch' };
/** Quick-reply buttons proposed per variant (the tap arrives as the button's text and is read like a typed reply). */
export const ANSWER_TEMPLATE_BUTTONS: Record<AnswerTemplateKind, Record<Lang, string[]>> = {
  answer: { en: ['Not a shipment', 'Ask later'], ja: ['出荷ではない', '後で'] },
  answer_deal: { en: ['Create order', 'Not a deal', 'Ask later'], ja: ['注文を作成', '案件ではない', '後で'] },
  answer_is_shipment: { en: ['Not a shipment', 'Ask later'], ja: ['出荷ではない', '後で'] },
  answer_recheck: { en: ['Ask later'], ja: ['後で'] },
  answer_batch: { en: [], ja: [] },
};

/** A template value: one line, no emoji, never empty ("-"). */
export const templateValue = (v: string | null | undefined): string => stripEmoji(String(v ?? '')).replace(/\s+/g, ' ').trim() || '-';

export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => templateValue(params[Number(n) - 1]));
}

/** The five values of a single push: [company, date time, subject, summary, link]. */
export function answerParamsOf(i: NeedsCheckInput, lang: Lang): string[] {
  return [senderWho(i.from, i.company), dateLabel(i.date, lang, true), cleanSubject(i.subject), i.summary ?? '', i.portalUrl].map(templateValue);
}

/** ONE push for ONE email — the template body with its values (what a template send shows, and the plain text inside the window). */
export function needsCheckText(i: NeedsCheckInput, lang: Lang = 'en'): string {
  return renderTemplate(ANSWER_TEMPLATES[variantOf(i.kind)][lang], answerParamsOf(i, lang));
}
export const answerText = needsCheckText;

/** The batch: [count, "company · date time" of the latest, its subject, link]. */
export function answerBatchParamsOf(count: number, latest: { who: string; when: string; subject: string }, url: string): string[] {
  return [String(count), `${latest.who} · ${latest.when}`, cleanSubject(latest.subject), url].map(templateValue);
}
export function answerBatchText(count: number, latest: { who: string; when: string; subject: string }, url: string, lang: Lang = 'en'): string {
  return renderTemplate(ANSWER_TEMPLATES.answer_batch[lang], answerBatchParamsOf(count, latest, url));
}
/** Kept for callers: several inputs → the batch text. */
export function needsCheckBatchText(items: NeedsCheckInput[], lang: Lang = 'en'): string {
  if (items.length === 1) return needsCheckText(items[0], lang);
  const latest = [...items].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())[0];
  return answerBatchText(items.length, { who: senderWho(latest.from, latest.company), when: dateLabel(latest.date, lang, true), subject: cleanSubject(latest.subject) }, items[0].portalUrl, lang);
}

const VARIANTS: AnswerVariant[] = ['answer', 'answer_deal', 'answer_is_shipment', 'answer_recheck'];
/** The fixed words of a variant's LAST line (the variables removed) — tells the variants with a shared title apart. */
const lastFixed = (k: AnswerVariant, l: Lang) => ANSWER_TEMPLATES[k][l].split('\n').pop()!.split(/\{\{\d+\}\}/)[0].trim();

export interface ParsedAnswerPush {
  variant: AnswerVariant;
  lang: Lang;
  /** [company, date time, subject, summary, url] — the template's values, read back from the stored text. */
  params: string[];
  who: string;
  when: string;
  subject: string;
  summary: string;
  url: string;
}

/**
 * A stored push (the outbox keeps text only) → its template kind and values. The title and the fixed words of the last
 * line decide the variant. null = not a round AE push (an older row, an event line).
 */
export function parseAnswerPush(text: string): ParsedAnswerPush | null {
  const ls = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (ls.length < 5) return null;
  const title = ls[0];
  const lang: Lang = JA_RE.test(title) ? 'ja' : 'en';
  const last = ls[ls.length - 1];
  const variant = VARIANTS.find((k) => ANSWER_TEMPLATES[k][lang].split('\n')[0] === title && last.startsWith(lastFixed(k, lang))) ?? null;
  if (!variant) return null;
  const from = /^(?:From|差出人) (.+?) · (.+)$/.exec(ls[1]);
  const subject = /^(?:Subject|件名): (.*)$/.exec(ls[2])?.[1];
  const summary = /^(?:Summary|要約): (.*)$/.exec(ls[3])?.[1];
  const url = /https?:\/\/[^\s）)。]+/.exec(last)?.[0]?.replace(/[.,]+$/, '') ?? '';
  if (!from || subject === undefined || summary === undefined || !url) return null;
  return { variant, lang, params: [from[1], from[2], subject, summary, url], who: from[1], when: from[2], subject, summary, url };
}

/** Lines that read as "needs an answer" pushes (their first line) — the outbox handles those on the template path. */
export const isNeedsCheckPush = (text: string) => {
  const first = (text.split('\n')[0] ?? '').trim();
  return VARIANTS.some((k) => ANSWER_TEMPLATES[k].en.split('\n')[0] === first || ANSWER_TEMPLATES[k].ja.split('\n')[0] === first) || /^You have \d+ new emails|^新しいメール \d+ 件への回答/.test(first);
};

// ── (e) events, one line each (kept; off by default since round AE) ──────────

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

const andMore = (n: number, lang: Lang) => (lang === 'ja' ? `ほか ${n} 件` : `and ${n} more`);

/** Several event lines due together: the lines, a blank line, the link once. */
export function eventsBatchText(lines: string[], portalUrl: string, lang: Lang = 'en'): string {
  const out = lines.map((l) => stripEmoji(l)).filter(Boolean).slice(0, 7);
  if (lines.length > 7) out.push(andMore(lines.length - 7, lang));
  return sections([out.join('\n'), portalUrl]);
}

/** The event rows of one user due together (the answer pushes take the template path in the outbox). */
export function batchText(items: Array<{ text: string }>, lang: Lang = 'en', portalUrl?: string): string {
  const texts = items.map((i) => stripEmoji(i.text)).filter(Boolean);
  if (texts.length === 1) return clip(texts[0], WHATSAPP_MAX);
  const url = portalUrl ?? texts.map((t) => URL_RE.exec(t)?.[1]).find((u): u is string => !!u) ?? '';
  return clip(eventsBatchText(texts.map((t) => t.split('\n')[0]), url, lang), WHATSAPP_MAX);
}

// ── the digest template (kept): one parameter per line ───────────────────────

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
