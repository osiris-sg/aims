/**
 * Swap unit on a delivered run (Biofuel, 2026-11-23; flag enableDeliveryUnitSwap,
 * default OFF so every other org, WCT included, is unchanged).
 *
 * The office found the wrong serial was recorded (or the unit was replaced on
 * site): an Admin swaps the unit on a delivered outbound line for another unit
 * of the SAME product that is in stock. The old unit comes back to stock, the new
 * one goes out on the same project + deployment, and the run line, its proof
 * reports and the DO line point at the new unit. Signatures, DO number and DO
 * status stay as they are. Invoices are never touched: the drafts that still name
 * the old serial are returned for the office to fix.
 *
 * Pure rules only (no Prisma): the eligibility checks and the DO line rewrite.
 * unit-swap.service.ts does the reads and the one transaction.
 */
export const DELIVERY_UNIT_SWAP_FLAG = 'enableDeliveryUnitSwap';

/** A run that is not completed or cancelled still holds its units. */
export const OPEN_RUN_STATUSES = ['scheduled', 'in_progress', 'delivered'] as const;

/** Unit statuses that mean "out on the delivery" (rental, or a sale). */
const OUT_STATUSES = new Set(['rental', 'sold']);

export interface SwapUnitFacts {
  id: string;
  sku: string | null;
  assetId: string | null;
  status: string;
  organizationId: string;
}

export interface SwapCheckInput {
  organizationId: string;
  flagOn: boolean;
  isAdmin: boolean;
  reason: string | null | undefined;
  newInventoryId: string | null | undefined;
  run: { deliveryNumber: number; status: string; direction: string };
  line: { inventoryId: string | null; deliveryStatus: string } | null;
  oldUnit: SwapUnitFacts | null;
  newUnit: SwapUnitFacts | null;
  /** Open runs (other than this one) the old unit is on, by run number. */
  oldUnitOtherOpenRuns: number[];
  /** Open runs (any, this one included) the new unit is on, by run number. */
  newUnitOpenRuns: number[];
  /** The old unit's open assignment on this run's project. */
  hasOpenAssignment: boolean;
}

export interface SwapRefusal {
  status: 400 | 403 | 404;
  message: string;
}

const runList = (nums: number[]) => [...new Set(nums)].sort((a, b) => a - b).map((n) => `#${n}`).join(', ');

/** The first reason a swap is refused, or null when it may go ahead. */
export function swapRefusal(i: SwapCheckInput): SwapRefusal | null {
  if (!i.flagOn) return { status: 403, message: 'Swap unit is not turned on for this organisation' };
  if (!i.isAdmin) return { status: 403, message: 'Only an Admin can swap a unit' };
  if (!i.line) return { status: 404, message: 'This line is not on the delivery' };
  if (i.run.direction !== 'OUTBOUND') return { status: 400, message: 'Units can only be swapped on a delivery, not on a return' };
  const delivered = i.run.status === 'completed' || ['not_installed', 'completed'].includes(i.line.deliveryStatus);
  if (i.run.status === 'cancelled' || !delivered) {
    return { status: 400, message: `Delivery #${i.run.deliveryNumber} is not delivered yet, so its unit cannot be swapped` };
  }
  if (!i.line.inventoryId || !i.oldUnit) return { status: 400, message: 'This line has no unit to swap' };
  if (!String(i.reason ?? '').trim()) return { status: 400, message: 'A reason is required' };
  if (!String(i.newInventoryId ?? '').trim()) return { status: 400, message: 'Pick the unit to swap in' };
  if (!i.newUnit || i.newUnit.organizationId !== i.organizationId) return { status: 404, message: 'The new unit was not found in this organisation' };
  if (i.newUnit.id === i.oldUnit.id) return { status: 400, message: `${i.oldUnit.sku ?? 'This unit'} is already on this line` };
  if (!i.oldUnit.assetId || i.newUnit.assetId !== i.oldUnit.assetId) {
    return { status: 400, message: `${i.newUnit.sku ?? 'The new unit'} is a different product. Pick a unit of the same product` };
  }
  if (i.newUnit.status !== 'instock') {
    return { status: 400, message: `${i.newUnit.sku ?? 'The new unit'} is not in stock (status: ${i.newUnit.status})` };
  }
  if (i.newUnitOpenRuns.length) {
    return { status: 400, message: `${i.newUnit.sku ?? 'The new unit'} is on open delivery ${runList(i.newUnitOpenRuns)}` };
  }
  if (!OUT_STATUSES.has(i.oldUnit.status)) {
    return { status: 400, message: `${i.oldUnit.sku ?? 'The unit'} is not out on this delivery any more (status: ${i.oldUnit.status})` };
  }
  if (i.oldUnitOtherOpenRuns.length) {
    return {
      status: 400,
      message: `${i.oldUnit.sku ?? 'The unit'} is also on open delivery ${runList(i.oldUnitOtherOpenRuns)}. Remove it from that run first`,
    };
  }
  if (!i.hasOpenAssignment) {
    return { status: 400, message: `${i.oldUnit.sku ?? 'The unit'} is not on this delivery's project any more` };
  }
  return null;
}

/** Status the new unit takes: the old unit's (a sale stays a sale), else rental. */
export function swappedInStatus(oldStatus: string): 'rental' | 'sold' {
  return oldStatus === 'sold' ? 'sold' : 'rental';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces the old serial as a whole token (not inside a longer code) in free text. */
export function replaceSerialText(text: string, oldSku: string, newSku: string): string {
  if (!oldSku || !text) return text;
  return text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(oldSku)}(?![A-Za-z0-9])`, 'g'), newSku);
}

export interface SwapLineIds {
  oldInventoryId: string;
  oldSku: string | null;
  newInventoryId: string;
  newSku: string | null;
  deliveryItemId?: string | null;
}

/** Does this DO / invoice line belong to the old unit? */
export function lineIsOldUnit(line: any, ids: SwapLineIds): boolean {
  if (!line || typeof line !== 'object') return false;
  if (line.inventoryItemId && line.inventoryItemId === ids.oldInventoryId) return true;
  if (line.inventoryId && line.inventoryId === ids.oldInventoryId) return true;
  return !line.inventoryItemId && !!ids.deliveryItemId && line.deliveryItemId === ids.deliveryItemId;
}

/**
 * The DO's config.items with the old unit's line(s) pointed at the new unit:
 * inventoryItemId and the serial display fields (serialNumbers, sku, serial,
 * serialNumber, serialNo, an itemCode that was the serial, the serial inside the
 * description). Every other key (price, tax, model, group, remarks) is kept.
 * Returns the new array and the changed indexes; the input is not mutated.
 */
export function rewriteDoItemsForSwap(items: unknown, ids: SwapLineIds): { items: any[]; changed: number[] } {
  const rows: any[] = Array.isArray(items) ? items : [];
  const changed: number[] = [];
  const oldSku = ids.oldSku ?? '';
  const newSku = ids.newSku ?? '';
  const out = rows.map((line, idx) => {
    if (!lineIsOldUnit(line, ids)) return line;
    changed.push(idx);
    const next: any = { ...line, inventoryItemId: ids.newInventoryId };
    if ('inventoryId' in next && next.inventoryId === ids.oldInventoryId) next.inventoryId = ids.newInventoryId;
    // A unit line names one unit: the old serial becomes the new one (any other
    // serial on the line is kept); a serial list without the old one becomes the
    // new one. A line with no serial list is not given one.
    if (Array.isArray(next.serialNumbers)) {
      const serials: any[] = next.serialNumbers;
      next.serialNumbers = oldSku && serials.includes(oldSku) ? serials.map((s) => (s === oldSku ? newSku : s)).filter(Boolean) : newSku ? [newSku] : [];
    }
    for (const k of ['sku', 'serial', 'serialNumber', 'serialNo', 'itemCode']) {
      if (oldSku && typeof next[k] === 'string' && next[k] === oldSku) next[k] = newSku;
    }
    if (oldSku && typeof next.description === 'string') next.description = replaceSerialText(next.description, oldSku, newSku);
    return next;
  });
  return { items: out, changed };
}

/** Does any line of an invoice still name the old unit (its id or its serial)? */
export function invoiceMentionsUnit(config: unknown, oldInventoryId: string, oldSku: string | null): boolean {
  const items: any[] = Array.isArray((config as any)?.items) ? (config as any).items : [];
  const re = oldSku ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(oldSku)}(?![A-Za-z0-9])`) : null;
  return items.some((line) => {
    if (!line || typeof line !== 'object') return false;
    if (line.inventoryItemId === oldInventoryId || line.inventoryId === oldInventoryId) return true;
    return !!re && re.test(JSON.stringify(line));
  });
}

/** One line for the toast / Activity Log: what moved and which drafts need fixing. */
export function swapSummary(s: { runNumber: number; fromSku: string | null; toSku: string | null; doName: string | null; draftInvoices: Array<{ name: string | null }> }): string {
  const head = `Delivery #${s.runNumber}: ${s.fromSku ?? 'old unit'} swapped for ${s.toSku ?? 'new unit'}${s.doName ? ` on ${s.doName}` : ''}.`;
  if (!s.draftInvoices.length) return head;
  const names = s.draftInvoices.map((d) => d.name ?? 'draft invoice').join(', ');
  return `${head} Draft invoice${s.draftInvoices.length === 1 ? '' : 's'} still naming ${s.fromSku ?? 'the old unit'}: ${names}.`;
}
