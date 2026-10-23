/**
 * Own text vs quoted history (round R) — pure. A reply's body carries the
 * sender's own words first and the quoted thread after a marker: ">" lines,
 * "On … wrote:", Outlook's "From: / Sent:" block, "-----Original Message-----",
 * Gmail-JP "2026年10月15日(木) 18:16 Name <addr>:", 差出人: / 送信日時:. Keys in
 * the own text count as the email's own evidence (guard 1b); keys only in the
 * quoted part are weak (an older email of the thread).
 */
const MARKERS: RegExp[] = [
  /^>/,
  /^On .+ wrote:\s*$/i,
  /^-{2,}\s*(Original Message|Forwarded message|元のメッセージ|転送メッセージ)\s*-{2,}\s*$/i,
  /^(From|差出人|送信者)\s*[:：]/i,
  /^\d{4}年\d{1,2}月\d{1,2}日.*[:：]\s*$/,
  /^\d{4}[/-]\d{1,2}[/-]\d{1,2}.*<[^<>\s]+@[^<>\s]+>.*[:：]\s*$/,
  /^.*<[^<>\s]+@[^<>\s]+>\s*(wrote|書きました|さんは書きました)[:：]?\s*$/i,
  /^_{8,}\s*$/,
];

export function isQuoteMarker(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && MARKERS.some((re) => re.test(t));
}

/** The sender's own text and the quoted history below the first marker ("" when there is no quote). */
export function splitQuoted(body: string | null | undefined): { own: string; quoted: string } {
  const lines = (body ?? '').split(/\r?\n/);
  const i = lines.findIndex((l) => isQuoteMarker(l));
  if (i < 0) return { own: (body ?? '').trim(), quoted: '' };
  // Signatures sit above the marker; keep them in "own" (harmless — no record keys).
  return { own: lines.slice(0, i).join('\n').trim(), quoted: lines.slice(i).join('\n').trim() };
}

// ── Round AF: the earlier emails a reply QUOTES (their headers), and the ones AIMS never received ──────────────

export interface QuotedHeader {
  /** The From line as written ("Name <a@b>", "名前 <a@b>", or a bare name). */
  from: string | null;
  /** The address inside it, lower-case, when there is one. */
  address: string | null;
  /** The date as parsed, or null when the line could not be read. */
  date: Date | null;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const addressOf = (s: string | null): string | null => (s ? (/<?([^<>\s,;"]+@[^<>\s,;"]+)>?/.exec(s)?.[1] ?? null)?.toLowerCase() ?? null : null);

/** "2026年10月21日(火) 18:00" / "Tuesday, 21 October 2026 18:00" / "Oct 21, 2026 at 6:00 PM" / "21 Oct 2026 18:00" → a Date (JST assumed when no zone), else null. */
export function parseQuotedDate(text: string): Date | null {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  let m = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*\([^)]*\))?\s*(\d{1,2}):(\d{2})/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]));
  m = /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5]));
  m = /(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4}),?\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
  const hour = (h: string, ampm?: string) => (ampm ? (+h % 12) + (ampm.toUpperCase() === 'PM' ? 12 : 0) : +h);
  if (m && MONTHS[m[2].toLowerCase().slice(0, 3)] !== undefined) return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1], hour(m[4], m[6]) - 9, +m[5]));
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)] !== undefined) return new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2], hour(m[4], m[6]) - 9, +m[5]));
  const d = Date.parse(t.replace(/^(On|Le|Am)\s+/i, ''));
  return Number.isNaN(d) ? null : new Date(d);
}

/**
 * The header blocks inside a quoted history, in order: Outlook-style ("From: … / Sent: …", "差出人: … / 送信日時: …"),
 * Gmail-style ("On 21 Oct 2026 at 18:00, Name <a@b> wrote:", "2026年10月21日(火) 18:00 Name <a@b>:"). Each is one
 * earlier email the reply carries. Text is data: nothing here is followed, only read.
 */
export function quotedEmailHeaders(quoted: string | null | undefined): QuotedHeader[] {
  const lines = (quoted ?? '').split(/\r?\n/).map((l) => l.replace(/^[>\s]+/, '').trim());
  const out: QuotedHeader[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = /^(?:From|差出人|送信者|De|Von)\s*[:：]\s*(.+)$/i.exec(l);
    if (m) {
      // The date sits on one of the next few lines ("Sent:", "Date:", "送信日時:", "日時:").
      let date: Date | null = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const d = /^(?:Sent|Date|送信日時|日時|Envoyé|Gesendet)\s*[:：]\s*(.+)$/i.exec(lines[j]);
        if (d) {
          date = parseQuotedDate(d[1]);
          break;
        }
      }
      out.push({ from: m[1].trim(), address: addressOf(m[1]), date });
      continue;
    }
    m = /^On\s+(.+?),?\s+(.+?)\s+wrote\s*:?\s*$/i.exec(l) ?? /^On\s+(.+?)\s+<([^>]+)>\s+wrote\s*:?\s*$/i.exec(l);
    if (m) {
      const who = l.replace(/^On\s+/i, '').replace(/\s+wrote\s*:?\s*$/i, '');
      const addr = addressOf(who);
      const date = parseQuotedDate(who);
      out.push({ from: who.replace(/\s*<[^>]*>\s*$/, '').replace(/^.*?(\d{4}),?\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)?,?\s*/i, '').trim() || who, address: addr, date });
      continue;
    }
    m = /^(\d{4}年\s*\d{1,2}月\s*\d{1,2}日(?:\s*\([^)]*\))?\s*\d{1,2}:\d{2})\s+(.+?)\s*[:：]?\s*$/.exec(l);
    if (m) {
      out.push({ from: m[2].replace(/\s*[:：]$/, '').trim(), address: addressOf(m[2]), date: parseQuotedDate(m[1]) });
      continue;
    }
  }
  // The same header twice (nested quotes repeat the chain) counts once.
  const seen = new Set<string>();
  return out.filter((h) => {
    const k = `${h.address ?? h.from ?? ''}|${h.date ? Math.round(h.date.getTime() / 60_000) : ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * How many quoted earlier emails have NO stored email in the thread: same sender address (or name when there is
 * no address) within 6 hours of the quoted date; a header without a readable date matches on the sender alone.
 */
export function missingQuotedEmails(headers: QuotedHeader[], stored: Array<{ from: string | null; date: Date | string | null }>): number {
  const rows = stored.map((s) => ({ address: addressOf(s.from), name: (s.from ?? '').replace(/<[^>]*>/, '').replace(/"/g, '').trim().toLowerCase(), date: s.date ? new Date(s.date) : null }));
  const near = (a: Date | null, b: Date | null) => !a || !b || Math.abs(a.getTime() - b.getTime()) <= 6 * 3600_000;
  let missing = 0;
  for (const h of headers) {
    const name = (h.from ?? '').replace(/<[^>]*>/, '').replace(/"/g, '').trim().toLowerCase();
    const covered = rows.some((r) => {
      const sameSender = (h.address && r.address && h.address === r.address) || (!h.address && name && r.name && (r.name.includes(name) || name.includes(r.name)));
      return sameSender && near(h.date, r.date);
    }) || (!h.address && !name && rows.some((r) => near(h.date, r.date)));
    if (!covered) missing++;
  }
  return missing;
}
