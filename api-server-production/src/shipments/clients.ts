/**
 * Round AM (2026-10-26, ADH) — the Clients tab (Customers · Suppliers): list figures, contacts from the email intake,
 * and the per-customer document formats catalogue. Pure: no Prisma, no Nest. Built on what AIMS already stores —
 * Customer / Supplier records, the trade profiles (TradeSetting.customerProfiles / supplierProfiles: billing mode,
 * port, delivery site, docVariants = the step-4 generator, 宛先 …), contracts, orders and EmailIngestLog senders.
 */
import { CUSTOMER_DOC_TEMPLATES, CustomerProfile, DocFormatType, FormatSample, formatOf, OTHER_DOC_TEMPLATES } from './trade-profile';
import { delivered, StageShipment } from './trade-stage';

/** "2026-10" + n months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface ClientOrderFact {
  orderNo: number;
  status: string;
  isTest?: boolean;
  qtyMt: number | null;
  deliveryMonth: string | null;
  shipMonth: string | null;
  shipments: Array<StageShipment & { seqNo: number | null; deliveryMonth?: string | null }>;
}

export interface ClientStats {
  openOrders: number;
  /** Order tonnage by delivery month: this month, and the three months before it. */
  tonsThisMonth: number;
  tonsLast3Months: number;
  last3From: string;
  last3To: string;
  /** The latest delivered shipment (its arrival / ETA date), else the latest completed order's delivery month. */
  lastDelivery: { date: string | null; month: string | null; ref: string } | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const dayOf = (d: Date | string | null | undefined) => {
  if (!d) return null;
  const x = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};

/** A customer's (or supplier's) list figures; test and cancelled orders don't count. */
export function clientStats(orders: ClientOrderFact[], today: string): ClientStats {
  const live = orders.filter((o) => !o.isTest && o.status !== 'CANCELLED');
  const month = today.slice(0, 7);
  const from = addMonths(month, -3);
  const to = addMonths(month, -1);
  const tons = (pred: (m: string) => boolean) => r3(live.filter((o) => o.deliveryMonth && pred(o.deliveryMonth)).reduce((a, o) => a + (o.qtyMt ?? 0), 0));
  let last: ClientStats['lastDelivery'] = null;
  for (const o of live) {
    for (const s of o.shipments.filter((x) => x.status !== 'CANCELLED')) {
      if (!delivered(s) && o.status !== 'COMPLETED') continue;
      const date = dayOf(s.actualArrivalDate) ?? dayOf(s.eta);
      const m = date?.slice(0, 7) ?? s.deliveryMonth ?? o.deliveryMonth;
      const ref = `#${o.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}`;
      const key = date ?? `${m ?? ''}-99`;
      const cur = last ? (last.date ?? `${last.month ?? ''}-99`) : '';
      if (!last || key > cur) last = { date, month: m ?? null, ref };
    }
    if (o.status === 'COMPLETED' && !o.shipments.length && o.deliveryMonth) {
      const key = `${o.deliveryMonth}-99`;
      if (!last || key > (last.date ?? `${last.month ?? ''}-99`)) last = { date: null, month: o.deliveryMonth, ref: `#${o.orderNo}` };
    }
  }
  return {
    openOrders: live.filter((o) => o.status === 'OPEN').length,
    tonsThisMonth: tons((m) => m === month),
    tonsLast3Months: tons((m) => m >= from && m <= to),
    last3From: from,
    last3To: to,
    lastDelivery: last,
  };
}

export interface SenderRow {
  fromAddress: string;
  direction: string | null;
  counterparty: string | null;
  emailDate: Date | string | null;
  createdAt: Date | string;
}
export interface Contact {
  email: string;
  messages: number;
  lastAt: string | null;
}

/**
 * Contacts from known email senders: incoming mail whose counterparty is the client's profile key (SUS, KATO,
 * VEDANTA …) or whose domain is one of its email domains. The org's own domains are left out.
 */
export function contactsFrom(rows: SenderRow[], keys: string[], domains: string[], ownDomains: string[] = []): Contact[] {
  const k = new Set(keys.filter(Boolean).map((x) => x.toUpperCase()));
  const d = new Set(domains.filter(Boolean).map((x) => x.toLowerCase().replace(/^@/, '')));
  const own = new Set(ownDomains.map((x) => x.toLowerCase()));
  const out = new Map<string, Contact>();
  for (const r of rows) {
    const email = (r.fromAddress ?? '').trim().toLowerCase();
    const domain = email.split('@')[1] ?? '';
    if (!email.includes('@') || own.has(domain) || r.direction === 'OUT') continue;
    if (!(r.counterparty && k.has(r.counterparty.toUpperCase())) && !d.has(domain)) continue;
    const at = dayOf(r.emailDate) ?? dayOf(r.createdAt);
    const c = out.get(email) ?? { email, messages: 0, lastAt: null };
    c.messages++;
    if (at && (!c.lastAt || at > c.lastAt)) c.lastAt = at;
    out.set(email, c);
  }
  return [...out.values()].sort((a, b) => b.messages - a.messages || a.email.localeCompare(b.email));
}

/** The documents AIMS makes for a customer, in step order, and how the generator is chosen. */
export const DOC_FORMAT_SLOTS: Array<{ docType: DocFormatType; step: string; title: string; titleJa: string; choose: 'variant' | 'billing' | 'fixed'; previewable: boolean }> = [
  { docType: 'CUSTOMER_COA', step: '4', title: 'Customer COA', titleJa: '顧客向けCOA', choose: 'variant', previewable: true },
  { docType: 'CUSTOMER_PL', step: '4', title: 'Customer packing list', titleJa: '顧客向けパッキングリスト', choose: 'variant', previewable: true },
  // Round AN: a variant per customer — the SG→JP customs invoice (SUS, Kato) or Hoei's SG→Thailand sale invoice.
  { docType: 'SGJP_IV_PL', step: '7', title: 'INVOICE & PACKING LIST', titleJa: 'INVOICE & PACKING LIST', choose: 'variant', previewable: false },
  { docType: 'SHIPPING_INSTRUCTIONS', step: '9', title: '出庫・納入依頼書', titleJa: '出庫・納入依頼書', choose: 'fixed', previewable: false },
  { docType: 'INVOICE', step: '11', title: 'Invoice (請求書)', titleJa: '請求書', choose: 'billing', previewable: false },
];

export interface FormatView {
  docType: DocFormatType;
  step: string;
  title: string;
  titleJa: string;
  generator: string;
  generatorLabel: string;
  formatConfirmed: boolean;
  options: Array<{ key: string; label: string; formatConfirmed: boolean }>;
  /** variant: pick here; billing: follows the billing mode (Org Settings → Customers); fixed: one layout for everyone. */
  choose: 'variant' | 'billing' | 'fixed';
  previewable: boolean;
  language: 'ja' | 'en';
  addressee: string | null;
  /** What prints as 宛先 today (this document's, else the customer's, else the Japanese legal name). */
  effectiveAddressee: string;
  notes: string | null;
  samples: Array<Omit<FormatSample, 's3Key'>>;
}

const FIXED_LABELS: Record<string, string> = {
  SGJP_IV_PL: 'INVOICE & PACKING LIST (SG→JP customs, ADH layout, one per arrival)',
  SHIPPING_INSTRUCTIONS: '出庫・納入依頼書 (Mitsui Soko, delivery site from the customer profile)',
  INVOICE_2: '請求書 Invoice #1 + #2 (two-stage: provisional, then final − #1)',
  INVOICE_SINGLE: '請求書 single invoice (after the B/L)',
};

/** The Document formats tab of one customer. */
export function formatViews(profile: CustomerProfile, legalName: string): FormatView[] {
  return DOC_FORMAT_SLOTS.map((slot) => {
    const f = formatOf(profile, slot.docType);
    let generator: string;
    let options: FormatView['options'];
    if (slot.docType === 'SGJP_IV_PL') {
      generator = profile.docVariants.SGJP_IV_PL ?? 'SGJP_IV_PL';
      options = [{ key: 'SGJP_IV_PL', label: FIXED_LABELS.SGJP_IV_PL, formatConfirmed: true }, ...otherOptions('SGJP_IV_PL')];
    } else if (slot.choose === 'variant') {
      generator = profile.docVariants[slot.docType as 'CUSTOMER_COA' | 'CUSTOMER_PL'] ?? `${slot.docType}_KATO`;
      options = Object.entries(CUSTOMER_DOC_TEMPLATES)
        .filter(([, t]) => t.docType === slot.docType)
        .map(([key, t]) => ({ key, label: t.label, formatConfirmed: t.formatConfirmed }));
    } else if (slot.choose === 'billing') {
      const byBilling = profile.billingMode === 'SINGLE' ? 'INVOICE_SINGLE' : 'INVOICE_2';
      // Round AN: a single-billing customer may take Hoei's USD 請求書 (docVariants.INVOICE); the layout follows billing otherwise.
      const own = profile.docVariants.INVOICE && OTHER_DOC_TEMPLATES[profile.docVariants.INVOICE]?.docType === 'INVOICE' ? profile.docVariants.INVOICE : null;
      generator = profile.billingMode === 'SINGLE' && own ? own : byBilling;
      options = [{ key: byBilling, label: FIXED_LABELS[byBilling], formatConfirmed: true }, ...(profile.billingMode === 'SINGLE' ? otherOptions('INVOICE') : [])];
    } else {
      generator = slot.docType;
      options = [{ key: generator, label: FIXED_LABELS[generator], formatConfirmed: true }];
    }
    const opt = options.find((o) => o.key === generator);
    const addressee = f?.addressee ?? null;
    return {
      ...slot,
      generator,
      generatorLabel: opt?.label ?? generator,
      formatConfirmed: opt?.formatConfirmed ?? true,
      options,
      language: f?.language ?? 'ja',
      addressee,
      effectiveAddressee: addressee || profile.docAddressee || legalName,
      notes: f?.notes ?? null,
      samples: (f?.samples ?? []).filter((s) => !s.hidden).map(({ s3Key: _k, ...s }) => s),
    };
  });
}

const otherOptions = (docType: 'SGJP_IV_PL' | 'INVOICE') =>
  Object.entries(OTHER_DOC_TEMPLATES)
    .filter(([, t]) => t.docType === docType)
    .map(([key, t]) => ({ key, label: t.label, formatConfirmed: t.formatConfirmed }));

/** A generator key valid for this document type (Clients → Document formats). */
export function generatorFits(docType: string, key: string): boolean {
  if (docType === 'SGJP_IV_PL' && key === 'SGJP_IV_PL') return true;
  if (docType === 'INVOICE' && (key === 'INVOICE_SINGLE' || key === 'INVOICE_2')) return true;
  return CUSTOMER_DOC_TEMPLATES[key]?.docType === docType || OTHER_DOC_TEMPLATES[key]?.docType === docType;
}
