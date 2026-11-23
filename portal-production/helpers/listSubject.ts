// Subject column on the Quotations, Delivery Orders and Invoices lists (WCT group: enableWctDocNav; 2026-11-24). It
// replaces the Remarks column there; sortable and searchable on the server (api-server-production/src/documents/
// list-subject.ts). A DO / Invoice with no Subject of its own shows its quotation's, muted. Every other org and list:
// the Remarks column, unchanged. Pure helpers, tested by helpers/listSubject.test.mjs.

const QO = ["QUOTATION", "QO", "QO1", "QO2", "QT"];
const ALL = new Set([...QO, "DELIVERY_ORDER", "DO", "INVOICE", "TI", "TI2", "TAX_INVOICE", "INV"]);

/** The list shows Subject (not Remarks): the WCT doc nav flag and a quotation / DO / invoice list. */
export const subjectColumnOn = (documentTypes: string[] | null | undefined, wctDocNav: boolean | null | undefined): boolean =>
  !!wctDocNav && !!documentTypes?.length && documentTypes.every((t) => ALL.has(String(t ?? "").toUpperCase()));

/** The list's column id -> the server's sortBy. */
export const SUBJECT_SORT = "subject";

/** The cell: the server's listSubject, else the row's own config Subject (an older API). Muted = the quotation's. */
export function subjectCell(row: { listSubject?: { text: string; inherited: boolean } | null; config?: any } | null | undefined): { text: string; muted: boolean } | null {
  if (!row) return null;
  if (row.listSubject !== undefined) return row.listSubject?.text ? { text: row.listSubject.text, muted: !!row.listSubject.inherited } : null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const own = s(row.config?.subject) || s(row.config?.documentInfo?.subject);
  return own ? { text: own, muted: false } : null;
}
