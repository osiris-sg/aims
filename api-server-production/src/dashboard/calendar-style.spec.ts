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
import { jobStyleOf, parseJobStylePatch, stampJobCreator, withStampedApplicant, EMPTY_JOB_STYLE } from '../deliveries/job-style';
import { AUTO_PALETTE, colourCircle, panelPeople, withPanelFills } from './calendar-style';
import { DEFAULT_EXPORT_HEADER, cleanExportHeader, readExportHeader, writeExportHeader } from './calendar-export';
import { parseRescheduleTarget, zonedInstant } from '../deliveries/calendar-panel';
import { isCompletedDo, isLiveDo } from './calendar-style';
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

  it('bar = the stored PTW applicant colour, only when a PTW is needed; never the default at render', () => {
    expect(styleOf(input({ ptwStatus: 'REQUIRED', ptwApplicantId: JOYNA }), colours).bar).toBe('#f6bf26');
    expect(styleOf(input({ ptwStatus: 'APPROVED', ptwApplicantId: BALA }), colours).bar).toBe('#d50000');
    // No applicant stored: the neutral bar, whatever the default applicant is.
    expect(styleOf(input({ ptwStatus: 'APPROVED' }), colours).bar).toBe(NEUTRAL_BAR);
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
    expect(CALENDAR_STYLE_LEGEND.map((l) => l.icon)).toEqual(['✋', '👍', '👎', '✅', '❌', '⭕', '📅', '🟫', '📌']);
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
    expect(jobStyleOf('junk')).toEqual({ salespersonId: null, salespersonName: null, ptwApplicantId: null, ptwApplicantName: null, cod: false, postponed: false, sticker: false, createdById: null, team: null, calendarCancel: null });
  });

  it('✅ counts only completed / signed DOs: not drafts, not cancelled or voided', () => {
    expect(isCompletedDo({ status: 'delivered_installed', config: {} })).toBe(true);
    expect(isCompletedDo({ status: 'unconfirmed', config: {} })).toBe(false);
    expect(isCompletedDo({ status: 'confirmed', config: { awaitingSignature: true } })).toBe(false);
    expect(isCompletedDo({ status: 'delivered_installed', config: { cancelled: true } })).toBe(false);
    expect(isCompletedDo({ status: 'delivered_installed', config: { voided: true } })).toBe(false);
  });

  it('the PTW applicant is stamped on save: the default only when a PTW is needed and none is sent or stored', () => {
    const stored = { ...EMPTY_JOB_STYLE, ptwApplicantId: JOYNA };
    expect(withStampedApplicant({}, 'REQUIRED', null, BALA)).toEqual({ ptwApplicantId: BALA, ptwApplicantName: null });
    expect(withStampedApplicant({ ptwApplicantId: null, ptwApplicantName: null }, 'SUBMITTED', stored, BALA)).toEqual({ ptwApplicantId: BALA, ptwApplicantName: null });
    expect(withStampedApplicant({}, 'REQUIRED', stored, BALA)).toEqual({});
    expect(withStampedApplicant({ ptwApplicantId: JOYNA, ptwApplicantName: 'Joyna' }, 'APPROVED', null, BALA)).toEqual({ ptwApplicantId: JOYNA, ptwApplicantName: 'Joyna' });
    expect(withStampedApplicant({ cod: true }, 'NOT_NEEDED', null, BALA)).toEqual({ cod: true });
    expect(withStampedApplicant({}, null, null, BALA)).toEqual({});
    expect(withStampedApplicant({}, 'REQUIRED', null, null)).toEqual({});
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
    // No PTW applicants list (2026-11-19): the people's own bar colours apply, as before.
    customField: { findFirst: jest.fn(async () => null) },
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
  /** The order's quotation Sales Person (default S002) and the org's salesperson alias map (src/sales-report). */
  quoteSalesPerson?: string;
  aliases?: Record<string, Array<{ text: string; userIds: string[] }>>;
  /** Calendar notes per org (people list tests). */
  notes?: Record<string, any[]>;
  /** Round 36: the order's quotation Subject. */
  quoteSubject?: string;
  /** Round 37: DOs made on orders (config.orderId) and orders' linked documents. */
  orderDos?: any[];
  orderLinks?: Record<string, any>;
}

function world(): World {
  const ON = { enableJobsCalendar: true, enableWctOrders: true, enableCalendarStyle: true, enableGroupCalendar: true };
  return {
    features: { [P]: { ...ON }, [C]: { enableJobsCalendar: true, enableWctOrders: true }, [X]: { enableJobsCalendar: true, enableWctOrders: true } },
    runs: {
      [P]: [
        // A PTW job saved before applicants were stored: neutral bar, never the default (Bala).
        baseRun('r-legacy', { ptwStatus: 'SUBMITTED' }),
        // Order job: its quotation's salesman code S002 = HH; PTW required, Bala stored; one completed DO + one draft.
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
      'r-child': { salespersonId: AMY, salespersonName: 'Amy Yap', ptwApplicantId: BALA, ptwApplicantName: 'Bala WCT', cod: false, postponed: false },
      'r-order': { ptwApplicantId: BALA, ptwApplicantName: 'Bala WCT', cod: false, postponed: false },
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
      findMany: jest.fn(async ({ where }: any) =>
        where.deliveryId.in.includes('r-order')
          ? [{ deliveryId: 'r-order', documentId: 'do-1' }, { deliveryId: 'r-order', documentId: 'do-2' }, { deliveryId: 'r-order', documentId: 'do-3' }]
          : [],
      ),
    },
    document: {
      findMany: jest.fn(async ({ where }: any) => {
        // Round 37: the order fallback reads the order's DOs by config.orderId (no id list).
        if (where.type && !where.id) return (w.orderDos ?? []).filter((d: any) => where.OR?.some((o: any) => o.config?.equals === d.config?.orderId));
        if (where.type)
          return [
            { id: 'do-1', name: 'DO1', status: 'delivered_installed', documentTemplateId: 't', config: {}, createdAt: new Date() },
            { id: 'do-2', name: 'DO2', status: 'unconfirmed', documentTemplateId: 't', config: {}, createdAt: new Date() },
            { id: 'do-3', name: 'DO3', status: 'delivered_installed', documentTemplateId: 't', config: { cancelled: true }, createdAt: new Date() },
          ].filter((d) => where.id.in.includes(d.id));
        return where.id.in.includes(Q1) ? [{ id: Q1, name: 'QO1', type: 'QUOTATION', status: 'ACCEPTED', documentTemplateId: 'tq', config: { salesPerson: w.quoteSalesPerson ?? 'S002', ...(w.quoteSubject ? { subject: w.quoteSubject } : {}) } }] : [];
      }),
    },
    deliverySiteClockJob: { findMany: jest.fn(async () => []) },
    order: { findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, linkedDocuments: w.orderLinks?.[id] ?? {} }))) },
    calendarNote: {
      findMany: jest.fn(async ({ where, distinct }: any) => {
        const list = (w.notes?.[org(where)] ?? []).filter((n: any) => (where.id?.in ? where.id.in.includes(n.id) : true)).filter((n: any) => (where.createdById ? !!n.createdById : true));
        if (distinct) return [...new Set(list.map((n: any) => n.createdById))].map((createdById) => ({ createdById }));
        return list.map((n: any) => ({ ...n }));
      }),
    },
    customField: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async ({ where }: any) => where.fieldName === 'salesperson_aliases' ? (w.aliases?.[org(where)] ? { options: w.aliases[org(where)] } : null) : (where.fieldName === 'job_calendar_style' && (org(where) === P || org(where) === C) ? { id: `${STYLE_FIELD}-${org(where)}` } : null)),
    },
    customFieldValue: {
      findMany: jest.fn(async ({ where }: any) => {
        // The people list reads every value of the org's style field (no entityId filter).
        const ids: string[] = where.entityId?.in ?? (w.runs[String(where.customFieldId).replace(`${STYLE_FIELD}-`, '')] ?? []).map((r: any) => r.id);
        return ids.filter((id: string) => w.styleValues[id]).map((id: string) => ({ entityId: id, value: w.styleValues[id] }));
      }),
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
  it('fill by salesperson (quotation code or own pick), bar by the stored PTW applicant, icons', async () => {
    const res = await svc(world()).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(res.style?.legend.map((l) => l.icon)).toEqual(['✋', '👍', '👎', '✅', '❌', '⭕', '📅', '🟫', '📌']);
    const order = byId(res.events, 'r-order');
    expect(order.style).toMatchObject({ fill: '#039be5', bar: '#d50000', greyed: false });
    // One completed DO (the draft and the cancelled one don't count).
    // Round 37 (Elroy 20 Nov): every DO that is not cancelled counts, draft or completed: DO1 (completed) + DO2 (draft) = 2✅; DO3 is cancelled.
    expect(order.style.icons.map((i: any) => i.icon)).toEqual(['✋', '2✅']);
    expect(order.salesperson).toEqual({ id: HH, name: 'Nat HH' });
    expect(order.ptwApplicant).toEqual({ id: BALA, name: 'Bala' });
    const quick = byId(res.events, 'r-quick');
    expect(quick.style).toMatchObject({ fill: '#8e24aa', bar: '#f6bf26', greyed: true });
    expect(quick.style.icons.map((i: any) => i.icon)).toEqual(['⭕', '👍', '🟫']);
    expect(quick).toMatchObject({ postponed: true, cod: true, statusLabel: 'Postponed', ptwApplicant: { id: JOYNA, name: 'Joyna' } });
  });

  it("imported quotation's free-text salesperson: the org's alias map (first listed user for several names); unmapped text = neutral", async () => {
    const w = world();
    w.quoteSalesPerson = '  henry &  JOYNA ';
    w.aliases = { [P]: [{ text: 'Henry & Joyna', userIds: [HH, AMY] }] };
    const mapped = byId((await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH })).events, 'r-order');
    expect(mapped.salesperson).toEqual({ id: HH, name: 'Nat HH' });
    expect(mapped.style.fill).toBe('#039be5');
    w.quoteSalesPerson = 'Isadora';
    const raw = byId((await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH })).events, 'r-order');
    expect(raw.salesperson).toBeNull();
    expect(raw.style.fill).toBe(NEUTRAL_FILL);
  });

  it('changing the default applicant does not recolour: a job with no stored applicant shows the neutral bar', async () => {
    const res = await svc(world()).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const legacy = byId(res.events, 'r-legacy');
    expect(legacy.style.bar).toBe(NEUTRAL_BAR);
    expect(legacy.ptwApplicant).toBeNull();
    const w = world();
    w.members[P] = w.members[P].map((m) => (m.userId === JOYNA ? { ...m, settings: { calendar: { bar: '#f6bf26', ptwDefault: true } } } : m.userId === BALA ? { ...m, settings: { calendar: { bar: '#d50000' } } } : m));
    const after = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(byId(after.events, 'r-order').style.bar).toBe('#d50000');
    expect(byId(after.events, 'r-legacy').style.bar).toBe(NEUTRAL_BAR);
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
    // Amy's colour from the parent (#8e24aa), not the child's own (#7986cb); PTW rejected with Bala's (stored) bar.
    expect(child.style).toMatchObject({ fill: '#8e24aa', bar: '#d50000' });
    expect(child.style.icons.map((i: any) => i.icon)).toEqual(['👎']);
  });

  it('gate off: the calendar is exactly as before (no style keys, same events), for the WCT parent and any other org', async () => {
    const w = world();
    w.features[P].enableCalendarStyle = false;
    const off = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const without = await svc(w, false).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(off).toEqual(without);
    expect(JSON.stringify(off)).not.toMatch(/"style"|salesperson|ptwApplicant|"cod"|postponed|doCount|createdBy|"people"|sticker/);
    // Another org (flag never set): identical with or without the style service.
    const other = await svc(w).get(X, '2026-11-16', '2026-11-22', { userId: 'x' });
    const otherWithout = await svc(w, false).get(X, '2026-11-16', '2026-11-22', { userId: 'x' });
    expect(other).toEqual(otherWithout);
    expect(other.events.map((e) => e.id).sort()).toEqual(['aims:r-x', 'aims:r-x2']);
    expect(JSON.stringify(other)).not.toMatch(/"style"|createdBy|"people"|sticker/);
  });
});

describe('PTW Rejected is a calendar style status only', () => {
  function ptwSvc(styleOn: boolean) {
    const svc: any = Object.create(DeliveriesService.prototype);
    svc.prisma = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableJobsCalendar: true, enableWctOrders: true, enableCalendarStyle: styleOn } })) },
      delivery: { findFirst: jest.fn(async () => ({ id: 'j', ptwStatus: null })), update: jest.fn(async () => ({})) },
      userOrganization: { findMany: jest.fn(async () => [{ userId: BALA, settings: { calendar: { bar: '#d50000', ptwDefault: true } } }, { userId: JOYNA, settings: null }]) },
      customField: { findFirst: jest.fn(async () => ({ id: 'cf' })), create: jest.fn() },
      customFieldValue: {
        findMany: jest.fn(async () => (svc.stored ? [{ entityId: 'j', value: svc.stored }] : [])),
        findUnique: jest.fn(async () => (svc.stored ? { value: svc.stored } : null)),
        upsert: jest.fn(async ({ create }: any) => ((svc.stored = create.value), {})),
      },
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

  it('gate on: setting a PTW stamps the default applicant on the job; a stored applicant is kept; gate off writes nothing', async () => {
    const on = ptwSvc(true);
    await on.setPtw('j', 'org', { ptwStatus: 'REQUIRED' });
    expect(on.stored).toMatchObject({ ptwApplicantId: BALA });
    on.stored = { ...on.stored, ptwApplicantId: JOYNA };
    await on.setPtw('j', 'org', { ptwStatus: 'APPROVED' });
    expect(on.stored.ptwApplicantId).toBe(JOYNA);
    const none = ptwSvc(true);
    await none.setPtw('j', 'org', { ptwStatus: 'NOT_NEEDED' });
    expect(none.prisma.customFieldValue.upsert).not.toHaveBeenCalled();
    const off = ptwSvc(false);
    await off.setPtw('j', 'org', { ptwStatus: 'REQUIRED' });
    expect(off.prisma.customFieldValue.upsert).not.toHaveBeenCalled();
    expect(off.prisma.userOrganization.findMany).not.toHaveBeenCalled();
  });

  it('job page save: clearing the applicant on a PTW job stamps the default again', async () => {
    const on = ptwSvc(true);
    on.prisma.delivery.findFirst = jest.fn(async () => ({ id: 'j', ptwStatus: 'SUBMITTED' }));
    const res = await on.setJobStyle('j', 'org', { ptwApplicant: null, cod: true });
    expect(res).toMatchObject({ ptwApplicantId: BALA, cod: true });
  });
});

/**
 * Calendar people list + Generate sticker (WCT group, 2026-11-19, same gate as the style): who made each job / note,
 * the people rows (creators + Sales members, colour or an automatic one), 📌 on the chip and in the legend.
 */
describe('calendar people list and Generate sticker', () => {
  it('📌 shows on a job with Generate sticker ticked, after the other icons, and nowhere else', () => {
    expect(icons({ sticker: true, cod: true, ptwStatus: 'APPROVED' })).toEqual(['👍', '🟫', '📌']);
    expect(icons({})).toEqual([]);
    expect(styleOf(input({ sticker: true }), colours).icons).toContainEqual({ icon: '📌', label: 'Generate sticker' });
  });

  it('the job form sends Generate sticker; the creator can never be sent by a form', () => {
    expect(parseJobStylePatch({ sticker: true })).toEqual({ sticker: true });
    expect(parseJobStylePatch({ sticker: false, createdById: 'someone' })).toEqual({ sticker: false });
    expect(() => parseJobStylePatch({ sticker: 'yes' })).toThrow(BadRequestException);
    expect(jobStyleOf({ sticker: true, createdById: AMY })).toMatchObject({ sticker: true, createdById: AMY });
  });

  it('people colours: a picked colour wins; others get distinct automatic colours, in name order, stable', () => {
    const rows = panelPeople(
      [
        { id: 'z', name: 'Zed' },
        { id: HH, name: 'Nat HH' },
        { id: 'a', name: 'Alan' },
      ],
      { [HH]: '#039be5' },
    );
    expect(rows.map((r) => r.name)).toEqual(['Alan', 'Nat HH', 'Zed']);
    expect(rows[1]).toEqual({ id: HH, name: 'Nat HH', colour: '#039be5', auto: false });
    expect(rows[0].auto && rows[2].auto).toBe(true);
    expect(rows[0].colour).not.toBe(rows[2].colour);
    expect(AUTO_PALETTE as readonly string[]).toContain(rows[0].colour);
    // An automatic colour never repeats a picked one.
    expect(panelPeople([{ id: 'a', name: 'A' }], { x: AUTO_PALETTE[0] })[0].colour).not.toBe(AUTO_PALETTE[0]);
    expect(panelPeople([{ id: 'z', name: 'Zed' }, { id: 'a', name: 'Alan' }], {})).toEqual(panelPeople([{ id: 'a', name: 'Alan' }, { id: 'z', name: 'Zed' }], {}));
  });

  it('the calendar names who made each job and note, and lists creators plus every Sales member', async () => {
    const w = world();
    w.styleValues['r-quick'] = { ...w.styleValues['r-quick'], createdById: JOYNA, sticker: true };
    w.notes = { [P]: [{ id: 'n1', title: 'Leave', type: 'LEAVE', staffId: null, staffName: null, startDate: '2026-11-17', endDate: '2026-11-17', allDay: true, startTime: null, endTime: null, remark: null, createdById: BALA }, { id: 'n2', title: 'Old', type: 'OTHER', staffId: null, staffName: null, startDate: '2026-11-18', endDate: '2026-11-18', allDay: true, startTime: null, endTime: null, remark: null, createdById: null }] };
    const res = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const quick = byId(res.events, 'r-quick');
    expect(quick.createdBy).toEqual({ id: JOYNA, name: 'Joyna' });
    expect(quick.sticker).toBe(true);
    expect(quick.style.icons.map((i: any) => i.icon)).toContain('📌');
    // Jobs made before the creator was recorded: null (the portal lists them under Unknown).
    expect(byId(res.events, 'r-order').createdBy).toBeNull();
    expect(byId(res.events, 'r-order').sticker).toBeUndefined();
    expect(res.notes!.find((n) => n.id === 'n1')!.createdBy).toEqual({ id: BALA, name: 'Bala' });
    expect(res.notes!.find((n) => n.id === 'n2')!.createdBy).toBeNull();
    // Creators (Joyna: a job, Bala: a note) + Sales members (HH, Amy) even with nothing made yet.
    const people = res.people!;
    expect(people.map((p) => p.id).sort()).toEqual([AMY, BALA, HH, JOYNA].sort());
    expect(people.find((p) => p.id === HH)).toMatchObject({ colour: '#039be5', auto: false });
    expect(people.find((p) => p.id === JOYNA)!.auto).toBe(true);
    // Child org items keep their company (the portal's company rows); the people list is the viewing org's.
    expect(byId(res.events, 'r-child').orgId).toBe(C);
  });

  it('style off: no people list, no creators, no sticker (the calendar as before)', async () => {
    const w = world();
    w.styleValues['r-quick'] = { ...w.styleValues['r-quick'], createdById: JOYNA, sticker: true };
    w.features[P].enableCalendarStyle = false;
    const res = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(res.people).toBeUndefined();
    expect(JSON.stringify(res)).not.toMatch(/createdBy|sticker|📌/);
  });

  it('a new job records its creator once, only with the style on', async () => {
    const make = (styleOn: boolean, stored: any) => {
      const upsert = jest.fn(async () => ({}));
      const prisma: any = {
        organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableCalendarStyle: styleOn } })) },
        customField: { findFirst: jest.fn(async () => ({ id: 'f1' })), create: jest.fn() },
        customFieldValue: {
          findMany: jest.fn(async () => (stored ? [{ entityId: 'job-1', value: stored }] : [])),
          findUnique: jest.fn(async () => (stored ? { value: stored } : null)),
          upsert,
        },
      };
      return { prisma, upsert };
    };
    const off = make(false, null);
    expect(await stampJobCreator(off.prisma, P, 'job-1', AMY)).toBe(false);
    expect(off.upsert).not.toHaveBeenCalled();
    expect(off.prisma.customFieldValue.findMany).not.toHaveBeenCalled();

    const fresh = make(true, { cod: true });
    expect(await stampJobCreator(fresh.prisma, P, 'job-1', AMY)).toBe(true);
    expect((fresh.upsert.mock.calls[0] as any[])[0].create.value).toMatchObject({ createdById: AMY, cod: true });

    const kept = make(true, { createdById: HH });
    expect(await stampJobCreator(kept.prisma, P, 'job-1', AMY)).toBe(false);
    expect(kept.upsert).not.toHaveBeenCalled();

    expect(await stampJobCreator(make(true, null).prisma, P, 'job-1', null)).toBe(false);
  });
});

describe('calendar chip text (2026-11-19): customer only', () => {
  it('order job and quick job: the customer; no customer: the site address; neither: the title; full title kept', async () => {
    const w = world();
    w.runs[P].push(baseRun('r-nocust', { customer: null, siteAddress: '10 Anson Road' }), baseRun('r-bare', { customer: null, siteAddress: null, deliveryNumber: 9 }));
    const res = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const order = byId(res.events, 'r-order');
    expect(order.chipLabel).toBe('Acme');
    expect(order.title).toMatch(/^ORD-1 · #1 /);
    expect(byId(res.events, 'r-quick').chipLabel).toBe('Acme');
    expect(byId(res.events, 'r-nocust').chipLabel).toBe('10 Anson Road');
    const bare = byId(res.events, 'r-bare');
    // Neither: the title without its job number (2026-11-19).
    expect(bare.chipLabel).toBe(bare.title.replace(/^#\d+\s+/, ''));
    // Child company items get it too.
    expect(byId(res.events, 'r-child').chipLabel).toBe('Acme');
  });

  it('style off (and every other org): no chipLabel, titles unchanged', async () => {
    const w = world();
    w.features[P].enableCalendarStyle = false;
    const res = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(JSON.stringify(res)).not.toMatch(/chipLabel/);
    expect(JSON.stringify(await svc(w).get(X, '2026-11-16', '2026-11-22', { userId: 'x' }))).not.toMatch(/chipLabel/);
  });
});

describe('chip label fallback (2026-11-19): no order / job numbers', () => {
  it('customer, else site address, else the title without ORD… / #n', () => {
    const { chipLabelOf, titleWithoutNumbers } = require('./jobs-calendar');
    expect(chipLabelOf({ customerName: 'Acme' }, 'ORD202611-003 · #41 Acme')).toBe('Acme');
    expect(chipLabelOf({ siteAddress: '10 Anson Road' }, '#41 X')).toBe('10 Anson Road');
    expect(chipLabelOf(null, 'ORD202611-003 · #41 Domino\'s Pizza')).toBe("Domino's Pizza");
    expect(chipLabelOf(null, '#41 Site visit')).toBe('Site visit');
    expect(titleWithoutNumbers('Return #7 Acme')).toBe('Return Acme');
    expect(titleWithoutNumbers('#41')).toBe('#41');
  });
});


/**
 * Round 36 (WCT group, 2026-11-20, same gate as the style): the side panel and WhatsApp list fields on each event,
 * the PTW applicant's colour circle, Team / crew, Cancel job / Undo, Postpone / Reschedule, the Export list header.
 */
describe('round 36: panel fields on the calendar events', () => {
  it('each own job carries customer, Subject, Remarks, Team / crew, stored PTW status, quotation status; the applicant circle', async () => {
    const w = world();
    w.quoteSubject = 'Troubleshoot Exhaust VSD Issue at Rooftop';
    w.runs[P][1] = { ...w.runs[P][1], notes: 'Please call the management 96420116 upon arrival' };
    w.styleValues['r-order'] = { ...w.styleValues['r-order'], team: 'Team A + Guru' };
    w.styleValues['r-cancel'] = { calendarCancel: { from: 'scheduled', at: '2026-11-20T01:00:00.000Z', byId: HH } };
    const res = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    const order = byId(res.events, 'r-order');
    expect(order).toMatchObject({
      customer: 'Acme',
      subject: 'Troubleshoot Exhaust VSD Issue at Rooftop',
      remarks: 'Please call the management 96420116 upon arrival',
      team: 'Team A + Guru',
      ptwStatus: 'REQUIRED',
      quotationStatus: 'ACCEPTED',
    });
    // Bala's bar #d50000 = 🔴; a PTW job with no stored applicant has no circle; no PTW = none.
    expect(order.style.applicantIcon).toBe('🔴');
    expect(byId(res.events, 'r-legacy').style.applicantIcon).toBeUndefined();
    expect(byId(res.events, 'r-quick').style.applicantIcon).toBe('🟡');
    const quick = byId(res.events, 'r-quick');
    expect(quick).toMatchObject({ ptwStatus: 'APPROVED', team: null, subject: null, remarks: null });
    // Cancelled from the calendar: Undo offered; a job cancelled elsewhere: not.
    expect(byId(res.events, 'r-cancel').calendarCancelled).toBe(true);
    expect(byId(res.events, 'r-legacy').calendarCancelled).toBeUndefined();
    // No PTW: NOT_NEEDED (the panel's pills).
    w.runs[P].push(baseRun('r-plain'));
    expect(byId((await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH })).events, 'r-plain').ptwStatus).toBe('NOT_NEEDED');
  });

  it('style off (and every other org): none of the new keys', async () => {
    const w = world();
    w.features[P].enableCalendarStyle = false;
    const keys = /"(customer|subject|remarks|team|ptwStatus|quotationStatus|calendarCancelled|applicantIcon)"/;
    expect(JSON.stringify(await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH }))).not.toMatch(keys);
    expect(JSON.stringify(await svc(w).get(X, '2026-11-16', '2026-11-22', { userId: 'x' }))).not.toMatch(keys);
  });

  it('colour circles: Bala red, Joyna amber or yellow, Kherry green; no colour none', () => {
    expect(colourCircle('#d50000')).toBe('🔴');
    expect(colourCircle('#c99a00')).toBe('🟡');
    expect(colourCircle('#f6bf26')).toBe('🟡');
    expect(colourCircle('#0b8043')).toBe('🟢');
    expect(colourCircle('#212121')).toBe('⚫');
    // An applicant with no colour yet (the neutral bar): no circle.
    expect(styleOf(input({ ptwStatus: 'REQUIRED', ptwApplicantId: 'user_nobody' }), colours).applicantIcon).toBeUndefined();
    expect(styleOf(input({ ptwStatus: 'REQUIRED', ptwApplicantId: BALA }), colours).applicantIcon).toBe('🔴');
    expect(colourCircle(null)).toBeNull();
    expect(colourCircle('red')).toBeNull();
  });

  it('Team / crew: free text from a form, one line, at most 120 characters; the cancel mark never from a form', () => {
    expect(parseJobStylePatch({ team: '  Team A  +  Guru ' })).toEqual({ team: 'Team A + Guru' });
    expect(parseJobStylePatch({ team: '' })).toEqual({ team: null });
    expect(parseJobStylePatch({ team: null })).toEqual({ team: null });
    expect(parseJobStylePatch({ team: 'x'.repeat(200) }).team).toHaveLength(120);
    expect(() => parseJobStylePatch({ team: 5 })).toThrow(BadRequestException);
    expect(parseJobStylePatch({ calendarCancel: { from: 'scheduled', at: 'x' } } as any)).toEqual({});
    expect(jobStyleOf({ team: 'Team B', calendarCancel: { from: 'scheduled', at: '2026-11-20T00:00:00Z', byId: HH } })).toMatchObject({ team: 'Team B', calendarCancel: { from: 'scheduled', byId: HH } });
  });
});

describe('round 36: Cancel job / Undo and Postpone / Reschedule from the panel', () => {
  function jobSvc(run: any, opts: { styleOn?: boolean; stored?: any } = {}) {
    const svc: any = Object.create(DeliveriesService.prototype);
    svc.stored = opts.stored ?? null;
    svc.run = { ...run };
    svc.prisma = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableJobsCalendar: true, enableWctOrders: true, enableCalendarStyle: opts.styleOn !== false } })) },
      accountingSetting: { findUnique: jest.fn(async () => null) },
      userOrganization: { findMany: jest.fn(async () => []) },
      delivery: {
        findFirst: jest.fn(async () => ({ ...svc.run })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.status && where.status !== svc.run.status) return { count: 0 };
          Object.assign(svc.run, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(svc.run, data)),
      },
      document: { findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn(async () => []) },
      order: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null), update: jest.fn() },
      customField: { findFirst: jest.fn(async () => ({ id: 'cf' })), create: jest.fn() },
      customFieldValue: {
        findMany: jest.fn(async () => (svc.stored ? [{ entityId: 'j', value: svc.stored }] : [])),
        findUnique: jest.fn(async () => (svc.stored ? { value: svc.stored } : null)),
        upsert: jest.fn(async ({ update }: any) => ((svc.stored = update.value), {})),
      },
    };
    svc.siteclock = { touch: jest.fn() };
    svc.redateRunDo = jest.fn(async () => undefined);
    svc.ensureScheduledServiceReport = jest.fn(async () => undefined);
    svc.orderFollowsRun = jest.fn(async () => undefined);
    return svc;
  }

  it('Cancel job: a scheduled job becomes cancelled, its DOs untouched, the status it had kept for Undo; Undo puts it back', async () => {
    const s = jobSvc({ id: 'j', status: 'scheduled', isDraft: false });
    await expect(s.calendarCancel('j', 'org', HH)).resolves.toEqual({ id: 'j', status: 'cancelled' });
    expect(s.run.status).toBe('cancelled');
    expect(s.stored.calendarCancel).toMatchObject({ from: 'scheduled', byId: HH });
    expect(s.prisma.document.update).not.toHaveBeenCalled();
    expect(s.prisma.document.delete).not.toHaveBeenCalled();
    expect(s.orderFollowsRun).toHaveBeenCalledWith('org', 'j');
    await expect(s.calendarUncancel('j', 'org')).resolves.toEqual({ id: 'j', status: 'scheduled' });
    expect(s.run.status).toBe('scheduled');
    expect(s.stored.calendarCancel).toBeNull();
  });

  it('Cancel job refuses drafts, started and finished jobs; Undo refuses a job cancelled any other way; style off = not found', async () => {
    await expect(jobSvc({ id: 'j', status: 'scheduled', isDraft: true }).calendarCancel('j', 'org', HH)).rejects.toBeInstanceOf(BadRequestException);
    for (const status of ['in_progress', 'completed', 'cancelled']) {
      await expect(jobSvc({ id: 'j', status, isDraft: false }).calendarCancel('j', 'org', HH)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(jobSvc({ id: 'j', status: 'cancelled' }).calendarUncancel('j', 'org')).rejects.toBeInstanceOf(BadRequestException);
    const off = jobSvc({ id: 'j', status: 'scheduled', isDraft: false }, { styleOn: false });
    await expect(off.calendarCancel('j', 'org', HH)).rejects.toThrow(/not enabled/);
    expect(off.prisma.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('Postpone: on hold with no date = postponed, the day kept; Reschedule: a new day / time clears it', async () => {
    const s = jobSvc({ id: 'j', status: 'scheduled', isDraft: false, scheduledFor: new Date('2026-11-20T02:00:00Z') });
    await expect(s.rescheduleJob('j', 'org', { onHold: true })).resolves.toEqual({ id: 'j', onHold: true });
    expect(s.stored.postponed).toBe(true);
    expect(s.prisma.delivery.update).not.toHaveBeenCalled();
    const timed = await s.rescheduleJob('j', 'org', { date: '2026-11-25', time: '14:30' });
    expect(timed).toMatchObject({ onHold: false, scheduledAllDay: false });
    expect(s.run.scheduledFor.toISOString()).toBe('2026-11-25T06:30:00.000Z');
    expect(s.stored.postponed).toBe(false);
    expect(s.redateRunDo).toHaveBeenCalledWith('j', 'org');
    const allDay = await s.rescheduleJob('j', 'org', { date: '2026-11-26' });
    expect(allDay).toMatchObject({ scheduledAllDay: true });
    expect(s.run.scheduledAllDay).toBe(true);
  });

  it('Reschedule refuses a bad date or time and a job that is not scheduled', async () => {
    const s = jobSvc({ id: 'j', status: 'scheduled', isDraft: false });
    await expect(s.rescheduleJob('j', 'org', { date: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.rescheduleJob('j', 'org', { date: '2026-11-25', time: '25:00' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.rescheduleJob('j', 'org', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(jobSvc({ id: 'j', status: 'cancelled', isDraft: false }).rescheduleJob('j', 'org', { onHold: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(parseRescheduleTarget({ date: '2026-11-25', time: '9:05' })).toEqual({ date: '2026-11-25', time: '09:05' });
    expect(zonedInstant('2026-11-25', '09:05').toISOString()).toBe('2026-11-25T01:05:00.000Z');
  });

  it("the PTW pills send the status only: the job's PTW remark is kept; Not needed clears it", async () => {
    const s = jobSvc({ id: 'j', status: 'scheduled', ptwRemark: 'MCST form' });
    s.prisma.delivery.update = jest.fn(async () => ({}));
    await s.setPtw('j', 'org', { ptwStatus: 'APPROVED' });
    expect(s.prisma.delivery.update).toHaveBeenLastCalledWith({ where: { id: 'j' }, data: { ptwStatus: 'APPROVED', ptwRemark: 'MCST form' } });
    await s.setPtw('j', 'org', { ptwStatus: 'APPROVED', ptwRemark: 'new' });
    expect(s.prisma.delivery.update).toHaveBeenLastCalledWith({ where: { id: 'j' }, data: { ptwStatus: 'APPROVED', ptwRemark: 'new' } });
    await s.setPtw('j', 'org', { ptwStatus: 'NOT_NEEDED' });
    expect(s.prisma.delivery.update).toHaveBeenLastCalledWith({ where: { id: 'j' }, data: { ptwStatus: null, ptwRemark: null } });
  });
});

describe('round 36: Export list header (Settings > Job fields)', () => {
  it('default until set; saved as a hidden storage field; one line, at most 300 characters; empty allowed', async () => {
    let row: any = null;
    const prisma: any = {
      customField: {
        findFirst: jest.fn(async () => row),
        create: jest.fn(async ({ data }: any) => (row = { id: 'cf', ...data })),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
      },
    };
    expect(await readExportHeader(prisma, 'org')).toEqual({ header: DEFAULT_EXPORT_HEADER, isDefault: true });
    await writeExportHeader(prisma, 'org', cleanExportHeader('  Sign back   all DOs '));
    expect(row).toMatchObject({ fieldName: 'calendar_export_header', isActive: false, showInForm: false, defaultValue: 'Sign back all DOs' });
    expect(await readExportHeader(prisma, 'org')).toEqual({ header: 'Sign back all DOs', isDefault: false });
    await writeExportHeader(prisma, 'org', cleanExportHeader(''));
    expect(await readExportHeader(prisma, 'org')).toEqual({ header: '', isDefault: false });
    expect(() => cleanExportHeader('x'.repeat(301))).toThrow(BadRequestException);
    expect(() => cleanExportHeader(5)).toThrow(BadRequestException);
  });
});


describe('round 37: ✅ = any DO that is not cancelled (Elroy 20 Nov)', () => {
  it('draft and completed DOs count, cancelled / voided never; the label says generated', () => {
    expect(isLiveDo({ config: {} })).toBe(true);
    expect(isLiveDo({ config: { cancelled: true } })).toBe(false);
    expect(isLiveDo({ config: { voided: true } })).toBe(false);
    expect(styleOf(input({ doCount: 1 }), colours).icons).toEqual([{ icon: '✅', label: 'DO generated' }]);
    expect(styleOf(input({ doCount: 3 }), colours).icons).toEqual([{ icon: '3✅', label: '3 DOs generated' }]);
  });

  it("a job with no DO of its own counts its order's DOs (made on the order or linked; old ERP DOs never)", async () => {
    const w = world();
    w.runs[P].push(baseRun('r-o2', { order: { id: 'o2', orderNumber: 'ORD-2', sourceQuotationId: null } }));
    w.orderDos = [
      { id: 'od1', config: { orderId: 'o2' } },
      { id: 'od2', config: { orderId: 'o2', cancelled: true } },
      { id: 'od3', config: { orderId: 'o2', erpImport: { source: 'wct-erp' } } },
    ];
    const res = await svc(w).get(P, '2026-11-16', '2026-11-22', { userId: HH });
    expect(byId(res.events, 'r-o2').doCount).toBe(1);
    expect(byId(res.events, 'r-o2').style.icons.map((i: any) => i.icon)).toContain('✅');
    // The job with its own DOs keeps its own count (not the order's).
    expect(byId(res.events, 'r-order').doCount).toBe(2);
    // No order and no DO: none.
    expect(byId(res.events, 'r-quick').doCount).toBe(0);
  });
});


// Round 39 (Elroy 2026-11-20): a chip takes its salesperson's People panel colour, the automatic ones too.
describe('withPanelFills', () => {
  it('adds the automatic colours; a colour picked in Settings still wins; no people = unchanged', () => {
    const colours = { fill: { a: '#039be5' }, bar: {}, defaultApplicant: null } as any;
    const people = [
      { id: 'a', name: 'Amy', colour: '#039be5', auto: false },
      { id: 'h', name: 'Henry Hoo', colour: '#f09300', auto: true },
    ];
    expect(withPanelFills(colours, people).fill).toEqual({ a: '#039be5', h: '#f09300' });
    expect(withPanelFills(colours, [{ id: 'a', name: 'Amy', colour: '#33b679', auto: true }]).fill.a).toBe('#039be5');
    expect(withPanelFills(colours, null)).toBe(colours);
    expect(colours.fill).toEqual({ a: '#039be5' });
  });
});
