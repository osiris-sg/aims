/**
 * Round L: the Documents hub looks like Shipments — one clean order / shipment link + the real B/L per row
 * (never a "pending" placeholder, never "B/L B/L"), category counts for the tabs, search by doc ID / number /
 * B/L / order no. / file name.
 */
import { hubMatches, hubPlace, realBl, TradeHubService } from './trade-hub.service';
import { TradeConfigService } from './trade-config.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';

describe('order / shipment link + real B/L', () => {
  it('a placeholder or empty B/L is null — never "pending"; a "B/L" prefix is not doubled', () => {
    expect(realBl(null)).toBeNull();
    expect(realBl('')).toBeNull();
    expect(realBl('B/L pending')).toBeNull();
    expect(realBl('pending')).toBeNull();
    expect(realBl('TBA')).toBeNull();
    expect(realBl('B/L 198GX04630')).toBe('198GX04630');
    expect(realBl('TEST-198GX04630')).toBe('TEST-198GX04630');
  });
  it('the shipment link wins ("#27-1" + its B/L + its order for the href); contract-only links add nothing', () => {
    const p = hubPlace([
      { contractId: 'c1', shipmentId: null, contractNo: '454003598', blNumber: null },
      { contractId: null, shipmentId: null, orderId: 'o27', contractNo: null, blNumber: null, ref: '#27' },
      { contractId: null, shipmentId: 's1', contractNo: null, blNumber: '198GX04630', ref: '#27-1', orderOfShipment: 'o27' },
    ]);
    expect(p).toEqual({ ref: '#27-1', orderId: 'o27', shipmentId: 's1', bl: '198GX04630', contractNo: '454003598' });
  });
  it('the "B/L pending" + "B/L TEST-198G…" case: one #27-1 link, the real B/L only', () => {
    const p = hubPlace([
      { contractId: null, shipmentId: 's1', contractNo: null, blNumber: null, ref: '#27-1', orderOfShipment: 'o27' },
      { contractId: null, shipmentId: 's2', contractNo: null, blNumber: 'TEST-198GX09999', ref: '#27-2', orderOfShipment: 'o27' },
    ]);
    expect(p.ref).toBe('#27-1');
    expect(p.bl).toBe('TEST-198GX09999');
    expect(JSON.stringify(p)).not.toMatch(/pending/i);
  });
  it('an order-only link → "#27"; nothing linked → nulls', () => {
    expect(hubPlace([{ contractId: null, shipmentId: null, orderId: 'o27', contractNo: null, blNumber: null, ref: '#27' }])).toMatchObject({ ref: '#27', orderId: 'o27', shipmentId: null, bl: null });
    expect(hubPlace([])).toEqual({ ref: null, orderId: null, shipmentId: null, bl: null, contractNo: null });
  });
});

describe('search', () => {
  const row = {
    name: 'BL_SCAN.pdf',
    docRef: '26-27-1-BLD',
    customerName: 'SUS Co., Ltd.',
    recipient: null,
    docTypeLabel: 'B/L scan',
    links: [{ contractId: null, shipmentId: 's1', contractNo: null, blNumber: '198GX04630', ref: '#27-1' }],
    place: { ref: '#27-1', orderId: 'o27', shipmentId: 's1', bl: '198GX04630', contractNo: null },
  };
  it.each([['26-27-1-BLD'], ['bl_scan'], ['198GX04630'], ['#27'], ['27'], ['27-1'], ['#27-1']])('finds it by %s', (q) => expect(hubMatches(row, q)).toBe(true));
  it('order no. matches exactly — #2 is not #27, 27-2 is not #27-1', () => {
    expect(hubMatches(row, '#2')).toBe(false);
    expect(hubMatches(row, '27-2')).toBe(false);
    expect(hubMatches(row, 'pending')).toBe(false);
  });
});

describe('hub list: tab counts + place + search', () => {
  const file = (id: string, docType: string, fileName: string, links: any[]) => ({
    id,
    docType,
    fileName,
    mimeType: 'application/pdf',
    thumbKey: null,
    docRef: `REF-${id}`,
    uploadedByName: 'u',
    createdAt: new Date(`2026-10-1${id.length}`),
    links,
  });
  const svc = () => {
    const prisma: any = {
      tradeDocType: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'BL_SCAN', label: 'B/L scan', category: 'SUPPLIER' },
          { code: 'IMPORT_PERMIT', label: 'Import permit', category: 'CUSTOMS_LOGISTICS' },
        ]),
      },
      tradeFile: {
        findMany: jest.fn().mockResolvedValue([
          file('f1', 'BL_SCAN', 'scan.pdf', [
            { id: 'l1', contractId: null, shipmentId: 's1', orderId: null, shipment: { blNumber: null, seqNo: 1, customerId: 'k', customer: { name: 'SUS' }, order: { id: 'o27', orderNo: 27 } } },
          ]),
          file('f22', 'IMPORT_PERMIT', 'permit.pdf', [
            {
              id: 'l2',
              contractId: null,
              shipmentId: 's2',
              orderId: null,
              shipment: { blNumber: 'TEST-198GX09999', seqNo: 2, customerId: 'k', customer: { name: 'SUS' }, order: { id: 'o27', orderNo: 27 } },
            },
          ]),
        ]),
      },
      tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
      tradeGeneratedDoc: { findMany: jest.fn().mockResolvedValue([]) },
      shipment: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new TradeHubService(prisma, {} as TradeConfigService);
  };
  it('counts per category for the tabs; a shipment without a B/L shows "#27-1" and B/L null', async () => {
    const r = await svc().list(ORG, {});
    expect(r.allCount).toBe(2);
    expect(r.categoryCounts).toEqual({ SUPPLIER: 1, CUSTOMS_LOGISTICS: 1 });
    const f1: any = r.items.find((x) => x.id === 'f1');
    expect(f1.place).toEqual({ ref: '#27-1', orderId: 'o27', shipmentId: 's1', bl: null, contractNo: null });
    expect(r.items.find((x) => x.id === 'f22')!.place.bl).toBe('TEST-198GX09999');
  });
  it('search by order no. / B/L narrows the list; the tab counts follow the search', async () => {
    const byShip = await svc().list(ORG, { q: '#27-2' });
    expect(byShip.items.map((x) => x.id)).toEqual(['f22']);
    expect(byShip.categoryCounts).toEqual({ CUSTOMS_LOGISTICS: 1 });
    expect((await svc().list(ORG, { q: '27' })).items).toHaveLength(2);
    expect((await svc().list(ORG, { q: 'TEST-198G' })).items.map((x) => x.id)).toEqual(['f22']);
    expect((await svc().list(ORG, { q: 'REF-f1', category: 'SUPPLIER' })).items.map((x) => x.id)).toEqual(['f1']);
  });
});
