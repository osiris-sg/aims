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
