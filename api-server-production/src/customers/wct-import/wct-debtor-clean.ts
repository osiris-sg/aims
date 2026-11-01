// WCT customer import (2026-11): pure cleaning + planning for WCT's DP Info
// debtor export. No DB access here — scripts/import-wct-customers.ts reads the
// CSV, loads the org's existing customers and issues codes; this module only
// turns raw rows into a deterministic plan so every rule is unit-tested.

export const DEBTOR_COLUMNS = [
  'DebtorCode',
  'IDType',
  'UEN',
  'Name',
  'AcctOpenDate',
  'Type',
  'Salute',
  'ContactPerson',
  'Address',
  'Country',
  'ContactNo1',
  'ContactNo2',
  'ContactNo3',
  'ContactNo4',
  'Email',
] as const;
export type DebtorRow = Record<(typeof DEBTOR_COLUMNS)[number], string>;

/** RFC 4180 parser: quoted fields may hold commas, "" and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const t = text.replace(/^\ufeff/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function debtorRowsFromCsv(text: string): DebtorRow[] {
  const [header, ...rows] = parseCsv(text);
  const missing = DEBTOR_COLUMNS.filter((c) => !header?.includes(c));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(', ')}`);
  return rows.map((r) => Object.fromEntries(DEBTOR_COLUMNS.map((c) => [c, r[header.indexOf(c)] ?? ''])) as DebtorRow);
}

// ── Text ────────────────────────────────────────────────────────────────────
// The export is UTF-8 that was once read as Windows-1252 and re-saved
// ("CafÃ©" for "Café", "â€™" for "’", "Â " for a no-break space).
// Reverse it only when the whole string round-trips to valid UTF-8; anything
// else is left untouched.
const CP1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};
const MOJIBAKE_HINT = /[\u00c2-\u00f4][\u0080-\u00bf\u0152-\u0192\u02c6\u02dc\u2013-\u2122]/;

export function fixMojibake(s: string): string {
  if (!s || !MOJIBAKE_HINT.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x100) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return s;
  }
  const buf = Uint8Array.from(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // The export cut some names mid-character ("è¾£ä¸"): accept the decode
    // when the only damage is that truncated last character, and drop it.
    const loose = new TextDecoder('utf-8').decode(buf);
    const bad = loose.indexOf('\ufffd');
    return bad > 0 && /^\ufffd+$/.test(loose.slice(bad)) ? loose.slice(0, bad) : s;
  }
}

const INVISIBLE = /[\u00a0\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g;

/** Fix mojibake, turn odd spaces into plain ones, collapse whitespace. */
export function cleanText(s: string | null | undefined): string {
  return fixMojibake(s ?? '')
    .replace(INVISIBLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Comparison key: case-, punctuation- and spacing-insensitive. */
export function normKey(s: string | null | undefined): string {
  return cleanText(s)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ── UEN ─────────────────────────────────────────────────────────────────────
// Business (8 digits + letter), local company (9 digits + letter, e.g.
// 201302496E), other entities (T08LL1234A). An NRIC/FIN-shaped value is never
// kept or reported.
const UEN_RE = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;
const NRIC_RE = /^[STFGM]\d{7}[A-Z]$/;
export type UenStatus = 'ok' | 'blank' | 'junk' | 'nric-shaped';

export function cleanUen(raw: string): { uen: string | null; status: UenStatus } {
  const t = cleanText(raw).toUpperCase();
  if (!t) return { uen: null, status: 'blank' };
  const s = t.replace(/^UEN\s*(NO\.?)?\s*[:.]?\s*/, '').replace(/[\s-]/g, '');
  if (NRIC_RE.test(s)) return { uen: null, status: 'nric-shaped' };
  if (UEN_RE.test(s)) return { uen: s, status: 'ok' };
  return { uen: null, status: 'junk' };
}

// ── Address ─────────────────────────────────────────────────────────────────
export interface CleanAddress {
  address: string | null;
  /** First line of the address (site name for the Job Location picker). */
  firstLine: string | null;
  formatted: boolean;
}

export function cleanAddress(raw: string, country = ''): CleanAddress {
  const lines = fixMojibake(raw ?? '')
    .replace(INVISIBLE, ' ')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[,\s]+|[,\s]+$/g, ''),
    )
    .filter(Boolean);
  if (!lines.length) return { address: null, firstLine: null, formatted: false };
  let s = lines
    .join(', ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  // "…, Singapore 628437 628437" → the trailing postal repeated: drop the copy.
  const dup = s.match(/^(.*\b(\d{6})\b.*?)[\s,]+\2$/);
  if (dup) s = dup[1].replace(/[,\s]+$/, '');
  let formatted = false;
  let street = s;
  const foreign = country.trim() !== '' && country.trim().toUpperCase() !== 'SG';
  if (!foreign && !/singapore/i.test(s)) {
    const m = s.match(/^(.*?)(?:^|[\s,]+)(?:\(S\)|S\(?|SG)?\s*(\d{6})\)?$/i);
    if (m) {
      street = m[1].replace(/[,\s]+$/, '');
      s = street ? `${street}, Singapore ${m[2]}` : `Singapore ${m[2]}`;
      formatted = true;
    }
  }
  const firstLine = lines.length > 1 ? lines[0] : street.replace(/[,\s]*\bSingapore\b[\s,]*\(?\d{6}\)?$/i, '') || s;
  return { address: s, firstLine, formatted };
}

// ── Phones ──────────────────────────────────────────────────────────────────
// Keep Singapore 8-digit numbers starting 6/8/9 (a +65 / 65 prefix is
// dropped). Several numbers in one cell ("9123 4567 / 6123 4567") are split.
export function cleanPhoneField(raw: string): { valid: string[]; unparsed: string[] } {
  const t = fixMojibake(raw ?? '')
    .replace(INVISIBLE, ' ')
    .trim();
  const out = { valid: [] as string[], unparsed: [] as string[] };
  if (!t) return out;
  for (const tok of t.split(/\s*[\/,;&]\s*|\s{2,}/)) {
    const tokTrim = tok.trim();
    if (!tokTrim) continue;
    const d = tokTrim.replace(/[\s\-().]/g, '').replace(/^\+?65(?=[689]\d{7}$)/, '');
    if (/^[689]\d{7}$/.test(d)) out.valid.push(d);
    else out.unparsed.push(tokTrim);
  }
  return out;
}

// ── Emails ──────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function cleanEmailField(raw: string): { valid: string[]; invalid: string[] } {
  const s = fixMojibake(raw ?? '')
    .replace(/[^\x21-\x7e\s]/g, '') // NBSP, LRM and other invisible leftovers
    .toLowerCase()
    .replace(/,(com|net|org|edu|gov|sg|co|my|biz|info)\b/g, '.$1') // gmail,com → gmail.com
    .trim();
  const out = { valid: [] as string[], invalid: [] as string[] };
  if (!s) return out;
  for (const tok of s.split(/[\s;,\/]+/)) {
    const e = tok.replace(/^(mailto|e-?mail)\s*:/, '').replace(/^[<("'\[:]+|[>)"'\].,;:]+$/g, '');
    if (!e) continue;
    if (EMAIL_RE.test(e)) out.valid.push(e);
    else out.invalid.push(tok);
  }
  return out;
}

// ── Contact person ──────────────────────────────────────────────────────────
const SAL = '(mr|ms|mrs|mdm|miss|dr|madam)';
const SAL_TITLE: Record<string, string> = { mr: 'Mr', ms: 'Ms', mrs: 'Mrs', mdm: 'Mdm', miss: 'Miss', dr: 'Dr', madam: 'Madam' };
const titleSal = (s: string) => SAL_TITLE[s.toLowerCase().replace(/\./g, '')] ?? s.replace(/\./g, '');

/**
 * "- Alvin Mr" → "Mr Alvin". Drops the value when empty or when it is just the
 * company name (the export fills "- <company>" where no person was recorded,
 * sometimes cut short or spelt differently — anything with Pte/Ltd/LLP).
 * The Salute column wins over a salutation in the text.
 */
export function cleanContactName(raw: string, salute: string, companyName: string): string | null {
  const t = cleanText(raw);
  const dashed = /^-+\s*/.test(t);
  let s = t.replace(/^-+\s*/, '').trim();
  let sal: string | null = null;
  const lead = s.match(new RegExp(`^${SAL}\\.?\\s+(.+)$`, 'i'));
  const trail = s.match(new RegExp(`^(.+?)\\s+${SAL}\\.?$`, 'i'));
  if (lead) {
    sal = lead[1];
    s = lead[2];
  } else if (trail) {
    s = trail[1];
    sal = trail[2];
  } else if (new RegExp(`^${SAL}\\.?$`, 'i').test(s)) s = '';
  if (cleanText(salute)) sal = cleanText(salute);
  s = s.trim();
  if (!s) return null;
  const k = normKey(s);
  const whole = normKey(t.replace(/^-+\s*/, ''));
  const co = normKey(companyName);
  if (!k || k === co || whole === co || (dashed && k.length >= 4 && co.startsWith(k))) return null;
  // A company (a variant of the customer's own name, usually) is not a person.
  if (/\b(PTE|LTD|LLP|LIMITED)\b/.test(whole)) return null;
  return sal ? `${titleSal(sal)} ${s}` : s;
}

// ── Plan ────────────────────────────────────────────────────────────────────
export const WCT_SELF_DEBTOR_CODE = '74';

export interface CleanRow {
  debtorCode: string;
  name: string;
  nameKey: string;
  isIndividual: boolean;
  uen: string | null;
  uenStatus: UenStatus;
  address: string | null;
  addressKey: string;
  siteName: string | null;
  addressFormatted: boolean;
  phones: string[];
  emails: string[];
  contactName: string | null;
  acctOpenDate: string | null;
  unparsedPhones: { field: string; value: string }[];
  invalidEmails: string[];
}

export function cleanRow(r: DebtorRow): CleanRow {
  const name = cleanText(r.Name);
  const addr = cleanAddress(r.Address, r.Country);
  const phones: string[] = [];
  const unparsedPhones: CleanRow['unparsedPhones'] = [];
  for (const f of ['ContactNo1', 'ContactNo2', 'ContactNo3', 'ContactNo4'] as const) {
    const p = cleanPhoneField(r[f]);
    for (const v of p.valid) if (!phones.includes(v)) phones.push(v);
    for (const v of p.unparsed) unparsedPhones.push({ field: f, value: v });
  }
  const em = cleanEmailField(r.Email);
  const isIndividual = r.Type.trim().toUpperCase() === 'I' || r.IDType.trim().toUpperCase() === 'NRIC';
  // Individuals' UEN column is the NRIC slot: never read it.
  const uen = isIndividual ? { uen: null, status: 'blank' as UenStatus } : cleanUen(r.UEN);
  return {
    debtorCode: r.DebtorCode.trim(),
    name,
    nameKey: normKey(name),
    isIndividual,
    uen: uen.uen,
    uenStatus: uen.status,
    address: addr.address,
    addressKey: normKey(addr.address),
    siteName: addr.firstLine,
    addressFormatted: addr.formatted,
    phones,
    emails: [...new Set(em.valid)],
    contactName: cleanContactName(r.ContactPerson, r.Salute, name),
    acctOpenDate: cleanText(r.AcctOpenDate) || null,
    unparsedPhones,
    invalidEmails: em.invalid,
  };
}

export interface PlannedContact {
  name: string;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}
export interface PlannedCustomer {
  debtorCodes: string[];
  rows: CleanRow[];
  name: string;
  address: string | null;
  phone: string | null;
  /** Primary email before the uniqueness check. */
  emailCandidate: string | null;
  email: string | null;
  emailNulledReason: 'dup-in-import' | 'used-by-existing' | null;
  contacts: PlannedContact[];
  site: { name: string; address: string; contactDetail: { name: string; email: string; phone: string } | null } | null;
}

export interface ExistingCustomer {
  id: string;
  customerCode: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}
export interface ExistingMatch {
  row: CleanRow;
  existing: ExistingCustomer;
  by: 'name' | 'name+email' | 'name+phone';
}

export interface ImportPlan {
  total: number;
  skippedSelf: CleanRow[];
  skippedBlankName: string[];
  skippedAlreadyImported: CleanRow[];
  skippedExisting: ExistingMatch[];
  customers: PlannedCustomer[];
  merges: PlannedCustomer[];
}

function buildContacts(name: string, rows: CleanRow[]): PlannedContact[] {
  const contacts: PlannedContact[] = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  rows.forEach((row) => {
    const base = row.contactName ?? (row.isIndividual ? name : 'Accounts');
    const phones = row.phones.filter((p) => !seenPhones.has(p));
    const emails = row.emails.filter((e) => !seenEmails.has(e));
    const n = Math.max(phones.length, emails.length);
    const known = contacts.some((c) => c.name === base);
    if (n === 0) {
      // A named person with no number/email is still worth keeping; a bare
      // "Accounts" placeholder is not.
      if (row.contactName && !known) contacts.push({ name: base, phone: null, email: null, isPrimary: contacts.length === 0 });
      return;
    }
    for (let i = 0; i < n; i++) {
      const phone = phones[i] ?? null;
      const email = emails[i] ?? null;
      contacts.push({ name: i === 0 && !known ? base : `${base} (alt)`, phone, email, isPrimary: contacts.length === 0 });
      if (phone) seenPhones.add(phone);
      if (email) seenEmails.add(email);
    }
  });
  return contacts;
}

/**
 * Turn cleaned rows into customers. Exact duplicates (same normalised name AND
 * address) merge into one; the same email under different names stays separate
 * customers. Rows matching an existing customer by name are skipped.
 */
export function planImport(raw: DebtorRow[], existing: ExistingCustomer[], alreadyImported: Set<string> = new Set()): ImportPlan {
  const plan: ImportPlan = {
    total: raw.length,
    skippedSelf: [],
    skippedBlankName: [],
    skippedAlreadyImported: [],
    skippedExisting: [],
    customers: [],
    merges: [],
  };
  const byName = new Map<string, ExistingCustomer[]>();
  for (const c of existing) {
    const k = normKey(c.name);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const groups = new Map<string, CleanRow[]>();
  for (const r of raw) {
    const row = cleanRow(r);
    if (row.debtorCode === WCT_SELF_DEBTOR_CODE) {
      plan.skippedSelf.push(row);
      continue;
    }
    if (!row.name) {
      plan.skippedBlankName.push(row.debtorCode);
      continue;
    }
    if (alreadyImported.has(row.debtorCode)) {
      plan.skippedAlreadyImported.push(row);
      continue;
    }
    const hits = byName.get(row.nameKey);
    if (hits?.length) {
      const byEmail = hits.find((c) => c.email && row.emails.includes(c.email.toLowerCase()));
      const byPhone = hits.find((c) => c.phone && row.phones.includes(c.phone.replace(/\D/g, '').replace(/^65(?=\d{8}$)/, '')));
      const ex = byEmail ?? byPhone ?? hits[0];
      plan.skippedExisting.push({ row, existing: ex, by: byEmail ? 'name+email' : byPhone ? 'name+phone' : 'name' });
      continue;
    }
    const k = `${row.nameKey}|${row.addressKey}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  for (const rows of groups.values()) {
    const first = rows[0];
    const contacts = buildContacts(first.name, rows);
    const allPhones = rows.flatMap((r) => r.phones);
    const allEmails = rows.flatMap((r) => r.emails);
    const primary = contacts[0];
    const address = rows.find((r) => r.address)?.address ?? null;
    const siteName = rows.find((r) => r.address)?.siteName ?? null;
    const cd = primary && primary.email && primary.phone ? { name: primary.name, email: primary.email, phone: primary.phone } : null;
    const c: PlannedCustomer = {
      debtorCodes: rows.map((r) => r.debtorCode),
      rows,
      name: first.name,
      address,
      phone: allPhones[0] ?? null,
      emailCandidate: allEmails[0] ?? null,
      email: null,
      emailNulledReason: null,
      contacts,
      site: address ? { name: siteName || address, address, contactDetail: cd } : null,
    };
    plan.customers.push(c);
    if (rows.length > 1) plan.merges.push(c);
  }
  // Customer.email is unique per org: only set it when no other planned or
  // existing customer would carry the same address. It stays on the contact.
  const uses = new Map<string, number>();
  for (const c of plan.customers) for (const e of new Set(c.rows.flatMap((r) => r.emails))) uses.set(e, (uses.get(e) ?? 0) + 1);
  const taken = new Set(existing.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[]);
  for (const c of plan.customers) {
    const e = c.emailCandidate;
    if (!e) continue;
    if (taken.has(e)) c.emailNulledReason = 'used-by-existing';
    else if ((uses.get(e) ?? 0) > 1) c.emailNulledReason = 'dup-in-import';
    else c.email = e;
  }
  return plan;
}

// ── Masking for reports ─────────────────────────────────────────────────────
export const maskEmail = (e: string) => {
  const [u, d] = e.split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : `${e.slice(0, 1)}***`;
};
export const maskPhone = (p: string) => (p.length > 4 ? `${p.slice(0, 1)}${'\u2022'.repeat(p.length - 3)}${p.slice(-2)}` : '\u2022'.repeat(p.length));
export const maskShape = (s: string) => s.replace(/[A-Za-z]/g, 'a').replace(/\d/g, '9');
