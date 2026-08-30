import type { IdQuote, QuoteInclude, QuoteItem, QuoteSection } from "./types";

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const isPriced = (mode: string | null | undefined) => !mode || mode === "priced";

/** What the client pays for this line (item + separately-priced includes). */
export function itemAmount(it: QuoteItem): number {
  if (!isPriced(it.pricingMode)) return 0;
  const inc = (it.includes || []).reduce((s, i) => s + (i.pricingMode === "priced" ? num(i.amount) : 0), 0);
  return num(it.amount) + inc;
}

/** What the line costs us (item cost + every include's cost). */
export function itemCost(it: QuoteItem): number {
  return num(it.cost) + (it.includes || []).reduce((s, i) => s + num(i.cost), 0);
}

export const hasCost = (it: QuoteItem): boolean =>
  it.cost != null || (it.includes || []).some((i: QuoteInclude) => i.cost != null);

/** Margin on PRICE: (amount − cost) / amount. null when there's no cost or no amount. */
export function itemMarginPct(it: QuoteItem): number | null {
  const amt = itemAmount(it);
  if (!isPriced(it.pricingMode) || amt <= 0 || !hasCost(it)) return null;
  return ((amt - itemCost(it)) / amt) * 100;
}

/** Selling price that yields the guideline margin on price. */
export const priceFromCost = (cost: number, guidelinePct: number): number =>
  guidelinePct >= 100 ? cost : Math.round((cost / (1 - guidelinePct / 100)) * 100) / 100;

export function sectionTotals(s: QuoteSection) {
  let amount = 0;
  let cost = 0;
  let costed = false;
  for (const a of s.areas || []) {
    for (const it of a.items || []) {
      amount += itemAmount(it);
      if (hasCost(it)) {
        costed = true;
        cost += itemCost(it);
      }
    }
  }
  return { amount, cost, marginPct: costed && amount > 0 ? ((amount - cost) / amount) * 100 : null };
}

export interface LowLine {
  itemId: string;
  sectionLetter: string;
  no: number;
  description: string;
  marginPct: number;
}

export function quoteTotals(q: IdQuote) {
  const perSection = (q.sections || []).map(sectionTotals);
  const total = perSection.reduce((s, x) => s + x.amount, 0);
  const totalCost = perSection.reduce((s, x) => s + x.cost, 0);
  const anyCost = (q.sections || []).some((s) => s.areas.some((a) => a.items.some(hasCost)));
  const feePct = num(q.summary?.designFeePct);
  const designFee = Math.round(total * feePct) / 100;
  const discounts = (q.summary?.discounts || []).filter((d) => num(d.amount) !== 0);
  const discountTotal = discounts.reduce((s, d) => s + num(d.amount), 0);
  const grand = total + designFee - discountTotal;
  // Margin the way their sheet computes it: on the grand total vs total cost.
  const marginPct = anyCost && grand > 0 ? ((grand - totalCost) / grand) * 100 : null;

  const floor = num(q.settings?.marginFloorPct);
  const lowLines: LowLine[] = [];
  for (const s of q.sections || []) {
    let no = 0;
    for (const a of s.areas || []) {
      for (const it of a.items || []) {
        no += 1;
        const m = itemMarginPct(it);
        if (m != null && m < floor) lowLines.push({ itemId: it.id, sectionLetter: s.letter, no, description: it.description, marginPct: m });
      }
    }
  }
  const breach = (marginPct != null && marginPct < floor) || lowLines.length > 0;
  return { perSection, total, totalCost, designFee, feePct, discounts, discountTotal, grand, marginPct, lowLines, breach, anyCost };
}

/**
 * Flatten the tree into the legacy `config.items[]` shape so downstream
 * features (invoice extraction, DocumentItem mirror, reports) see plain
 * service lines. Non-priced lines are skipped; includes with their own price
 * become their own lines.
 */
export function flattenItems(q: IdQuote): any[] {
  const out: any[] = [];
  for (const s of q.sections || []) {
    for (const a of s.areas || []) {
      for (const it of a.items || []) {
        if (!isPriced(it.pricingMode)) continue;
        const prefix = a.name && a.name !== "General" ? `${s.title} — ${a.name}` : s.title;
        out.push({
          id: it.id,
          itemCode: it.code || "",
          inventoryItemId: "",
          description: `[${prefix}] ${it.description}`,
          quantity: num(it.qty) || 1,
          uom: it.uom || "",
          unitPrice: num(it.qty) ? Math.round((num(it.amount) / num(it.qty)) * 100) / 100 : num(it.amount),
          amount: num(it.amount),
          costPrice: it.cost ?? null,
          isService: true,
          revenueTag: "service",
        });
        for (const inc of it.includes || []) {
          if (inc.pricingMode !== "priced" || !num(inc.amount)) continue;
          out.push({
            id: inc.id,
            itemCode: it.code || "",
            inventoryItemId: "",
            description: `[${prefix}] ${it.description} — ${inc.text}`,
            quantity: num(inc.qty) || 1,
            uom: "",
            unitPrice: num(inc.amount),
            amount: num(inc.amount),
            costPrice: inc.cost ?? null,
            isService: true,
            revenueTag: "service",
          });
        }
      }
    }
  }
  return out;
}

const fmt = new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number | null | undefined): string => fmt.format(num(n));
export const pct = (n: number | null | undefined): string => (n == null ? "—" : `${n.toFixed(1)}%`);

/** Fill `{dims}` / `{unit type}` placeholders from a library template. */
export const hasPlaceholders = (s: string) => /\{[^}]+\}/.test(s || "");
