/**
 * Company name from the sender's domain (round W, owner's C.4): the Inbox "Company" chip shows
 * "Isewan" for isewan.co.jp, not the counterparty code ("OTHER"). An unknown domain shows the
 * domain itself (gmail.com, example.com) — never "OTHER". The org's own list (Settings → Shipping →
 * Email filter → Companies) wins over the built-ins; built-ins come from the counterparty rules
 * (email-triage.rules.ts), the sender filter's ADH list (email-filter.rules.ts) and the carriers
 * (trade-carrier.ts). Display names in the From header are untrusted data and are never used.
 */
import { emailOf } from './email-triage.rules';

/** Built-in domain → company name. Keep every key lower-case and apex (no "www.", no "@"). */
export const DEFAULT_COMPANIES: Record<string, string> = {
  // Supplier / customers / forwarder (counterparty rules + ADH's sender filter list)
  'vedanta.co.in': 'Vedanta',
  'sus.co.jp': 'SUS',
  'katokei.co.jp': 'Kato',
  'mitsui-soko.co.jp': 'Mitsui Soko',
  'isewan.co.jp': 'Isewan',
  'shippio.io': 'Shippio',
  'asiadealhub.com': 'Asia Deal Hub',
  // Shipping lines (SHIPPING_LINES in the triage rules + CARRIERS in trade-carrier.ts)
  'wanhai.com': 'Wan Hai',
  'ekmtc.com': 'KMTC',
  'maersk.com': 'Maersk',
  'msc.com': 'MSC',
  'sitcline.com': 'SITC',
  'rclgroup.com': 'RCL',
  'evergreen-line.com': 'Evergreen',
  'shipmentlink.com': 'Evergreen',
  'one-line.com': 'ONE',
  'cosco.com': 'COSCO',
  'coscoshipping.com': 'COSCO',
  'hapag-lloyd.com': 'Hapag-Lloyd',
  'oocl.com': 'OOCL',
  'cma-cgm.com': 'CMA CGM',
  'yangming.com': 'Yang Ming',
  'hmm21.com': 'HMM',
  'zim.com': 'ZIM',
};

/** Public mailbox providers: the domain is the "company" — a person, not an organisation. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.jp',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.de',
  'mail.com',
  'zoho.com',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
  'daum.net',
  'docomo.ne.jp',
  'ezweb.ne.jp',
  'softbank.ne.jp',
  'i.softbank.jp',
  'au.com',
]);

/** A domain the override list accepts: lower-case labels, a dot, a 2+ letter TLD. */
export const COMPANY_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
/** Round AC: a key of the org's list — a domain, or ONE exact address (a counterparty on free mail: purchasing@gmail.com → "SIAE"). */
export const COMPANY_KEY_RE = /^(?:[a-z0-9._%+-]+@)?[a-z0-9.-]+\.[a-z]{2,}$/;
export const COMPANY_NAME_MAX = 60;
export const COMPANY_LIST_MAX = 200;

export interface CompanyOf {
  /** What the chip shows: the company, or the bare domain when unknown. Never "OTHER". */
  name: string;
  /** The sender's domain, lower-case (null when the address cannot be parsed). */
  domain: string | null;
  /** true when the name came from the org's list or the built-ins (false = the domain itself). */
  known: boolean;
}

/** First exact match on the domain, then on each parent domain (mail.sus.co.jp → sus.co.jp). */
function lookup(domain: string, map: Record<string, string> | undefined): string | null {
  if (!map) return null;
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const v = map[parts.slice(i).join('.')];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * The company behind an email address. `overrides` is the org's own domain → name list (wins over the
 * built-ins). Unknown / free-mail → the domain as the name; garbage / null → "—" with no domain.
 */
export function companyOf(from: string | null | undefined, overrides?: Record<string, string>): CompanyOf {
  const addr = emailOf(from);
  const domain = (addr.split('@')[1] ?? '').trim().toLowerCase() || null;
  if (!domain) return { name: '—', domain: null, known: false };
  // Round AC: an exact address in the org's list wins (one gmail mailbox → its company, not all of gmail.com).
  const exact = overrides?.[addr.trim().toLowerCase()];
  if (typeof exact === 'string' && exact.trim()) return { name: exact.trim(), domain, known: true };
  if (FREE_MAIL_DOMAINS.has(domain)) {
    const o = lookup(domain, overrides);
    return o ? { name: o, domain, known: true } : { name: domain, domain, known: false };
  }
  const name = lookup(domain, overrides) ?? lookup(domain, DEFAULT_COMPANIES);
  return name ? { name, domain, known: true } : { name: domain, domain, known: false };
}

/**
 * Validate an org's override list (Settings → Email filter → Companies): lower-case domains or exact addresses
 * (round AC), names of 1–60 characters, at most 200 rows. Returns the clean map or throws with a message naming the row.
 */
export function cleanCompanyOverrides(v: unknown, fail: (msg: string) => never): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('emailCompanies must map a domain to a company name');
  const out: Record<string, string> = {};
  for (const [rawDomain, rawName] of Object.entries(v as Record<string, unknown>)) {
    const domain = String(rawDomain).trim().toLowerCase().replace(/^@/, '');
    if (!COMPANY_KEY_RE.test(domain) || domain.length > 253) fail(`"${String(rawDomain).slice(0, 80)}" is not an email domain or address (like isewan.co.jp or purchasing@gmail.com)`);
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name.length > COMPANY_NAME_MAX) fail(`The company name for ${domain} must be 1–${COMPANY_NAME_MAX} characters`);
    out[domain] = name;
  }
  if (Object.keys(out).length > COMPANY_LIST_MAX) fail(`At most ${COMPANY_LIST_MAX} companies`);
  return out;
}

/** The org's list out of TradeSetting.docDefaults (where it is stored as docDefaults.emailCompanies). */
export function companyOverridesOf(docDefaults: Record<string, unknown> | null | undefined): Record<string, string> {
  const v = docDefaults?.emailCompanies;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === 'string' && n.trim()).map(([d, n]) => [d.toLowerCase(), String(n).trim()]));
}
