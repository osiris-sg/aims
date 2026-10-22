/**
 * WhatsApp pushes for the shipments assistant (ADH, round X, 2026-10-22) — the TEXT, pure and tested.
 *
 * Owner's rules: no emojis anywhere; short lines, one fact per line, at most ~8 lines; say what happened and what
 * to do (usually "check the Dashboard") with the link; never list auto-filed emails one by one (the count only);
 * the language follows the user's setting (EN / JA). Subjects are trimmed to ~50 chars, senders read
 * "Name (Company)" from the domain → company map, never the raw address.
 *
 * Everything here is data in, text out. Nothing turns words into actions.
 */
export type Lang = 'en' | 'ja';

const JST_OFFSET_MS = 9 * 3600_000;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}]/gu;

/** Every emoji / pictograph removed, the spacing tidied. */
export function stripEmoji(s: string): string {
  return String(s ?? '')
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, (m) => m) // keep indents
    .replace(/[ \t]+$/gm, '')
    .replace(/^\s*[·•]\s*$/gm, '')
    .trim();
}

/** "Re:【ご相談】直近のDET費用及びディテンション回避策について" → at most `n` chars + "…". */
export function trimSubject(subject: string | null | undefined, n = 50): string {
  const s = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '(no subject)';
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** The display name of a From header ("Toshiro Takekoshi <t@asiadealhub.com>" → "Toshiro Takekoshi"; a bare address → its local part). */
export function senderName(from: string | null | undefined): string {
  const s = (from ?? '').trim();
  const m = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s);
  if (m) return (m[1].trim() || m[2].split('@')[0]).trim();
  return (s.replace(/^<|>$/g, '').split('@')[0] || '?').trim();
}

/** "Toshiro Takekoshi (Asia Deal Hub)" — the company from the domain map; a domain alone when unmapped. */
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

export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

// ── (a) the morning digest ───────────────────────────────────────────────────

export type DigestInput = {
  /** JST now (the header's date). */
  at: Date;
  /** Emails filed by themselves since yesterday's digest — the COUNT only, never listed. */
  filedAuto: number;
  /** The Dashboard's own numbers: questions (threads waiting for a person) and the emails behind them. */
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
  return `${ref} ${clip(rest, 24)}`.trim();
}

export function digestText(d: DigestInput, lang: Lang = 'en'): string {
  const ja = lang === 'ja';
  const lines: string[] = [ja ? `おはようございます。${dayLabel(d.at, 'ja')}` : `Good morning. ${dayLabel(d.at, 'en')}`];
  lines.push(ja ? `- メール ${d.filedAuto} 件を自動処理` : `- ${d.filedAuto} email${d.filedAuto === 1 ? '' : 's'} filed automatically`);
  if (d.questions > 0) lines.push(ja ? `- ${d.questions} 件の確認が必要です（メール ${d.questionEmails} 件）` : `- ${d.questions} need${d.questions === 1 ? 's' : ''} your check (${d.questionEmails} email${d.questionEmails === 1 ? '' : 's'})`);
  else lines.push(ja ? '- 確認が必要なものはありません' : '- Nothing needs your check');
  if (d.overdue.length) {
    const shown = d.overdue.slice(0, 3).join(ja ? '、' : ', ');
    const more = d.overdue.length > 3 ? (ja ? ` ほか ${d.overdue.length - 3} 件` : ` and ${d.overdue.length - 3} more`) : '';
    lines.push(ja ? `- 期限超過のタスク ${d.overdue.length} 件: ${shown}${more}` : `- ${d.overdue.length} task${d.overdue.length === 1 ? '' : 's'} overdue: ${shown}${more}`);
  }
  if (d.arriving.length) {
    const first = d.arriving[0];
    const when = etaLabel(first.eta, lang);
    lines.push(ja ? `- 今週到着 ${d.arriving.length} 件（最初: ${first.ref}${when ? `、${when}` : ''}）` : `- ${d.arriving.length} shipment${d.arriving.length === 1 ? '' : 's'} arriving this week (first: ${first.ref}${when ? `, ${when}` : ''})`);
  }
  lines.push(ja ? `ダッシュボードを開く: ${d.portalUrl}` : `Open the Dashboard: ${d.portalUrl}`);
  return stripEmoji(lines.join('\n'));
}

// ── (b) (c) (d) an email needs a person ──────────────────────────────────────

export type NeedsCheckInput = {
  kind: 'CONFIRM' | 'WHICH' | 'CHECK' | 'IS_SHIPMENT' | 'NEW_DEAL' | 'RECHECK';
  from: string | null;
  company: string | null;
  date: Date | string | null;
  subject: string | null;
  /** The card's options in order (reply 1..n). */
  options: Array<{ ref: string }>;
  /** CHECK: what the subject says ("6063"). */
  says?: string | null;
  portalUrl: string;
};

const link = (lang: Lang, url: string, what: 'check' | 'confirm' | 'open') =>
  lang === 'ja'
    ? what === 'confirm' ? `ダッシュボードで出荷を確認してください: ${url}` : what === 'open' ? `ダッシュボードを開く: ${url}` : `ダッシュボードで確認: ${url}`
    : what === 'confirm' ? `Please confirm the shipment on the Dashboard: ${url}` : what === 'open' ? `Open the Dashboard: ${url}` : `check it on the Dashboard: ${url}`;

/** The "Reply 1 for #16-1, 2 for #16-2, or check it on the Dashboard: <link>" line. */
function replyLine(i: NeedsCheckInput, lang: Lang): string {
  const ja = lang === 'ja';
  const opts = i.options.slice(0, 4);
  if (i.kind === 'IS_SHIPMENT') return ja ? `出荷の件なら 1、違えば X と返信、または${link('ja', i.portalUrl, 'check')}` : `Reply 1 if it is, X if not, or ${link('en', i.portalUrl, 'check')}`;
  if (!opts.length) return ja ? link('ja', i.portalUrl, 'check') : `Check it on the Dashboard: ${i.portalUrl}`;
  if (opts.length === 1) return ja ? `${opts[0].ref} なら 1 と返信、または${link('ja', i.portalUrl, 'check')}` : `Reply 1 to confirm ${opts[0].ref}, or ${link('en', i.portalUrl, 'check')}`;
  const list = opts.map((o, n) => (ja ? `${o.ref} なら ${n + 1}` : `${n + 1} for ${o.ref}`));
  return ja ? `${list.join('、')} と返信、または${link('ja', i.portalUrl, 'check')}` : `Reply ${list.join(', ')}, or ${link('en', i.portalUrl, 'check')}`;
}

/** One push for one email, by card kind (b: CONFIRM / WHICH / CHECK / IS_SHIPMENT; c: NEW_DEAL; d: RECHECK). */
export function needsCheckText(i: NeedsCheckInput, lang: Lang = 'en'): string {
  const ja = lang === 'ja';
  const who = senderLine(i.from, i.company);
  const when = dateLabel(i.date, lang, i.kind !== 'NEW_DEAL' && i.kind !== 'RECHECK');
  const subject = trimSubject(i.subject);
  const refs = i.options.map((o) => o.ref);
  const lines: string[] = [];
  if (i.kind === 'NEW_DEAL') {
    lines.push(ja ? `${who} から新しいメール、${when}` : `New email from ${who}, ${when}`);
    lines.push(ja ? `件名: ${subject}` : `Subject: ${subject}`);
    lines.push(ja ? 'AIMSにまだない新しい案件のようです。' : "This looks like a new deal that isn't in AIMS yet.");
    lines.push(link(lang, i.portalUrl, 'check').replace(/^check/, 'Check'));
    return stripEmoji(lines.join('\n'));
  }
  if (i.kind === 'RECHECK') {
    lines.push(ja ? 'AIMSがメールを再確認したところ、確信が持てなくなりました' : "AIMS re-checked an email and isn't sure anymore");
    lines.push(ja ? `差出人: ${who}、${when}` : `From: ${who}, ${when}`);
    lines.push(ja ? `件名: ${subject}` : `Subject: ${subject}`);
    lines.push(link(lang, i.portalUrl, 'confirm'));
    return stripEmoji(lines.join('\n'));
  }
  lines.push(ja ? '新しいメールの確認が必要です' : 'New email needs your check');
  lines.push(ja ? `差出人: ${who}、${when}` : `From: ${who}, ${when}`);
  lines.push(ja ? `件名: ${subject}` : `Subject: ${subject}`);
  const or = (xs: string[]) => (ja ? xs.join(' か ') : xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
  if (i.kind === 'WHICH') lines.push(refs.length ? (ja ? `AIMSはどの出荷の件か判断できません: ${or(refs.slice(0, 4))}。` : `AIMS isn't sure which shipment this is for: ${or(refs.slice(0, 4))}.`) : ja ? 'AIMSはどの出荷の件か判断できません。' : "AIMS isn't sure which shipment this is for.");
  else if (i.kind === 'CHECK') lines.push(ja ? `件名は「${i.says ?? '?'}」ですが、AIMSは ${refs[0] ?? '?'} と判断しました。` : `The subject says ${i.says ?? '?'}, but AIMS matched ${refs[0] ?? '?'}.`);
  else if (i.kind === 'IS_SHIPMENT') lines.push(ja ? 'AIMSは出荷の件かどうか判断できません。' : "AIMS isn't sure this is about a shipment at all.");
  else lines.push(refs[0] ? (ja ? `AIMSは ${refs[0]} の件だと思いますが、確信がありません。` : `AIMS thinks this is about ${refs[0]} but isn't sure.`) : ja ? 'AIMSは確信が持てません。' : "AIMS isn't sure about this one.");
  lines.push(replyLine(i, lang));
  return stripEmoji(lines.join('\n'));
}

/** The one-line form used when several pushes go out together: "Mitsui Soko · 11月納入 Kato… · which shipment?". */
export function needsCheckLine(i: NeedsCheckInput, lang: Lang = 'en'): string {
  const ja = lang === 'ja';
  const who = (i.company ?? '').trim() || senderName(i.from);
  const q =
    i.kind === 'WHICH' ? (ja ? 'どの出荷？' : 'which shipment?')
    : i.kind === 'CHECK' ? (ja ? `${i.options[0]?.ref ?? '?'} で合っている？` : `is it ${i.options[0]?.ref ?? '?'}?`)
    : i.kind === 'IS_SHIPMENT' ? (ja ? '出荷の件？' : 'about a shipment?')
    : i.kind === 'NEW_DEAL' ? (ja ? '新しい案件？' : 'new deal?')
    : i.kind === 'RECHECK' ? (ja ? '再確認' : 're-check')
    : ja ? `${i.options[0]?.ref ?? '?'} の件？` : `is it ${i.options[0]?.ref ?? '?'}?`;
  return `${who} · ${trimSubject(i.subject, 30)} · ${q}`;
}

/** Several "needs a check" pushes due together → one message, one line each, no reply codes. */
export function needsCheckBatchText(items: NeedsCheckInput[], lang: Lang = 'en'): string {
  if (items.length === 1) return needsCheckText(items[0], lang);
  const ja = lang === 'ja';
  const lines = [ja ? `新しいメール ${items.length} 件の確認が必要です` : `${items.length} new emails need your check`];
  for (const i of items.slice(0, 6)) lines.push(`- ${needsCheckLine(i, lang)}`);
  if (items.length > 6) lines.push(ja ? `- ほか ${items.length - 6} 件` : `- and ${items.length - 6} more`);
  lines.push(ja ? `ダッシュボードで確認: ${items[0].portalUrl}` : `Check them on the Dashboard: ${items[0].portalUrl}`);
  return stripEmoji(lines.join('\n'));
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

/** Several event lines due together: the lines, then the Dashboard link once. */
export function eventsBatchText(lines: string[], portalUrl: string, lang: Lang = 'en'): string {
  const out = lines.map((l) => stripEmoji(l)).filter(Boolean).slice(0, 7);
  if (lines.length > 7) out.push(lang === 'ja' ? `ほか ${lines.length - 7} 件` : `and ${lines.length - 7} more`);
  out.push(lang === 'ja' ? `ダッシュボードを開く: ${portalUrl}` : `Open the Dashboard: ${portalUrl}`);
  return out.join('\n');
}

/** Lines that read as "needs a check" pushes (their first line) — the outbox batches those separately from events. */
export const isNeedsCheckPush = (text: string) => /^(New email needs your check|新しいメールの確認が必要です|New email from .*|.* から新しいメール、.*|AIMS re-checked|AIMSがメールを再確認)/.test(text.split('\n')[0] ?? '');

/**
 * A stored "needs a check" push → its one-line form, read back from our own stable layout (the outbox keeps
 * text only). Lines: title / From: … / Subject: … / the question / the reply line.
 */
export function pushToLine(text: string, lang: Lang = 'en'): string {
  const ls = text.split('\n');
  const get = (re: RegExp) => ls.map((l) => re.exec(l)?.[1] ?? null).find((x): x is string => !!x) ?? null;
  const from = get(/^(?:From|差出人): (.*?)(?:, |、)\d/) ?? get(/^(?:New email from|.*?から新しいメール)\s*(.*?)(?:, |、)\d/) ?? get(/^(.*?) から新しいメール/) ?? '?';
  const company = /\(([^()]+)\)\s*$/.exec(from)?.[1] ?? from;
  const subject = get(/^(?:Subject|件名): (.*)$/) ?? '';
  const title = ls[0] ?? '';
  const q = /re-checked|再確認/.test(title) ? (lang === 'ja' ? '再確認' : 're-check')
    : /New email from|から新しいメール/.test(title) ? (lang === 'ja' ? '新しい案件？' : 'new deal?')
    : /isn't sure which|どの出荷の件か/.test(text) ? (lang === 'ja' ? 'どの出荷？' : 'which shipment?')
    : /about a shipment at all|出荷の件かどうか/.test(text) ? (lang === 'ja' ? '出荷の件？' : 'about a shipment?')
    : (() => { const r = /(?:matched|thinks this is about|AIMSは) (#\d+(?:-\d+)?)/.exec(text)?.[1]; return r ? (lang === 'ja' ? `${r} の件？` : `is it ${r}?`) : lang === 'ja' ? '確認' : 'check'; })();
  return `${company} · ${trimSubject(subject, 30)} · ${q}`;
}

/** The whole due batch of one user: "needs a check" pushes together, event lines together. */
export function batchText(items: Array<{ text: string }>, lang: Lang = 'en', portalUrl?: string): string {
  const texts = items.map((i) => stripEmoji(i.text)).filter(Boolean);
  if (texts.length === 1) return clip(texts[0], 3500);
  const needs = texts.filter(isNeedsCheckPush);
  const rest = texts.filter((t) => !isNeedsCheckPush(t));
  const url = portalUrl ?? /(https?:\/\/\S+)\s*$/.exec(texts.map((t) => t.split('\n').pop() ?? '').find((l) => /https?:\/\//.test(l)) ?? '')?.[1] ?? '';
  const parts: string[] = [];
  if (needs.length === 1) parts.push(needs[0]);
  else if (needs.length > 1) {
    const ja = lang === 'ja';
    const lines = [ja ? `新しいメール ${needs.length} 件の確認が必要です` : `${needs.length} new emails need your check`, ...needs.slice(0, 6).map((t) => `- ${pushToLine(t, lang)}`)];
    if (needs.length > 6) lines.push(ja ? `- ほか ${needs.length - 6} 件` : `- and ${needs.length - 6} more`);
    lines.push(ja ? `ダッシュボードで確認: ${url}` : `Check them on the Dashboard: ${url}`);
    parts.push(lines.join('\n'));
  }
  if (rest.length) parts.push(rest.length === 1 && rest[0].includes('\n') ? rest[0] : eventsBatchText(rest.map((t) => t.split('\n')[0]), url, lang));
  return clip(parts.join('\n\n'), 3500);
}
