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


// ─── Merged rate cell (guru 2026-09-24) ─────────────────────────────────────
// Several CONTIGUOUS rows quoted at one shared price. Nothing is hidden and
// nothing is collapsed: every row keeps printing with its own description,
// UOM, quantity and item code. Only ONE rate column — 'unitPrice' (Monthly
// Rental Rates S$) or 'salePrice' (Sales Unit Rates S$) — merges into a single
// cell spanning those rows, like a merged cell in a spreadsheet, and the
// Amount column merges with it over the same range.
//
// WHERE THE MONEY LIVES. The block price sits on the ANCHOR row's `amount`;
// every continuation row's amount is null. That is the whole totals story:
// the three subtotal reducers (preview Biofuel, preview generic, and the
// server one at quotation.ts:46 which has NO filter of its own) each sum
// `Number(amount) || 0` and therefore count the block price exactly ONCE,
// with no filtering added anywhere. Members keep their OWN unitPrice too, so
// the Sales-Order pricing ladder (buildCodeMap → itemCode + unitPrice) still
// resolves each product months later.
//
// `null`, NEVER `0`, for a continuation's amount: the three quotation-extract
// paths fall back with `amount: item.amount || qty * unitPrice` and 0 is
// falsy, so a zeroed row would be re-priced onto the invoice and double-count
// against the block.

export type RateMergeColumn = 'unitPrice' | 'salePrice';

export interface RateMerge {
  id: string;
  column: RateMergeColumn;
  price: number;
}

// EVERY member carries the same `rateMerge` marker — id, column and price.
// There is no stored "anchor" flag: the anchor is simply the FIRST row of the
// run, derived on every read. That is deliberate. When the price lived only on
// an anchor row, deleting that row destroyed the price and the block silently
// fell to zero; with the marker on every member the price cannot be deleted
// while any member remains, and re-anchoring is not an operation at all — the
// next row is already the first.

const newMergeId = () => `rm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Rows eligible to be merged: real lines, not section headers. */
const isMergeable = (it: any) => !!it && !it.isGroupHeader && !it.isTagGroup;

/**
 * RULE 1 — a merge must be CONTIGUOUS. HTML rowSpan can only span adjacent
 * rows, so ticking rows 1, 3 and 5 cannot render as one cell. Reordering the
 * office's quotation to make it fit would be a worse answer than refusing, so
 * this reports the gap and the caller shows the message.
 */
export function contiguityError(items: any[], memberIds: Array<number | string>): string | null {
  const ids = new Set(memberIds.map(String));
  const idx = items.map((it, i) => (ids.has(String(it?.id)) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return 'Pick at least two rows.';
  if (items.filter((it) => ids.has(String(it?.id))).some((it) => !isMergeable(it)))
    return 'A section header cannot share a rate.';
  const strays = items.slice(idx[0], idx[idx.length - 1] + 1).filter((it) => !ids.has(String(it?.id)));
  if (strays.length > 0) {
    const names = strays.map((x) => String(x?.description ?? '').trim() || 'an untitled row').slice(0, 3);
    return `Those rows are not next to each other — ${names.join(', ')} sits between them. Tick a run of rows with nothing in between.`;
  }
  return null;
}

/** Apply the shared price to a contiguous run. */
export function mergeRates(
  items: any[],
  memberIds: Array<number | string>,
  column: RateMergeColumn,
  price: number,
): any[] {
  if (contiguityError(items, memberIds)) return items;
  const ids = new Set(memberIds.map(String));
  const merge: RateMerge = { id: newMergeId(), column, price: Number(price) || 0 };
  return normalizeRateMerges(
    items.map((it) => (ids.has(String(it?.id)) ? { ...it, rateMerge: { ...merge } } : it)),
  );
}

/** Re-price a whole block: the marker is on every member, so all of them move. */
export function setMergePriceOn(items: any[], mergeId: string, price: number): any[] {
  return normalizeRateMerges(
    items.map((it) =>
      it?.rateMerge?.id === mergeId ? { ...it, rateMerge: { ...it.rateMerge, price: Number(price) || 0 } } : it,
    ),
  );
}

/** Undo: every row prices itself again from its own quantity x rate. */
export function dissolveMerge(items: any[], mergeId: string): any[] {
  return items.map((it) => {
    if (it?.rateMerge?.id !== mergeId) return it;
    const { rateMerge, ...rest } = it;
    const qty = Number(rest.quantity) || 0;
    const unit = Number(rest.unitPrice) || Number(rest.salePrice) || 0;
    const isEmptyLine =
      (rest.quantity == null || rest.quantity === '') &&
      (rest.unitPrice == null || rest.unitPrice === '') &&
      (rest.salePrice == null || rest.salePrice === '');
    return { ...rest, amount: isEmptyLine ? '' : qty * unit };
  });
}

/** Rows belonging to a merge, in document order. */
export const mergeMembers = (items: any[], mergeId: string): any[] =>
  items.filter((it) => it?.rateMerge?.id === mergeId);

/**
 * RULES 2, 3 and 4, enforced in one pass. Call after ANY structural edit —
 * merge, re-price, delete or reorder.
 *
 *   2. the first row was deleted → nothing to repair: the marker is on every
 *      member, so the next row IS the anchor, and this pass simply moves the
 *      block's amount onto it.
 *   3. one member left → nothing to span; dissolve, and the survivor prices
 *      itself normally.
 *   4. a reorder split the run → a rowSpan cannot skip a row, so dissolve
 *      rather than print a cell spanning rows it no longer covers.
 *
 * It also (re)places the money: the block price sits on the FIRST member's
 * `amount` and every other member's is null. That single figure is what all
 * three subtotal reducers count — including the server's, which has no filter
 * of its own — so the block is counted exactly once with no filtering anywhere.
 */
export function normalizeRateMerges(items: any[]): any[] {
  const ids: string[] = [];
  items.forEach((it) => {
    const id = it?.rateMerge?.id;
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  let out = items;
  for (const id of ids) {
    const idx = out.map((it, i) => (it?.rateMerge?.id === id ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) { out = dissolveMerge(out, id); continue; }               // RULE 3
    if (!idx.every((v, k) => k === 0 || v === idx[k - 1] + 1)) {                  // RULE 4
      out = dissolveMerge(out, id);
      continue;
    }
    const first = idx[0];                                                          // RULE 2
    out = out.map((it, i) =>
      it?.rateMerge?.id === id ? { ...it, amount: i === first ? Number(it.rateMerge.price) || 0 : null } : it,
    );
  }
  return out;
}

/** True when this row leads its merged run — i.e. draws the spanning cells. */
export function isMergeAnchor(items: any[], row: any): boolean {
  const id = row?.rateMerge?.id;
  if (!id) return false;
  return items.findIndex((it) => it?.rateMerge?.id === id) === items.indexOf(row);
}

/**
 * What each renderer needs to draw the spanning cells: for every anchor, how
 * many rows it covers; for every continuation, which column to SKIP.
 *
 * The span is DERIVED from the rows present, never from a stored count, so a
 * delete can never leave a rowSpan reaching past the end of its block — the
 * classic way a merged cell tears a table apart.
 */
export function resolveRateMerges(rows: any[]): {
  anchors: Map<number, { span: number; price: number; column: RateMergeColumn }>;
  skip: Map<number, RateMergeColumn>;
} {
  const anchors = new Map<number, { span: number; price: number; column: RateMergeColumn }>();
  const skip = new Map<number, RateMergeColumn>();
  rows.forEach((r: any, i: number) => {
    const m = r?.rateMerge;
    if (!m?.id) return;
    if (i > 0 && rows[i - 1]?.rateMerge?.id === m.id) return; // continuation, handled below
    let span = 1;
    for (let j = i + 1; j < rows.length && rows[j]?.rateMerge?.id === m.id; j++) {
      skip.set(j, m.column);
      span++;
    }
    anchors.set(i, { span, price: Number(m.price) || 0, column: m.column });
  });
  return { anchors, skip };
}
