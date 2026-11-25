/**
 * The ten legacy Inventory Reports (guru 2026-11-25, from the legacy system's
 * "Inventory Report" menu — names word for word):
 *
 *   Stock Status · Unconfirn Inventory Transactions · Purchase Order Listing ·
 *   Purchase Summary By Supplier · Detailed Stock Analysis By Supplier / Stock ·
 *   Detailed Stock Analysis By Category · Stock Movement Analysis ·
 *   Stock Take Listing · Last Buy Price Report · Reorder Level Analysis
 *
 * Pure shapes + the rules the service and its tests share. No Prisma here.
 */

/** Stock IN: a confirmed one of these ADDS to stock. */
export const STOCK_IN_TYPES = ['PO', 'PURCHASE_ORDER', 'SAI', 'STOCK_ADJUSTMENT_IN'];

/** Stock OUT: a confirmed one of these TAKES stock away. */
export const STOCK_OUT_TYPES = [
  'PR', 'PURCHASE_RETURN', 'SAO', 'STOCK_ADJUSTMENT_OUT',
  'INVOICE', 'TI', 'TI2', 'DO', 'DELIVERY_ORDER', 'DN', 'DEBIT_NOTE',
];

/** The four documents the Inventory module itself raises — the only ones "Unconfirn Inventory Transactions" asks about. */
export const INVENTORY_DOC_TYPES = [
  'PO', 'PURCHASE_ORDER', 'PR', 'PURCHASE_RETURN',
  'SAI', 'STOCK_ADJUSTMENT_IN', 'SAO', 'STOCK_ADJUSTMENT_OUT',
];

export const PURCHASE_TYPES = ['PO', 'PURCHASE_ORDER'];

/** What the legacy menu calls each document, for the Type column. */
export const DOC_TYPE_LABEL: Record<string, string> = {
  PO: 'Purchase Order', PURCHASE_ORDER: 'Purchase Order',
  PR: 'Purchase Return', PURCHASE_RETURN: 'Purchase Return',
  SAI: 'Stock Adjustment In', STOCK_ADJUSTMENT_IN: 'Stock Adjustment In',
  SAO: 'Stock Adjustment Out', STOCK_ADJUSTMENT_OUT: 'Stock Adjustment Out',
  INVOICE: 'Invoice', TI: 'Invoice', TI2: 'Invoice',
  DO: 'Delivery Order', DELIVERY_ORDER: 'Delivery Order',
  DN: 'Debit Note', DEBIT_NOTE: 'Debit Note',
};

export const docTypeLabel = (t: string): string => DOC_TYPE_LABEL[String(t || '').toUpperCase()] || String(t || '');

/**
 * A document only moves stock once it is CONFIRMED. A draft or unconfirmed one
 * is paperwork in progress — which is precisely what the "Unconfirn Inventory
 * Transactions" report exists to list, so the two reports read the same rows
 * from opposite sides of this line.
 */
export const UNCONFIRMED_STATUSES = ['draft', 'unconfirmed'];
export const isConfirmedStatus = (status: string | null | undefined): boolean => {
  const s = String(status ?? '').toLowerCase().trim();
  // No status at all is not a confirmation: an unknown document must never be
  // counted as having moved stock.
  if (!s) return false;
  return !UNCONFIRMED_STATUSES.includes(s);
};

/** yyyy-mm-dd or null — the same guard the sales report uses, so a bad date never reaches SQL. */
export const isoDateOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** One line of one document, already flattened out of config.items. */
export interface ItemRow {
  documentId: string;
  number: string;
  type: string;
  status: string;
  date: string;
  supplier: string;
  supplierCode: string;
  reference: string;
  assetId: string | null;
  code: string;
  description: string;
  uom: string;
  /** As typed on the line — always positive; the DIRECTION comes from the document type. */
  quantity: number;
  unitPrice: number;
  amount: number;
  receivedQty: number;
}

/** A product, with what is actually on the shelf. */
export interface StockRow {
  assetId: string;
  code: string;
  name: string;
  description: string;
  uom: string;
  categoryId: string | null;
  category: string;
  costPrice: number;
  sellPrice: number;
  minQuantity: number | null;
  isTracked: boolean;
  /** Untracked: Asset.quantity. Tracked: the unit counts below. */
  onHand: number;
  reserved: number;
  rental: number;
  maintenance: number;
  sold: number;
}

/** + for a document that adds stock, − for one that takes it away, 0 for one that does neither. */
export const directionOf = (type: string): 1 | -1 | 0 => {
  const t = String(type || '').toUpperCase();
  if (STOCK_IN_TYPES.includes(t)) return 1;
  if (STOCK_OUT_TYPES.includes(t)) return -1;
  return 0;
};

/** The quantity this line moves, signed by its document type. */
export const signedQty = (row: Pick<ItemRow, 'type' | 'quantity'>): number => directionOf(row.type) * Math.abs(Number(row.quantity) || 0);

/** What is left to come in on a purchase order line (ordered − received, never below zero). */
export const outstandingQty = (row: Pick<ItemRow, 'quantity' | 'receivedQty'>): number =>
  Math.max(0, (Number(row.quantity) || 0) - (Number(row.receivedQty) || 0));

/** Available to sell = on hand less what is already spoken for. */
export const availableQty = (s: Pick<StockRow, 'onHand' | 'reserved'>): number => (Number(s.onHand) || 0) - (Number(s.reserved) || 0);

/** Stock value at cost — the figure Stock Status totals by category. */
export const stockValue = (s: Pick<StockRow, 'onHand' | 'costPrice'>): number =>
  Math.round((Number(s.onHand) || 0) * (Number(s.costPrice) || 0) * 100) / 100;

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** Blank supplier reads as the legacy report's "(No supplier)" bucket so nothing falls out of a grouped total. */
export const NO_SUPPLIER = '(No supplier)';
export const NO_CATEGORY = '(No category)';
export const supplierOf = (r: Pick<ItemRow, 'supplier'>): string => String(r.supplier || '').trim() || NO_SUPPLIER;
