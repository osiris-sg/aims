// WCT manual order flow (2026-11-13): the order page sends "Add service report" to the
// Service Reports page's own New Report / Upload flow, with the customer + DO prefilled.
// The page reads the same query back (and drops it once the flow is open).

export type ServiceReportFlowMode = "new" | "upload";
export type ServiceReportPrefill = { customer: { id: string; name: string } | null; doId: string | null };

export function serviceReportFlowHref(mode: ServiceReportFlowMode, prefill: ServiceReportPrefill): string {
  const p = new URLSearchParams();
  p.set(mode, "1");
  if (prefill.customer) {
    p.set("customerId", prefill.customer.id);
    p.set("customerName", prefill.customer.name);
  }
  if (prefill.doId) p.set("doId", prefill.doId);
  return `/portal/maintenance-reports?${p.toString()}`;
}

export function readServiceReportFlow(search: string): ({ mode: ServiceReportFlowMode } & ServiceReportPrefill) | null {
  const p = new URLSearchParams(search);
  const mode: ServiceReportFlowMode | null = p.get("new") === "1" ? "new" : p.get("upload") === "1" ? "upload" : null;
  if (!mode) return null;
  const id = p.get("customerId");
  return { mode, customer: id ? { id, name: p.get("customerName") || "" } : null, doId: p.get("doId") || null };
}

// WCT round 12 (2026-11-19): the order page's ONE "Service report" button. Its menu holds what the
// separate buttons did: New and Upload file (manual order flow: the Service Reports page's own flows,
// customer + DO prefilled) and Link existing (the order's "Link a service report" dialog). Without the
// manual flow (e.g. WCT Racking), Upload file stores the file on the order, as the old Upload file button.
export type ServiceReportMenuKey = "new" | "upload" | "link";
export type ServiceReportMenuItem = { key: ServiceReportMenuKey; label: string; tour: string };

export function serviceReportMenuItems(manualFlow: boolean): ServiceReportMenuItem[] {
  return [
    ...(manualFlow ? [{ key: "new" as const, label: "New", tour: "wct-order-new-report" }] : []),
    { key: "upload", label: "Upload file", tour: "wct-order-upload-report" },
    { key: "link", label: "Link existing", tour: "wct-order-link-report" },
  ];
}

// The file types each upload takes, as the file picker's accept attribute. An uploaded SERVICE REPORT
// (Service Reports page upload, its photos file) must be one of these: the API checks the same list
// (api-server-production/src/maintenance-reports/uploaded-report.ts, MIME_EXT).
export const REPORT_FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif";
// A file stored straight on an order (orders without the manual flow): the picker has always taken a PDF
// or any image; the API stores the file without checking its type.
export const ORDER_FILE_ACCEPT = "application/pdf,image/*";

const TYPE_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/gif": "GIF",
  "image/*": "any image",
};

/** "PDF, JPG, PNG, WEBP or GIF": the accept list in words, for the upload control's tooltip. */
export function acceptLabel(accept: string): string {
  const words = accept
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => TYPE_LABEL[t] ?? t);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}` : words[0] ?? "";
}

/** The tooltip on the order page's Upload file: the types that upload takes. */
export function orderUploadTip(manualFlow: boolean): string {
  return acceptLabel(manualFlow ? REPORT_FILE_ACCEPT : ORDER_FILE_ACCEPT);
}
