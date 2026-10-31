/**
 * Round AY part 3 — Clients: company details, contacts and logistics of a customer / supplier, and the Shipping lines
 * tab. Stored on what exists: Customer / Supplier columns (name, address, email, phone, tax no., currency; a
 * customer's 日本語名 / 住所), CustomerContact rows (a customer's contacts), and the trade profiles
 * (TradeSetting.customerProfiles / supplierProfiles): `company` (country, website, payment terms, bank, notes; a
 * supplier's Japanese legal name), `logistics` (shipping lines used, B/L / booking number patterns, ports, incoterm),
 * a supplier's `contacts`, a customer contact's language (`contactLangs`). Shipping lines: TradeSetting.shippingLines
 * keyed by carrier code — the carriers AIMS already knows (trade-carrier.ts) plus lines added here. Pure.
 */
export interface BankInfo {
  bankName?: string;
  branch?: string;
  accountName?: string;
  accountNo?: string;
  swift?: string;
}
export interface CompanyInfo {
  country?: string;
  website?: string;
  paymentTerms?: string;
  bank?: BankInfo;
  notes?: string;
  /** Suppliers (no column for it): the legal name in Japanese. */
  legalNameJa?: string;
}
export interface LogisticsInfo {
  /** Shipping line codes (WANHAI, MAERSK … or a line added on the Shipping lines tab). */
  carriers?: string[];
  blPattern?: string;
  bookingPattern?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  incoterm?: string;
}
export interface ContactInfo {
  id?: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  lang?: 'ja' | 'en';
  isPrimary?: boolean;
}

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const txt = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const clean = (v: unknown, max: number, name: string, fail: (m: string) => never): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (!txt(v, max)) fail(`${name} must be text (up to ${max} characters)`);
  return (v as string).trim() || undefined;
};
const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'object' && v && !Array.isArray(v) && !Object.keys(v).length))) as T;

/** The bank account number as shown: last 4 digits only. */
export const maskAccount = (no: string | null | undefined) => {
  const s = (no ?? '').replace(/\s/g, '');
  return s ? `••••${s.slice(-4)}` : '';
};
/** Company info for the screen: the bank account masked (the full number never leaves the server). */
export const companyView = (c: CompanyInfo | null | undefined): CompanyInfo => ({ ...(c ?? {}), ...(c?.bank ? { bank: { ...c.bank, accountNo: maskAccount(c.bank.accountNo) } } : {}) });

/** A profile (customer or supplier) as sent to the browser: the bank account masked. */
export function maskedProfile<T extends { company?: CompanyInfo } | null | undefined>(p: T): T {
  if (!p || !p.company?.bank?.accountNo) return p;
  return { ...p, company: companyView(p.company) };
}
/** Org Settings (GET /trade-config/settings): every profile's bank account masked. */
export function maskedSettings<T extends { customerProfiles?: unknown; supplierProfiles?: unknown }>(s: T): T {
  const map = (m: unknown) => Object.fromEntries(Object.entries((m ?? {}) as Record<string, { company?: CompanyInfo }>).map(([k, v]) => [k, maskedProfile(v)]));
  return { ...s, customerProfiles: map(s.customerProfiles), supplierProfiles: map(s.supplierProfiles) };
}
/** A saved company whose account number came back masked ("••••1234") keeps the stored number. */
export function keepAccount(next: CompanyInfo | undefined, stored: CompanyInfo | undefined): CompanyInfo | undefined {
  if (!next?.bank) return next;
  const no = next.bank.accountNo ?? '';
  if (no && !no.startsWith('••••')) return next;
  return { ...next, bank: { ...next.bank, ...(stored?.bank?.accountNo ? { accountNo: stored.bank.accountNo } : { accountNo: undefined }) } };
}

/** Validate a company patch; a masked / empty account number keeps the stored one. */
export function cleanCompany(raw: unknown, current: CompanyInfo | null | undefined, fail: (m: string) => never): CompanyInfo {
  if (raw === null || raw === undefined) return current ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('company must be an object');
  const r = raw as Record<string, unknown>;
  const website = clean(r.website, 300, 'website', fail);
  if (website && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(website)) fail('website must be a web address');
  const b = (r.bank ?? undefined) as Record<string, unknown> | undefined;
  if (b !== undefined && b !== null && (typeof b !== 'object' || Array.isArray(b))) fail('bank must be an object');
  const acct = clean(b?.accountNo, 40, 'bank account no.', fail);
  const bank: BankInfo | undefined = b
    ? strip({
        bankName: clean(b.bankName, 120, 'bank name', fail),
        branch: clean(b.branch, 120, 'branch', fail),
        accountName: clean(b.accountName, 160, 'account name', fail),
        // "••••1234" (what the screen shows) or empty = unchanged.
        accountNo: acct && !acct.startsWith('••••') ? acct : current?.bank?.accountNo,
        swift: clean(b.swift, 20, 'SWIFT', fail),
      })
    : current?.bank;
  return strip({
    country: clean(r.country, 80, 'country', fail),
    website,
    paymentTerms: clean(r.paymentTerms, 500, 'payment terms', fail),
    bank,
    notes: clean(r.notes, 4000, 'notes', fail),
    legalNameJa: clean(r.legalNameJa, 200, 'Japanese name', fail),
  });
}

export function cleanLogistics(raw: unknown, knownCarriers: Set<string>, fail: (m: string) => never): LogisticsInfo {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('logistics must be an object');
  const r = raw as Record<string, unknown>;
  const carriers = r.carriers === undefined || r.carriers === null ? [] : r.carriers;
  if (!Array.isArray(carriers) || carriers.some((c) => typeof c !== 'string' || !knownCarriers.has(c))) fail('carriers must be shipping line codes from the Shipping lines tab');
  for (const k of ['blPattern', 'bookingPattern'] as const) {
    const v = clean(r[k], 200, k, fail);
    if (v) {
      try {
        new RegExp(v);
      } catch {
        fail(`${k} must be a pattern (regular expression), e.g. ^198[A-Z]{2}\\d{5}$`);
      }
    }
  }
  const inc = clean(r.incoterm, 10, 'incoterm', fail)?.toUpperCase();
  if (inc && !INCOTERMS.includes(inc)) fail(`incoterm must be one of ${INCOTERMS.join(', ')}`);
  return strip({
    carriers: [...new Set(carriers as string[])],
    blPattern: clean(r.blPattern, 200, 'blPattern', fail),
    bookingPattern: clean(r.bookingPattern, 200, 'bookingPattern', fail),
    portOfLoading: clean(r.portOfLoading, 120, 'port of loading', fail),
    portOfDischarge: clean(r.portOfDischarge, 120, 'port of discharge', fail),
    incoterm: inc,
  });
}

export function cleanContacts(raw: unknown, fail: (m: string) => never): ContactInfo[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) fail('contacts must be a list');
  return (raw as unknown[]).map((c, i) => {
    if (!c || typeof c !== 'object') fail(`contact ${i + 1} must be an object`);
    const r = c as Record<string, unknown>;
    const name = clean(r.name, 120, 'contact name', fail);
    if (!name) fail(`contact ${i + 1} needs a name`);
    const email = clean(r.email, 200, 'contact email', fail);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`contact ${i + 1}: "${email}" is not an e-mail address`);
    if (r.lang !== undefined && r.lang !== null && r.lang !== '' && r.lang !== 'ja' && r.lang !== 'en') fail('contact language must be ja or en');
    return strip({
      id: typeof r.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id) ? r.id : undefined,
      name: name!,
      role: clean(r.role, 120, 'contact role', fail),
      email,
      phone: clean(r.phone, 60, 'contact phone', fail),
      lang: r.lang === 'ja' || r.lang === 'en' ? (r.lang as 'ja' | 'en') : undefined,
      isPrimary: r.isPrimary === true || undefined,
    }) as ContactInfo;
  });
}

// ── Shipping lines ─────────────────────────────────────────────────────────
export interface AgentContact {
  name: string;
  company?: string;
  role?: string;
  email?: string;
  phone?: string;
}
export interface ShippingLineInfo {
  name: string;
  website?: string;
  trackingUrl?: string;
  /** Local agents (e.g. Wan Hai Japan). */
  agents?: AgentContact[];
  /** Free time at the port of discharge. */
  freeTime?: { detDays?: number; demDays?: number; note?: string };
  notes?: string;
  /** Added on the Shipping lines tab (not one AIMS knows by its B/L). */
  custom?: boolean;
}

export function cleanShippingLine(raw: unknown, current: ShippingLineInfo | undefined, fail: (m: string) => never): ShippingLineInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('A shipping line must be an object');
  const r = raw as Record<string, unknown>;
  const name = clean(r.name, 120, 'name', fail) ?? current?.name;
  if (!name) fail('A shipping line needs a name');
  const url = (k: string) => {
    const v = clean(r[k], 400, k, fail);
    if (v && !/^https?:\/\/\S+$/i.test(v)) fail(`${k} must start with http:// or https://`);
    return v;
  };
  const ft = (r.freeTime ?? undefined) as Record<string, unknown> | undefined;
  const days = (v: unknown, n: string) => {
    if (v === undefined || v === null || v === '') return undefined;
    const x = Number(v);
    if (!Number.isInteger(x) || x < 0 || x > 120) fail(`${n} must be a whole number of days (0–120)`);
    return x;
  };
  const agents = r.agents === undefined ? current?.agents : cleanAgents(r.agents, fail);
  return strip({
    name: name!,
    website: url('website'),
    trackingUrl: url('trackingUrl'),
    agents,
    freeTime: ft ? strip({ detDays: days(ft.detDays, 'DET free days'), demDays: days(ft.demDays, 'DEM free days'), note: clean(ft.note, 500, 'free-time note', fail) }) : current?.freeTime,
    notes: clean(r.notes, 4000, 'notes', fail),
    custom: current?.custom,
  });
}

/** Local agent contacts of a shipping line. */
export function cleanAgents(raw: unknown, fail: (m: string) => never): AgentContact[] {
  const base = cleanContacts(raw, fail);
  return base.map((a, i) => strip({ name: a.name, company: clean((raw as Array<Record<string, unknown>>)[i]?.company, 160, 'agent company', fail), role: a.role, email: a.email, phone: a.phone }) as AgentContact);
}

/** A new line's code from its name ("Ocean Network Express" → "OCEAN_NETWORK_EXPRESS"), unique against `taken`. */
export function lineCode(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().normalize('NFKC').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'LINE';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}
