// "Unconfirmed X(s)" / "Confirmed X(s)" bands — the legacy listings' split
// (Receipts / Payment Voucher / Journal Voucher listings had it first) now on
// EVERY report that lists individual transactions (guru 2026-11-12). The
// unconfirmed band is tinted red (ReportRow.highlight) so unconfirmed items
// stand out; running-balance reports print confirmed rows first and append
// the unconfirmed ones so BALANCE B/F and the running balance stay in order.
import type { ReportRow } from "./ReportTable";

export const isUnconfirmedStatus = (s?: string | null) => {
  const v = String(s || "").toLowerCase();
  return v === "draft" || v === "unconfirmed";
};

export const bandLabel = (noun: string, unconfirmed: boolean) => `${unconfirmed ? "Unconfirmed" : "Confirmed"} ${noun}(s)`;

/** A full-width band row: label in the first cell, the rest blank. */
export const bandRow = (key: string, label: string, cellCount: number, unconfirmed: boolean): ReportRow => ({
  kind: "row",
  key,
  cells: [{ text: label }, ...Array(Math.max(0, cellCount - 1)).fill("")],
  highlight: unconfirmed,
});

/** Split a list into [unconfirmed, confirmed] keeping each side's order. */
export function splitConfirmed<T>(items: T[], isUnconfirmed: (t: T) => boolean): { unconfirmed: T[]; confirmed: T[] } {
  return { unconfirmed: items.filter(isUnconfirmed), confirmed: items.filter((t) => !isUnconfirmed(t)) };
}
