// Service / field report status for the office screens (2026-11-02). A draft
// that is not a WCT scheduled report was submitted unsigned (field app Skip)
// and waits for the customer's signature: "Pending sign", never "Completed".

export type MsrStatusChip = {
  label: string;
  color: "success" | "warning" | "info" | "default";
  variant: "filled" | "outlined";
};

type MsrLike = { status?: string | null; kind?: string | null; serviceData?: { scheduled?: boolean } | null };

export function msrStatusChip(r: MsrLike): MsrStatusChip {
  if (r.status === "completed") return { label: "Completed", color: "success", variant: "filled" };
  if (r.status === "draft") {
    // WCT: created with the run, written by the technician after the sign-off.
    if (r.serviceData?.scheduled) return { label: "Scheduled", color: "info", variant: "outlined" };
    // A started delivery's proof row stays draft until the handover.
    if (r.kind === "DO_START") return { label: "In progress", color: "info", variant: "outlined" };
    return { label: "Pending sign", color: "warning", variant: "outlined" };
  }
  return { label: r.status || "—", color: "default", variant: "outlined" };
}
