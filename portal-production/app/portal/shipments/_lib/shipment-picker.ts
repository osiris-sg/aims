// Round AV (Sayaka, ADH Sales) — the Answer flow's "Which shipment?" picker and its add / edit drawer: pure helpers
// (tested by helpers/shipmentPicker.test.mjs). The components are ChooseShipmentDialog, ShipmentDrawer and
// ShipmentFormDialog (bare / order / emailFacts).

import type { EmailFactKey, EmailShipmentFacts, OrderListItem, ShipmentListItem } from "./api";

/** The two formatters the lines use (format.ts's fmtDay / shortCustomer) — passed in so this file has no runtime imports. */
export type PickerFmt = { day: (d?: string | null) => string; customer: (name: string | null | undefined) => string | null };

/** "#18-2 · SUS · 6005 · 20.4 t · ETA 29 Oct" — one shipment row; no net yet → its B/L, or "no B/L yet". */
export function shipmentLine(s: Pick<ShipmentListItem, "ref" | "blNumber" | "netWeightMt" | "eta" | "customerName" | "customer" | "order" | "contractLine" | "productLine">, fmt: PickerFmt): string {
  const net = s.netWeightMt !== null && s.netWeightMt !== undefined && s.netWeightMt !== "" && Number.isFinite(Number(s.netWeightMt)) ? `${Number(s.netWeightMt).toLocaleString("en-US", { maximumFractionDigits: 1 })} t` : null;
  const grade = s.order?.grade ?? s.contractLine?.grade ?? s.productLine ?? null;
  const qty = net ?? (s.blNumber ? `B/L ${s.blNumber}` : "no B/L yet");
  return [s.ref || (s.blNumber ? `B/L ${s.blNumber}` : "Shipment"), fmt.customer(s.customerName ?? s.customer?.name), grade, qty, s.eta ? `ETA ${fmt.day(s.eta).slice(0, 6)}` : null].filter(Boolean).join(" · ");
}

/** "#27-1": the order's next shipment number (cancelled shipments keep theirs, as the server counts). */
export function nextShipmentRef(o: Pick<OrderListItem, "orderNo" | "shipments">): string {
  const max = Math.max(0, ...(o.shipments ?? []).map((s) => s.seqNo ?? 0));
  return `#${o.orderNo}-${max + 1}`;
}

/** "#27 · Kato 6005 · 40 t" — an order in the picker. */
export function orderLine(o: Pick<OrderListItem, "orderNo" | "customerName" | "customer" | "grade" | "qtyMt">, fmt: Pick<PickerFmt, "customer">): string {
  const qty = o.qtyMt !== null && o.qtyMt !== undefined && o.qtyMt !== "" && Number.isFinite(Number(o.qtyMt)) ? `${Number(o.qtyMt).toLocaleString("en-US", { maximumFractionDigits: 3 })} t` : null;
  return [`#${o.orderNo}`, [fmt.customer(o.customerName ?? o.customer?.name), o.grade].filter(Boolean).join(" ") || null, qty].filter(Boolean).join(" · ");
}

/** The order search text: #n (and its old numbers), customer, grade, contract, PI. */
export const orderHaystack = (o: Pick<OrderListItem, "orderNo" | "previousOrderNos" | "customerName" | "customer" | "grade" | "product" | "size" | "contractNo" | "piNo" | "label">) =>
  [`#${o.orderNo}`, ...(o.previousOrderNos ?? []).map((n) => `#${n}`), o.customerName, o.customer?.name, o.grade, o.product, o.size, o.contractNo, o.piNo, o.label].filter(Boolean).join(" ").toLowerCase();

/** "All shipments" groups — open orders (completed ones on request, never cancelled), newest ETA first. */
export function orderGroups<O extends Pick<OrderListItem, "orderNo" | "status" | "shipMonth" | "shipments">>(orders: O[], opts: { showCompleted: boolean }): O[] {
  const latest = (o: O) => {
    const etas = (o.shipments ?? []).filter((x) => x.status !== "CANCELLED" && x.eta).map((x) => new Date(x.eta!).getTime());
    if (etas.length) return Math.max(...etas);
    // No ETA yet: by ship month (end of month), else last.
    return o.shipMonth ? new Date(`${o.shipMonth}-28T00:00:00Z`).getTime() : -Infinity;
  };
  return orders.filter((o) => o.status !== "CANCELLED" && (opts.showCompleted || o.status !== "COMPLETED")).sort((a, b) => latest(b) - latest(a) || b.orderNo - a.orderNo);
}

const NUMERIC: EmailFactKey[] = ["netWeightMt", "grossWeightMt", "totalBundles", "containerCount"];
/** Same value for the form? Numbers by value (20.4 = 20.40), the rest by text (case-insensitive). */
export function sameFactValue(k: EmailFactKey, a: string, b: string): boolean {
  if (NUMERIC.includes(k)) return a.trim() !== "" && b.trim() !== "" && Number(a) === Number(b);
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** A NEW shipment's prefill: the email's agreed values into EMPTY fields only. */
export function factPrefill(form: Record<string, string>, facts: Pick<EmailShipmentFacts, "fields"> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!facts) return out;
  for (const [k, f] of Object.entries(facts.fields)) {
    if (f?.value && k in form && !String(form[k] ?? "").trim()) out[k] = f.value;
  }
  return out;
}

/** Beside a field: the email agrees ("same"), or its other value(s) to offer with "Use this" — never applied by itself. */
export function factSuggestion(k: EmailFactKey, current: string, facts: Pick<EmailShipmentFacts, "fields"> | null | undefined): { same: { value: string; sources: string[] } | null; others: Array<{ value: string; sources: string[] }>; several: boolean } | null {
  const f = facts?.fields[k];
  if (!f || !f.candidates.length) return null;
  const same = f.candidates.find((c) => sameFactValue(k, c.value, current)) ?? null;
  return { same, others: f.candidates.filter((c) => !sameFactValue(k, c.value, current)), several: f.candidates.length > 1 };
}

/** The order's quantity left: max (qty ± tolerance) − the other shipments' net (`ownNet` = this shipment's, on an edit). */
export function qtyLeft(tol: { max: number; netTotal: number } | null | undefined, ownNet: number | null = null): number | null {
  if (!tol) return null;
  const own = ownNet !== null && Number.isFinite(ownNet) ? ownNet : 0;
  return Math.round((tol.max - (tol.netTotal - own)) * 1000) / 1000;
}
