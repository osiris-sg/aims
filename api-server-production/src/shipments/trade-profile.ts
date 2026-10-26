/**
 * Customer profiles (TradeSetting.customerProfiles, keyed by customer id; Org
 * Settings → Customers). How a customer is billed and served decides which
 * steps apply, which document templates are used and the cost estimator's
 * rates:
 *   TWO_STAGE (SUS)   Invoice #1 provisional at the previous month's LME,
 *                     Invoice #2 = final price + costs − Invoice #1.
 *   SINGLE (Kato, Hoei) one invoice after the B/L (INVOICE_SINGLE): shipment-
 *                     month LME average + QMJP + premium, plus 通関、車輸送料
 *                     (taxable) and 通関 (non-taxable) per MT; due in 5 business days.
 * Pure: no Prisma, no Nest.
 */
import type { DeliveryProfile } from './trade-invoice';

export type BillingMode = 'TWO_STAGE' | 'SINGLE';

/** Template keys a customer uses for its documents (CUSTOMER_PL_KATO, INVOICE_SINGLE …). */
export interface DocVariants {
  CUSTOMER_PL?: string;
  CUSTOMER_COA?: string;
  INVOICE?: string;
  /** Round AN: step 7's INVOICE & PACKING LIST — SGJP_IV_PL (SG→JP customs, default) or SGJP_IV_PL_HOEI (SG→Thailand sale). */
  SGJP_IV_PL?: string;
}

/** Round AN: the parties printed on the customer's own INVOICE & PACKING LIST (Hoei: Ship To / Buyer = Hoei, Notify = ISEWAN). */
export interface PartyBlocks {
  consignee?: string;
  buyer?: string;
  notify?: string;
}

export interface CustomerProfile {
  customerId: string;
  /** Short name used in matching and labels ("SUS", "KATO", "HOEI"). */
  key?: string;
  label?: string;
  billingMode: BillingMode;
  /** Step 10: the import permit is sent to the customer (SUS yes; Kato / Hoei no). */
  sendImportPermit: boolean;
  /** Port of discharge / Mitsui Soko office ("Yokohama", "Nagoya"). */
  port?: string;
  /** Truck size for delivery (t): SUS 20, Kato 10 — picks the trucking rate. */
  truckCapacityT: number;
  /** 通関 (一貫作業) rate, JPY/MT: Yokohama 2,800, Nagoya 2,300. */
  customsRatePerMt?: number;
  /** Customer's email domains for intake matching (e.g. kato.example.jp). */
  emailDomains?: string[];
  docVariants: DocVariants;
  /** 出庫・納入依頼書 delivery site (moved here from docDefaults.deliveryProfiles). */
  deliveryProfile?: Omit<DeliveryProfile, 'id' | 'customerName'> | null;
  /** Invoice 備考 block for INVOICE_SINGLE (商品 / 荷姿 / 保管倉庫 / 取扱港 / 保管条件 / 業務範囲 / 作業備考). */
  invoiceRemarks?: string;
  /** 弊社指定口座 preselected on this customer's invoices (a docDefaults.banks id): Kato CFSB, SUS DBS. Any entity's account. */
  defaultBankId?: string;
  /** The default bank is provisional — shown as "check" until ADH confirms it (Hoei). */
  defaultBankCheck?: boolean;
  /** 宛先 on this customer's Japanese PL / COA when it isn't the legal name alone (SUS: "SUS株式会社 福島製造グループ"). */
  docAddressee?: string;
  /**
   * Round AM — Clients → a customer → Document formats: per document type, the 宛先 / language override, a note, and
   * the customer's sample files (stored by the Clients service only — a settings save never adds or changes them).
   * The generator choice stays in docVariants.
   */
  docFormats?: Partial<Record<DocFormatType, DocFormat>>;
  /** Round AN: Consignee / Buyer / Notify Party blocks of the customer's INVOICE & PACKING LIST (SGJP_IV_PL_HOEI). */
  partyBlocks?: PartyBlocks;
}

/** The documents AIMS makes for a customer, by step: 4 Customer COA / PL, 7 SG→JP IV & PL, 9 出庫・納入依頼書, 11 invoice. */
export type DocFormatType = 'CUSTOMER_COA' | 'CUSTOMER_PL' | 'SGJP_IV_PL' | 'SHIPPING_INSTRUCTIONS' | 'INVOICE';
export const DOC_FORMAT_TYPES: DocFormatType[] = ['CUSTOMER_COA', 'CUSTOMER_PL', 'SGJP_IV_PL', 'SHIPPING_INSTRUCTIONS', 'INVOICE'];
export interface FormatSample {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  uploadedAt: string;
  uploadedByName?: string | null;
  /** Hidden from the list (never deleted). */
  hidden?: boolean;
}
export interface DocFormat {
  /** 'ja' (ADH's Japanese layout) | 'en' (the English table layout) — Customer PL / COA. */
  language?: 'ja' | 'en';
  /** This document's 宛先 (else the profile's docAddressee, else the legal name). */
  addressee?: string;
  notes?: string;
  samples?: FormatSample[];
}

/** The format settings of one document type (INVOICE_SINGLE / INVOICE_2 → INVOICE). */
export function formatOf(p: { docFormats?: CustomerProfile['docFormats'] } | null | undefined, docType: string): DocFormat | undefined {
  const k = (/^INVOICE/.test(docType) ? 'INVOICE' : docType) as DocFormatType;
  return p?.docFormats?.[k];
}

export const BILLING_MODES: BillingMode[] = ['TWO_STAGE', 'SINGLE'];

/** A customer without a profile is billed in two stages, like SUS (the flow before profiles existed). */
export function defaultProfile(customerId: string): CustomerProfile {
  return { customerId, billingMode: 'TWO_STAGE', sendImportPermit: true, truckCapacityT: 20, docVariants: {} };
}

/** The customer's profile, or the default. */
export function profileFor(profiles: unknown, customerId: string | null | undefined): CustomerProfile {
  const map = (profiles && typeof profiles === 'object' ? profiles : {}) as Record<string, Partial<CustomerProfile>>;
  const p = customerId ? map[customerId] : undefined;
  if (!customerId || !p) return defaultProfile(customerId ?? '');
  return { ...defaultProfile(customerId), ...p, customerId, docVariants: { ...(p.docVariants ?? {}) } };
}

// ── Supplier profiles (TradeSetting.supplierProfiles, keyed by supplier id) ──
/**
 * How a supplier sells: Vedanta issues a PI and takes a deposit (step 1)
 * before the CI balance (step 6); Inalum / the Thai P1020 supplier don't —
 * step 1 is N/A and step 6 pays the full amount. Their shipping documents
 * differ too: only the listed types are required on step 3b.
 */
export interface SupplierProfile {
  supplierId: string;
  key?: string;
  label?: string;
  hasPI: boolean;
  /** Step 3b's required document types; null = the org's template (Vedanta's set). */
  shippingDocs?: string[] | null;
  /** Supplier email domains (intake matching), e.g. vedanta.co.in. */
  emailDomains?: string[];
  // ── Round M (a second, fixed-price supplier) — descriptive, read by intake only for now ──
  /** ISO country ("ID") and loading port ("Batu Ampar"). */
  country?: string | null;
  loadingPort?: string | null;
  /** LME_FORMULA (Vedanta: LME + QMJP premium) | FIXED (a fixed USD/t price on the PI — no LME / QMJP helpers). */
  pricingMode?: 'LME_FORMULA' | 'FIXED';
  /** e.g. "USD/t". */
  priceUnit?: string | null;
  /** 30% advance, 70% within 3 bank working days against the B/L copy. */
  paymentTerms?: { advancePct: number; balanceAgainst: 'BL_COPY' | 'ARRIVAL' | 'OTHER'; balanceDays?: number | null; note?: string | null } | null;
  /** The supplier's own number formats (regex), valid intake keys: PI ("^SIAE_PI_\\d{8}$"), contract, CI. */
  piNoPatterns?: string[];
  contractNoPatterns?: string[];
  ciNoPatterns?: string[];
}

/** Every supplier's own key formats (intake validation): Vedanta's defaults are added by the callers. */
export function supplierKeyPatterns(profiles: unknown): { pi: string[]; contract: string[]; ci: string[] } {
  const all = Object.values((profiles && typeof profiles === 'object' ? profiles : {}) as Record<string, Partial<SupplierProfile>>);
  const take = (k: 'piNoPatterns' | 'contractNoPatterns' | 'ciNoPatterns') => all.flatMap((p) => (Array.isArray(p?.[k]) ? (p[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []));
  return { pi: take('piNoPatterns'), contract: take('contractNoPatterns'), ci: take('ciNoPatterns') };
}

/** A supplier without a profile works like Vedanta (the flow before profiles existed). */
export function defaultSupplierProfile(supplierId: string): SupplierProfile {
  return { supplierId, hasPI: true, shippingDocs: null };
}

export function supplierProfileFor(profiles: unknown, supplierId: string | null | undefined): SupplierProfile {
  const map = (profiles && typeof profiles === 'object' ? profiles : {}) as Record<string, Partial<SupplierProfile>>;
  const p = supplierId ? map[supplierId] : undefined;
  if (!supplierId || !p) return defaultSupplierProfile(supplierId ?? '');
  return { ...defaultSupplierProfile(supplierId), ...p, supplierId };
}

/** Validate a supplier profiles patch ({ [supplierId]: profile | null }) and merge it. */
export function mergeSupplierProfiles(current: unknown, patch: Record<string, unknown>, fail: (msg: string) => never): Record<string, SupplierProfile> {
  const out = { ...((current && typeof current === 'object' ? current : {}) as Record<string, SupplierProfile>) };
  for (const [id, raw] of Object.entries(patch ?? {})) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail(`Unknown supplier "${id}"`);
    if (raw === null) {
      delete out[id];
      continue;
    }
    if (!raw || typeof raw !== 'object') fail('A supplier profile must be an object');
    const r = raw as Record<string, unknown>;
    const next: SupplierProfile = { ...(out[id] ?? defaultSupplierProfile(id)), supplierId: id };
    if ('hasPI' in r) {
      if (typeof r.hasPI !== 'boolean') fail('hasPI must be true or false');
      next.hasPI = r.hasPI as boolean;
    }
    for (const k of ['key', 'label'] as const) if (k in r) next[k] = isText(r[k], 80) ? String(r[k]).trim() : fail(`${k} must be text`);
    if ('shippingDocs' in r) {
      if (r.shippingDocs === null) next.shippingDocs = null;
      else if (!Array.isArray(r.shippingDocs) || !r.shippingDocs.every((d) => typeof d === 'string' && /^[A-Z0-9_]{2,40}$/.test(d))) fail('shippingDocs must be a list of document type codes');
      else next.shippingDocs = r.shippingDocs as string[];
    }
    if ('emailDomains' in r) {
      if (!Array.isArray(r.emailDomains) || !r.emailDomains.every((d) => typeof d === 'string')) fail('emailDomains must be a list');
      next.emailDomains = (r.emailDomains as string[]).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    }
    out[id] = next;
  }
  return out;
}

/**
 * Step codes that don't apply ("N/A (customer profile)" / "(supplier profile)"):
 * SINGLE billing has no Invoice #1; a supplier without a PI has no PI payment.
 */
export function naStepCodes(p: CustomerProfile, scope: 'ORDER' | 'SHIPMENT' | 'CONTRACT' | 'SUPPLIER_ORDER', supplier?: SupplierProfile | null): string[] {
  const noPi = supplier && !supplier.hasPI ? ['PI_PAYMENT'] : [];
  if (scope === 'SUPPLIER_ORDER') return noPi;
  // One order process (2026-10, round H): steps 0 / 1 are the order's again.
  if (scope === 'ORDER') return [...noPi, ...(p.billingMode === 'SINGLE' ? ['INVOICE_1'] : [])];
  return [];
}

/**
 * Step changes for this customer / supplier: SINGLE billing issues one invoice
 * on step 11 (INVOICE_SINGLE); no PI → step 6 pays the full amount; a supplier
 * with its own document set requires only those on step 3b.
 */
export function stepOverride(p: CustomerProfile, code: string, supplier?: SupplierProfile | null): { title?: string; requiredDocTypes?: string[] } {
  if (p.billingMode === 'SINGLE' && code === 'INVOICE_2') return { title: 'Issue invoice (single)', requiredDocTypes: ['INVOICE_SINGLE'] };
  if (supplier && !supplier.hasPI && code === 'CI_PAYMENT') return { title: 'Pay the CI (full amount — no PI)' };
  if (supplier?.shippingDocs?.length && code === 'SHIPPING_DOCS') return { requiredDocTypes: supplier.shippingDocs };
  return {};
}

export interface Subtask {
  key: string;
  label: string;
  done: boolean;
  /** Doesn't apply to this customer (e.g. Kato: import permit not sent). */
  na?: boolean;
  at?: string | null;
  by?: string | null;
  /** 'MANUAL' | 'EMAIL' (with the intake log row id). */
  source?: string | null;
  emailLogId?: string | null;
}

/** Sub-tasks per step code: "sent" evidence (ticked by hand or by an outgoing email). They never block a step. */
export const STEP_SUBTASKS: Record<string, Array<{ key: string; label: string }>> = {
  INVOICE_1: [{ key: 'sent', label: 'Sent to customer' }],
  INVOICE_2: [{ key: 'sent', label: 'Sent to customer' }],
  CUSTOMS_TAX_ESTIMATE: [{ key: 'sentToWarehouse', label: 'Documents + telex sent to Mitsui Soko' }],
  AN_INSTRUCTIONS: [{ key: 'sentToWarehouse', label: 'Arrival notice + SI sent to Mitsui Soko' }],
  IMPORT_PERMIT: [{ key: 'sentToCustomer', label: 'Import permit sent to customer' }],
};

export function subtasksFor(code: string, p: CustomerProfile): Subtask[] | null {
  const list = STEP_SUBTASKS[code];
  if (!list) return null;
  return list.map((t) => ({ ...t, done: false, na: code === 'IMPORT_PERMIT' && t.key === 'sentToCustomer' && !p.sendImportPermit ? true : undefined }));
}

/** Business days to the invoice due date: Invoice #1 7, Invoice #2 6, single invoice 5 (all editable in settings). */
export function invoiceDueDays(docType: string, d: { invoiceDueBusinessDays?: number; invoice2DueBusinessDays?: number; invoiceSingleDueBusinessDays?: number }): number {
  if (docType === 'INVOICE_SINGLE') return Number(d.invoiceSingleDueBusinessDays ?? 5);
  if (docType === 'INVOICE_2') return Number(d.invoice2DueBusinessDays ?? 6);
  return Number(d.invoiceDueBusinessDays ?? 7);
}

/**
 * The template a generated document of `docType` uses for this customer:
 * Customer PL / COA from docVariants (default the Kato layout, which the first
 * templates were built from), the invoice for step 11 from billingMode.
 */
export function templateKeyFor(p: CustomerProfile, docType: string): string {
  if (docType === 'CUSTOMER_PL') return p.docVariants.CUSTOMER_PL ?? 'CUSTOMER_PL_KATO';
  if (docType === 'CUSTOMER_COA') return p.docVariants.CUSTOMER_COA ?? 'CUSTOMER_COA_KATO';
  if (docType === 'INVOICE_SINGLE') return p.docVariants.INVOICE ?? 'INVOICE_SINGLE';
  if (docType === 'SGJP_IV_PL') return p.docVariants.SGJP_IV_PL ?? 'SGJP_IV_PL';
  return docType;
}

/** Customer PL / COA template variants. formatConfirmed=false shows "format not yet confirmed" in the editor (never on the PDF). */
export const CUSTOMER_DOC_TEMPLATES: Record<string, { docType: 'CUSTOMER_PL' | 'CUSTOMER_COA'; customer: string; formatConfirmed: boolean; label: string }> = {
  CUSTOMER_PL_KATO: { docType: 'CUSTOMER_PL', customer: 'KATO', formatConfirmed: true, label: '計量検収票 (加藤軽金属)' },
  CUSTOMER_COA_KATO: { docType: 'CUSTOMER_COA', customer: 'KATO', formatConfirmed: true, label: '納品書兼分析試験成績報告書 (加藤軽金属)' },
  CUSTOMER_PL_SUS: { docType: 'CUSTOMER_PL', customer: 'SUS', formatConfirmed: false, label: '計量検収票 (SUS)' },
  CUSTOMER_COA_SUS: { docType: 'CUSTOMER_COA', customer: 'SUS', formatConfirmed: false, label: '納品書兼分析試験成績報告書 (SUS)' },
  CUSTOMER_PL_HOEI: { docType: 'CUSTOMER_PL', customer: 'HOEI', formatConfirmed: false, label: '計量検収票 (Hoei)' },
  CUSTOMER_COA_HOEI: { docType: 'CUSTOMER_COA', customer: 'HOEI', formatConfirmed: false, label: '納品書兼分析試験成績報告書 (Hoei)' },
  // Round AM: SUS's own formats from ADH's samples (Sayaka, 24–25 Oct) — see trade-sus-formats.ts.
  CUSTOMER_COA_SUS_SUMMARY: { docType: 'CUSTOMER_COA', customer: 'SUS', formatConfirmed: true, label: 'COA_集計ファイル (SUS): COA summary by cast, PDF' },
  CUSTOMER_PL_SUS_XLS: { docType: 'CUSTOMER_PL', customer: 'SUS', formatConfirmed: true, label: 'PACKING LIST (SUS): Excel from Vedanta\'s PL' },
  // Round AN: Hoei gets Vedanta's own COA / PL as received (Drive Houeiへ送付資料/Sent) — nothing is generated at step 4.
  CUSTOMER_COA_AS_RECEIVED: { docType: 'CUSTOMER_COA', customer: 'HOEI', formatConfirmed: true, label: "Vedanta's COA as received (forwarded, no ADH document)" },
  CUSTOMER_PL_AS_RECEIVED: { docType: 'CUSTOMER_PL', customer: 'HOEI', formatConfirmed: true, label: "Vedanta's packing list as received (forwarded, no ADH document)" },
};

/** Round AN: variants of the other generated documents (step 7 INVOICE & PACKING LIST, step 11 invoice) — see trade-hoei-formats.ts. */
export const OTHER_DOC_TEMPLATES: Record<string, { docType: 'SGJP_IV_PL' | 'INVOICE'; customer: string; formatConfirmed: boolean; label: string }> = {
  SGJP_IV_PL_HOEI: { docType: 'SGJP_IV_PL', customer: 'HOEI', formatConfirmed: true, label: 'INVOICE & PACKING LIST (Hoei): ADH SG sale, CIF Laem Chabang, Notify Party, payment term + bank' },
  INVOICE_SINGLE_HOEI_USD: { docType: 'INVOICE', customer: 'HOEI', formatConfirmed: true, label: '請求書 (Hoei): Asia Deal Hub Pte. Ltd., USD only, no 消費税' },
};

const isText = (v: unknown, max = 4000) => typeof v === 'string' && v.length <= max;
const TEMPLATE_KEYS = new Set([...Object.keys(CUSTOMER_DOC_TEMPLATES), ...Object.keys(OTHER_DOC_TEMPLATES), 'INVOICE_SINGLE', 'INVOICE_2', 'SGJP_IV_PL']);

/**
 * Validate a profiles patch ({ [customerId]: profile | null }) and merge it
 * into the stored map; throws with a message naming the field.
 */
export function mergeProfiles(current: unknown, patch: Record<string, unknown>, fail: (msg: string) => never): Record<string, CustomerProfile> {
  const out = { ...((current && typeof current === 'object' ? current : {}) as Record<string, CustomerProfile>) };
  for (const [id, raw] of Object.entries(patch ?? {})) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) fail(`Unknown customer "${id}"`);
    if (raw === null) {
      delete out[id];
      continue;
    }
    const p = raw as Partial<CustomerProfile>;
    if (!BILLING_MODES.includes(p.billingMode as BillingMode)) fail('billingMode must be TWO_STAGE or SINGLE');
    const truck = Number(p.truckCapacityT);
    if (!Number.isFinite(truck) || truck <= 0 || truck > 100) fail('truckCapacityT must be a number of tonnes');
    if (p.customsRatePerMt !== undefined && p.customsRatePerMt !== null && (!Number.isFinite(Number(p.customsRatePerMt)) || Number(p.customsRatePerMt) < 0)) fail('customsRatePerMt must be a number');
    for (const k of ['key', 'label', 'port'] as const) if (p[k] !== undefined && p[k] !== null && !isText(p[k], 100)) fail(`${k} must be text`);
    if (p.invoiceRemarks !== undefined && p.invoiceRemarks !== null && !isText(p.invoiceRemarks)) fail('invoiceRemarks must be text');
    if (p.docAddressee !== undefined && p.docAddressee !== null && p.docAddressee !== '' && !isText(p.docAddressee, 120)) fail('docAddressee must be text (up to 120 characters)');
    if (p.defaultBankId !== undefined && p.defaultBankId !== null && p.defaultBankId !== '' && !isText(p.defaultBankId, 100)) fail('defaultBankId must be a bank account id');
    const dv = (p.docVariants ?? {}) as DocVariants;
    for (const [k, v] of Object.entries(dv)) {
      if (!['CUSTOMER_PL', 'CUSTOMER_COA', 'INVOICE', 'SGJP_IV_PL'].includes(k)) fail(`Unknown document variant "${k}"`);
      if (v && !TEMPLATE_KEYS.has(v)) fail(`Unknown template "${v}"`);
    }
    const domains = Array.isArray(p.emailDomains) ? p.emailDomains.filter((d) => isText(d, 200)).map((d) => d.trim().toLowerCase().replace(/^@/, '')) : [];
    const dp = p.deliveryProfile;
    if (dp && (!isText(dp.siteName, 200) || !isText(dp.address, 500) || !isText(dp.notes ?? '', 4000))) fail('deliveryProfile needs siteName, address and notes');
    const formats = mergeDocFormats((out[id] as CustomerProfile | undefined)?.docFormats, p.docFormats, fail);
    const pb = p.partyBlocks;
    if (pb !== undefined && pb !== null && (typeof pb !== 'object' || Object.entries(pb).some(([k, v]) => !['consignee', 'buyer', 'notify'].includes(k) || (v !== undefined && v !== null && !isText(v, 600))))) fail('partyBlocks must be consignee / buyer / notify text');
    // A save without partyBlocks (Org Settings → Customers doesn't know them) keeps the stored ones.
    const parties = pb === undefined ? { ...((out[id] as CustomerProfile | undefined)?.partyBlocks ?? {}) } : pb ? Object.fromEntries(Object.entries(pb).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()])) : {};
    out[id] = {
      customerId: id,
      key: p.key?.trim() || undefined,
      label: p.label?.trim() || undefined,
      billingMode: p.billingMode as BillingMode,
      sendImportPermit: p.sendImportPermit !== false,
      port: p.port?.trim() || undefined,
      truckCapacityT: truck,
      customsRatePerMt: p.customsRatePerMt === undefined || p.customsRatePerMt === null ? undefined : Number(p.customsRatePerMt),
      emailDomains: domains,
      docVariants: Object.fromEntries(Object.entries(dv).filter(([, v]) => !!v)) as DocVariants,
      // Round AM: the site's label / 倉庫名 / "to confirm" flag survive a save (they were dropped before).
      deliveryProfile: dp ? { ...deliveryExtras(dp), siteName: dp.siteName.trim(), address: dp.address.trim(), notes: dp.notes ?? '' } : null,
      invoiceRemarks: p.invoiceRemarks ?? undefined,
      defaultBankId: p.defaultBankId?.trim() || undefined,
      defaultBankCheck: p.defaultBankCheck === true || undefined,
      docAddressee: p.docAddressee?.trim() || undefined,
      ...(formats ? { docFormats: formats } : {}),
      ...(Object.keys(parties).length ? { partyBlocks: parties as PartyBlocks } : {}),
    };
  }
  return out;
}

/** The optional delivery-site keys kept on save (label, 倉庫名, warehouseCheck). */
function deliveryExtras(dp: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (typeof dp.label === 'string' && dp.label.length <= 100) out.label = dp.label;
  if (typeof dp.warehouseName === 'string' && dp.warehouseName.length <= 200) out.warehouseName = dp.warehouseName;
  if (dp.warehouseCheck === true) out.warehouseCheck = true;
  return out;
}

/**
 * Document formats on save: language / 宛先 / notes from the patch (validated); samples always from the stored profile
 * (only the Clients service adds or hides them). A patch without docFormats keeps the stored ones.
 */
export function mergeDocFormats(current: CustomerProfile['docFormats'], patch: unknown, fail: (msg: string) => never): CustomerProfile['docFormats'] | undefined {
  if (patch === undefined || patch === null) return current && Object.keys(current).length ? current : undefined;
  if (typeof patch !== 'object' || Array.isArray(patch)) fail('docFormats must be an object');
  const out: NonNullable<CustomerProfile['docFormats']> = {};
  const types = new Set([...Object.keys(current ?? {}), ...Object.keys(patch as object)]);
  for (const k of types) {
    if (!DOC_FORMAT_TYPES.includes(k as DocFormatType)) fail(`Unknown document format "${k}"`);
    const t = k as DocFormatType;
    const cur = current?.[t] ?? {};
    const raw = ((patch as Record<string, unknown>)[k] ?? cur) as Record<string, unknown>;
    if (typeof raw !== 'object') fail(`docFormats.${k} must be an object`);
    if (raw.language !== undefined && raw.language !== null && raw.language !== '' && raw.language !== 'ja' && raw.language !== 'en') fail('language must be ja or en');
    for (const f of ['addressee', 'notes'] as const) if (raw[f] !== undefined && raw[f] !== null && !isText(raw[f], f === 'notes' ? 2000 : 120)) fail(`docFormats.${k}.${f} must be text`);
    const next: DocFormat = {
      ...(raw.language === 'ja' || raw.language === 'en' ? { language: raw.language } : {}),
      ...(typeof raw.addressee === 'string' && raw.addressee.trim() ? { addressee: raw.addressee.trim() } : {}),
      ...(typeof raw.notes === 'string' && raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
      ...(cur.samples?.length ? { samples: cur.samples } : {}),
    };
    if (Object.keys(next).length) out[t] = next;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The single invoice's 備考 block (Kato sample) for a port. */
export function defaultSingleRemarks(port?: string | null): string {
  const p = port ? `${port.replace(/港$/, '')}港` : '名古屋港';
  return [
    ' 商　品：アルミビレット',
    ' 荷　姿：バンドル',
    ' 保管倉庫：三井倉庫',
    ` 取扱港　：${p}`,
    ' 保管条件：野積保管',
    ` 業務範囲：${p}到着後、CY通関、ドレージ、デバン入出庫、NO.取り作業(傷チェック)、保管(野積)、貴社指定場所（車上渡し)への配送まで`,
    ' 作業備考：コンテナ単位での保管指定あり',
    '',
    '※保管料、税関検査、船社立替、輸送費等は実費で最終見積調整',
  ].join('\n');
}
