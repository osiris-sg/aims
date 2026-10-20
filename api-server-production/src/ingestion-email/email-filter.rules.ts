/**
 * Shipments intake sender filter (2026-10). The worker forwards Sayaka's whole mailbox; this decides which mail
 * the intake keeps. SHADOW first: decide + log ("would drop"), keep everything; ENFORCE drops before storage.
 *
 * Keep an email when ANY of:
 *   - a participant (from / to / cc) is an allowed domain / address — the org's own addresses don't count on
 *     their own (every email has one);
 *   - the subject or an attachment name carries a shipment key (B/L 198GX… / 22AA… / KMTC… / MEDU… / SITG… /
 *     GGVC…, contract 4540…, PI 9331…, CI XP26… / 9000…);
 *   - it is on a thread already matched to an order.
 * Internal-only mail (everyone @ the org's own domains) is therefore kept only with a key or a matched thread.
 * Pure.
 */
export type FilterMode = 'OFF' | 'SHADOW' | 'ENFORCE';
export const FILTER_MODES: FilterMode[] = ['OFF', 'SHADOW', 'ENFORCE'];

export interface FilterInput {
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  attachmentNames: string[];
  /** An earlier email of the thread is matched to an order (its "#19"), else null. */
  threadOrder: string | null;
}

export interface FilterConfig {
  allowDomains: string[];
  allowAddresses: string[];
}

export interface FilterDecision {
  keep: boolean;
  reason: string;
}

/** Shipment keys in a subject / file name: carrier B/Ls, contract, PI and CI numbers. */
export const SHIPMENT_KEY_RES: Array<[RegExp, string]> = [
  [/\d{3}[A-Z]{2}\d{5}/i, 'B/L'],
  [/\bKMTC[A-Z0-9]{6,}/i, 'B/L (KMTC)'],
  [/\bMEDU[A-Z0-9]{6,}/i, 'B/L (MSC)'],
  [/\bSITG[A-Z0-9]{6,}/i, 'B/L (SITC)'],
  [/\bGGVC[A-Z0-9]{6,}/i, 'B/L (RCL)'],
  [/(?<!\d)4540\d{5}(?!\d)/, 'contract'],
  [/(?<!\d)933\d{7}(?!\d)/, 'PI'],
  [/\bXP\d{10}\b/i, 'CI'],
  [/(?<!\d)9000\d{6}(?!\d)/, 'CI'],
];

/** "Name <a@b.c>" / "a@b.c" / { address } → "a@b.c". */
export const addressOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v : v && typeof v === 'object' && 'address' in (v as object) ? String((v as { address: unknown }).address ?? '') : '';
  return (/<?([^<>\s,;"]+@[^<>\s,;"]+)>?/.exec(s)?.[1] ?? '').toLowerCase();
};
const domainOf = (addr: string) => addr.split('@')[1] ?? '';
const underDomain = (d: string, allowed: string) => d === allowed || d.endsWith(`.${allowed}`);

/** The first shipment key in the subject / attachment names, as "B/L 198GX04630" (null = none). */
export function shipmentKeyIn(subject: string | null, attachmentNames: string[]): string | null {
  for (const text of [subject ?? '', ...attachmentNames]) {
    const t = text.normalize('NFKC');
    for (const [re, label] of SHIPMENT_KEY_RES) {
      const m = re.exec(t);
      if (m) return `${label} ${m[0]}`;
    }
  }
  return null;
}

/** Normalise a typed allow-list: lower case, no "@" prefix / spaces, valid-looking, unique. */
export function cleanAllowList(list: unknown, kind: 'domain' | 'address'): string[] {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[\s,;]+/) : [];
  const out = arr
    .map((x) =>
      String(x ?? '')
        .trim()
        .toLowerCase(),
    )
    .map((x) => (kind === 'domain' ? x.replace(/^@/, '') : x))
    .filter((x) => (kind === 'domain' ? /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(x) : /^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(x)));
  return [...new Set(out)];
}

export function filterDecision(e: FilterInput, cfg: FilterConfig, ownDomains: string[]): FilterDecision {
  const own = (a: string) => ownDomains.some((o) => underDomain(domainOf(a), o));
  // The intake address itself (docs+…@) is never a participant that counts.
  const people = [e.from, ...e.to, ...e.cc].map(addressOf).filter((a) => a && !/^docs\+/i.test(a));
  const external = people.filter((a) => !own(a));
  const addresses = new Set(cfg.allowAddresses.map((a) => a.toLowerCase()));
  const hitAddr = external.find((a) => addresses.has(a));
  if (hitAddr) return { keep: true, reason: `allowed address ${domainOf(hitAddr)}` };
  const hitDomain = external.find((a) => cfg.allowDomains.some((d) => underDomain(domainOf(a), d.toLowerCase())));
  if (hitDomain) return { keep: true, reason: `allowed domain ${domainOf(hitDomain)}` };
  const key = shipmentKeyIn(e.subject, e.attachmentNames);
  if (key) return { keep: true, reason: `shipment key ${key}` };
  if (e.threadOrder) return { keep: true, reason: `thread matched to ${e.threadOrder}` };
  if (!external.length) return { keep: false, reason: 'internal only, no shipment key or matched thread' };
  return { keep: false, reason: `not on the allow-list (${[...new Set(external.map(domainOf))].slice(0, 3).join(', ')})` };
}

// ── ADH Japan's seed (scripts/setup-adh-org.ts; editable in Settings → Shipping → Email filter) ──────────
export const ADH_FILTER_ALLOW_DOMAINS = [
  'vedanta.co.in',
  'mitsui-soko.co.jp',
  'sus.co.jp',
  'katokei.co.jp',
  'wanhai.com',
  'isewan.co.jp',
  'shippio.io',
  'ekmtc.com',
  'maersk.com',
  'msc.com',
  'sitcline.com',
  'rclgroup.com',
  'evergreen-line.com',
];
export const ADH_FILTER_NOTES: Record<string, string> = {
  'shippio.io': 'not seen in stored mail yet',
  'ekmtc.com': 'unverified (KMTC)',
  'maersk.com': 'unverified (Maersk)',
  'msc.com': 'unverified (MSC)',
  'sitcline.com': 'unverified (SITC)',
  'rclgroup.com': 'unverified (RCL)',
  'evergreen-line.com': 'unverified (Evergreen)',
  Hoei: 'add when known',
  Inalum: 'add when known',
};
