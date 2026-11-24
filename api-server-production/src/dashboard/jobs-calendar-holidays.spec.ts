import { holidaysInRange } from './jobs-calendar';
import { JobsCalendarService } from './jobs-calendar.service';

// Public holidays on the jobs calendar (WCT group, calendar style orgs, 2026-11-24): read from the Field module's
// public holidays table (FieldPublicHoliday), sent as `holidays` only when the calendar style is on.
const WCT = '5c700000-0000-4000-8000-5c7000000001';

describe('holidaysInRange', () => {
  it('in range, one per holiday per day (date + name, any case), by date; junk dropped', () => {
    const rows = [
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-11-08', name: '  Deepavali ' },
      { date: '2026-12-25', name: 'christmas  day' },
      { date: '2026-12-25', name: 'Christmas (other org)' },
      { date: '2027-01-01', name: "New Year's Day" },
      { date: 'junk', name: 'x' },
      { date: '2026-11-20', name: '' },
    ];
    expect(holidaysInRange(rows, '2026-11-01', '2026-12-31')).toEqual([
      { date: '2026-11-08', name: 'Deepavali' },
      { date: '2026-12-25', name: 'Christmas (other org)' },
      { date: '2026-12-25', name: 'Christmas Day' },
    ]);
  });
});

describe('jobs calendar response: holidays', () => {
  function setup(styleOn: boolean, rows: any[] = [{ date: '2026-11-08', name: 'Deepavali' }]) {
    const holidayFind = jest.fn(async ({ where }: any) => rows.filter((r) => r.date >= where.date.gte && r.date <= where.date.lte));
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn().mockResolvedValue({ features: { enableJobsCalendar: true, enableCalendarStyle: styleOn } }) },
      organization: { findUnique: jest.fn().mockResolvedValue({ id: WCT, name: 'WCT', parentOrganizationId: null }), findMany: jest.fn().mockResolvedValue([]) },
      delivery: { findMany: jest.fn().mockResolvedValue([]) },
      deliverySiteClockJob: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryItem: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      customField: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      customFieldValue: { findMany: jest.fn().mockResolvedValue([]) },
      fieldPublicHoliday: { findMany: holidayFind },
    };
    const style: any = {
      enabled: jest.fn(async () => styleOn),
      colours: jest.fn(async () => ({ fills: {}, bars: {}, defaultApplicant: null, ptwList: null })),
      panel: jest.fn(async () => []),
      names: jest.fn(async () => new Map()),
      salesmanCodes: jest.fn(async () => new Map()),
    };
    const svc = new JobsCalendarService(prisma, { calendarJobs: async () => null } as any, undefined, style);
    return { svc, holidayFind };
  }

  it('calendar style orgs get the holidays in the range', async () => {
    const { svc, holidayFind } = setup(true);
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect(res.holidays).toEqual([{ date: '2026-11-08', name: 'Deepavali' }]);
    expect(holidayFind.mock.calls[0][0].where).toMatchObject({ organizationId: WCT, date: { gte: '2026-11-01', lte: '2026-11-30' } });
    // None in the range: an empty list.
    expect((await svc.get(WCT, '2026-12-01', '2026-12-31')).holidays).toEqual([]);
  });

  it('every other org: no holidays key and no read', async () => {
    const { svc, holidayFind } = setup(false);
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect('holidays' in res).toBe(false);
    expect(holidayFind).not.toHaveBeenCalled();
  });

  it('a failed read never fails the calendar (the key is left out)', async () => {
    const { svc } = setup(true);
    (svc as any).prisma.fieldPublicHoliday.findMany = jest.fn().mockRejectedValue(new Error('no table'));
    const res = await svc.get(WCT, '2026-11-01', '2026-11-30');
    expect('holidays' in res).toBe(false);
    expect(Array.isArray(res.events)).toBe(true);
  });
});
