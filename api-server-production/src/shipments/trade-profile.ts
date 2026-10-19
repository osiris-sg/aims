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
  if (scope === 'SUPPLIER_ORDER') return supplier && !supplier.hasPI ? ['PI_PAYMENT'] : [];
  if (p.billingMode === 'SINGLE' && scope === 'ORDER') return ['INVOICE_1'];
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
};

const isText = (v: unknown, max = 4000) => typeof v === 'string' && v.length <= max;
const TEMPLATE_KEYS = new Set([...Object.keys(CUSTOMER_DOC_TEMPLATES), 'INVOICE_SINGLE', 'INVOICE_2']);

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
    const dv = (p.docVariants ?? {}) as DocVariants;
    for (const [k, v] of Object.entries(dv)) {
      if (!['CUSTOMER_PL', 'CUSTOMER_COA', 'INVOICE'].includes(k)) fail(`Unknown document variant "${k}"`);
      if (v && !TEMPLATE_KEYS.has(v)) fail(`Unknown template "${v}"`);
    }
    const domains = Array.isArray(p.emailDomains) ? p.emailDomains.filter((d) => isText(d, 200)).map((d) => d.trim().toLowerCase().replace(/^@/, '')) : [];
    const dp = p.deliveryProfile;
    if (dp && (!isText(dp.siteName, 200) || !isText(dp.address, 500) || !isText(dp.notes ?? '', 4000))) fail('deliveryProfile needs siteName, address and notes');
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
      deliveryProfile: dp ? { siteName: dp.siteName.trim(), address: dp.address.trim(), notes: dp.notes ?? '' } : null,
      invoiceRemarks: p.invoiceRemarks ?? undefined,
    };
  }
  return out;
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
