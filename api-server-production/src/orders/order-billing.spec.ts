import { computeDocumentTotals } from '../common/document-money';
import { assetKey, descKey, orderInvoiceReference, planOrderInvoice, quoteAllowance, splitJobLines } from './order-billing';

// WCT invoice per order: the quotation is billed once per order; only lines a
// job carries on top of it are billed again (guru 2026-11-02, ORD202611-001).
const DEGREASE = 'S- Chemical degreasing for kitchen exhaust hoods (interior and exterior)';
const quote = [{ description: DEGREASE, quantity: 1, unitPrice: 100, amount: 100, accountCode: 'SS001' }];
const tax = { gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N' };
const jobKey = (l: any) => assetKey(l.assetId) ?? descKey(l.description);
const quoteKey = (l: any) => descKey(l.description);
const total = (lines: any[]) => computeDocumentTotals(lines, tax).nettTotal;

/** What the order invoice would carry: the quote lines (once) + the extras. */
function invoiceLines(plan: ReturnType<typeof planOrderInvoice>) {
  return [...(plan.billQuote ? quote : []), ...plan.extras];
}

describe('order billing: the quotation is billed once', () => {
  it('2 jobs on a $109 quote → one $109 invoice', () => {
    const plan = planOrderInvoice({
      quoteBilled: false,
      quoteLines: quote,
      jobs: [
        { jobId: 'j1', lines: [{ description: DEGREASE, quantity: 1, unitPrice: 100, amount: 100 }] },
        { jobId: 'j2', lines: [{ description: DEGREASE, quantity: 1, unitPrice: 100, amount: 100 }] },
      ],
      keyOfQuoteLine: quoteKey,
      keyOfJobLine: jobKey,
    });
    expect(plan.billQuote).toBe(true);
    expect(plan.extras).toEqual([]);
    expect(total(invoiceLines(plan))).toBe(109);
  });

  it('an extra $50 line on job 2 → $109 + $54.50', () => {
    const plan = planOrderInvoice({
      quoteBilled: false,
      quoteLines: quote,
      jobs: [
        { jobId: 'j1', lines: [{ description: DEGREASE, quantity: 1 }] },
        {
          jobId: 'j2',
          lines: [
            { description: DEGREASE, quantity: 1 },
            { description: 'Replace filter', quantity: 1, unitPrice: 50, amount: 50 },
          ],
        },
      ],
      keyOfQuoteLine: quoteKey,
      keyOfJobLine: jobKey,
    });
    expect(plan.extras.map((e) => [e.jobId, e.description])).toEqual([['j2', 'Replace filter']]);
    expect(total(invoiceLines(plan))).toBe(163.5);
  });

  it('split: invoice now after job 1 bills the quote; a later job bills only its extra; none → no invoice', () => {
    const first = planOrderInvoice({ quoteBilled: false, quoteLines: quote, jobs: [{ jobId: 'j1', lines: [{ description: DEGREASE, quantity: 1 }] }], keyOfQuoteLine: quoteKey, keyOfJobLine: jobKey });
    expect(first.billQuote).toBe(true);
    expect(total(invoiceLines(first))).toBe(109);

    const second = planOrderInvoice({
      quoteBilled: true,
      quoteLines: quote,
      jobs: [
        {
          jobId: 'j2',
          lines: [
            { description: DEGREASE, quantity: 1 },
            { description: 'Replace filter', quantity: 1, unitPrice: 50, amount: 50 },
          ],
        },
      ],
      keyOfQuoteLine: quoteKey,
      keyOfJobLine: jobKey,
    });
    expect(second.billQuote).toBe(false);
    expect(second.nothing).toBe(false);
    expect(total(invoiceLines(second))).toBe(54.5);

    const third = planOrderInvoice({ quoteBilled: true, quoteLines: quote, jobs: [{ jobId: 'j3', lines: [{ description: DEGREASE, quantity: 1 }] }], keyOfQuoteLine: quoteKey, keyOfJobLine: jobKey });
    expect(third).toEqual({ billQuote: false, extras: [], nothing: true });
  });

  it('matches free-typed lines on their first line of text, case and spacing aside (HTML from the editor too)', () => {
    expect(descKey(`<p>${DEGREASE.toUpperCase()}</p><p>second line</p>`)).toBe(descKey(`  ${DEGREASE}  `));
    expect(descKey('')).toBeNull();
  });

  it('catalog lines match on the asset; quantity above the quote is the extra', () => {
    const allowance = quoteAllowance([{ key: assetKey('A1'), quantity: 2 }]);
    const { scope, extras } = splitJobLines(
      [
        { assetId: 'A1', description: 'Hood', quantity: 1 },
        { assetId: 'A1', description: 'Hood', quantity: 1 },
        { assetId: 'A1', description: 'Hood', quantity: 1, unitPrice: 80 },
      ],
      jobKey,
      allowance,
    );
    expect(scope).toHaveLength(2);
    expect(extras).toEqual([{ assetId: 'A1', description: 'Hood', quantity: 1, unitPrice: 80 }]);
  });

  it('a line over the quoted quantity is split, the part above the quote billed', () => {
    const { scope, extras } = splitJobLines([{ description: 'Visit', quantity: 3, unitPrice: 10, amount: 30 }], jobKey, quoteAllowance([{ key: descKey('Visit'), quantity: 2 }]));
    expect(scope).toEqual([{ description: 'Visit', quantity: 2, unitPrice: 10, amount: 20 }]);
    expect(extras).toEqual([{ description: 'Visit', quantity: 1, unitPrice: 10, amount: 10 }]);
  });

  it('each job carries the full quoted scope (the allowance is per job)', () => {
    const plan = planOrderInvoice({
      quoteBilled: false,
      quoteLines: [{ description: 'Visit', quantity: 1 }],
      jobs: [1, 2, 3].map((n) => ({ jobId: `j${n}`, lines: [{ description: 'Visit', quantity: 1 }] })),
      keyOfQuoteLine: quoteKey,
      keyOfJobLine: jobKey,
    });
    expect(plan.extras).toEqual([]);
  });

  it('display rows and empty lines are never billed', () => {
    const { scope, extras } = splitJobLines([{ isGroupHeader: true, description: 'Kitchen' }, { description: '  ' }], jobKey, new Map());
    expect(scope).toEqual([]);
    expect(extras).toEqual([]);
  });

  it('an order without a quotation bills every job line (nothing is scope)', () => {
    const plan = planOrderInvoice({
      quoteBilled: false,
      quoteLines: [],
      jobs: [{ jobId: 'j1', lines: [{ description: 'Work', quantity: 1, unitPrice: 10 }] }],
      keyOfQuoteLine: quoteKey,
      keyOfJobLine: jobKey,
    });
    expect(plan.billQuote).toBe(false);
    expect(plan.extras).toHaveLength(1);
  });
});

describe('orderInvoiceReference', () => {
  it('order · DOs, unless the DO carried its own reference', () => {
    expect(orderInvoiceReference('ORD202611-001', ['DO202611008', 'DO202611009'])).toBe('ORD202611-001 · DO202611008, DO202611009');
    expect(orderInvoiceReference('ORD202611-001', ['DO202611008'], 'PO-778')).toBe('PO-778');
    expect(orderInvoiceReference('ORD202611-001', [], '')).toBe('ORD202611-001');
  });
});
