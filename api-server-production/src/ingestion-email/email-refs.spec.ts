import { localRefMap, numbersAsAt, refFreshener, renumberEventsOf } from './email-refs';

// Round AT on 2026-10-28 07:23 (23→25, 24→26, 25→27, 26→28, 27→9001, 40→1011), then the order page 1011→10 on 10-29.
const AT = new Date('2026-10-28T07:23:33Z');
const ev = (orderId: string, from: number, to: number, at = AT) => ({ orderId, from, to, at });
const events = [ev('A', 23, 25), ev('B', 24, 26), ev('C', 25, 27), ev('D', 26, 28), ev('E', 27, 9001), ev('X', 40, 1011), ev('X', 1011, 10, new Date('2026-10-29T03:47:04Z'))];
const current = new Map([['A', 25], ['B', 26], ['C', 27], ['D', 28], ['E', 9001], ['X', 10], ['N', 24]]);

describe('round AV — stored texts show today’s order numbers', () => {
  it('a number as at a time before the renumber maps to the order that had it then (no chaining)', () => {
    const m = numbersAsAt(new Date('2026-10-27T00:00:00Z'), events, current);
    expect(m.get(25)).toBe(27); // old #25 is today's #27 — not #25 → #27 → #9001
    expect(m.get(23)).toBe(25);
    expect(m.get(27)).toBe(9001);
    expect(m.get(40)).toBe(10);
  });

  it('between the two renumbers: #1011 → #10; after both: nothing changes', () => {
    expect(numbersAsAt(new Date('2026-10-28T12:00:00Z'), events, current).get(1011)).toBe(10);
    expect(numbersAsAt(new Date('2026-10-30T00:00:00Z'), events, current).size).toBe(0);
  });

  it('rewrites #n and #n-m in a reasoner text written before the renumber', () => {
    const f = refFreshener(events, current);
    expect(f('reasoner: Vedanta asks for approval of the B/L draft for #25-1 (SUS 6005); not #27', { at: '2026-10-27T07:11:08Z' })).toBe('reasoner: Vedanta asks for approval of the B/L draft for #27-1 (SUS 6005); not #9001');
    expect(f('reasoner: written after it: #25 and #27', { at: '2026-10-30T09:07:59Z' })).toBe('reasoner: written after it: #25 and #27');
  });

  it('without a write time only the decision’s own pairs apply; unknown refs stay as written', () => {
    const f = refFreshener(events, current);
    const local = localRefMap([{ stored: '#25', live: '#27' }, { stored: '#26', live: '#26' }, { stored: null, live: '#1' }]);
    expect([...local.entries()]).toEqual([['#25', '#27']]);
    expect(f('an earlier email in this thread went to #25', { local })).toBe('an earlier email in this thread went to #27');
    expect(f('#25-2 · the subject describes it', { local })).toBe('#27-2 · the subject describes it');
    expect(f('#26 and #23', { local })).toBe('#26 and #23');
    expect(f(null)).toBe('');
  });

  it('reads renumber events from Activity Log rows, ignoring anything else', () => {
    expect(
      renumberEventsOf([
        { resourceId: 'C', createdAt: AT, details: { orderNo: { from: 25, to: 27 }, year: 2026 } },
        { resourceId: 'C', createdAt: AT, details: { orderNo: 27 } },
        { resourceId: null, createdAt: AT, details: { orderNo: { from: 1, to: 2 } } },
        { resourceId: 'Q', createdAt: AT, details: null },
      ]),
    ).toEqual([{ orderId: 'C', at: AT, from: 25, to: 27 }]);
  });
});
