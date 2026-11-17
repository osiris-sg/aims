import { BadRequestException } from '@nestjs/common';
import {
  BAR_PALETTE,
  CALENDAR_STYLE_LEGEND,
  FILL_PALETTE,
  MIN_COLOUR_DISTANCE,
  NEUTRAL_BAR,
  NEUTRAL_FILL,
  SEED_BARS,
  SEED_FILLS,
  colourClash,
  colourDistance,
  coloursOf,
  mergeColours,
  quotationSalesmanCode,
  salespersonFromCode,
  styleOf,
  StyleInput,
} from './calendar-style';
import { CalendarStyleService, isSalesMember } from './calendar-style.service';
import { JobsCalendarService } from './jobs-calendar.service';
import { CalendarNotesService } from './calendar-notes.service';
import { jobStyleOf, parseJobStylePatch } from '../deliveries/job-style';
import { DEFAULT_ORG_FEATURES } from '../organizations/default-features';
import { DeliveriesService } from '../deliveries/deliveries.service';

/**
 * Jobs calendar style (WCT group, 2026-11-18, enableCalendarStyle): fill by
 * salesperson, bar by PTW applicant, icons, greyed cancelled / postponed;
 * group child items styled too; gate off = the calendar exactly as before.
 */

const HH = 'user_hh';
const AMY = 'user_amy';
const BALA = 'user_bala';
const JOYNA = 'user_joyna';

const colours = {
  fill: { [HH]: '#039be5', [AMY]: '#8e24aa' },
  bar: { [BALA]: '#d50000', [JOYNA]: '#f6bf26' },
  defaultApplicant: { id: BALA, name: 'Bala' },
};
const input = (over: Partial<StyleInput> = {}): StyleInput => ({
  cancelled: false,
  postponed: false,
  ptwStatus: null,
  doCount: 0,
  cod: false,
  category: null,
  salespersonId: null,
  ptwApplicantId: null,
  ...over,
});
const icons = (i: Partial<StyleInput>) => styleOf(input(i), colours).icons.map((x) => x.icon);

describe('calendar style: chips', () => {
  it('fill = the salesperson colour; no salesperson (or no colour yet) = neutral', () => {
    expect(styleOf(input({ salespersonId: HH }), colours).fill).toBe('#039be5');
    expect(styleOf(input({ salespersonId: AMY }), colours).fill).toBe('#8e24aa');
    expect(styleOf(input(), colours).fill).toBe(NEUTRAL_FILL);
    expect(styleOf(input({ salespersonId: 'someone_else' }), colours).fill).toBe(NEUTRAL_FILL);
  });

  it('bar = the PTW applicant colour, only when a PTW is needed; the default applicant when the job names none', () => {
    expect(styleOf(input({ ptwStatus: 'REQUIRED', ptwApplicantId: JOYNA }), colours).bar).toBe('#f6bf26');
    expect(styleOf(input({ ptwStatus: 'APPROVED' }), colours).bar).toBe('#d50000');
    expect(styleOf(input({ ptwStatus: null, ptwApplicantId: JOYNA }), colours).bar).toBeNull();
    expect(styleOf(input({ ptwStatus: 'NOT_NEEDED', ptwApplicantId: JOYNA }), colours).bar).toBeNull();
    expect(styleOf(input({ ptwStatus: 'SUBMITTED', ptwApplicantId: 'nobody' }), { ...colours, defaultApplicant: null }).bar).toBe(NEUTRAL_BAR);
  });

  it('icons: PTW ✋ pending / applied, 👍 approved, 👎 rejected', () => {
    expect(icons({ ptwStatus: 'REQUIRED' })).toEqual(['✋']);
    expect(icons({ ptwStatus: 'SUBMITTED' })).toEqual(['✋']);
    expect(icons({ ptwStatus: 'APPROVED' })).toEqual(['👍']);
    expect(icons({ ptwStatus: 'REJECTED' })).toEqual(['👎']);
    expect(icons({ ptwStatus: 'NOT_NEEDED' })).toEqual([]);
  });

  it('icons: ✅ for a DO, "2✅" for two; 🟫 COD; ❌ cancelled; ⭕ postponed', () => {
    expect(icons({ doCount: 1 })).toEqual(['✅']);
    expect(icons({ doCount: 2 })).toEqual(['2✅']);
    expect(icons({ cod: true })).toEqual(['🟫']);
    expect(icons({ cancelled: true })).toEqual(['❌']);
    expect(icons({ postponed: true })).toEqual(['⭕']);
    expect(icons({ cancelled: true, postponed: true })).toEqual(['❌']);
    expect(icons({ postponed: true, ptwStatus: 'APPROVED', doCount: 3, cod: true })).toEqual(['⭕', '👍', '3✅', '🟫']);
  });

  it('cancelled and postponed are greyed (drawn, never dropped); others are not', () => {
    expect(styleOf(input({ cancelled: true }), colours).greyed).toBe(true);
    expect(styleOf(input({ postponed: true }), colours).greyed).toBe(true);
    expect(styleOf(input(), colours).greyed).toBe(false);
  });

  it('category prefixes: (SV) Site visit, (M) Meeting, (CC) Collect cheque; others none', () => {
    expect(styleOf(input({ category: 'Site visit' }), colours).prefix).toBe('(SV)');
    expect(styleOf(input({ category: 'Meeting' }), colours).prefix).toBe('(M)');
    expect(styleOf(input({ category: 'collect cheque' }), colours).prefix).toBe('(CC)');
    expect(styleOf(input({ category: 'Service order' }), colours).prefix).toBeNull();
  });

  it('the legend is icons only (no people)', () => {
    expect(CALENDAR_STYLE_LEGEND.map((l) => l.icon)).toEqual(['✋', '👍', '👎', '✅', '❌', '⭕', '📅', '🟫']);
    expect(JSON.stringify(CALENDAR_STYLE_LEGEND)).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('text is readable on the fill (white on dark, dark on light)', () => {
    expect(styleOf(input({ salespersonId: AMY }), colours).text).toBe('#ffffff');
    expect(styleOf(input(), colours).text).toBe('#212121');
  });
});

describe('calendar style: bar colours stay distinct from fill colours', () => {
  it('the palettes never clash (every bar far from every fill and the neutral fill)', () => {
    expect(colourClash([...FILL_PALETTE], [...BAR_PALETTE])).toBeNull();
    for (const b of BAR_PALETTE) for (const f of [...FILL_PALETTE, NEUTRAL_FILL]) expect(colourDistance(b, f)).toBeGreaterThanOrEqual(MIN_COLOUR_DISTANCE);
  });

  it('the seeds are distinct: 4 different salesperson fills, 3 different bars, none close', () => {
    const fills = Object.values(SEED_FILLS);
    const bars = Object.values(SEED_BARS);
    expect(new Set(fills).size).toBe(4);
    expect(new Set(bars).size).toBe(3);
    expect(colourClash(fills, bars)).toBeNull();
    expect(Object.keys(SEED_FILLS).sort()).toEqual(['amy@wct.com.sg', 'hh@wct.com.sg', 'joyna@wct.com.sg', 'pc@wct.com.sg']);
    expect(SEED_BARS).toEqual({ Bala: '#d50000', Joyna: '#f6bf26', Kherry: '#0b8043' });
  });

  it('a bar too close to a fill is a clash', () => {
    expect(colourClash(['#d50000'], ['#d50000'])).toEqual({ fill: '#d50000', bar: '#d50000' });
    expect(colourClash(['#039be5'], ['#0a9fe0'])).not.toBeNull();
  });

  it('saving colours refuses a bar close to a fill, and two default applicants', async () => {
    const prisma = fakeMembersPrisma([
      { userId: HH, settings: null, salesmanCode: 'S002', roles: ['Sales'] },
      { userId: BALA, settings: null, salesmanCode: null, roles: ['field-tech'] },
    ]);
    const svc = new CalendarStyleService(prisma);
    await expect(svc.save('org', { people: [{ id: HH, fill: '#039be5' }, { id: BALA, bar: '#0a9fe0' }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.save('org', { people: [{ id: HH, ptwDefault: true }, { id: BALA, ptwDefault: true }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.save('org', { people: [{ id: 'stranger', fill: '#039be5' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userOrganization.update).not.toHaveBeenCalled();
    await svc.save('org', { people: [{ id: HH, fill: '#039be5' }, { id: BALA, bar: '#d50000', ptwDefault: true }] });
    expect(prisma.userOrganization.update).toHaveBeenCalledTimes(2);
    expect(prisma.userOrganization.update.mock.calls[1][0]).toMatchObject({
      where: { userId_organizationId: { userId: BALA, organizationId: 'org' } },
      data: { settings: { calendar: { fill: null, bar: '#d50000', ptwDefault: true } } },
    });
  });
});

describe('calendar style: people', () => {
  it('Sales = a role named Sales or a salesman code', () => {
    expect(isSalesMember({ roles: ['Sales'], salesmanCode: null })).toBe(true);
    expect(isSalesMember({ roles: ['sales'], salesmanCode: null })).toBe(true);
    expect(isSalesMember({ roles: ['Admin'], salesmanCode: 'S001' })).toBe(true);
    expect(isSalesMember({ roles: ['Operations'], salesmanCode: null })).toBe(false);
  });

  it("the quotation's salesman: a member's salesman code (any case); free text matches nobody", () => {
    const codes = new Map([['S002', HH]]);
    expect(salespersonFromCode(quotationSalesmanCode({ salesPerson: 's002' }), codes)).toBe(HH);
    expect(salespersonFromCode(quotationSalesmanCode({ documentInfo: { salesPerson: 'S002' } }), codes)).toBe(HH);
    expect(salespersonFromCode(quotationSalesmanCode({ salesPerson: 'Henry' }), codes)).toBeNull();
    expect(salespersonFromCode(quotationSalesmanCode({ salesPerson: '' }), codes)).toBeNull();
  });

  it('colours from members; group children use the parent colours first', () => {
    const c = coloursOf([
      { userId: HH, settings: { calendar: { fill: '#039BE5' } } },
      { userId: BALA, settings: { calendar: { bar: '#d50000', ptwDefault: true } }, name: 'Bala' },
      { userId: AMY, settings: { other: 1 } },
    ]);
    expect(c).toEqual({ fill: { [HH]: '#039be5' }, bar: { [BALA]: '#d50000' }, defaultApplicant: { id: BALA, name: 'Bala' } });
    const child = { fill: { [HH]: '#7986cb', [AMY]: '#8e24aa' }, bar: {}, defaultApplicant: null };
    expect(mergeColours(child, c)).toEqual({ fill: { [HH]: '#039be5', [AMY]: '#8e24aa' }, bar: { [BALA]: '#d50000' }, defaultApplicant: { id: BALA, name: 'Bala' } });
  });

  it('job fields parse: people, COD, postponed; malformed values refused; stored junk reads empty', () => {
    expect(parseJobStylePatch({ salesperson: { id: HH, name: 'Nat HH' }, cod: true })).toEqual({ salespersonId: HH, salespersonName: 'Nat HH', cod: true });
    expect(parseJobStylePatch({ ptwApplicant: null, postponed: false })).toEqual({ ptwApplicantId: null, ptwApplicantName: null, postponed: false });
    expect(parseJobStylePatch({})).toEqual({});
    expect(() => parseJobStylePatch({ cod: 'yes' })).toThrow(BadRequestException);
    expect(() => parseJobStylePatch({ salesperson: { name: 'x' } })).toThrow(BadRequestException);
    expect(jobStyleOf('junk')).toEqual({ salespersonId: null, salespersonName: null, ptwApplicantId: null, ptwApplicantName: null, cod: false, postponed: false });
  });

  it('the flag is off by default for new orgs', () => {
    expect(DEFAULT_ORG_FEATURES.enableCalendarStyle).toBe(false);
  });
});

// ── The calendar service, with a small fake database ──────────────────────

const P = 'org-parent';
const C = 'org-child';
const X = 'org-other';
const Q1 = 'q-1';
const STYLE_FIELD = 'cf-style';

function fakeMembersPrisma(members: Array<{ userId: string; settings: any; salesmanCode: string | null; roles: string[] }>) {
  return {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableCalendarStyle: true } })) },
    userOrganization: {
      findMany: jest.fn(async ({ where }: any) => members.filter((m) => (where.salesmanCode ? m.salesmanCode : true)).map((m) => ({ userId: m.userId, salesmanCode: m.salesmanCode, settings: m.settings }))),
      update: jest.fn(async () => ({})),
    },
    userRole: { findMany: jest.fn(async () => members.flatMap((m) => m.roles.map((r) => ({ userId: m.userId, role: { name: r } })))) },
  } as any;
}

const baseRun = (id: string, extra: any = {}) => ({
  id,
  deliveryNumber: 1,
  direction: 'OUTBOUND',
  status: 'scheduled',
  scheduledFor: new Date('2026-11-18T02:00:00.000Z'),
  scheduledAllDay: false,
  riderUserId: null,
  riderName: null,
  siteAddress: 'site',
  customer: { name: 'Acme' },
  project: null,
  order: null,
  sourceQuotationId: null,
  verificationState: null,
  ptwStatus: null,
  ptwRemark: null,
  items: [],
  ...extra,
});

interface World {
  features: Record<string, Record<string, boolean>>;
  runs: Record<string, any[]>;
  children: Record<string, string[]>;
  members: Record<string, Array<{ userId: string; salesmanCode: string | null; settings: any; roles: string[] }>>;
  styleValues: Record<string, any>;
}

function world(): World {
  const ON = { enableJobsCalendar: true, enableWctOrders: true, enableCalendarStyle: true, enableGroupCalendar: true };
  return {
    features: { [P]: { ...ON }, [C]: { enableJobsCalendar: true, enableWctOrders: true }, [X]: { enableJobsCalendar: true, enableWctOrders: true } },
    runs: {
      [P]: [
        // Order job: its quotation's salesman code S002 = HH; PTW required, no applicant (default Bala); one DO.
        baseRun('r-order', { order: { id: 'o1', orderNumber: 'ORD-1', sourceQuotationId: Q1 }, ptwStatus: 'REQUIRED', items: [{ id: 'svc' }] }),
        // Quick job: own salesperson Amy, applicant Joyna, PTW approved, COD, postponed.
        baseRun('r-quick', { ptwStatus: 'APPROVED' }),
        // Cancelled job: stays, greyed.
        baseRun('r-cancel', { status: 'cancelled' }),
      ],
      [C]: [baseRun('r-child', { ptwStatus: 'REJECTED' })],
      [X]: [baseRun('r-x', { status: 'cancelled', ptwStatus: 'REQUIRED' }), baseRun('r-x2')],
    },
    children: { [P]: [C] },
    members: {
      [P]: [
        { userId: HH, salesmanCode: 'S002', settings: { calendar: { fill: '#039be5' } }, roles: ['Sales'] },
        { userId: AMY, salesmanCode: null, settings: { calendar: { fill: '#8e24aa' } }, roles: ['Sales'] },
        { userId: BALA, salesmanCode: null, settings: { calendar: { bar: '#d50000', ptwDefault: true } }, roles: ['field-tech'] },
        { userId: JOYNA, salesmanCode: null, settings: { calendar: { bar: '#f6bf26' } }, roles: ['Operations'] },
      ],
      [C]: [{ userId: AMY, salesmanCode: null, settings: { calendar: { fill: '#7986cb' } }, roles: ['Sales'] }],
      [X]: [{ userId: 'x-sales', salesmanCode: 'S002', settings: { calendar: { fill: '#039be5' } }, roles: ['Sales'] }],
    },
    styleValues: {
      'r-quick': { salespersonId: AMY, salespersonName: 'Amy Yap', ptwApplicantId: JOYNA, ptwApplicantName: 'Joyna', cod: true, postponed: true },
      'r-child': { salespersonId: AMY, salespersonName: 'Amy Yap', cod: false, postponed: false },
    },
  };
}

function fakePrisma(w: World) {
  const org = (where: any): string => (typeof where?.organizationId === 'string' ? where.organizationId : '');
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async ({ where }: any) => ({ features: w.features[where.organizationId] ?? {} })) },
    organization: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, name: where.id })) },
    $queryRawUnsafe: jest.fn(async (_sql: string, id: string) => (w.children[id] ?? []).map((c) => ({ id: c, name: c }))),
    delivery: { findMany: jest.fn(async ({ where }: any) => (w.runs[org(where)] ?? []).map((r) => ({ ...r }))) },
    deliveryItem: {
      findMany: jest.fn(async ({ where }: any) => (where.deliveryId.in.includes('r-order') ? [{ deliveryId: 'r-order', documentId: 'do-1' }] : [])),
    },
    document: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.type) return where.id.in.includes('do-1') ? [{ id: 'do-1', name: 'DO1', status: 'unconfirmed', documentTemplateId: 't', config: {}, createdAt: new Date() }] : [];
        return where.id.in.includes(Q1) ? [{ id: Q1, name: 'QO1', type: 'QUOTATION', documentTemplateId: 'tq', config: { salesPerson: 'S002' } }] : [];
      }),
    },
    deliverySiteClockJob: { findMany: jest.fn(async () => []) },
    calendarNote: { findMany: jest.fn(async () => []) },
    customField: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async ({ where }: any) => (where.fieldName === 'job_calendar_style' && (org(where) === P || org(where) === C) ? { id: `${STYLE_FIELD}-${org(where)}` } : null)),
    },
    customFieldValue: {
      findMany: jest.fn(async ({ where }: any) => where.entityId.in.filter((id: string) => w.styleValues[id]).map((id: string) => ({ entityId: id, value: w.styleValues[id] }))),
    },
    userOrganization: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.userId) return [];
        const list = w.members[org(where)] ?? [];
        return list.filter((m) => (where.salesmanCode ? m.salesmanCode : true)).map((m) => ({ userId: m.userId, salesmanCode: m.salesmanCode, settings: m.settings }));
      }),
    },
    userRole: {
      findMany: jest.fn(async ({ where }: any) => (where.userId ? [] : (w.members[org(where)] ?? []).flatMap((m) => m.roles.map((r) => ({ userId: m.userId, role: { name: r } }))))),
    },
  };
  return prisma;
}

const NAMES: Record<string, string> = { [HH]: 'Nat HH', [AMY]: 'Amy Yap', [BALA]: 'Bala', [JOYNA]: 'Joyna' };
const clerk = { toClerkUsers: jest.fn(async (ids: Iterable<string>) => new Map([...ids].filter((i) => NAMES[i]).map((i) => [i, { firstName: NAMES[i], lastName: '', emailAddresses: [] }]))) };

function svc(w: World, withStyle = true) {
  const prisma = fakePrisma(w);
  return new JobsCalendarService(prisma, { calendarJobs: async () => null } as any, new CalendarNotesService(prisma), withStyle ? new CalendarStyleService(prisma, clerk as any) : undefined);
}

const byId = (events: any[], id: string) => events.find((e) => e.id === `aims:${id}`);

describe('jobs calendar with the style on (WCT group)', () => {
  it('fill by salesperson (quotation code or own pick), bar by PTW applicant (own or the default), icons', async () => {
    const res = await svc(world()).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(res.style?.legend.map((l) => l.icon)).toEqual(['✋', '👍', '👎', '✅', '❌', '⭕', '📅', '🟫']);
    const order = byId(res.events, 'r-order');
    expect(order.style).toMatchObject({ fill: '#039be5', bar: '#d50000', greyed: false });
    expect(order.style.icons.map((i: any) => i.icon)).toEqual(['✋', '✅']);
    expect(order.salesperson).toEqual({ id: HH, name: 'Nat HH' });
    expect(order.ptwApplicant).toEqual({ id: BALA, name: 'Bala' });
    const quick = byId(res.events, 'r-quick');
    expect(quick.style).toMatchObject({ fill: '#8e24aa', bar: '#f6bf26', greyed: true });
    expect(quick.style.icons.map((i: any) => i.icon)).toEqual(['⭕', '👍', '🟫']);
    expect(quick).toMatchObject({ postponed: true, cod: true, statusLabel: 'Postponed', ptwApplicant: { id: JOYNA, name: 'Joyna' } });
  });

  it('cancelled jobs come back greyed with ❌ (never dropped); no salesperson = neutral fill', async () => {
    const res = await svc(world()).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const gone = byId(res.events, 'r-cancel');
    expect(gone).toBeDefined();
    expect(gone.style).toMatchObject({ fill: NEUTRAL_FILL, bar: null, greyed: true });
    expect(gone.style.icons.map((i: any) => i.icon)).toEqual(['❌']);
  });

  it('group calendar: child items are styled too, with the parent colours first', async () => {
    const res = await svc(world()).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const child = byId(res.events, 'r-child');
    expect(child.foreign).toBe(true);
    // Amy's colour from the parent (#8e24aa), not the child's own (#7986cb); PTW rejected with the default applicant's bar.
    expect(child.style).toMatchObject({ fill: '#8e24aa', bar: '#d50000' });
    expect(child.style.icons.map((i: any) => i.icon)).toEqual(['👎']);
  });

  it('gate off: the calendar is exactly as before (no style keys, same events), for the WCT parent and any other org', async () => {
    const w = world();
    w.features[P].enableCalendarStyle = false;
    const off = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const without = await svc(w, false).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(off).toEqual(without);
    expect(JSON.stringify(off)).not.toMatch(/"style"|salesperson|ptwApplicant|"cod"|postponed|doCount/);
    // Another org (flag never set): identical with or without the style service.
    const other = await svc(w).get(X, '2026-11-16', '2026-11-22', { userId: 'x' });
    const otherWithout = await svc(w, false).get(X, '2026-11-16', '2026-11-22', { userId: 'x' });
    expect(other).toEqual(otherWithout);
    expect(other.events.map((e) => e.id).sort()).toEqual(['aims:r-x', 'aims:r-x2']);
    expect(JSON.stringify(other)).not.toMatch(/"style"/);
  });
});

describe('PTW Rejected is a calendar style status only', () => {
  function ptwSvc(styleOn: boolean) {
    const svc: any = Object.create(DeliveriesService.prototype);
    svc.prisma = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableJobsCalendar: true, enableWctOrders: true, enableCalendarStyle: styleOn } })) },
      delivery: { findFirst: jest.fn(async () => ({ id: 'j' })), update: jest.fn(async () => ({})) },
    };
    svc.siteclock = { touch: jest.fn() };
    return svc;
  }
  it('gate off: refused as before; gate on: saved', async () => {
    const off = ptwSvc(false);
    await expect(off.setPtw('j', 'org', { ptwStatus: 'REJECTED' })).rejects.toBeInstanceOf(BadRequestException);
    expect(off.prisma.delivery.update).not.toHaveBeenCalled();
    await expect(off.setPtw('j', 'org', { ptwStatus: 'APPROVED' })).resolves.toMatchObject({ ptwStatus: 'APPROVED' });
    const on = ptwSvc(true);
    await expect(on.setPtw('j', 'org', { ptwStatus: 'REJECTED' })).resolves.toMatchObject({ ptwStatus: 'REJECTED' });
  });
});
