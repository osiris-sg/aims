import { HttpException } from '@nestjs/common';
import {
  fmtMoney,
  invoiceSplitOf,
  mergedBackConfig,
  partConfig,
  planInvoiceSplit,
  restoreSnapshotOf,
  splitAmounts,
  splitLineTexts,
  splitSentSummary,
  withSplitPartIds,
} from './invoice-split';
import { orderLinksAfter, splitInvoice, undoInvoiceSplit } from './invoice-split-ops';
import { DocumentNumberingService, splitPartNamesAmong } from '../document-numbering/document-numbering.service';
import { invoiceRowsWithSplitParts } from '../orders/wct-orders';

/**
 * Split payment (features.enableInvoiceSplit, 2026-11-17). Shared fixtures with
 * the portal's helpers/invoiceSplit.test.mjs (same numbers, same texts).
 */
const QUOTE_CFG = {
  sourceDocumentNumber: 'QO202611-0030',
  sourceDocumentType: 'QUOTATION',
  gstPercent: 9,
  taxApplicable: 'Y',
  absorbTax: 'N',
  items: [
    { description: 'Supply and install exhaust hood', quantity: 1, unitPrice: 8000, amount: 8000, accountCode: '4-2000' },
    { description: 'Ductwork', quantity: 2, unitPrice: 1000, amount: 2000, accountCode: '4-3000' },
  ],
  subTotal: 10000,
  gstAmount: 900,
  nettTotal: 10900,
  documentNumber: 'INV202611-0014',
  orderId: 'o1',
  orderJobIds: ['j1'],
  payToken: 'tok',
};

describe('split amounts', () => {
  it('by rate: 30 / 70', () => {
    expect(splitAmounts(10000, { mode: 'rate', parts: [30, 70] }).amounts).toEqual([3000, 7000]);
  });
  it('by rate: the last part takes the rounding cents', () => {
    expect(splitAmounts(100, { mode: 'rate', parts: [33.33, 33.33, 33.34] }).amounts).toEqual([33.33, 33.33, 33.34]);
    expect(splitAmounts(1000.01, { mode: 'rate', parts: [50, 50] }).amounts).toEqual([500.01, 500]);
    const a = splitAmounts(999.99, { mode: 'rate', parts: [33.3333, 33.3333, 33.3334] }).amounts;
    expect(Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100).toBe(999.99);
  });
  it('deposit %, then the remainder by rate', () => {
    expect(splitAmounts(10000, { mode: 'deposit', deposit: { percent: 30 }, parts: [50, 50] })).toEqual({ amounts: [3000, 3500, 3500], deposit: 3000, remainder: 7000 });
  });
  it('deposit as a fixed amount', () => {
    expect(splitAmounts(10000, { mode: 'deposit', deposit: { amount: 2000 }, parts: [100] })).toEqual({ amounts: [2000, 8000], deposit: 2000, remainder: 8000 });
  });
  it('refuses a plan that does not add up', () => {
    expect(() => splitAmounts(10000, { mode: 'rate', parts: [100] })).toThrow('Add at least one more invoice');
    expect(() => splitAmounts(10000, { mode: 'rate', parts: [30, 60] })).toThrow('must total 100% (now 90%)');
    expect(() => splitAmounts(10000, { mode: 'rate', parts: [0, 100] })).toThrow('above 0%');
    expect(() => splitAmounts(10000, { mode: 'deposit', deposit: { amount: 10000 }, parts: [100] })).toThrow('below the contract value');
    expect(() => splitAmounts(10000, { mode: 'deposit', deposit: {}, parts: [100] })).toThrow('Enter the deposit');
    expect(() => splitAmounts(10000, { mode: 'deposit', deposit: { percent: 10, amount: 5 }, parts: [100] })).toThrow('not both');
    expect(() => splitAmounts(0, { mode: 'rate', parts: [50, 50] })).toThrow('no amount');
    expect(() => splitAmounts(0.01, { mode: 'rate', parts: [10, 90] })).toThrow('Invoice -1 comes to $0.00');
  });
});

describe('split line texts (BC Air I003278 style, one line per part)', () => {
  it('by rate', () => {
    expect(splitLineTexts({ mode: 'rate', parts: [30, 40, 30] }, 10000, 'QO202611-0030')).toEqual([
      'First payment (30%) of contract value $10,000.00, ref QO202611-0030',
      'Second payment (40%) of contract value $10,000.00, ref QO202611-0030',
      'Final payment (30%) of contract value $10,000.00, ref QO202611-0030',
    ]);
  });
  it('deposit + rate', () => {
    expect(splitLineTexts({ mode: 'deposit', deposit: { percent: 30 }, parts: [50, 50] }, 10000, 'QO202611-0030')).toEqual([
      'Deposit (30%) of contract value $10,000.00, ref QO202611-0030',
      'Second payment (50% of balance $7,000.00) of contract value $10,000.00, ref QO202611-0030',
      'Final payment (50% of balance $7,000.00) of contract value $10,000.00, ref QO202611-0030',
    ]);
    expect(splitLineTexts({ mode: 'deposit', deposit: { amount: 2000 }, parts: [100] }, 10000, null)).toEqual([
      'Deposit ($2,000.00) of contract value $10,000.00',
      'Final payment (balance $8,000.00) of contract value $10,000.00',
    ]);
  });
  it('money format', () => {
    expect(fmtMoney(1234567.5)).toBe('$1,234,567.50');
    expect(fmtMoney(0)).toBe('$0.00');
  });
});

describe('planInvoiceSplit', () => {
  it('GST per part; the parts add up to the invoice', () => {
    const p = planInvoiceSplit(QUOTE_CFG, { mode: 'rate', parts: [30, 70] });
    expect(p.contractValue).toBe(10000);
    expect(p.parts.map((x) => [x.totals.subTotal, x.totals.gstAmount, x.totals.nettTotal])).toEqual([
      [3000, 270, 3270],
      [7000, 630, 7630],
    ]);
  });
  it('a document discount comes off the contract value', () => {
    const p = planInvoiceSplit({ ...QUOTE_CFG, discountAmount: 1000 }, { mode: 'rate', parts: [50, 50] });
    expect(p.contractValue).toBe(9000);
    expect(p.parts[0].description).toBe('First payment (50%) of contract value $9,000.00, ref QO202611-0030');
  });
  it('tax inclusive: the lines carry GST, each part derives its own', () => {
    const p = planInvoiceSplit({ ...QUOTE_CFG, absorbTax: 'Y' }, { mode: 'rate', parts: [50, 50] });
    expect(p.parts[0].totals).toMatchObject({ nettTotal: 5000, gstAmount: 412.84, subTotal: 4587.16 });
  });
});

describe('part config + undo snapshot', () => {
  const p = planInvoiceSplit(QUOTE_CFG, { mode: 'rate', parts: [30, 70] });
  const ctx = (i: number) => ({ number: `INV202611-0014-${i + 1}`, groupId: 'inv1', of: 2, baseNumber: 'INV202611-0014', mode: 'rate' as const, account: { accountCode: '4-2000' } });
  it('keeps the header, one line, its own money; never the pay link or the jobs', () => {
    const c = partConfig(QUOTE_CFG, p.parts[1], ctx(1));
    expect(c.orderId).toBe('o1');
    expect(c.sourceDocumentNumber).toBe('QO202611-0030');
    expect(c.payToken).toBeUndefined();
    expect(c.orderJobIds).toBeUndefined();
    expect(c.documentNumber).toBe('INV202611-0014-2');
    expect(c.items).toEqual([{ description: 'Final payment (70%) of contract value $10,000.00, ref QO202611-0030', quantity: 1, unitPrice: 7000, amount: 7000, splitPart: 2, accountCode: '4-2000' }]);
    expect([c.subTotal, c.gstAmount, c.nettTotal, c.totalWithTax, c.outstandingBalance, c.paidToDate]).toEqual([7000, 630, 7630, 7630, 7630, 0]);
    expect(invoiceSplitOf(c)).toMatchObject({ groupId: 'inv1', part: 2, of: 2 });
  });
  it('undo puts the lines, totals and number back; header edits made since stay', () => {
    const split = { ...partConfig(QUOTE_CFG, p.parts[0], ctx(0)), remarks: 'edited after split' };
    const back = mergedBackConfig(split, restoreSnapshotOf(QUOTE_CFG));
    expect(back.items).toEqual(QUOTE_CFG.items);
    expect([back.subTotal, back.gstAmount, back.nettTotal, back.documentNumber]).toEqual([10000, 900, 10900, 'INV202611-0014']);
    expect(back.totalWithTax).toBeUndefined(); // the original had no stamp: none is invented
    expect(back.invoiceSplit).toBeUndefined();
    expect(back.remarks).toBe('edited after split');
  });
});

describe('orders see every part', () => {
  it('withSplitPartIds: no split = the same ids', () => {
    expect(withSplitPartIds(['a', 'b'], [{ id: 'a', config: {} }, { id: 'b', config: null }])).toEqual(['a', 'b']);
  });
  it('withSplitPartIds: part 1 brings the others; a later part brings part 1', () => {
    expect(withSplitPartIds(['a'], [{ id: 'a', config: { invoiceSplit: { groupId: 'a', part: 1, of: 3, partIds: ['a', 'b', 'c'] } } }])).toEqual(['a', 'b', 'c']);
    expect(withSplitPartIds(['c'], [{ id: 'c', config: { invoiceSplit: { groupId: 'a', part: 3, of: 3 } } }])).toEqual(['c', 'a']);
  });
  it('invoiceRowsWithSplitParts: one query when nothing is split', async () => {
    const findMany = jest.fn(async () => [{ id: 'a', status: 'paid', config: {} }]);
    expect(await invoiceRowsWithSplitParts({ document: { findMany } }, 'org', ['a'])).toEqual([{ id: 'a', status: 'paid', config: {} }]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it('"2 of 3 sent"', () => {
    const s = (status: string) => ({ status, split: { part: 1 } });
    expect(splitSentSummary([s('pending_payment'), s('paid'), s('draft')])).toBe('2 of 3 sent');
    expect(splitSentSummary([{ status: 'draft' }])).toBeNull();
  });
  it('order links: parts added, renamed, removed on undo', () => {
    const ld = { po: [], do: [], invoice: [{ id: 'inv1', name: 'INV202611-0014' }], salesOrder: [] };
    const after = orderLinksAfter(ld, { renameId: 'inv1', renameTo: 'INV202611-0014-1', add: [{ id: 'p2', name: 'INV202611-0014-2' }] });
    expect(after.invoice).toEqual([{ id: 'inv1', name: 'INV202611-0014-1' }, { id: 'p2', name: 'INV202611-0014-2', splitPart: true }]);
    expect(orderLinksAfter(after, { renameId: 'inv1', renameTo: 'INV202611-0014', removeIds: ['p2'] }).invoice).toEqual(ld.invoice);
  });
});

describe('numbering: parts never move the counter', () => {
  const fmt = { id: 'f1', organizationId: 'org', documentType: 'INVOICE', pattern: '{DOC}{YYYY}{MM}-{####}', resetPolicy: 'never', nextSerial: 15, lastResetKey: null, isActive: true };
  const when = new Date(2026, 10, 17);
  const db = (names: Array<{ name: string; config?: any }>) =>
    ({
      documentNumberFormat: { findFirst: async () => fmt, findMany: async () => [fmt] },
      document: { findMany: async (a: any) => (a.where.name?.in ? names.filter((n) => a.where.name.in.includes(n.name)) : names.filter((n) => n.name.startsWith(a.where.name.startsWith))) },
    }) as any;
  it('a split part counts as its base serial, nothing above it', async () => {
    const svc = new DocumentNumberingService(db([{ name: 'INV202611-0014-1', config: { invoiceSplit: { groupId: 'x', part: 1 } } }, { name: 'INV202611-0014-12', config: { invoiceSplit: { groupId: 'x', part: 12 } } }]));
    expect((await svc.peekNumber('org', 'INVOICE', { when }))!.number).toBe('INV202611-0015');
  });
  it('without split parts: unchanged (a "-n" name that is not a part is ignored as before)', async () => {
    const svc = new DocumentNumberingService(db([{ name: 'INV202611-0013' }, { name: 'INV202611-0099-2', config: {} }]));
    expect((await svc.peekNumber('org', 'INVOICE', { when }))!.number).toBe('INV202611-0015');
  });
  it('legacy names: a split part after the highest serial still reserves its base', async () => {
    const svc = new DocumentNumberingService(db([{ name: 'INV202611-0020-1', config: { invoiceSplit: { groupId: 'x', part: 1 } } }]));
    expect((await svc.peekNumber('org', 'INVOICE', { when }))!.number).toBe('INV202611-0021');
    expect(await splitPartNamesAmong(db([{ name: 'A-1', config: {} }]) as any, 'org', ['A-1'])).toEqual([]);
  });
});

/** In-memory Prisma for the ops. */
function world(o: { features?: any; status?: string; payments?: number; journals?: any[]; config?: any } = {}) {
  const docs = new Map<string, any>();
  docs.set('inv1', { id: 'inv1', organizationId: 'org', type: 'INVOICE', name: 'INV202611-0014', status: o.status ?? 'unconfirmed', documentTemplateId: 't1', projectId: null, config: { ...QUOTE_CFG, ...(o.config || {}) } });
  const order: any = { id: 'o1', linkedDocuments: { po: [], do: [], invoice: [{ id: 'inv1', name: 'INV202611-0014' }], salesOrder: [] } };
  const match = (d: any, w: any) =>
    (!w.id || (typeof w.id === 'string' ? d.id === w.id : w.id.in.includes(d.id))) &&
    (!w.name || (typeof w.name === 'string' ? d.name === w.name : w.name.in ? w.name.in.includes(d.name) : true)) &&
    (!w.NOT || !(w.NOT.id === d.id || (w.NOT.id?.in ?? []).includes(d.id))) &&
    (!w.documentTemplateId || d.documentTemplateId === w.documentTemplateId);
  const prisma: any = {
    organizationUIConfig: { findUnique: async () => ({ features: o.features ?? { enableInvoiceSplit: true, postInvoicesOnConfirm: true } }) },
    document: {
      findFirst: async (a: any) => [...docs.values()].find((d) => match(d, a.where)) ?? null,
      findMany: async (a: any) => [...docs.values()].filter((d) => match(d, a.where)),
      update: async (a: any) => Object.assign(docs.get(a.where.id), { ...a.data, version: undefined }),
      create: async (a: any) => docs.set(a.data.id, { ...a.data }),
      deleteMany: async (a: any) => a.where.id.in.forEach((id: string) => docs.delete(id)),
    },
    payment: { count: async () => o.payments ?? 0 },
    journalEntry: { findMany: async () => o.journals ?? [] },
    order: { findFirst: async () => order, update: async (a: any) => Object.assign(order, a.data) },
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn: any) => fn(prisma),
  };
  const log: any[] = [];
  return { prisma, docs, order, log, logFn: (e: any) => void log.push(e) };
}

describe('splitInvoice / undoInvoiceSplit', () => {
  it('splits: -1 keeps its row, -2 is new, the order lists both; undo merges back', async () => {
    const w = world();
    const out = await splitInvoice(w.prisma, 'org', 'inv1', { mode: 'rate', parts: [30, 70] }, { name: 'Elroy' }, w.logFn);
    expect(out.parts.map((p) => [p.name, p.total])).toEqual([
      ['INV202611-0014-1', 3270],
      ['INV202611-0014-2', 7630],
    ]);
    const first = w.docs.get('inv1');
    expect(first.name).toBe('INV202611-0014-1');
    expect(first.config.orderJobIds).toEqual(['j1']);
    expect(first.config.payToken).toBe('tok');
    expect(first.config.invoiceSplit.partIds).toHaveLength(2);
    const second = w.docs.get(out.parts[1].id);
    expect([second.status, second.type, second.documentTemplateId]).toEqual(['unconfirmed', 'INVOICE', 't1']);
    expect(w.order.linkedDocuments.invoice.map((x: any) => x.name)).toEqual(['INV202611-0014-1', 'INV202611-0014-2']);
    expect(w.log.map((l) => l.action)).toEqual(['EDITED', 'CREATED']);

    await expect(splitInvoice(w.prisma, 'org', 'inv1', { mode: 'rate', parts: [50, 50] }, undefined, w.logFn)).rejects.toThrow('already split');

    const back = await undoInvoiceSplit(w.prisma, 'org', out.parts[1].id, { name: 'Elroy' }, w.logFn);
    expect(back).toEqual({ id: 'inv1', name: 'INV202611-0014', removed: ['INV202611-0014-2'] });
    expect(w.docs.size).toBe(1);
    expect(w.docs.get('inv1').config.items).toEqual(QUOTE_CFG.items);
    expect(w.docs.get('inv1').config.nettTotal).toBe(10900);
    expect(w.order.linkedDocuments.invoice).toEqual([{ id: 'inv1', name: 'INV202611-0014' }]);
  });

  it('setting off (every org but the WCT group): refused, nothing written', async () => {
    const w = world({ features: { postInvoicesOnConfirm: true } });
    await expect(splitInvoice(w.prisma, 'org', 'inv1', { mode: 'rate', parts: [30, 70] }, undefined, w.logFn)).rejects.toThrow('not enabled');
    expect(w.docs.get('inv1').name).toBe('INV202611-0014');
  });

  it('needs postInvoicesOnConfirm (no draft part may sit in the GL)', async () => {
    const w = world({ features: { enableInvoiceSplit: true } });
    await expect(splitInvoice(w.prisma, 'org', 'inv1', { mode: 'rate', parts: [30, 70] }, undefined, w.logFn)).rejects.toThrow('post to the ledger on confirm');
  });

  it.each([
    ['sent', { status: 'pending_payment' }, 'no longer a draft'],
    ['paid', { payments: 1 }, 'payment'],
    ['in the GL', { journals: [{ sourceDocumentId: 'inv1', status: 'POSTED' }] }, 'ledger entry'],
    ['imported', { config: { erpImport: { source: 'ABSS' } } }, 'imported'],
    ['synced to Xero', { config: { xeroInvoiceId: 'x' } }, 'Xero'],
    ['stale totals', { config: { nettTotal: 999 } }, 'Save the invoice first'],
  ])('refuses an invoice that is %s', async (_n, o, msg) => {
    const w = world(o as any);
    const p = splitInvoice(w.prisma, 'org', 'inv1', { mode: 'rate', parts: [30, 70] }, undefined, w.logFn);
    await expect(p).rejects.toBeInstanceOf(HttpException);
    await expect(p).rejects.toThrow(msg);
  });

  it('undo is refused once a part is sent, and while any part has a journal (even void)', async () => {
    const w = world();
    const out = await splitInvoice(w.prisma, 'org', 'inv1', { mode: 'rate', parts: [50, 50] }, undefined, w.logFn);
    w.docs.get(out.parts[1].id).status = 'pending_payment';
    await expect(undoInvoiceSplit(w.prisma, 'org', 'inv1', undefined, w.logFn)).rejects.toThrow('no longer a draft');
    w.docs.get(out.parts[1].id).status = 'unconfirmed';
    w.prisma.journalEntry.findMany = async () => [{ sourceDocumentId: out.parts[1].id, status: 'VOID' }];
    await expect(undoInvoiceSplit(w.prisma, 'org', 'inv1', undefined, w.logFn)).rejects.toThrow('ledger entry');
    expect(w.docs.size).toBe(2);
  });
});
