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

/** Order / shipment step codes that don't apply to this customer ("N/A (customer profile)"). */
export function naStepCodes(p: CustomerProfile, scope: 'ORDER' | 'SHIPMENT' | 'CONTRACT'): string[] {
  if (p.billingMode === 'SINGLE' && scope === 'ORDER') return ['INVOICE_1'];
  return [];
}

/** Step changes for this customer: SINGLE billing issues one invoice on step 11 (INVOICE_SINGLE). */
export function stepOverride(p: CustomerProfile, code: string): { title?: string; requiredDocTypes?: string[] } {
  if (p.billingMode === 'SINGLE' && code === 'INVOICE_2') return { title: 'Issue invoice (single)', requiredDocTypes: ['INVOICE_SINGLE'] };
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
