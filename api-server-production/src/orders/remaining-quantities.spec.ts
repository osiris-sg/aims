import { descKey, doLineWarnings, remainingAllowance, remainingQuoteLines } from './order-billing';

// DO first (2026-11-13): prefill only what is still to deliver; warn before saving beyond it.
const D = (d: string) => descKey(d);
const QUOTE = [
  { key: D('UVC emitter'), quantity: 3 },
  { key: D('Area cleaning'), quantity: 1 },
];

describe('remaining quantities', () => {
  it('quoted minus what the order\'s other DOs carry', () => {
    const left = remainingAllowance(QUOTE, [{ key: D('UVC emitter'), quantity: 2 }]);
    const lines = remainingQuoteLines(QUOTE.map((q, i) => ({ line: i, key: q.key, quantity: q.quantity })), left);
    expect(lines).toEqual([{ line: 0, quantity: 1 }, { line: 1, quantity: 1 }]);
  });
  it('nothing left once every quoted line is on a DO (ORD202611-003: a second DO starts empty)', () => {
    const left = remainingAllowance(QUOTE, [{ key: D('UVC emitter'), quantity: 3 }, { key: D('Area cleaning'), quantity: 1 }]);
    expect(remainingQuoteLines(QUOTE.map((q, i) => ({ line: i, key: q.key, quantity: q.quantity })), left)).toEqual([]);
  });
  it('a line not on the quote does not use any allowance', () => {
    const left = remainingAllowance(QUOTE, [{ key: D('Something else'), quantity: 5 }]);
    expect(left.get(D('UVC emitter')!)).toBe(3);
  });
});

describe('warnings before saving a DO', () => {
  it('above the quote on this DO: billed as extra', () => {
    const w = doLineWarnings(QUOTE, [], [{ key: D('UVC emitter'), quantity: 5, description: 'UVC emitter' }, { key: D('Ladder hire'), quantity: 1, description: 'Ladder hire' }]);
    expect(w.billedExtra).toEqual([{ description: 'UVC emitter', quantity: 2 }, { description: 'Ladder hire', quantity: 1 }]);
    expect(w.repeated).toEqual([]);
  });
  it('quoted work already on another DO: repeated (not billed again)', () => {
    const w = doLineWarnings(QUOTE, [{ key: D('UVC emitter'), quantity: 3 }], [{ key: D('UVC emitter'), quantity: 3, description: 'UVC emitter' }]);
    expect(w.billedExtra).toEqual([]);
    expect(w.repeated).toEqual([{ description: 'UVC emitter', quantity: 3 }]);
  });
  it('within what is left: no warning', () => {
    const w = doLineWarnings(QUOTE, [{ key: D('UVC emitter'), quantity: 1 }], [{ key: D('UVC emitter'), quantity: 2, description: 'UVC emitter' }]);
    expect(w).toEqual({ billedExtra: [], repeated: [] });
  });
});

// 2026-11-23: a balance DO lists every quotation line at full qty (flagged) when the earlier DOs were summary lines.
describe('balance DO after summary-line DOs', () => {
  const { earlierDosSummaryOnly, SUMMARY_DO_REMARK } = jest.requireActual('./order-billing');
  it('flags only when earlier DOs exist and none of their lines is a quotation line', () => {
    expect(earlierDosSummaryOnly(QUOTE, [{ key: D('Balance of quotation Q-014151'), quantity: 1 }])).toBe(true);
    expect(earlierDosSummaryOnly(QUOTE, [{ key: D('UVC emitter'), quantity: 1 }, { key: D('Ladder hire'), quantity: 1 }])).toBe(false);
    expect(earlierDosSummaryOnly(QUOTE, [])).toBe(false);
    expect(SUMMARY_DO_REMARK).toBe('Check qty: earlier DOs were summary lines');
    // The summary lines take nothing off: every line at its full qty.
    const left = remainingAllowance(QUOTE, [{ key: D('Balance of quotation Q-014151'), quantity: 1 }]);
    expect(remainingQuoteLines(QUOTE.map((q, i) => ({ line: i, key: q.key, quantity: q.quantity })), left)).toEqual([{ line: 0, quantity: 3 }, { line: 1, quantity: 1 }]);
  });
});

describe('order page: the uploaded signed / stamped DO (FILE column, 2026-11-23)', () => {
  const { stampedDoKeyOf } = jest.requireActual('./orders.service');
  it('the last "Stamped DO" attachment, nothing else', () => {
    expect(stampedDoKeyOf([{ fileKey: 'a', label: 'Stamped DO' }, { fileKey: 'b', label: 'Other' }, { fileKey: 'c', label: 'Stamped DO' }])).toBe('c');
    expect(stampedDoKeyOf([{ fileKey: 'b', label: 'Other' }])).toBeNull();
    expect(stampedDoKeyOf(null)).toBeNull();
  });
});
