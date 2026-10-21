// Round P wording for the inbox threads and the Sales dashboard — pure, tested
// in helpers/inboxThreads.test.mjs. No React, no MUI.
import type { InboxBy, InboxLinked, InboxLinkedFile, InboxMessage } from "./api";

/** "To do: 4 emails to confirm · 2 tasks overdue · 3 arriving this week" (the dashboard's top line). */
export function toDoLine(c: { emails: number; overdue: number; arriving: number }): string {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const parts = [c.emails ? `${n(c.emails, "email", "emails")} to confirm` : null, c.overdue ? `${n(c.overdue, "task", "tasks")} overdue` : null, c.arriving ? `${c.arriving} arriving this week` : null].filter(Boolean);
  return parts.length ? `To do: ${parts.join(" · ")}` : "Nothing to do — all emails are linked, no task overdue, nothing arriving this week.";
}

/** "Name <a@b.c>" → { name: "Name", email: "a@b.c" }; a bare address → its local part as the name. */
/** Round S: a file sent to the assistant on WhatsApp is stored as an email from "<name> via WhatsApp <…@whatsapp>". */
export const isWhatsAppSource = (from: string | null | undefined) => /@whatsapp>?$/i.test((from ?? "").trim());

export function fromParts(from: string | null | undefined): { name: string; email: string } {
  const s = (from ?? "").trim();
  const m = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s);
  if (m) return { name: m[1].trim() || m[2].split("@")[0], email: m[2].trim() };
  const email = s.replace(/^<|>$/g, "");
  return { name: email.split("@")[0] || "—", email };
}

/** "COA_9000565680.pdf → #28-1 · 3b · Certificate of analysis" */
export const linkedFileLine = (f: InboxLinkedFile): string => `${f.name} → ${[f.ref ?? "—", f.stepNo, f.docLabel ?? f.docType].filter(Boolean).join(" · ")}`;

/**
 * What Confirm will do / did: "files COA.pdf to step 3b · Certificate of analysis; fills blNumber 198GX…";
 * "links only (no files)" for a link-only email; "no order picked yet" when nothing is linked.
 */
export function whatHappens(m: Pick<InboxMessage, "linked" | "done">): string {
  const l = m.linked;
  if (!l) return "no order picked yet";
  const did = (m.done ?? []).some((a) => a.status === "done");
  const parts = [
    ...l.files.map((f) => `${did ? "filed" : "files"} ${f.name} to ${[f.stepNo ? `step ${f.stepNo}` : null, f.docLabel ?? f.docType].filter(Boolean).join(" · ") || "a step"}`),
    ...l.fields.map((f) => `${did ? "filled" : "fills"} ${f.field} ${f.value}`),
  ];
  return parts.length ? parts.join("; ") : did ? `Linked to ${l.ref ?? "the order"} (no files)` : "links only (no files)";
}

/** The "Linked to" chip text: "#15-1 (no files)" / "#28-1 · 3 files". */
export function linkedChip(l: InboxLinked | null): string | null {
  if (!l?.ref) return null;
  const n = l.files.length;
  return n ? `${l.ref} · ${n} file${n === 1 ? "" : "s"}` : `${l.ref} (no files)`;
}

/** "21 Oct 10:12" in Tokyo. */
export const whenShort = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(",", "");
};

/** "Confirmed by Sayaka · 21 Oct 10:12" / "Auto · B/L 198GX…" / "Auto · thread" / "Changed by …" / "Ignored by …". */
export function byLine(by: InboxBy | null | undefined): string | null {
  if (!by) return null;
  if (by.outcome === "AUTO") return `Auto · ${by.autoLabel ?? "applied by itself"}${by.at ? ` · ${whenShort(by.at)}` : ""}`;
  const verb = by.outcome === "ACCEPTED" ? "Confirmed" : by.outcome === "CHANGED" ? "Changed" : by.outcome === "IGNORED" ? "Ignored" : "Rejected";
  return `${verb} by ${by.name ?? "—"}${by.via === "whatsapp" ? " via WhatsApp" : ""}${by.at ? ` · ${whenShort(by.at)}` : ""}`;
}

/** The order page, on that shipment, with the step expanded. */
export function orderHref(orderId: string | null | undefined, shipmentId?: string | null, stepId?: string | null): string | null {
  if (!orderId) return null;
  const p = new URLSearchParams();
  if (shipmentId) p.set("shipment", shipmentId);
  if (stepId) p.set("step", stepId);
  const q = p.toString();
  return `/portal/shipments/orders/${orderId}${q ? `?${q}` : ""}`;
}

/** "5 emails · 3 files" */
export const threadCounts = (emails: number, files: number): string => `${emails} email${emails === 1 ? "" : "s"}${files ? ` · ${files} file${files === 1 ? "" : "s"}` : ""}`;

/** Shipments with an ETA from today through the next 7 days (Tokyo days), soonest first. */
export function arrivingThisWeek<T extends { eta: string | null }>(items: T[], today: string): T[] {
  const end = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  return items
    .filter((s) => s.eta && s.eta.slice(0, 10) >= today && s.eta.slice(0, 10) <= end)
    .sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? ""));
}
