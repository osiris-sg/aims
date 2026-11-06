// Round BG — the link checklist (link one file to several orders / shipments in one go). Pure: no React, no imports.

export type CheckKind = "order" | "shipment" | "contract" | "supplierOrder";
export type CheckItem = {
  key: string;
  kind: CheckKind;
  /** "#18" / "#18-2" (or a contract / supplier order label). */
  ref: string;
  /** The rest of the line: customer, B/L, product … */
  detail?: string | null;
  /** The order's ref ("#18") for shipments — the "Select all shipments of #18" group. */
  orderRef?: string | null;
  customer?: string | null;
  bl?: string | null;
  /** Round BG part 2.3: the shipment's CI (a payment proof covering several CIs). */
  ciNo?: string | null;
  ciAmount?: number | null;
  currency?: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[\s　]+/g, " ").trim();

/** "#18" (or "18") → order #18 and its shipments #18-1, #18-2 (never #180); "#18-2" → that shipment; else text in ref / B/L / customer / detail. */
export function matches(it: CheckItem, q: string): boolean {
  const s = norm(q);
  if (!s) return true;
  const ref = /^#?(\d{1,6})(?:-(\d{1,3}))?$/.exec(s);
  if (ref) {
    const want = ref[2] ? `#${ref[1]}-${ref[2]}` : `#${ref[1]}`;
    const r = it.ref.toLowerCase();
    if (ref[2]) return r === want;
    if (r === want || r.startsWith(`${want}-`) || (it.orderRef ?? "").toLowerCase() === want) return true;
    // A bare number may also be part of a B/L or CI number.
    return /^\d{4,}$/.test(ref[1]) && [it.bl, it.ciNo].some((x) => (x ?? "").toLowerCase().includes(ref[1]));
  }
  const hay = norm([it.ref, it.detail, it.customer, it.bl ? `B/L ${it.bl}` : null, it.bl, it.ciNo].filter(Boolean).join(" "));
  return s.split(" ").every((w) => hay.includes(w));
}

const refNum = (ref: string) => {
  const m = /^#(\d+)(?:-(\d+))?/.exec(ref);
  return m ? Number(m[1]) * 1000 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
};

export type CheckGroups = {
  orders: CheckItem[];
  /** Shipments by order ("#18" → its shipments), orders in number order. */
  shipments: Array<{ orderRef: string | null; items: CheckItem[] }>;
  other: CheckItem[];
};

/** The visible items, grouped Orders / Shipments (by order) / other, in number order; a ticked item is never hidden by the search. */
export function groupItems(items: CheckItem[], q: string, ticked: Set<string>): CheckGroups {
  const seen = new Set<string>();
  const vis = items.filter((it) => {
    if (seen.has(it.key)) return false;
    seen.add(it.key);
    return matches(it, q) || ticked.has(it.key);
  });
  const byRef = (a: CheckItem, b: CheckItem) => refNum(a.ref) - refNum(b.ref) || a.ref.localeCompare(b.ref);
  const ships = vis.filter((x) => x.kind === "shipment").sort(byRef);
  const groups = new Map<string, CheckItem[]>();
  for (const s of ships) {
    const k = s.orderRef ?? "";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return {
    orders: vis.filter((x) => x.kind === "order").sort(byRef),
    shipments: [...groups.entries()].map(([orderRef, xs]) => ({ orderRef: orderRef || null, items: xs })),
    other: vis.filter((x) => x.kind === "contract" || x.kind === "supplierOrder").sort(byRef),
  };
}

/** Tick / untick every key (the "Select all shipments of #18" button: all on unless they already all are). */
export function toggleAll(value: string[], keys: string[]): string[] {
  const all = keys.length > 0 && keys.every((k) => value.includes(k));
  return all ? value.filter((k) => !keys.includes(k)) : [...value, ...keys.filter((k) => !value.includes(k))];
}

export const toggleOne = (value: string[], key: string) => (value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

/**
 * Round BG part 2.3: the ticked shipments' CIs and their total, and the difference to the proof's amount (when
 * entered). Several currencies → no total (one line per currency, no difference). Never blocks.
 */
export function ciTotals(items: CheckItem[], value: string[], proofAmount?: number | null) {
  const lines = items
    .filter((x) => x.kind === "shipment" && value.includes(x.key))
    .sort((a, b) => refNum(a.ref) - refNum(b.ref))
    .map((x) => ({ key: x.key, ref: x.ref, ciNo: x.ciNo ?? null, amount: typeof x.ciAmount === "number" && Number.isFinite(x.ciAmount) ? x.ciAmount : null, currency: x.currency || "USD" }));
  const currencies = [...new Set(lines.filter((l) => l.amount !== null).map((l) => l.currency))];
  const cents = (n: number) => Math.round(n * 100);
  const total = currencies.length === 1 ? lines.reduce((s, l) => s + cents(l.amount ?? 0), 0) / 100 : null;
  const missing = lines.filter((l) => l.amount === null).length;
  const proof = typeof proofAmount === "number" && Number.isFinite(proofAmount) && proofAmount > 0 ? proofAmount : null;
  const difference = proof !== null && total !== null ? (cents(proof) - cents(total)) / 100 : null;
  return { lines, total, currency: currencies.length === 1 ? currencies[0] : null, currencies, missing, proof, difference };
}
