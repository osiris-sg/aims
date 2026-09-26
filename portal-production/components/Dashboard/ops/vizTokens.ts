// Chart colour slots for the operations dashboard.
//
// Both columns are SELECTED steps, not an automatic flip: the dark values are
// the same hues re-stepped for a dark surface. The order is the documented
// categorical order, which is what makes ADJACENT pairs (stacked segments,
// neighbouring bars) separable — so a series keeps its slot index and segments
// are drawn in slot order.
//
// Validated with the palette checker before use:
//   light  worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6 — all checks pass
//   dark   worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3 — all checks pass
// Light mode returns a contrast WARN on the lighter hues, which obliges visible
// labels rather than colour alone: every chart here ships a legend and the
// figures are repeated as text beside the marks.
export const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
export const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;

export const seriesColor = (index: number, dark: boolean) =>
  (dark ? SERIES_DARK : SERIES_LIGHT)[index % SERIES_LIGHT.length];

// Stock statuses keep a FIXED slot each — filtering the list must never
// repaint the survivors, so colour follows the status, not its rank.
export const STOCK_STATUSES = [
  { key: "instock", label: "In stock", slot: 0 },
  { key: "rental", label: "On rent", slot: 1 },
  { key: "reserved", label: "Reserved", slot: 2 },
  { key: "maintenance", label: "In service", slot: 3 },
  { key: "sold", label: "Sold", slot: 4 },
] as const;

// Field-activity kinds, in the order the field flow produces them.
export const MSR_KINDS = [
  { key: "SERVICE", label: "Service visit", slot: 0 },
  { key: "DO_START", label: "Delivery started", slot: 1 },
  { key: "DO_INSTALL", label: "Installed", slot: 2 },
  { key: "DO_ACK", label: "Acknowledged", slot: 3 },
] as const;

export const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(1)}k`
    : `$${(n ?? 0).toFixed(0)}`;

export const monthLabel = (ym: string) => {
  const [y, m] = (ym || "").split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString("en-SG", { month: "short" });
};
