// Quotation item groups (guru 2026-09-14, modeled on the Nishio-style quote):
// products on a QUOTATION are listed under bold underlined section headers.
// The groups and membership are EXACTLY guru's spec — resolved by product
// name/code pattern, not by the (messy) inventory categories.
//
// Gated by the org feature flag `enableQuotationItemGroups` (Biofuel ON).
// Rows are ordinary config items flagged `isGroupHeader: true`; they carry no
// qty/price/amount (all null) so every renderer's text-line convention keeps
// their number columns blank, and totals ignore them.

export interface QuotationItemGroup {
  title: string;
  matches: (nameOrCode: string) => boolean;
}

const norm = (s: string) => (s || "").toUpperCase().replace(/[\s_-]+/g, "");

export const QUOTATION_ITEM_GROUPS: QuotationItemGroup[] = [
  {
    title: "ECM Water Treatment",
    // AF 5 / AF 10 / AF 40 / AF 60 / AF 100 systems (and other AF-series ECMs)
    matches: (v) => /^A?PF\d+|^AF\d+/.test(norm(v)),
  },
  {
    title: "ECM Add Ons",
    // Silt Imagery Detection System (web access / solar panel / TSS sensor)
    matches: (v) => /^SIDS|SILTIMAGERY|^TSS/.test(norm(v)),
  },
  {
    title: "Lighting Tower",
    // FIREFLY 4200 (Advanced Illumination System)
    matches: (v) => /^FIREFLY|^AIS(?!\d{6})/.test(norm(v)),
  },
  {
    title: "Battery Energy Storage System",
    // LION5 / LION125 / LION135 / LION250 / LION375 / LION500
    matches: (v) => /^LION\d*/.test(norm(v)),
  },
];

/** Group title for a product, or null when it stays ungrouped (e.g. transport). */
export function resolveQuotationGroup(product: { name?: string; sku?: string; description?: string }): string | null {
  const candidates = [product.sku, product.name, product.description].filter(Boolean) as string[];
  for (const g of QUOTATION_ITEM_GROUPS) {
    if (candidates.some((c) => g.matches(c))) return g.title;
  }
  return null;
}

export const makeGroupHeaderItem = (title: string) => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  isGroupHeader: true,
  description: title,
  quantity: null,
  unitPrice: null,
  amount: null,
});

/**
 * Insert `newItem` into `items` under its group header (creating the header
 * when absent). Group = header row up to (not incl.) the next header. Items
 * with no group append at the END so ungrouped lines (transport etc.) stay
 * below every group, like guru's reference layout.
 */
export function insertItemGrouped(items: any[], newItem: any, groupTitle: string | null): any[] {
  if (!groupTitle) return [...items, newItem];
  const headerIdx = items.findIndex((it) => it?.isGroupHeader && String(it.description).trim() === groupTitle);
  if (headerIdx === -1) {
    // New group: header + item go BEFORE the first ungrouped trailing line
    // (lines after the last group's block, e.g. transport), else at the end.
    return [...items, makeGroupHeaderItem(groupTitle), newItem];
  }
  // find the end of this group's block
  let end = items.length;
  for (let i = headerIdx + 1; i < items.length; i++) {
    if (items[i]?.isGroupHeader) { end = i; break; }
  }
  return [...items.slice(0, end), newItem, ...items.slice(end)];
}
