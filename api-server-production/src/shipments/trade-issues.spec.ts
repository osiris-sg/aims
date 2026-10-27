import { castKeysOf, matchAttachmentByCast, CastHolder } from './trade-cast-index';
import { cleanIssue, issueApplies } from './trade-issues.service';

const holder = (shipmentId: string, batches: string[], casts: string[]): CastHolder => ({ shipmentId, orderId: `o-${shipmentId}`, batches: new Set(batches), casts: new Set(casts) });

describe('round AR — cast / bundle keys', () => {
  it('reads whole cast and bundle numbers, never a PDF\'s broken spacing', () => {
    expect(castKeysOf('265C118614 265C1186 B60050108 2.551')).toEqual({ batches: ['265C118614'], casts: ['265C1186'] });
    expect(castKeysOf('26 5 C1 186 4 B6 005 01')).toEqual({ batches: [], casts: [] });
    expect(castKeysOf('COA 265C1701,265C1689 SUS 26th Oct.pdf')).toEqual({ batches: [], casts: ['265C1689', '265C1701'] });
    // Inside a longer number it doesn't count.
    expect(castKeysOf('X1265C11861499')).toEqual({ batches: [], casts: [] });
  });

  const holders = [holder('s1', ['265C118614', '265C119002'], ['265C1186', '265C1190']), holder('s2', ['265C134618'], ['265C1346']), holder('s3', ['265C134618'], ['265C1346']), holder('s4', ['265C170109'], ['265C1701', '265C1186'])];

  it('a bundle no. on exactly one shipment decides', () => {
    const m = matchAttachmentByCast({ name: 'COA 265C118614.pdf' }, '', holders);
    expect(m.best?.shipmentId).toBe('s1');
    expect(m.best?.why).toMatch(/bundle 265C118614/);
  });

  it("the email's bundle no. of a cast the attachment names counts (COA 265C1186 + bundle 265C118614 in the email)", () => {
    const m = matchAttachmentByCast({ name: 'COA 265C1186 SUS 26th Oct.pdf' }, 'bundle 265C118614 (4 pcs from batch 265C1186 + 1 pc from 265C1190)', holders);
    expect(m.bundles).toEqual(['265C118614']);
    expect(m.best?.shipmentId).toBe('s1');
  });

  it('a cast on several shipments and no bundle = no default (the person picks)', () => {
    const m = matchAttachmentByCast({ name: 'COA 265C1186.pdf' }, '', holders);
    expect(m.best).toBeNull();
    expect(m.holders.map((h) => h.shipmentId).sort()).toEqual(['s1', 's4']);
  });

  it('a bundle on two B/Ls is ambiguous too', () => {
    const m = matchAttachmentByCast({ name: 'AUTOMATIC COA.pdf', text: '265C134618 265C1346' }, '', holders);
    expect(m.best).toBeNull();
    expect(m.holders).toHaveLength(2);
  });

  it('nothing matches → no default', () => {
    expect(matchAttachmentByCast({ name: 'COA 265C1689.pdf' }, '', holders).best).toBeNull();
  });
});

describe('round AR — issues', () => {
  it('create needs a title and an owner; update takes only the fields given', () => {
    expect(() => cleanIssue({ title: '' }, 'create')).toThrow(/title/);
    expect(() => cleanIssue({ title: 'x' }, 'create')).toThrow(/customer, a supplier/);
    expect(cleanIssue({ title: '  Mixed-batch bundles  ', supplierId: 'v1', docTypes: ['CUSTOMER_COA', 'bad type'] }, 'create')).toEqual({ title: 'Mixed-batch bundles', supplierId: 'v1', docTypes: ['CUSTOMER_COA'] });
    expect(cleanIssue({ status: 'RESOLVED' }, 'update')).toEqual({ status: 'RESOLVED' });
    expect(() => cleanIssue({ status: 'DELETED' }, 'update')).toThrow(/OPEN or RESOLVED/);
  });

  const ship = { id: 's1', orderId: 'o1', customerId: 'sus', supplierId: 'vedanta' };
  const base = { status: 'OPEN', shipmentIds: [] as string[], orderIds: [] as string[], customerId: null as string | null, supplierId: 'vedanta' as string | null, docTypes: ['CUSTOMER_COA'] };

  it('a supplier issue shows on that supplier\'s shipments, at its step only', () => {
    expect(issueApplies(base, ship, 'CUSTOMER_COA')).toBe(true);
    expect(issueApplies(base, ship, 'CUSTOMER_PL')).toBe(false);
    expect(issueApplies(base, { ...ship, supplierId: 'inalum' }, 'CUSTOMER_COA')).toBe(false);
  });

  it('linked shipments / orders narrow it; resolved never shows', () => {
    expect(issueApplies({ ...base, shipmentIds: ['s2'] }, ship, 'CUSTOMER_COA')).toBe(false);
    expect(issueApplies({ ...base, shipmentIds: ['s1'] }, ship, 'CUSTOMER_COA')).toBe(true);
    expect(issueApplies({ ...base, orderIds: ['o1'] }, ship, null)).toBe(true);
    expect(issueApplies({ ...base, status: 'RESOLVED' }, ship, 'CUSTOMER_COA')).toBe(false);
    // Not marked for a step: listed on the profile / order, no step banner.
    expect(issueApplies({ ...base, docTypes: [] }, ship, 'CUSTOMER_COA')).toBe(false);
    expect(issueApplies({ ...base, docTypes: [] }, ship, null)).toBe(true);
  });
});
