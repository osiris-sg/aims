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
