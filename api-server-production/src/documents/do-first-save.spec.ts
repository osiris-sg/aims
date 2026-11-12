import { skipsDoSaveStockRule } from './do-first-save';

describe('saving a DO on an order (DO first)', () => {
  it('skips the every-row-needs-a-unit rule for a manual-flow DO on an order (DO202611020: a G01 service line)', () => {
    expect(skipsDoSaveStockRule('DELIVERY_ORDER', 'order-1', true)).toBe(true);
    expect(skipsDoSaveStockRule('DO', 'order-1', true)).toBe(true);
  });
  it('keeps the rule everywhere else', () => {
    expect(skipsDoSaveStockRule('DELIVERY_ORDER', 'order-1', false)).toBe(false); // other orgs
    expect(skipsDoSaveStockRule('DELIVERY_ORDER', undefined, true)).toBe(false); // a DO not on an order
    expect(skipsDoSaveStockRule('RDO', 'order-1', true)).toBe(false);
  });
});
