/**
 * Shipment folder naming (ADH's improvement sheet, 2026-10):
 *   "{Grade}-{Diameter}_{Note}_{B/L No.}_{Net Weight}_{Port of Discharge}_{Contract No.}"
 *   e.g. 6063-8inch_Sep_198GX04630_305.804_Yokohama_454003422
 * Note = the delivery month (Sep). Files inside: "{folder}_{document ID}.{ext}".
 * SharePoint sync is a later phase (TODO: push the same folder there) — not built. Pure.
 */

const INCH_BY_MM: Record<number, number> = { 152: 6, 178: 7, 203: 8 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "203 MM X 5800 MM" / "8 inch" / '8"' → "8inch"; ingot (no size) → null. */
export function diameterOf(size: string | null | undefined): string | null {
  const s = (size ?? '').toUpperCase();
  const inch = /(\d{1,2})\s*(?:INCH|IN\b|"|”|インチ)/.exec(s);
  if (inch) return `${Number(inch[1])}inch`;
  const mm = /(\d{3})\s*MM/.exec(s);
  if (mm) {
    const v = Number(mm[1]);
    return INCH_BY_MM[v] ? `${INCH_BY_MM[v]}inch` : `${v}mm`;
  }
  return null;
}

/** "YOKOHAMA, JAPAN" → "Yokohama". */
export const portName = (p: string | null | undefined) => {
  const first = (p ?? '').split(',')[0].trim();
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : null;
};

/** Safe for Windows / SharePoint: no \ / : * ? " < > | and no spaces. */
const safe = (v: string) => v.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '');

export function shipmentFolderName(s: { grade?: string | null; size?: string | null; deliveryMonth?: string | null; blNumber?: string | null; netWeightMt?: number | null; portOfDischarge?: string | null; contractNo?: string | null }): string {
  const product = [s.grade?.trim() || null, diameterOf(s.size)].filter(Boolean).join('-');
  const note = /^\d{4}-\d{2}$/.test(s.deliveryMonth ?? '') ? MONTHS[Number(s.deliveryMonth!.slice(5, 7)) - 1] : null;
  const net = s.netWeightMt === null || s.netWeightMt === undefined ? null : Number(s.netWeightMt).toFixed(3);
  return [product || null, note, s.blNumber || null, net, portName(s.portOfDischarge), s.contractNo || null]
    .filter((x): x is string => !!x)
    .map(safe)
    .join('_');
}

/** A file's name in the folder: "{folder}_{document ID or type}{-n}.{ext}" — unique within the zip. */
export function folderFileNames(folder: string, files: Array<{ docRef: string | null; docType: string; fileName: string }>): string[] {
  const used = new Map<string, number>();
  return files.map((f) => {
    const ext = /\.([A-Za-z0-9]{1,6})$/.exec(f.fileName)?.[1]?.toLowerCase() ?? 'bin';
    const base = `${folder}_${safe(f.docRef || f.docType)}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return `${base}${n > 1 ? `-${n}` : ''}.${ext}`;
  });
}
