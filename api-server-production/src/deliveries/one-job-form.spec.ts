/**
 * One job form (WCT group, calendar style, 2026-11-24): Shop name suggestions, Location on site on the job's DO,
 * shop name in the stored style, and the record a postponed job leaves (never edited / rescheduled).
 */
import { BadRequestException } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { EMPTY_JOB_STYLE, jobStyleOf, parseJobStylePatch } from './job-style';

const ORG = 'org';
const svcWith = (prisma: any, styleOn = true) => {
  const s: any = Object.create(DeliveriesService.prototype);
  s.prisma = { organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableCalendarStyle: styleOn, enableJobsCalendar: true, enableWctOrders: true } })) }, ...prisma };
  return s;
};

describe('one job form', () => {
  it('shop name: parsed from a form, one line, kept in the stored style; server-only links never from a form', () => {
    expect(parseJobStylePatch({ shopName: '  Gokoku   Bakery ' })).toEqual({ shopName: 'Gokoku Bakery' });
    expect(parseJobStylePatch({ shopName: null })).toEqual({ shopName: null });
    expect(() => parseJobStylePatch({ shopName: 5 })).toThrow(BadRequestException);
    expect(parseJobStylePatch({ postponedTo: { id: 'x', date: '2026-12-01' }, recordOnly: true })).toEqual({});
    expect(jobStyleOf({ shopName: 'A', postponedTo: { id: 'b', date: '2026-12-05' }, recordOnly: true })).toMatchObject({ shopName: 'A', postponedTo: { id: 'b', date: '2026-12-05' }, recordOnly: true });
    expect(jobStyleOf({ postponedTo: { id: 'b', date: 'soon' } }).postponedTo).toBeNull();
    expect(EMPTY_JOB_STYLE.shopName).toBeNull();
  });

  it('shop name suggestions: only calendar style orgs, only a real customer id', async () => {
    const queryRaw = jest.fn(async () => [{ name: 'Gokoku @ Vivo', n: 3 }]);
    const s = svcWith({ $queryRaw: queryRaw });
    expect(await s.shopNames(ORG, '11111111-1111-4111-8111-111111111111')).toEqual({ names: ['Gokoku @ Vivo'] });
    expect(await s.shopNames(ORG, 'nope')).toEqual({ names: [] });
    expect(await svcWith({ $queryRaw: queryRaw }, false).shopNames(ORG, '11111111-1111-4111-8111-111111111111')).toEqual({ names: [] });
  });

  it('Location on site goes on the job DO, never on a completed DO, never without a DO', async () => {
    const doc: any = { id: 'do1', status: 'confirmed', config: { deliveryTo: 'X' } };
    const update = jest.fn(async ({ data }: any) => Object.assign(doc, data));
    const prisma: any = { deliveryItem: { findFirst: jest.fn(async () => ({ documentId: 'do1' })) }, document: { findFirst: jest.fn(async () => doc), update } };
    const s = svcWith(prisma);
    await expect(s.setJobLocation('j', ORG, { machineLocation: ' Level 3  kitchen ' })).resolves.toEqual({ id: 'j', machineLocation: 'Level 3 kitchen' });
    expect(doc.config).toEqual({ deliveryTo: 'X', machineLocation: 'Level 3 kitchen' });
    doc.status = 'delivered_installed';
    await expect(s.setJobLocation('j', ORG, { machineLocation: 'y' })).rejects.toThrow(/completed/);
    prisma.deliveryItem.findFirst = jest.fn(async () => null);
    await expect(s.setJobLocation('j', ORG, { machineLocation: 'y' })).rejects.toThrow(/no DO yet/);
  });
});

describe('delete keeps the postponed pair tidy', () => {
  const mk = (styles: Record<string, any>) => {
    const s: any = Object.create(DeliveriesService.prototype);
    s.prisma = {
      customField: { findFirst: jest.fn(async () => ({ id: 'cf' })) },
      customFieldValue: {
        findMany: jest.fn(async ({ where }: any) => (where.entityId.in as string[]).filter((id) => styles[id]).map((id) => ({ entityId: id, value: styles[id] }))),
        findUnique: jest.fn(async ({ where }: any) => (styles[where.customFieldId_entityId.entityId] ? { value: styles[where.customFieldId_entityId.entityId] } : null)),
        upsert: jest.fn(async ({ where, update }: any) => ((styles[where.customFieldId_entityId.entityId] = update.value), {})),
      },
    };
    s.removed = [];
    s.remove = jest.fn(async (id: string) => (s.removed.push(id), { deleted: true }));
    return s;
  };
  it('deleting the moved job deletes the record it left; deleting a record clears the job\'s link', async () => {
    const styles: any = { job: { postponedFrom: { id: 'rec', date: '2026-11-26' } }, rec: { recordOnly: true, postponed: true, postponedTo: { id: 'job', date: '2026-11-28' } } };
    const s = mk(styles);
    await s.removeWithPostponeRecord('job', ORG);
    expect(s.removed).toEqual(['job', 'rec']);
    const styles2: any = { job: { postponedFrom: { id: 'rec', date: '2026-11-26' } }, rec: { recordOnly: true, postponed: true, postponedTo: { id: 'job', date: '2026-11-28' } } };
    const s2 = mk(styles2);
    await s2.removeWithPostponeRecord('rec', ORG);
    expect(s2.removed).toEqual(['rec']);
    expect(styles2.job.postponedFrom).toBeNull();
  });
});
