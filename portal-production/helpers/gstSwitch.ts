// GST switch with company move (WCT group, 2026-11-24). Pure helpers for components/GstSwitchToggle.tsx; tested by
// helpers/gstSwitch.test.mjs. API: api-server-production/src/gst-switch/.

export interface GstPreview {
  same?: boolean;
  blocked: string | null;
  headline: string | null;
  to: { id: string; name: string } | null;
  toGst?: boolean;
  documents: Array<{ id: string; kind: string; name: string | null; status: string | null; action: "move" | "credit" }>;
  creditNotes: Array<{ invoiceId: string; invoice: string | null; amount: number; already: boolean }>;
}

export const gstSwitchLabel = (gst: boolean) => (gst ? "GST invoice" : "Non-GST invoice");

/** The confirm pop-up's rows: each document and what happens to it. */
export function gstMoveRows(p: GstPreview): Array<{ key: string; kind: string; name: string; action: string }> {
  const to = p.to?.name ?? "the other company";
  return (p.documents ?? []).map((d) => ({
    key: d.id,
    kind: d.kind,
    name: d.name || "Draft",
    action: d.action === "credit" ? "Credit note here, new draft invoice there" : `Moves to ${to}, new number`,
  }));
}
