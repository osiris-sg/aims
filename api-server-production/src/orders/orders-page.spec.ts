import { compareRows, flowKey, hubIndex, hubStatus, importedSortSql, importedStatusOfTab, mergePage, nativeMatchesSearch, nativeMatchesTab, orderTabs, parseSort, sortValue } from './orders-page';

const row = (id: string, over: any = {}) => ({ id, orderNumber: `ORD-${id}`, status: 'DO_DRAFT', createdAt: '2026-11-20T00:00:00Z', customer: { name: `Cust ${id}`, customerCode: `C${id}` }, ...over });

describe('WCT orders list paging (server side)', () => {
  it('hub statuses: legacy statuses map onto the hub, unknown ones read Quotation signed', () => {
    expect(hubStatus('OPEN')).toBe('DO_DRAFT');
    expect(hubStatus('PAID')).toBe('PAID');
    expect(hubStatus('weird')).toBe('QUOTATION_SIGNED');
    expect(hubIndex('CLOSED')).toBe(hubIndex('SERVICE_REPORT_SENT'));
  });

  it('tabs: All counts every row of the source; AIMS hub tabs (main steps always); imported entries that have rows', () => {
    const tabs = orderTabs([row('1'), row('2', { status: 'PAID' })], { PAID: 3, INVOICED: 0, PART_BILLED: 2 }, { flow: false, source: 'all' });
    expect(tabs[0]).toEqual({ key: 'all', label: 'All', count: 7 });
    expect(tabs.find((t) => t.key === 'DO_DRAFT')!.count).toBe(1);
    expect(tabs.find((t) => t.key === 'DO_SCHEDULED')!.count).toBe(0); // a main step shows even at 0
    expect(tabs.find((t) => t.key === 'QUOTATION_SIGNED')).toBeUndefined();
    expect(tabs.filter((t) => t.key.startsWith('imported:')).map((t) => [t.key, t.count])).toEqual([
      ['imported:PART_BILLED', 2],
      ['imported:PAID', 3],
    ]);
    // Imported view with no AIMS rows: All + the imported entries only.
    expect(orderTabs([], { PAID: 3 }, { flow: false, source: 'imported' }).map((t) => t.key)).toEqual(['all', 'imported:PAID']);
    // Status flow wording.
    const flow = orderTabs([row('1'), row('2', { status: 'CANCELLED' }), row('3', { status: 'PAID' })], {}, { flow: true, source: 'aims' });
    expect(flow.map((t) => [t.key, t.count])).toEqual([['all', 3], ['flow:pending', 1], ['flow:completed', 1], ['flow:cancelled', 1]]);
    expect(flowKey({ status: 'SERVICE_REPORT_SENT', invoices: [{ status: 'paid' }] })).toBe('completed');
  });

  it('matching: tabs never mix AIMS and imported entries; search covers no., customer, code, quotation, subject, site', () => {
    expect(nativeMatchesTab(row('1'), 'all')).toBe(true);
    expect(nativeMatchesTab(row('1'), 'DO_DRAFT')).toBe(true);
    expect(nativeMatchesTab(row('1', { status: 'OPEN' }), 'DO_DRAFT')).toBe(true);
    expect(nativeMatchesTab(row('1'), 'imported:PAID')).toBe(false);
    expect(nativeMatchesTab(row('1', { status: 'CANCELLED' }), 'flow:cancelled')).toBe(true);
    expect(importedStatusOfTab('all')).toBeNull();
    expect(importedStatusOfTab('imported:PAID')).toBe('PAID');
    expect(importedStatusOfTab('DO_DRAFT')).toBeUndefined();
    const r = row('1', { sourceQuotation: { name: 'QO202611-0041' }, subject: 'Kitchen exhaust', site: 'Tampines' });
    for (const q of ['ord-1', 'cust 1', 'c1', 'qo202611', 'exhaust', 'TAMPINES', '']) expect(nativeMatchesSearch(r, q)).toBe(true);
    expect(nativeMatchesSearch(r, 'pizza')).toBe(false);
  });

  it('sort: newest first by default; keys as the list columns sort them; ties by id', () => {
    expect(parseSort(undefined, undefined)).toEqual({ key: 'createdAt', desc: true });
    expect(parseSort('customer', 'asc')).toEqual({ key: 'customer', desc: false });
    expect(parseSort('nonsense', 'desc')).toEqual({ key: 'createdAt', desc: true });
    expect(sortValue(row('1', { amount: null }), 'amount')).toBe(-1);
    expect(sortValue(row('1', { imported: true, billedPct: 50 }), 'billedPct')).toBe(50);
    expect(sortValue(row('1', { billedPct: 50 }), 'billedPct')).toBe(-1); // AIMS rows: blank Billed %
    expect(compareRows({ v: 1, id: 'a' }, { v: 1, id: 'b' }, true)).toBe(-1);
    expect(importedSortSql('status')).toContain("WHEN 'OPEN' THEN");
  });

  it('merge: any page equals that slice of the full merge, so Load more never repeats or skips a row', () => {
    const native = [5, 3, 3, 1].map((v, i) => ({ row: { id: `n${i}` }, v }));
    const imported = [6, 4, 3, 2, 2, 0].map((v, i) => ({ id: `i${i}`, v }));
    const full = mergePage(native, imported, true, 0, 100).map((x: any) => (x.kind === 'native' ? x.row.id : x.id));
    expect(full).toHaveLength(10);
    expect(new Set(full).size).toBe(10);
    for (const size of [1, 2, 3, 4]) {
      const pages: string[] = [];
      for (let off = 0; off < 10; off += size) {
        // Only the first off + size imported ids are passed, as the SQL LIMIT does.
        pages.push(...mergePage(native, imported.slice(0, off + size), true, off, size).map((x: any) => (x.kind === 'native' ? x.row.id : x.id)));
      }
      expect(pages).toEqual(full);
    }
  });
});
