// UAT 2026-11-25 (INV202611-0040): after a split, part 1 read "Pending" and part 2 "Draft". Both stay the stored
// status the invoice had; the WCT wording reads config.savedAt (a person saved it), which part 2 lost. Parts now keep
// the original's savedAt / savedBy, so every part reads like the invoice it was split from.
import { partConfig, planInvoiceSplit, SPLIT_NOT_COPIED } from './invoice-split';

const original = {
  items: [{ description: 'Hood', quantity: 1, unitPrice: 1000, amount: 1000 }],
  gstPercent: 9,
  taxApplicable: 'Y',
  savedAt: '2026-11-24T20:25:50.563Z',
  savedBy: 'finance@example.com',
  payToken: 'tok',
  sentAt: '2026-11-24T20:26:00Z',
};
const ctx = { groupId: 'g', of: 2, baseNumber: 'INV1', mode: 'rate' as const, account: {} };

describe('split parts take the original invoice\'s saved state', () => {
  const { parts } = planInvoiceSplit(original, { mode: 'rate', parts: [40, 60] }, { lineDiscounts: true });
  it('a part keeps savedAt / savedBy (Pending like part 1), and still drops the pay link and send stamps', () => {
    const c = partConfig(original, parts[1], { ...ctx, number: 'INV1-2' });
    expect(c.savedAt).toBe(original.savedAt);
    expect(c.savedBy).toBe(original.savedBy);
    expect(c.payToken).toBeUndefined();
    expect(c.sentAt).toBeUndefined();
    expect(SPLIT_NOT_COPIED).not.toContain('savedAt');
  });
  it('an invoice nobody saved (system draft): its parts carry no savedAt (all Draft)', () => {
    const { savedAt: _s, savedBy: _b, ...system } = original;
    const c = partConfig(system, parts[1], { ...ctx, number: 'INV1-2' });
    expect(c.savedAt).toBeUndefined();
  });
});
