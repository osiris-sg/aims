// The toolbar "Send" menu (features.enableWctDocNav, WCT group 2026-11-17).
//
// One "Send" button replaces "Send for signature" / "Send Email" on the
// quotation, invoice, delivery order and service report. It lists only what
// the document can do today, with the same show rules as the old buttons:
//   - Send for signature: the existing sign-link flow of that document.
//   - Send email: the existing manual email send of that document.
//   - Send WhatsApp: shown disabled (not built yet).
// No option of its own = no Send button (WhatsApp alone is not a menu).

export type SendKey = "sign" | "email" | "whatsapp";
export type SendOption = { key: SendKey; label: string; disabled: boolean };

export const SEND_LABELS: Record<SendKey, string> = {
  sign: "Send for signature",
  email: "Send email",
  whatsapp: "Send WhatsApp",
};

export type SendDocKind = "quotation" | "invoice" | "do" | "serviceReport" | "other";

const QUOTATION_TYPES = ["QUOTATION", "QO", "QO1", "QO2", "QT"];
const INVOICE_TYPES = ["INVOICE", "TI", "TI2"];
const DO_TYPES = ["DO", "DELIVERY_ORDER"];

/** The editor's document type to a Send-menu kind. */
export function sendDocKind(documentType: string | null | undefined): SendDocKind {
  const t = String(documentType || "").toUpperCase();
  if (QUOTATION_TYPES.includes(t)) return "quotation";
  if (INVOICE_TYPES.includes(t)) return "invoice";
  if (DO_TYPES.includes(t)) return "do";
  return "other";
}

/**
 * Options for the document editor (quotation / invoice / DO).
 *  - quotation: sign = e-sign orgs, saved, not confirmed, not a template (the
 *    old "Send for signature" rule); email = any status (the old Send Email
 *    rule; the menu also offers it on e-sign quotations).
 *  - invoice: email only, any status (the old Send Email rule).
 *  - DO on an order (manual flow): sign = the order DO's "Customer sign link",
 *    not once completed. A DO not on an order: sign = "Share DO link (view /
 *    sign)", any saved DO. DOs have no email send (the API emails only
 *    invoices and quotations).
 */
export function editorSendOptions(o: {
  documentType: string | null | undefined;
  saved: boolean;
  confirmed: boolean;
  templateMode: boolean;
  quotationESign: boolean;
  doOnOrder: boolean;
  doCompleted: boolean;
}): SendOption[] {
  const kind = sendDocKind(o.documentType);
  const out: SendOption[] = [];
  const add = (key: SendKey, disabled = false) => out.push({ key, label: SEND_LABELS[key], disabled });
  if (kind === "quotation") {
    if (o.quotationESign && o.saved && !o.confirmed && !o.templateMode) add("sign");
    add("email");
  } else if (kind === "invoice") {
    add("email");
  } else if (kind === "do") {
    if (o.templateMode || !o.saved) return [];
    if (o.doOnOrder ? !o.doCompleted : true) add("sign");
  }
  if (!out.length) return [];
  add("whatsapp", true);
  return out;
}

/**
 * Options for the service report page.
 *  - sign: the report's "Customer sign link" (not completed, not the WCT
 *    paper, not an uploaded file; the old rule).
 *  - email: "Send service report to customer" of the report's order (manual
 *    order flow, report on an order); disabled until this report is completed.
 *    That send emails every completed report of the order.
 */
export function reportSendOptions(o: {
  status: string | null | undefined;
  isWctPaper: boolean;
  isUploaded: boolean;
  manualOrderFlow: boolean;
  onOrder: boolean;
  deleted: boolean;
}): SendOption[] {
  const out: SendOption[] = [];
  const completed = o.status === "completed";
  if (!completed && !o.isWctPaper && !o.isUploaded) out.push({ key: "sign", label: SEND_LABELS.sign, disabled: false });
  if (o.manualOrderFlow && o.onOrder) out.push({ key: "email", label: SEND_LABELS.email, disabled: !completed || o.deleted });
  if (!out.length) return [];
  out.push({ key: "whatsapp", label: SEND_LABELS.whatsapp, disabled: true });
  return out;
}

/**
 * The editor toolbar's send controls. Setting off: the old "Send for
 * signature" / "Send Email" buttons with their old rules, no menu (identical
 * to before). Setting on: the Send menu only.
 */
export function editorSendControls(
  enabled: boolean,
  o: Parameters<typeof editorSendOptions>[0],
): { menu: SendOption[] | null; legacySign: boolean; legacyEmail: boolean } {
  if (enabled) return { menu: editorSendOptions(o), legacySign: false, legacyEmail: false };
  const t = String(o.documentType || "");
  const isQuotation = ["QUOTATION", "QO", "QO1", "QO2", "QT"].includes(t);
  const cielSign = isQuotation && o.quotationESign;
  return {
    menu: null,
    legacySign: cielSign && o.saved && !o.confirmed && !o.templateMode,
    legacyEmail: t === "TI" || t === "TI2" || t === "INVOICE" || (isQuotation && !cielSign),
  };
}

/** The service report toolbar: setting off = the old "Copy sign link" button rule, no menu. */
export function reportSendControls(
  enabled: boolean,
  o: Parameters<typeof reportSendOptions>[0],
): { menu: SendOption[] | null; legacySignLink: boolean } {
  if (enabled) return { menu: reportSendOptions(o), legacySignLink: false };
  return { menu: null, legacySignLink: o.status !== "completed" && !o.isWctPaper && !o.isUploaded };
}

/** An invoice voided with its cancelled order (helpers/docStatus isVoidedWithOrder) offers no send at all. */
export function withoutSendWhenVoided<T extends { menu: SendOption[] | null; legacySign: boolean; legacyEmail: boolean }>(c: T, voided: boolean): T {
  return voided ? { ...c, menu: null, legacySign: false, legacyEmail: false } : c;
}
