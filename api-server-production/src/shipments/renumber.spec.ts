import { searchMatch } from './monthly-list';
import { LIVE_ORDER_NO_END } from './orders.service';

// Round AT: an order renumbered #26 → #28 keeps #26 as an alias.
describe('round AT — old order numbers still find the order', () => {
  const o: any = { orderNo: 28, previousOrderNos: [26], customerName: 'Kato', shipments: [{ seqNo: 1, blNumber: null }] };
  it('Monthly search "#26" / "26" / "#26-1" finds #28', () => {
    expect(searchMatch(o, '#26')).toBe('order');
    expect(searchMatch(o, '26')).toBe('order');
    const f = searchMatch(o, '#26-1') as (s: any) => boolean;
    expect(typeof f).toBe('function');
    expect(f({ seqNo: 1 })).toBe(true);
    expect(f({ seqNo: 2 })).toBe(false);
  });
  it('its own number still works; an unrelated number does not', () => {
    expect(searchMatch(o, '#28')).toBe('order');
    expect(searchMatch(o, '#27')).toBeNull();
  });
  it('history (#1001…) and test (#9001…) numbers are parked above the live range', () => {
    expect(LIVE_ORDER_NO_END).toBe(1000);
  });
});
