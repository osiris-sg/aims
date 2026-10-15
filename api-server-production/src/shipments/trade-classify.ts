/**
 * Bulk upload with AI sorting: which of a step's document types is a dropped
 * file? Three signals, combined:
 *   1. the file name (Vedanta / shipping-line naming: COMMERCIAL_INVOICE_…,
 *      PACKING_LIST_CONTAINER_…, COA_…, COO_…, INSURANCE, "<B/L no.> SCAN", …);
 *   2. for spreadsheets (Vedanta's tab-delimited .XLS, .xlsx, .csv) the header
 *      row: Cast No + FE / SI chemistry → COA summary; Container ID + Net /
 *      Gross Wt → packing list;
 *   3. for PDFs and images, Claude reads the document and names its type.
 * The result is one of the step's allowed types (else OTHER), a variant
 * ("container PL", "COA summary"…), a confidence 0–1 and whether it is the
 * step's primary file of that type (the one the required row shows; extra
 * files of a type land under Optional).
 */

export type ClassifyVariant = { docType: string; variant: string | null; primary: boolean };
export type Classification = ClassifyVariant & { confidence: number; source: 'name' | 'sheet' | 'ai' | 'name+ai' | 'none'; reason: string };

/** Below this the confirm table flags the row for a check. */
export const LOW_CONFIDENCE = 0.7;

const SPREADSHEET = /\.(xls|xlsx|csv|txt)$/i;

/** File-name rules, most specific first. */
const NAME_RULES: Array<{ re: RegExp } & ClassifyVariant> = [
  { re: /packing[\s_-]*list[\s_-]*container|container[\s_-]*(pl|packing)/i, docType: 'PL', variant: 'container PL', primary: false },
  { re: /^(pl|packing[\s_-]*list)[^/]*\.(xls|xlsx|csv)$/i, docType: 'PL', variant: 'PL spreadsheet', primary: false },
  { re: /packing[\s_-]*list|(^|[\s_-])pl([\s_.-]|$)/i, docType: 'PL', variant: null, primary: true },
  { re: /(^|[\s_-])coa[^/]*\.(xls|xlsx|csv)$|coa[\s_-]*(集計|summary)|集計/i, docType: 'COA', variant: 'COA summary', primary: false },
  { re: /(^|[\s_-])coa([\s_.-]|$)|certificate[\s_-]*of[\s_-]*analysis|test[\s_-]*(report|cert)/i, docType: 'COA', variant: null, primary: true },
  { re: /(^|[\s_-])coo([\s_.-]|$)|certificate[\s_-]*of[\s_-]*origin/i, docType: 'COO', variant: null, primary: true },
  { re: /insur/i, docType: 'INSURANCE', variant: null, primary: true },
  { re: /commercial[\s_-]*invoice|(^|[\s_-])ci([\s_.-]|$)/i, docType: 'CI', variant: null, primary: true },
  { re: /arrival[\s_-]*notice|(^|[\s_-])an([\s_.-]|$)/i, docType: 'ARRIVAL_NOTICE', variant: null, primary: true },
  { re: /b\/?l[\s_-]*draft|draft[\s_-]*b\/?l/i, docType: 'BL_DRAFT', variant: null, primary: true },
  { re: /bill[\s_-]*of[\s_-]*lading|(^|[\s_-])b\/?l([\s_.-]|$)|^\d{3}[a-z]{2}\d{5}/i, docType: 'BL', variant: null, primary: true },
  { re: /telex|surrender/i, docType: 'TELEX_RELEASE', variant: null, primary: true },
  { re: /import[\s_-]*permit|輸入許可/i, docType: 'IMPORT_PERMIT', variant: null, primary: true },
  { re: /delivery[\s_-]*schedule|納入予定/i, docType: 'DELIVERY_SCHEDULE', variant: null, primary: true },
];

export function classifyByName(fileName: string): ClassifyVariant | null {
  const name = (fileName ?? '').normalize('NFC');
  for (const r of NAME_RULES) if (r.re.test(name)) return { docType: r.docType, variant: r.variant, primary: r.primary };
  return null;
}

/** Spreadsheet content: the header row of Vedanta's exports. */
export function classifySheetText(text: string): ClassifyVariant | null {
  const head = (text ?? '').split(/\r?\n/).slice(0, 15).join(' ').toLowerCase();
  const has = (w: string) => head.includes(w);
  if ((has('cast no') || has('cast')) && (has('fe') && has('si'))) return { docType: 'COA', variant: 'COA summary', primary: false };
  if (has('container') && (has('net wt') || has('net weight')) && (has('gross') || has('batch'))) return { docType: 'PL', variant: 'PL spreadsheet', primary: false };
  return null;
}

export const isSpreadsheet = (fileName: string) => SPREADSHEET.test(fileName ?? '');

/** What Claude is told each type is (only the step's allowed types are offered). */
export const DOC_TYPE_HINTS: Record<string, string> = {
  BL: 'Bill of Lading (final, often a scan; shipper, consignee, notify party, vessel/voyage, containers)',
  BL_DRAFT: 'Draft Bill of Lading sent for approval',
  CI: "Supplier's Commercial Invoice (invoice no., unit price, amount)",
  PL: 'Packing List (batches / bundles with net and gross weight; a "container" packing list groups them per container)',
  COA: 'Certificate of Analysis / test report (chemical composition per cast: Fe, Si, Mg…); a COA summary also lists bundles and weights',
  COO: 'Certificate of Origin',
  INSURANCE: 'Insurance certificate / policy',
  ARRIVAL_NOTICE: 'Arrival Notice from the shipping line (ETA, charges, CY)',
  TELEX_RELEASE: 'Telex release / surrender notice',
  DELIVERY_SCHEDULE: "Customer's delivery schedule",
  IMPORT_PERMIT: 'Japanese import permit (輸入許可書)',
  VENDOR_INVOICE: 'Warehouse / transport vendor invoice',
  PAYMENT_PROOF: 'Bank transfer slip / payment proof',
  CI_PAYMENT_PROOF: 'Bank transfer slip for the commercial invoice balance',
  DEPOSIT_PROOF: 'Bank transfer slip for the PI deposit',
  PI: 'Proforma Invoice',
  CONTRACT: 'Sales contract',
  TAX_ESTIMATE: 'Import tax estimate from the customs broker',
  OTHER: 'Anything else',
};

export function classifyPrompt(allowed: string[]): [string, string] {
  const types = [...new Set([...allowed, 'OTHER'])];
  const system =
    'You sort shipping documents for an aluminium-billet import business (Vedanta India → Japan). Look at the document and pick its type from the list. Output STRICT JSON only.';
  const user = `Which ONE of these types is this document?
${types.map((t) => `- ${t}: ${DOC_TYPE_HINTS[t] ?? t}`).join('\n')}
Answer exactly: {"docType": "<one of: ${types.join(', ')}>", "variant": "container PL" | "COA summary" | null, "confidence": <0..1>, "reason": "<max 12 words>"}`;
  return [system, user];
}

/**
 * Combine the signals. AI and name agreeing → high confidence; the AI alone
 * (name unknown) keeps its own confidence; a disagreement goes to the AI but
 * is flagged; no AI → the name (or sheet) rule at a fixed confidence. Types
 * outside the step's allowed list become OTHER (low confidence).
 */
export function combineClassification(
  allowed: string[],
  name: ClassifyVariant | null,
  sheet: ClassifyVariant | null,
  ai: { docType?: unknown; variant?: unknown; confidence?: unknown; reason?: unknown } | null,
): Classification {
  const ok = (t: unknown): t is string => typeof t === 'string' && (allowed.includes(t) || t === 'OTHER');
  const aiType = ai && ok(ai.docType) ? (ai.docType as string) : null;
  const aiConf = ai && typeof ai.confidence === 'number' && Number.isFinite(ai.confidence) ? Math.max(0, Math.min(1, ai.confidence)) : 0.75;
  const aiReason = ai && typeof ai.reason === 'string' ? ai.reason.slice(0, 120) : '';
  const known = sheet ?? name;
  if (known && !allowed.includes(known.docType)) {
    if (!aiType) return { docType: 'OTHER', variant: null, primary: false, confidence: 0.4, source: sheet ? 'sheet' : 'name', reason: `Looks like ${known.docType}, which this step doesn't take` };
  }
  if (sheet && allowed.includes(sheet.docType)) return { ...sheet, confidence: 0.95, source: 'sheet', reason: 'Spreadsheet columns' };
  if (aiType && known && allowed.includes(known.docType)) {
    if (aiType === known.docType) {
      const variant = known.variant ?? (typeof ai!.variant === 'string' ? (ai!.variant as string) : null);
      return { docType: aiType, variant, primary: variant ? known.primary && !known.variant : known.primary, confidence: Math.max(0.9, aiConf), source: 'name+ai', reason: aiReason || 'File name and content agree' };
    }
    return { docType: aiType, variant: typeof ai!.variant === 'string' ? (ai!.variant as string) : null, primary: true, confidence: Math.min(aiConf, 0.6), source: 'ai', reason: `Content says ${aiType}, the file name says ${known.docType}` };
  }
  if (aiType) {
    const variant = typeof ai!.variant === 'string' ? (ai!.variant as string) : null;
    return { docType: aiType, variant, primary: !variant, confidence: aiType === 'OTHER' ? Math.min(aiConf, 0.5) : aiConf, source: 'ai', reason: aiReason || 'Read by AI' };
  }
  if (known && allowed.includes(known.docType)) return { ...known, confidence: 0.75, source: 'name', reason: 'From the file name' };
  return { docType: 'OTHER', variant: null, primary: false, confidence: 0.3, source: 'none', reason: 'Not recognised — choose the type' };
}
