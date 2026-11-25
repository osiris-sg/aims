// WCT group service report flow from the order page (UAT 2026-11-25). Pure helpers:
//  - the order's DOs a report can be written for, and which one is pre-picked (never a draft one on its own);
//  - the Finish step's customer email (never prefilled with the customer's email on file);
//  - the report number as people read it (SR202611-0001, else the old #n);
//  - the report page's Order / DO / Job pills.

import { flowDoRowWord } from "./wctStatusFlow";

/** A DO the order page offers for a service report. */
export interface OrderReportDo {
  id: string;
  name: string | null;
  /** Not done yet and nothing scheduled: a draft (e.g. the one "Add DO" just made). */
  draft: boolean;
}

/**
 * The order's DOs, once each: the DOs made on the order, its jobs' DOs, its linked DOs. Cancelled ones left out.
 * `draft`: the same word as the order page and the DO list (wctStatusFlow flowDoRowWord, 2026-11-25): made by the system
 * and nobody has saved, confirmed or sent it for signature yet.
 */
export function orderReportDos(o: any): OrderReportDo[] {
  const out: OrderReportDo[] = [];
  const seen = new Set<string>();
  const add = (id: unknown, name: unknown, draft: boolean) => {
    if (typeof id !== "string" || !id || id.startsWith("erp:") || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name: typeof name === "string" && name ? name : null, draft });
  };
  for (const d of o?.deliveryOrders ?? []) {
    if (d?.cancelled === true || d?.status === "cancelled") continue;
    add(d.id, d.name, flowDoRowWord(d) === "Draft");
  }
  for (const j of o?.jobs ?? []) {
    if (j?.status === "cancelled" || !j?.deliveryOrder) continue;
    add(j.deliveryOrder.id, j.deliveryOrder.name, j.isDraft === true && j.status !== "completed");
  }
  for (const d of o?.linkedDos ?? []) add(d?.id, d?.name, false);
  return out;
}

/**
 * Which DO the report dialog starts with. A DO the person clicked on: that one. Else the order's only DO, unless it
 * is a draft (a draft DO is never picked for them: they pick it themselves). Several DOs: none (they pick).
 */
export function prePickedDoId(dos: OrderReportDo[], clicked?: string | null): string | null {
  if (clicked && dos.some((d) => d.id === clicked)) return clicked;
  if (dos.length === 1 && !dos[0].draft) return dos[0].id;
  return null;
}

/** "DO202611-0007" / "DO202611-0008 (Draft)": a DO in the report dialog's picker. */
export function reportDoLabel(d: OrderReportDo): string {
  return `${d.name || "DO"}${d.draft ? " (Draft)" : ""}`;
}

/**
 * The Finish step's customer email box in the office (manual flow): only what was typed on the form before (the
 * saved draft), or, for a report completed before and reopened, the address it was completed with. Never the
 * customer's email on file (a new report starts with an empty box).
 */
export function officeEmailPrefill(r: { reportNumber?: number | null; serviceData?: any }): string {
  const sd = r?.serviceData ?? {};
  const typed = typeof sd?.draft?.clientEmail === "string" ? sd.draft.clientEmail : "";
  if (typed) return typed;
  return r?.reportNumber != null && typeof sd.clientEmail === "string" ? sd.clientEmail : "";
}

/** SR202611-0001 when the report has one, else the old running number (`pad`: #000004), else null. */
export function reportNoText(r: { reportNumber?: number | null; srNumber?: string | null; serviceData?: any } | null | undefined, opts: { pad?: boolean } = {}): string | null {
  const sr = r?.srNumber ?? r?.serviceData?.srNumber;
  if (typeof sr === "string" && /^SR\d{6}-\d{4,}$/.test(sr)) return sr;
  const n = r?.reportNumber;
  if (n == null) return null;
  return `#${opts.pad ? String(n).padStart(6, "0") : n}`;
}

export interface ReportPill {
  key: "order" | "do" | "job";
  label: string;
  href: string;
}

/** The report page's Order / DO / Job pills (each opens in a new tab). */
export function reportLinkPills(r: {
  order?: { id: string; orderNumber: string } | null;
  links?: { do?: { id: string; name: string | null } | null; job?: { id: string; number: number | null } | null } | null;
}): ReportPill[] {
  const out: ReportPill[] = [];
  if (r?.order?.id) out.push({ key: "order", label: r.order.orderNumber || "Order", href: `/portal/orders/${r.order.id}` });
  const d = r?.links?.do;
  if (d?.id) out.push({ key: "do", label: d.name || "DO", href: `/portal/documents/open/${d.id}` });
  const j = r?.links?.job;
  if (j?.id) out.push({ key: "job", label: j.number != null ? `Job #${j.number}` : "Job", href: `/portal/deliveries/${j.id}` });
  return out;
}
