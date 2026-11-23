import { SwapCheckInput, invoiceMentionsUnit, replaceSerialText, rewriteDoItemsForSwap, swapRefusal, swapSummary, swappedInStatus } from './unit-swap';

const ORG = 'org-1';
const OLD = { id: 'u-old', sku: 'AIS2026013', assetId: 'a-firefly', status: 'rental', organizationId: ORG };
const NEW = { id: 'u-new', sku: 'AIS2026021', assetId: 'a-firefly', status: 'instock', organizationId: ORG };

const ok = (patch: Partial<SwapCheckInput> = {}): SwapCheckInput => ({
  organizationId: ORG,
  flagOn: true,
  isAdmin: true,
  reason: 'Wrong serial recorded on site',
  newInventoryId: NEW.id,
  run: { deliveryNumber: 76, status: 'completed', direction: 'OUTBOUND' },
  line: { inventoryId: OLD.id, deliveryStatus: 'completed' },
  oldUnit: { ...OLD },
  newUnit: { ...NEW },
  oldUnitOtherOpenRuns: [],
  newUnitOpenRuns: [],
  hasOpenAssignment: true,
  ...patch,
});

describe('swapRefusal (enableDeliveryUnitSwap)', () => {
  it('allows an Admin swap on a completed run', () => {
    expect(swapRefusal(ok())).toBeNull();
  });
  it('allows a delivered line on a run that is not completed yet', () => {
    expect(swapRefusal(ok({ run: { deliveryNumber: 76, status: 'delivered', direction: 'OUTBOUND' }, line: { inventoryId: OLD.id, deliveryStatus: 'not_installed' } }))).toBeNull();
  });
  it('flag off: 403', () => {
    expect(swapRefusal(ok({ flagOn: false }))).toEqual({ status: 403, message: 'Swap unit is not turned on for this organisation' });
  });
  it('not an Admin: 403', () => {
    expect(swapRefusal(ok({ isAdmin: false }))).toEqual({ status: 403, message: 'Only an Admin can swap a unit' });
  });
  it('a return run is refused', () => {
    expect(swapRefusal(ok({ run: { deliveryNumber: 111, status: 'completed', direction: 'RETURN' } }))?.message).toMatch(/not on a return/);
  });
  it('a run not delivered yet is refused', () => {
    const r = swapRefusal(ok({ run: { deliveryNumber: 80, status: 'in_progress', direction: 'OUTBOUND' }, line: { inventoryId: OLD.id, deliveryStatus: 'delivering' } }));
    expect(r).toEqual({ status: 400, message: 'Delivery #80 is not delivered yet, so its unit cannot be swapped' });
  });
  it('a cancelled run is refused', () => {
    expect(swapRefusal(ok({ run: { deliveryNumber: 81, status: 'cancelled', direction: 'OUTBOUND' }, line: { inventoryId: OLD.id, deliveryStatus: 'not_installed' } }))?.status).toBe(400);
  });
  it('a free-typed line (no unit) is refused', () => {
    expect(swapRefusal(ok({ line: { inventoryId: null, deliveryStatus: 'completed' }, oldUnit: null }))?.message).toBe('This line has no unit to swap');
  });
  it('a blank reason is refused', () => {
    expect(swapRefusal(ok({ reason: '   ' }))).toEqual({ status: 400, message: 'A reason is required' });
    expect(swapRefusal(ok({ reason: undefined }))?.message).toBe('A reason is required');
  });
  it('no new unit picked is refused', () => {
    expect(swapRefusal(ok({ newInventoryId: '' }))?.message).toBe('Pick the unit to swap in');
  });
  it('a unit of another org is not found', () => {
    expect(swapRefusal(ok({ newUnit: { ...NEW, organizationId: 'org-2' } }))?.status).toBe(404);
  });
  it('the same unit is refused', () => {
    expect(swapRefusal(ok({ newUnit: { ...OLD } }))?.message).toMatch(/already on this line/);
  });
  it('a different product is refused', () => {
    expect(swapRefusal(ok({ newUnit: { ...NEW, assetId: 'a-lion' } }))?.message).toBe('AIS2026021 is a different product. Pick a unit of the same product');
  });
  it('a new unit not in stock is refused', () => {
    expect(swapRefusal(ok({ newUnit: { ...NEW, status: 'reserved' } }))?.message).toBe('AIS2026021 is not in stock (status: reserved)');
  });
  it('a new unit on an open run is refused', () => {
    expect(swapRefusal(ok({ newUnitOpenRuns: [120] }))?.message).toBe('AIS2026021 is on open delivery #120');
  });
  it('the old unit on another open run (a scheduled return) is refused, naming the run', () => {
    expect(swapRefusal(ok({ oldUnitOtherOpenRuns: [111] }))).toEqual({
      status: 400,
      message: 'AIS2026013 is also on open delivery #111. Remove it from that run first',
    });
  });
  it('an old unit already back in stock is refused', () => {
    expect(swapRefusal(ok({ oldUnit: { ...OLD, status: 'instock' } }))?.message).toMatch(/not out on this delivery/);
  });
  it('no open assignment on the project is refused', () => {
    expect(swapRefusal(ok({ hasOpenAssignment: false }))?.message).toMatch(/not on this delivery's project/);
  });
});

describe('swappedInStatus', () => {
  it('a sale stays a sale, everything else goes out on rental', () => {
    expect(swappedInStatus('sold')).toBe('sold');
    expect(swappedInStatus('rental')).toBe('rental');
  });
});

describe('rewriteDoItemsForSwap', () => {
  const ids = { oldInventoryId: OLD.id, oldSku: OLD.sku, newInventoryId: NEW.id, newSku: NEW.sku, deliveryItemId: 'di-1' };
  it('points the delivery-built line at the new unit and keeps every other key', () => {
    const items = [
      { description: 'FIREFLY 4200', quantity: 1, unitPrice: 0, amount: 0, inventoryItemId: OLD.id, serialNumbers: [OLD.sku], skuKey: 'AIS', itemCode: 'AIS', deliveryGroup: 'a-firefly', deploymentType: 'RENTAL', deliveryItemId: 'di-1' },
      { description: 'LION 375', quantity: 1, inventoryItemId: 'u-other', serialNumbers: ['MG1'] },
    ];
    const r = rewriteDoItemsForSwap(items, ids);
    expect(r.changed).toEqual([0]);
    expect(r.items[0]).toEqual({ ...items[0], inventoryItemId: NEW.id, serialNumbers: [NEW.sku] });
    expect(r.items[1]).toBe(items[1]);
    expect(items[0].inventoryItemId).toBe(OLD.id); // input not mutated
  });
  it('rewrites the serial in an editor line (itemCode = serial, S/No. typed in the description)', () => {
    const items = [{ itemCode: OLD.sku, inventoryItemId: OLD.id, description: '<div>FIREFLY 4200</div><div>S/No.: AIS2026013</div>', tax: 9 }];
    const r = rewriteDoItemsForSwap(items, ids);
    expect(r.items[0]).toEqual({ itemCode: NEW.sku, inventoryItemId: NEW.id, description: '<div>FIREFLY 4200</div><div>S/No.: AIS2026021</div>', tax: 9 });
  });
  it('does not touch a longer code that merely contains the serial', () => {
    expect(replaceSerialText('AIS2026013X and AIS2026013', OLD.sku, NEW.sku)).toBe('AIS2026013X and AIS2026021');
  });
  it('a line bound only by deliveryItemId is matched; no line means nothing changes', () => {
    expect(rewriteDoItemsForSwap([{ deliveryItemId: 'di-1', description: 'x' }], ids).changed).toEqual([0]);
    expect(rewriteDoItemsForSwap([{ inventoryItemId: 'u-other' }], ids).changed).toEqual([]);
    expect(rewriteDoItemsForSwap(undefined, ids)).toEqual({ items: [], changed: [] });
  });
});

describe('invoiceMentionsUnit', () => {
  it('finds the old unit by id or by serial anywhere in a line', () => {
    expect(invoiceMentionsUnit({ items: [{ inventoryItemId: OLD.id }] }, OLD.id, OLD.sku)).toBe(true);
    expect(invoiceMentionsUnit({ items: [{ description: 'Rental FIREFLY S/No.: AIS2026013' }] }, OLD.id, OLD.sku)).toBe(true);
    expect(invoiceMentionsUnit({ items: [{ serialNumbers: ['AIS2026013'] }] }, OLD.id, OLD.sku)).toBe(true);
    expect(invoiceMentionsUnit({ items: [{ description: 'AIS20260130' }] }, OLD.id, OLD.sku)).toBe(false);
    expect(invoiceMentionsUnit({}, OLD.id, OLD.sku)).toBe(false);
  });
});

describe('swapSummary', () => {
  it('names the drafts to fix', () => {
    expect(swapSummary({ runNumber: 76, fromSku: OLD.sku, toSku: NEW.sku, doName: 'DO202610082', draftInvoices: [] })).toBe('Delivery #76: AIS2026013 swapped for AIS2026021 on DO202610082.');
    expect(swapSummary({ runNumber: 76, fromSku: OLD.sku, toSku: NEW.sku, doName: null, draftInvoices: [{ name: 'BI202611001' }] })).toBe(
      'Delivery #76: AIS2026013 swapped for AIS2026021. Draft invoice still naming AIS2026013: BI202611001.',
    );
  });
});
