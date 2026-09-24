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

// ─── Lump sum (guru 2026-09-24) ─────────────────────────────────────────────
// Several products quoted under ONE price. The members are NOT merged away:
// each keeps its itemCode and unitPrice so the Sales-Order pricing ladder
// (documents.service.ts buildCodeMap → "Sales Order beats Quotation beats
// asset") can still find its agreed rate when the unit is delivered and
// invoiced. They are hidden from every RENDERER instead, by `rolledUpInto`.
//
// The lump itself is an ORDINARY item row — no flag drives its rendering, so
// no renderer needed a new branch. It prints because it is a normal line with
// a multi-line description, and every renderer already puts description
// through `white-space: pre-wrap`.
//
// MEMBER AMOUNTS ARE `null`, NEVER `0`. Both subtotal reducers read
// `Number(amount) || 0`, so null and 0 total identically — but the three
// quotation→document conversion paths fall back with
// `amount: item.amount || (quantity || 1) * (unitPrice || 0)`, and `0` is
// falsy, so a zeroed member would be RE-PRICED into a real amount on the
// invoice and double-count against the lump. `null` is falsy there too, which
// is why those call sites also skip rolled-up members explicitly.

/** Stable id for a lump row; members point at it via `rolledUpInto`. */
const newLumpId = () => `lump-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The printed description: one dash-prefixed line per member, stacked. */
export const stackDescriptions = (members: any[]): string =>
  members
    .map((m) => String(m?.description ?? '').trim())
    .filter(Boolean)
    .map((d) => (d.startsWith('-') ? d : `- ${d}`))
    .join('\n');

export interface LumpInput {
  quantity?: number | string | null;
  uom?: string | null;
  unitPrice?: number | string | null;
  salePrice?: number | string | null;
  amount: number | string;
  description?: string | null;
}

/**
 * Fold the ticked rows into one priced line.
 *
 * The lump is inserted AT THE FIRST MEMBER'S POSITION, so it stays inside its
 * group block and prints under the group title. Members keep their place in
 * the array (hidden, not moved) so unbundling restores the original order.
 */
export function combineIntoLump(items: any[], memberIds: Array<number | string>, input: LumpInput): any[] {
  const ids = new Set(memberIds.map(String));
  const members = items.filter((it) => ids.has(String(it?.id)) && !it?.isGroupHeader);
  if (members.length < 2) return items;
  const lumpId = newLumpId();
  const firstIdx = items.findIndex((it) => ids.has(String(it?.id)));
  const lump = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    lumpId,
    lumpCount: members.length,
    itemCode: '',
    description: (input.description && String(input.description).trim()) || stackDescriptions(members),
    uom: input.uom ?? members.find((m) => m?.uom)?.uom ?? '',
    quantity: input.quantity === '' || input.quantity == null ? null : Number(input.quantity),
    unitPrice: input.unitPrice === '' || input.unitPrice == null ? null : Number(input.unitPrice),
    salePrice: input.salePrice === '' || input.salePrice == null ? null : Number(input.salePrice),
    // The agreed figure, typed by the office. NEVER derived from qty × rate —
    // on a lump those deliberately do not multiply out (the reference quotes
    // qty 2 for members of 1, 3 and 1).
    amount: Number(input.amount) || 0,
  };
  const marked = items.map((it) =>
    ids.has(String(it?.id)) && !it?.isGroupHeader
      ? { ...it, rolledUpInto: lumpId, amount: null }
      : it,
  );
  return [...marked.slice(0, firstIdx), lump, ...marked.slice(firstIdx)];
}

/**
 * Reverse it: drop the lump row, clear the members' marker and give each its
 * own amount back (qty × rate, the same arithmetic updateItem uses).
 */
export function unbundleLump(items: any[], lumpId: string): any[] {
  return items
    .filter((it) => it?.lumpId !== lumpId)
    .map((it) => {
      if (it?.rolledUpInto !== lumpId) return it;
      const { rolledUpInto, ...rest } = it;
      const qty = Number(rest.quantity) || 0;
      const unit = Number(rest.unitPrice) || Number(rest.salePrice) || 0;
      const isEmptyLine =
        (rest.quantity == null || rest.quantity === '') &&
        (rest.unitPrice == null || rest.unitPrice === '') &&
        (rest.salePrice == null || rest.salePrice === '');
      return { ...rest, amount: isEmptyLine ? '' : qty * unit };
    });
}

/** Members of a lump, in document order. */
export const lumpMembers = (items: any[], lumpId: string): any[] =>
  items.filter((it) => it?.rolledUpInto === lumpId);
