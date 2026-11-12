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
