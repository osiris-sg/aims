import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  NEUTRAL_BAR,
  PTW_STATUS_COLOUR_KEYS,
  cleanPtwStatusColours,
  mergeColours,
  ptwStatusColour,
  ptwStripeLegend,
  styleOf,
  StyleInput,
} from './calendar-style';
import { CalendarStyleService } from './calendar-style.service';
import { PTW_COLOURS_FIELD, readPtwStatusColours, writePtwStatusColours } from './calendar-ptw-colours';

/**
 * Org Settings > Calendar colours (WCT group, 2026-11-25, enableCalendarStyle): people colours (the calendar's People
 * list) and a PTW stripe colour per PTW status. Nothing set = the calendar exactly as before (stripe = applicant).
 */

const HH = 'user_hh';
const BALA = 'user_bala';
const ADMIN = 'user_admin';
const SALES = 'user_sales';

const base = { fill: { [HH]: '#039be5' }, bar: { [BALA]: '#d50000' }, defaultApplicant: null };
const input = (over: Partial<StyleInput> = {}): StyleInput => ({
  cancelled: false,
  postponed: false,
  ptwStatus: null,
  doCount: 0,
  cod: false,
  category: null,
  salespersonId: HH,
  ptwApplicantId: BALA,
  ...over,
});

describe('PTW stripe colour per status', () => {
  it('no status colours: the stripe is the applicant colour, exactly as before', () => {
    for (const st of PTW_STATUS_COLOUR_KEYS) expect(styleOf(input({ ptwStatus: st }), base).bar).toBe('#d50000');
    expect(styleOf(input({ ptwStatus: 'NOT_NEEDED' }), base).bar).toBeNull();
    expect(styleOf(input({ ptwStatus: 'REQUIRED', ptwApplicantId: null }), base).bar).toBe(NEUTRAL_BAR);
  });

  it('a status with a colour draws the stripe in it; the applicant circle still follows the applicant', () => {
    const c = { ...base, ptwStatus: { APPROVED: '#0b8043', SUBMITTED: '#1e64c8' } };
    const approved = styleOf(input({ ptwStatus: 'APPROVED' }), c);
    expect(approved.bar).toBe('#0b8043');
    expect(approved.applicantIcon).toBe('🔴');
    expect(styleOf(input({ ptwStatus: 'SUBMITTED' }), c).bar).toBe('#1e64c8');
    // Required has no colour: the applicant's.
    expect(styleOf(input({ ptwStatus: 'REQUIRED' }), c).bar).toBe('#d50000');
    // No PTW needed: no stripe, whatever is set.
    expect(styleOf(input({ ptwStatus: 'NOT_NEEDED' }), c).bar).toBeNull();
    // The fill (salesperson) never changes.
    expect(approved.fill).toBe('#039be5');
  });

  it('clean: known statuses with #rrggbb only, lower case', () => {
    expect(cleanPtwStatusColours({ REQUIRED: '#AABBCC', SUBMITTED: 'red', NOT_NEEDED: '#000000', APPROVED: null })).toEqual({ REQUIRED: '#aabbcc' });
    expect(cleanPtwStatusColours(null)).toEqual({});
    expect(cleanPtwStatusColours(['#000000'])).toEqual({});
    expect(ptwStatusColour('approved', { ptwStatus: { APPROVED: '#0b8043' } })).toBe('#0b8043');
    expect(ptwStatusColour(null, { ptwStatus: { APPROVED: '#0b8043' } })).toBeNull();
  });

  it('group calendar: the parent org colours win, the child keeps the rest', () => {
    const m = mergeColours({ ...base, ptwStatus: { REQUIRED: '#f4511e', APPROVED: '#0b8043' } }, { ...base, ptwStatus: { APPROVED: '#1e64c8' } });
    expect(m.ptwStatus).toEqual({ REQUIRED: '#f4511e', APPROVED: '#1e64c8' });
    expect(mergeColours(base, base).ptwStatus).toBeUndefined();
  });

  it('legend: one stripe row per status with a colour, in status order; none when nothing is set', () => {
    expect(ptwStripeLegend({ ptwStatus: { REJECTED: '#212121', REQUIRED: '#f4511e' } })).toEqual([
      { label: 'PTW required', colour: '#f4511e' },
      { label: 'PTW rejected', colour: '#212121' },
    ]);
    expect(ptwStripeLegend({})).toEqual([]);
    expect(ptwStripeLegend(null)).toEqual([]);
  });
});

describe('storage: a storage-only custom field (no schema change)', () => {
  it('reads nothing as no colours, writes a hidden field once then updates it', async () => {
    const store: any = { row: null };
    const prisma: any = {
      customField: {
        findFirst: jest.fn(async () => store.row),
        create: jest.fn(async ({ data }: any) => (store.row = { id: 'f1', ...data })),
        update: jest.fn(async ({ data }: any) => Object.assign(store.row, data)),
      },
    };
    expect(await readPtwStatusColours(prisma, 'org')).toEqual({});
    await writePtwStatusColours(prisma, 'org', { APPROVED: '#0b8043' });
    expect(prisma.customField.create.mock.calls[0][0].data).toMatchObject({ fieldName: PTW_COLOURS_FIELD, entityType: 'Delivery', isActive: false, showInList: false, showInForm: false, options: { APPROVED: '#0b8043' } });
    await writePtwStatusColours(prisma, 'org', {});
    expect(prisma.customField.update).toHaveBeenCalledTimes(1);
    expect(await readPtwStatusColours(prisma, 'org')).toEqual({});
  });
});

/** An org: HH (Sales, picked colour), Sales Person (Sales, no colour: automatic), Bala (applicant), Admin. */
function pagePrisma(opts: { ptw?: Record<string, string>; style?: boolean; adminRoles?: string[] } = {}) {
  const members = [
    { userId: HH, salesmanCode: 'S002', settings: { calendar: { fill: '#039be5' } }, roles: ['Sales'] },
    { userId: SALES, salesmanCode: null, settings: null, roles: ['Sales'] },
    { userId: BALA, salesmanCode: null, settings: null, roles: ['Operations'] },
    { userId: ADMIN, salesmanCode: null, settings: null, roles: opts.adminRoles ?? ['Admin'] },
  ];
  const fields: Record<string, any> = {
    ptw_applicants: { options: [{ id: 'pta_bala', name: 'Bala', colour: '#d50000', hidden: false, userId: BALA }], defaultValue: 'pta_bala' },
    ...(opts.ptw ? { [PTW_COLOURS_FIELD]: { id: 'pc', options: opts.ptw } } : {}),
  };
  const roleIdOf = (name: string) => `role-${name}`;
  return {
    fields,
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableCalendarStyle: opts.style !== false } })) },
    userOrganization: {
      findMany: jest.fn(async ({ where }: any) => members.filter((m) => (where.salesmanCode ? m.salesmanCode : true)).map((m) => ({ userId: m.userId, salesmanCode: m.salesmanCode, settings: m.settings }))),
      update: jest.fn(async () => ({})),
    },
    userRole: {
      findMany: jest.fn(async ({ where }: any) => {
        const list = where.userId ? members.filter((m) => m.userId === where.userId) : members;
        return list.flatMap((m) => m.roles.map((r) => ({ userId: m.userId, roleId: roleIdOf(r), role: { name: r } })));
      }),
    },
    role: { findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: id.replace('role-', '') }))) },
    customAccess: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    calendarNote: { findMany: jest.fn(async () => []) },
    customFieldValue: { findMany: jest.fn(async () => []) },
    customField: {
      findFirst: jest.fn(async ({ where }: any) => fields[where.fieldName] ?? null),
      create: jest.fn(async ({ data }: any) => (fields[data.fieldName] = { id: 'new', ...data })),
      update: jest.fn(async ({ data }: any) => Object.assign(fields[PTW_COLOURS_FIELD], data)),
    },
  } as any;
}

const NAMES: Record<string, string> = { [HH]: 'Nat HH', [SALES]: 'Sam Sales', [BALA]: 'Bala', [ADMIN]: 'Ada Admin' };
const clerk = { toClerkUsers: jest.fn(async (ids: Iterable<string>) => new Map([...ids].filter((i) => NAMES[i]).map((i) => [i, { firstName: NAMES[i], lastName: '', emailAddresses: [] }]))) };
const admin = { orgId: 'org', platform: false, userId: ADMIN };

describe('Calendar colours page (Org Settings edit only)', () => {
  it('lists the People (Sales members + picked colours) with today colours, picked or automatic; PTW statuses default to the applicant colour', async () => {
    const svc = new CalendarStyleService(pagePrisma(), clerk as any);
    const page = await svc.coloursPage('org', admin);
    expect(page.people.map((p) => [p.name, p.auto])).toEqual([
      ['Nat HH', false],
      ['Sam Sales', true],
    ]);
    expect(page.people[0].colour).toBe('#039be5');
    expect(page.people[1].colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(page.ptw).toEqual([
      { status: 'REQUIRED', label: 'Required', colour: null },
      { status: 'SUBMITTED', label: 'Pending', colour: null },
      { status: 'APPROVED', label: 'Approved', colour: null },
      { status: 'REJECTED', label: 'Rejected', colour: null },
    ]);
    expect(page.applicants).toEqual([{ name: 'Bala', colour: '#d50000' }]);
    // Offered people colours never sit close to a PTW stripe colour (Bala red is excluded).
    expect(page.palettes.people).not.toContain('#d50000');
    expect(page.palettes.ptw).not.toContain('#039be5');
  });

  it('refuses anyone without Org Settings edit (a Sales role), and orgs without the calendar style', async () => {
    const sales = new CalendarStyleService(pagePrisma({ adminRoles: ['Sales'] }), clerk as any);
    await expect(sales.coloursPage('org', admin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(sales.saveColoursPage('org', admin, { ptw: { APPROVED: '#0b8043' } })).rejects.toBeInstanceOf(ForbiddenException);
    // The platform admin may.
    await expect(sales.coloursPage('org', { orgId: 'org', platform: true })).resolves.toBeTruthy();
    const off = new CalendarStyleService(pagePrisma({ style: false }), clerk as any);
    await expect(off.coloursPage('org', admin)).rejects.toThrow('not enabled');
  });

  it('saves a person colour and PTW status colours; null puts a person back to automatic and a status back to the applicant colour', async () => {
    const prisma = pagePrisma({ ptw: { REJECTED: '#212121' } });
    const svc = new CalendarStyleService(prisma, clerk as any);
    await svc.saveColoursPage('org', admin, { people: [{ id: SALES, colour: '#8e24aa' }, { id: HH, colour: null }], ptw: { APPROVED: '#0b8043', REJECTED: null } });
    expect(prisma.userOrganization.update).toHaveBeenCalledTimes(2);
    expect(prisma.userOrganization.update.mock.calls[0][0]).toMatchObject({ where: { userId_organizationId: { userId: SALES, organizationId: 'org' } }, data: { settings: { calendar: { fill: '#8e24aa', bar: null, ptwDefault: false } } } });
    expect(prisma.userOrganization.update.mock.calls[1][0]).toMatchObject({ data: { settings: { calendar: { fill: null } } } });
    expect(prisma.fields[PTW_COLOURS_FIELD].options).toEqual({ APPROVED: '#0b8043' });
  });

  it('statuses left out keep their colour; an unchanged save writes nothing', async () => {
    const prisma = pagePrisma({ ptw: { REJECTED: '#212121' } });
    const svc = new CalendarStyleService(prisma, clerk as any);
    await svc.saveColoursPage('org', admin, { people: [{ id: HH, colour: '#039be5' }], ptw: { REJECTED: '#212121' } });
    expect(prisma.userOrganization.update).not.toHaveBeenCalled();
    expect(prisma.customField.update).not.toHaveBeenCalled();
    expect(prisma.customField.create).not.toHaveBeenCalled();
    await svc.saveColoursPage('org', admin, { ptw: { APPROVED: '#0b8043' } });
    expect(prisma.fields[PTW_COLOURS_FIELD].options).toEqual({ APPROVED: '#0b8043', REJECTED: '#212121' });
  });

  it('refuses a PTW colour close to a salesperson colour, a bad colour and a stranger', async () => {
    const prisma = pagePrisma();
    const svc = new CalendarStyleService(prisma, clerk as any);
    await expect(svc.saveColoursPage('org', admin, { ptw: { APPROVED: '#0a9fe0' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveColoursPage('org', admin, { people: [{ id: SALES, colour: '#d50001' }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveColoursPage('org', admin, { ptw: { APPROVED: 'green' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveColoursPage('org', admin, { people: [{ id: 'stranger', colour: '#8e24aa' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userOrganization.update).not.toHaveBeenCalled();
    expect(prisma.customField.create).not.toHaveBeenCalled();
  });
});
