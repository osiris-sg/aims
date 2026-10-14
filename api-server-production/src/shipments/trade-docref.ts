/**
 * Document IDs for trade documents: "<contract no>-<shipment no>-<type code>"
 * (454003255-1-CPL), or "<contract no>-<type code>" for a document that sits
 * on the contract (454003255-PI, 454003255-INV1). A repeat of the same type on
 * the same record gets a counter (454003255-1-SGJP-2). The ID is assigned on
 * upload / create and never changes — it does not contain the B/L no., so
 * entering the B/L later keeps it stable. The document's own number printed on
 * the PDF (ADH-INV-2026-0001, ADH20260831 …) is separate.
 */

/** Short code per trade doc type; unknown types use their code without underscores. */
export const DOC_REF_CODES: Record<string, string> = {
  CONTRACT: 'SC',
  PI: 'PI',
  DEPOSIT_PROOF: 'DEP',
  INVOICE_1: 'INV1',
  BL_DRAFT: 'BLD',
  BL: 'BL',
  CI: 'CI',
  PL: 'PL',
  COA: 'COA',
  COO: 'COO',
  INSURANCE: 'INS',
  CUSTOMER_COA: 'CCOA',
  CUSTOMER_PL: 'CPL',
  CI_PAYMENT_PROOF: 'CIPAY',
  SGJP_IV_PL: 'SGJP',
  TAX_ESTIMATE: 'TAX',
  ARRIVAL_NOTICE: 'AN',
  SHIPPING_INSTRUCTIONS: 'SI',
  TELEX_RELEASE: 'TLX',
  DELIVERY_SCHEDULE: 'DSCH',
  IMPORT_PERMIT: 'PERMIT',
  INVOICE_2: 'INV2',
  VENDOR_INVOICE: 'VINV',
  PAYMENT_PROOF: 'PAY',
  OTHER: 'OTHER',
};

export const docRefCode = (docType: string) => DOC_REF_CODES[docType] ?? docType.replace(/_/g, '');

/** The ID before any repeat counter: on a shipment "<contract>-<seq>-<code>", on a contract "<contract>-<code>". */
export function docRefBase(owner: { contractNo: string; seqNo?: number | null }, docType: string): string {
  const seq = owner.seqNo ?? null;
  return seq ? `${owner.contractNo}-${seq}-${docRefCode(docType)}` : `${owner.contractNo}-${docRefCode(docType)}`;
}

/**
 * The next free ID for `base` given the IDs already used: the base itself
 * first, then base-2, base-3 … (the base counts as the first).
 */
export function nextDocRef(base: string, used: Iterable<string | null | undefined>): string {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-(\\d+))?$`);
  let max = 0;
  for (const u of used) {
    const m = u ? re.exec(u) : null;
    if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1);
  }
  return max === 0 ? base : `${base}-${max + 1}`;
}
