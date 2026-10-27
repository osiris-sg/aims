import { isManualCoaText, mixedBundleNote, parseManualCoa, renderSusCoaHtml, SUS_COA_COLUMNS } from './trade-sus-formats';

// Vedanta's manual COA PDFs as their text layer reads (numbers broken by spaces).
const OCT_1186 = `Sensitivity: Internal (C3) Sensitivity: Public (C4)
Average Chemical composition in %
Batch No. Cast No.
No. of
pieces
Material Fe Si Ti Mn Mg Zn Cu Cr Al Oth total
265C1 186 14
26 5 C1 186 4 B6 005 01 0.1600 0.6500 0.0180 0.1280 0.4880 0.0052 0.0150 0.0028 98.510 0.0300
26 5 C1 190 1 B6 00501 0.1600 0.6300 0.0190 0.1420 0.4720 0.0060 0.0252 0.0035 98.520 0.0300
IT IS ELECTRONICALLY SIGNED DOCUMENT HENCE NOT REQUIRED PHYSICALLY SIGNED. SAME
Works : AT - BHURKHAMUNDA , P.O. - SIRIPURA, JHARSUGUDA ORISSA - 768202, INDIA`;
const SEP_1556 = `Average Chemical composition in %
Batch No. Cast No.
No. of
pieces
Material Fe Si Ti Mn Mg Zn Cu Cr Al Oth total
26 5C155617
26 5C1556
4
B6 00526
0.18 00 0. 66 00 0.01 50 0. 1360 0. 483 0 0.00 52 0.0 108 0.00 63 98. 5 00
0.0300
26 6C1557
1
B60 0526
0.1 6 00 0. 66 00 0.01 6 0 0. 1350 0. 480 0 0.00 51 0.0 093 0.00 67 98. 5 00
0.0300`;
const OCT_1701 = `Average Chemical composition in %
Batch No. Cast No.
No. of
pieces
Material Fe Si Ti Mn Mg Zn Cu Cr Al Oth total
265C168914
26 5 C1689 4 B6 00526 0.17 00 0.6 600 0.014 0 0.12 90 0.486 0 0.0038 0.0258 0.0018 98. 500 0.0300
266C1692 1 B6 00526 0.18 00 0.6 700 0.015 0 0.1330 0.480 0 0.0036 0.0060 0.0010 98. 500 0.0300
26 5C1 70109
265C1701
4
B6 00526
0.1 600 0.65 00 0.01 50 0.13 30 0.486 0 0.0034 0.0076 0.0036 98.5 00
0.0300
266C1692 1 B60 0526 0.18 00 0.6 700 0.015 0 0.1330 0.48 00 0.0036 0.0060 0.0010 98. 500 0.0300`;
// The automatic test report (one row per bundle) is not a manual COA.
const AUTO = `TEST REPORT DATE : 26/09/2026 Batch No Cast No. Material Net Wt. Gross Wt. Length Size Fe Si
265C155617 265C1556 B60052608 2.551 2.561 5800 8" 0.1810 0.6560`;

describe('round AS — mixed bundles from Vedanta\'s manual COA', () => {
  it('tells a manual COA from the automatic test report', () => {
    expect(isManualCoaText(OCT_1186)).toBe(true);
    expect(isManualCoaText(AUTO)).toBe(false);
  });

  it('reads the bundle and pieces per cast through the broken spacing', () => {
    expect(parseManualCoa(OCT_1186)).toEqual([{ bundle: '265C118614', parts: [{ cast: '265C1186', pieces: 4, material: 'B600501' }, { cast: '265C1190', pieces: 1, material: 'B600501' }] }]);
    expect(parseManualCoa(SEP_1556)).toEqual([{ bundle: '265C155617', parts: [{ cast: '265C1556', pieces: 4, material: 'B600526' }, { cast: '266C1557', pieces: 1, material: 'B600526' }] }]);
    expect(parseManualCoa(OCT_1701).map(mixedBundleNote)).toEqual([
      'Bundle 265C168914: 4 pcs cast 265C1689 + 1 pc cast 266C1692 (manual COA attached)',
      'Bundle 265C170109: 4 pcs cast 265C1701 + 1 pc cast 266C1692 (manual COA attached)',
    ]);
  });

  it('never reads a single-cast row as mixed; the automatic report gives nothing', () => {
    expect(parseManualCoa(AUTO)).toEqual([]);
    expect(parseManualCoa('265C118614 26 5 C1 186 5 B6 005 01 0.1600 0.6500')).toEqual([]);
  });

  it('the footnote prints under the table, before the e-signature lines', () => {
    const { body } = renderSusCoaHtml({ date: '2026-10-26', footnotes: 'Bundle 265C118614: 4 pcs cast 265C1186 + 1 pc cast 265C1190 (manual COA attached)', footer: 'IT IS ELECTRONICALLY SIGNED' }, SUS_COA_COLUMNS, [{ batch: '265C1186', netwt: 10.2 }]);
    expect(body).toContain('Bundle 265C118614: 4 pcs cast 265C1186 + 1 pc cast 265C1190 (manual COA attached)');
    expect(body.indexOf('Bundle 265C118614')).toBeGreaterThan(body.indexOf('class="tot"'));
    expect(body.indexOf('Bundle 265C118614')).toBeLessThan(body.indexOf('IT IS ELECTRONICALLY SIGNED'));
  });
});
