import {
  MATCH_THRESHOLD,
  SUMMARY_DO_REMARK,
  descKey,
  earlierDosSummaryOnly,
  matchUsedLine,
  quoteLineLabel,
  remainingAllowance,
  remainingByLine,
  remainingQuoteLines,
  unmatchedDoRemark,
} from './order-billing';
import { plainText } from '../deliveries/quotation-to-delivery';

// 2026-11-23, ORD-Q-014151 (WCT (S) Systems): 'Add DO' after 4 imported ERP DOs carried the maintenance lines at the
// full 8 / 4 / 4 and brought back two delivered qty-1 lines, because the ERP DO lines word the quotation lines
// differently (flattened, no '- $400+GST per service' note, one outlet each). Real texts below (quotation + ERP DOs).

/** Q-014151 config.items: [description, quantity]. */
const QUOTE: Array<[string, number]> = [
  ['G- Provide tools, labor and materials to conduct below mentioned services only.', 1],
  ['G- Setting up protection coverage for kitchen service area to prevent dust, dirt or chemical to come with contact for any equipments for hygiene purposes', 1],
  ['S- Chemical degreasing for kitchen exhaust hoods (interior and exterior)', 1],
  ['S- Chemical degreasing for kitchen grease baffle filters for exhaust hoods', 1],
  ['G- Cutting and opening of access panels on ductworks for service works to be conducted', 1],
  ['S- Chemical degreasing for exhaust ductworks inside kitchen area to the its provision *where accessible*', 1],
  ['S- Cleaning of existing UV lights/lamps inside ductworks/ hoods', 1],
  [
    'S- Chemical degreasing for electrostatic air-cleaner\nc/w chemical cleaning for air cleaner cell\nc/w cleaning of existing grease tray under air cleaner\n- reinforcement of joints inside air cleaner with heavy silliant',
    1,
  ],
  ['S- Reinforcement of internal and external ductworks joints after cleaning with heavy type silliant *where accessible*', 1],
  ['S- Supply and Installation of grease trays/ holders for leaking joints (for affected duct areas if joints leaking when necessary only; or cleaning of existing grease holders/ trays)', 1],
  ['FOC - 1 Year of Troubleshooting (Maintenance Agreement)\nChecking of service works (chemical degreasing) conducted at site', 1],
  ['S- Area cleaning of service work area and clear debris from site', 1],
  ['Maintenance agreement of 1 year 4 times package (Quarterly)\n*For Hood & Duct - $400+GST per service*\n2 Outlets as below: \n1) Old Chang Kee @ Kallang MRT\n2) Old Chang Kee @ Kembangan MRT', 8],
  ['Maintenance agreement of 1 year 4 times package (Quarterly)\n*For Hood, Duct & UV Light - $400+GST per service*\n1 Outlet as below: \n1) Old Chang Kee @ Holland Village MRT', 4],
  ['Maintenance agreement of 1 year 4 times package (Quarterly)\n*For Hood, Duct & Air Cleaner - $500+GST per service*\n1 Outlet as below: \n1) Old Chang Kee @ Tampines MRT', 4],
];

/** Lines 1-12 of each of the 4 ERP DOs (identical on all four). */
const ERP_COMMON: Array<[string, number]> = [
  ['G- Provide tools, labor and materials to conduct below mentioned services only.', 1],
  ['G- Setting up protection coverage for kitchen service area to prevent dust, dirt or chemical to come with contact for any equipments for hygiene purposes', 1],
  ['S- Chemical degreasing for kitchen exhaust hoods (interior and exterior)', 1],
  ['S- Chemical degreasing for kitchen grease baffle filters for exhaust hoods', 1],
  ['G- Cutting and opening of access panels on ductworks for service works to be conducted', 1],
  ['S- Chemical degreasing for exhaust ductworks inside kitchen area to the its provision *where accessible*', 1],
  ['S- Cleaning of existing UV lights/lamps inside ductworks/ hoods', 1],
  [
    'S- Chemical degreasing for electrostatic air-cleaner c/w chemical cleaning for air cleaner cell c/w cleaning of existing grease tray under air cleaner - reinforcement of joints inside air cleaner with heavy silliant',
    1,
  ],
  ['S- Reinforcement of internal and external ductworks joints after cleaning with heavy type silliant *where accessible*', 1],
  ['S- Supply and Installation of grease trays/ holders for leaking joints (for affected duct areas if joints leaking when necessary only; or cleaning of existing grease holders/ trays)', 1],
  ['FOC - 1 Year of Troubleshooting (Maintenance Agreement) Checking of service works (chemical degreasing) conducted at site', 1],
  ['S- Area cleaning of service work area and clear debris from site', 1],
];

/** The 13th line of each ERP DO (one maintenance visit). */
const ERP_LAST: Array<[string, [string, number]]> = [
  ['DO012229', ['Maintenance agreement of 1 year 4 times package (Quarterly) *For Hood, Duct & UV Light* 1 Outlet as below: 1) Old Chang Kee @ Holland Village MRT', 1]],
  ['DO012236', ['Maintenance agreement of 1 year 4 times package (Quarterly) *For Hood, Duct & Air Cleaner* 1 Outlet as below: 1) Old Chang Kee @ Tampines MRT', 1]],
  ['DO012242', ['Maintenance agreement of 1 year 4 times package (Quarterly) *For Hood & Duct* 2 Outlets as below: 1) Old Chang Kee @ Kallang MRT', 1]],
  ['DO012241', ['Maintenance agreement of 1 year 4 times package (Quarterly) *For Hood & Duct* 2 Outlets as below: 2) Old Chang Kee @ Kembangan MRT', 1]],
];

// Keyed like prepareManualOrderDo: key from the first line (quotationLinesForJob), text = the full description.
const keyed = QUOTE.map(([d, q], i) => ({ line: i, key: descKey(plainText(d)), quantity: q, text: d }));
const used = ERP_LAST.flatMap(([, last]) => [...ERP_COMMON, last]).map(([d, q]) => ({ key: descKey(d), quantity: q, text: d }));

describe('DO prefill after imported ERP DOs (ORD-Q-014151)', () => {
  it('each quotation line: quoted minus delivered; fully delivered lines skipped; every ERP line matched (no remark)', () => {
    const { remaining, unmatchedUsed, usedLines } = remainingByLine(keyed, used);
    expect(usedLines).toBe(52);
    expect(unmatchedUsed).toBe(0);
    expect(remaining.map((r) => [r.line, r.quantity])).toEqual([
      [12, 6], // Hood & Duct: 8 quoted, 2 visits (Kallang, Kembangan)
      [13, 3], // Hood, Duct & UV Light: 4 quoted, 1 visit
      [14, 3], // Hood, Duct & Air Cleaner: 4 quoted, 1 visit
    ]);
    expect(earlierDosSummaryOnly(keyed, used)).toBe(false);
  });
  it('the old key-only matching reproduces the bug (guards the fixture)', () => {
    const old = remainingQuoteLines(keyed, remainingAllowance(keyed, used));
    expect(old.map((r) => [r.line, r.quantity])).toEqual([
      [7, 1],
      [10, 1],
      [12, 8],
      [13, 4],
      [14, 4],
    ]);
  });
  it('each ERP maintenance line matches its own quotation line by score (the Kembangan visit included)', () => {
    const one = (d: string) => matchUsedLine(keyed, { key: descKey(d), quantity: 1, text: d });
    expect(ERP_LAST.map(([, [d]]) => one(d).lines)).toEqual([[13], [14], [12], [12]]);
    for (const [, [d]] of ERP_LAST) {
      expect(one(d).how).toBe('score');
      expect(one(d).score!).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    }
    // 'S- Chemical degreasing for electrostatic air-cleaner' and 'FOC - 1 Year of Troubleshooting' (flattened on the DO)
    expect(one(ERP_COMMON[7][0]).lines).toEqual([7]);
    expect(one(ERP_COMMON[10][0]).lines).toEqual([10]);
    expect(one(ERP_COMMON[0][0])).toEqual({ lines: [0], how: 'key' });
  });
  it('summary-line earlier DOs: every line at full qty, all named in the remark', () => {
    const summary = [{ key: descKey('Balance of quotation Q-014151'), quantity: 1, text: 'Balance of quotation Q-014151' }];
    const { remaining, unmatchedUsed, untouched } = remainingByLine(keyed, summary);
    expect(unmatchedUsed).toBe(1);
    expect(remaining.map((r) => r.quantity)).toEqual(QUOTE.map(([, q]) => q));
    expect(untouched).toEqual(QUOTE.map((_, i) => i));
    expect(earlierDosSummaryOnly(keyed, summary)).toBe(true);
  });
  it('remark: only the quotation lines nothing was taken off, by their own short name', () => {
    // Every ERP line but the UV Light visit, plus one line no quotation line fits.
    const some = [...used.filter((u) => !/UV Light\*/.test(String(u.text))), { key: descKey('Ladder hire for high ceiling'), quantity: 1, text: 'Ladder hire for high ceiling' }];
    const { unmatchedUsed, untouched } = remainingByLine(keyed, some);
    expect(unmatchedUsed).toBe(1);
    expect(untouched).toEqual([13]);
    const texts = keyed.map((k) => k.text);
    expect(unmatchedDoRemark(untouched.map((i) => quoteLineLabel(texts[i], texts)))).toBe("Check qty: earlier DOs didn't match these lines: For Hood, Duct & UV Light");
    expect(quoteLineLabel(texts[0], texts)).toBe('G- Provide tools, labor and materials to conduct below me...');
    expect(unmatchedDoRemark([])).toBe(SUMMARY_DO_REMARK);
  });
});

describe('matching rule (owner, 2026-11-23)', () => {
  const Q = [
    { line: 0, key: descKey('Chemical degreasing of exhaust hood'), quantity: 2, text: 'Chemical degreasing of exhaust hood', itemCode: 'SVC-HOOD' },
    { line: 1, key: descKey('Chemical degreasing of exhaust duct'), quantity: 2, text: 'Chemical degreasing of exhaust duct', itemCode: 'SVC-DUCT' },
    { line: 2, key: descKey('Area cleaning of service work area'), quantity: 1, text: 'Area cleaning of service work area' },
  ];
  it('item code beats a different description', () => {
    const m = matchUsedLine(Q, { key: descKey('Hood cleaning (quarterly visit)'), quantity: 1, text: 'Hood cleaning (quarterly visit)', itemCode: 'svc-hood' });
    expect(m).toEqual({ lines: [0], how: 'itemCode' });
    // Even when the description is exactly another line's.
    expect(matchUsedLine(Q, { key: descKey('Chemical degreasing of exhaust duct'), quantity: 1, text: 'Chemical degreasing of exhaust duct', itemCode: 'SVC-HOOD' }).lines).toEqual([0]);
  });
  it('a near miss below the threshold stays unmatched', () => {
    const t = 'Chemical degreasing of exhaust hood and kitchen fans';
    const m = matchUsedLine(Q, { key: descKey(t), quantity: 1, text: t });
    expect(m).toEqual({ lines: [], how: 'none' });
    const r = remainingByLine(Q, [{ key: descKey(t), quantity: 1, text: t }]);
    expect(r.unmatchedUsed).toBe(1);
    expect(r.remaining.map((x) => x.quantity)).toEqual([2, 2, 1]);
  });
  it('ORD-Q-014151: another outlet of the Hood & Duct line is a near miss too', () => {
    const t = 'Maintenance agreement of 1 year 4 times package (Quarterly) *For Hood & Duct* 2 Outlets as below: 3) Old Chang Kee @ Bedok MRT';
    expect(matchUsedLine(keyed, { key: descKey(t), quantity: 1, text: t }).how).toBe('none');
  });
  it('two equally close candidates: unmatched', () => {
    const t = 'Chemical degreasing of exhaust';
    expect(matchUsedLine(Q, { key: descKey(t), quantity: 1, text: t })).toEqual({ lines: [], how: 'none' });
  });
  it('a clear closest description matches by score', () => {
    const t = 'CHEMICAL degreasing - exhaust hood';
    const m = matchUsedLine(Q, { key: descKey(t), quantity: 1, text: t });
    expect(m.lines).toEqual([0]);
    expect(m.how).toBe('score');
  });
});

describe('remainingByLine keeps the old results where keys matched', () => {
  it('lines sharing a key: used up from the last line (same as the old per-key pool)', () => {
    const lines = [
      { line: 'a', key: descKey('Visit'), quantity: 3 },
      { line: 'b', key: descKey('Visit'), quantity: 2 },
    ];
    const u = [{ key: descKey('Visit'), quantity: 2, text: 'Visit' }];
    expect(remainingByLine(lines, u).remaining).toEqual(remainingQuoteLines(lines, remainingAllowance(lines, u)));
    expect(remainingByLine(lines, u).remaining).toEqual([{ line: 'a', quantity: 3 }]);
  });
  it('a shared first line with no telling text stays one group (DOs that copied only the first line)', () => {
    const lines = keyed.slice(12);
    const first = 'Maintenance agreement of 1 year 4 times package (Quarterly)';
    expect(remainingByLine(lines, [{ key: descKey(first), quantity: 5, text: first }]).remaining.map((r) => r.quantity)).toEqual([8, 3]);
  });
  it('a shared first line with the full text (WCT balance DOs carry it) narrows to its own line', () => {
    const t = QUOTE[13][0];
    expect(matchUsedLine(keyed, { key: descKey(t), quantity: 1, text: t })).toEqual({ lines: [13], how: 'key', score: 1 });
  });
  it('a catalog product never matches by text; an ambiguous text matches nothing', () => {
    const lines = [
      { line: 0, key: 'a:p1', quantity: 2, text: 'UVC emitter' },
      { line: 1, key: descKey('Area cleaning kitchen'), quantity: 1, text: 'Area cleaning kitchen' },
      { line: 2, key: descKey('Area cleaning store'), quantity: 1, text: 'Area cleaning store' },
    ];
    expect(matchUsedLine(lines, { key: descKey('UVC emitter'), quantity: 1, text: 'UVC emitter' }).lines).toEqual([]);
    expect(matchUsedLine(lines, { key: descKey('Area cleaning'), quantity: 1, text: 'Area cleaning' }).lines).toEqual([]);
    expect(matchUsedLine(lines, { key: 'a:p1', quantity: 1 })).toEqual({ lines: [0], how: 'asset' });
  });
});
