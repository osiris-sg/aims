import { BadRequestException } from '@nestjs/common';
import { applicantBars, applicantEntryOf, applicantListOf, applicantView, cleanApplicantList, visibleApplicants, PTW_APPLICANTS_FIELD } from './ptw-applicants';
import { defaultPtwApplicant, withListedApplicant, withStampedApplicant, EMPTY_JOB_STYLE } from './job-style';
import { CalendarStyleService, withApplicantList } from '../dashboard/calendar-style.service';
import { NEUTRAL_BAR, coloursOf, styleOf, StyleInput } from '../dashboard/calendar-style';
import { DeliveriesService } from './deliveries.service';

/**
 * PTW applicants list (WCT group, 2026-11-19, enableCalendarStyle): Settings > Job fields > PTW applicants
 * is the only source of the PTW applicant pickers, the default and the calendar bar colours; jobs saved
 * before the list keep their applicant (a linked user reads as its entry, anyone else is marked);
 * an org with no list behaves exactly as before.
 */
const BALA_USER = 'user_submission';
const JOYNA_USER = 'user_joyna';
const OTHER_USER = 'user_richie';
const SEED = {
  entries: [
    { id: 'pta_bala', name: 'Bala', colour: '#d50000', userId: BALA_USER, hidden: false },
    { id: 'pta_joyna', name: 'Joyna', colour: '#f6bf26', userId: JOYNA_USER, hidden: false },
    { id: 'pta_kherry', name: 'Kherry', colour: '#0b8043', userId: null, hidden: false },
  ],
  defaultId: 'pta_bala',
};
const list = () => applicantListOf({ options: SEED.entries, defaultValue: SEED.defaultId })!;

describe('PTW applicants list: the list itself', () => {
  it('cleans a list: ids from names, unique names, colours, one login per entry, default visible', () => {
    const l = cleanApplicantList({ entries: [{ name: ' Bala ', colour: '#D50000', userId: BALA_USER }, { name: 'Kherry', colour: '#0b8043' }], defaultName: 'bala' }, new Set([BALA_USER]));
    expect(l).toEqual({ entries: [{ id: 'pta_bala', name: 'Bala', colour: '#d50000', userId: BALA_USER, hidden: false }, { id: 'pta_kherry', name: 'Kherry', colour: '#0b8043', userId: null, hidden: false }], defaultId: 'pta_bala' });
    // Ids are kept on rename, so old jobs keep pointing at the entry.
    expect(cleanApplicantList({ entries: [{ id: 'pta_bala', name: 'Bala K', colour: '#d50000' }] }).entries[0]).toMatchObject({ id: 'pta_bala', name: 'Bala K' });
    expect(() => cleanApplicantList({ entries: [{ name: 'Bala', colour: '#d50000' }, { name: 'bala', colour: '#f6bf26' }] })).toThrow(BadRequestException);
    expect(() => cleanApplicantList({ entries: [{ name: 'Bala', colour: 'red' }] })).toThrow(BadRequestException);
    expect(() => cleanApplicantList({ entries: [{ name: '', colour: '#d50000' }] })).toThrow(BadRequestException);
    expect(() => cleanApplicantList({ entries: [{ name: 'A', colour: '#d50000', userId: 'u1' }, { name: 'B', colour: '#f6bf26', userId: 'u1' }] })).toThrow(BadRequestException);
    expect(() => cleanApplicantList({ entries: [{ name: 'A', colour: '#d50000', userId: 'stranger' }] }, new Set([BALA_USER]))).toThrow(BadRequestException);
    expect(() => cleanApplicantList({ entries: [{ name: 'A', colour: '#d50000', hidden: true }] })).toThrow(BadRequestException);
    // A hidden default falls back to the first shown entry.
    expect(cleanApplicantList({ entries: [{ id: 'pta_a', name: 'A', colour: '#d50000', hidden: true }, { name: 'B', colour: '#f6bf26' }], defaultId: 'pta_a' }).defaultId).toBe('pta_b');
  });

  it('a stored applicant: entry id, else the entry linked to that user; hidden or unknown = marked, never lost', () => {
    const l = list();
    expect(applicantEntryOf(l, 'pta_kherry')?.name).toBe('Kherry');
    expect(applicantEntryOf(l, BALA_USER)?.id).toBe('pta_bala');
    expect(applicantView(l, BALA_USER, 'Bala WCT')).toEqual({ id: 'pta_bala', name: 'Bala', inList: true });
    expect(applicantView(l, OTHER_USER, 'Richie')).toEqual({ id: OTHER_USER, name: 'Richie', inList: false });
    const hidden = applicantListOf({ options: SEED.entries.map((e) => (e.id === 'pta_joyna' ? { ...e, hidden: true } : e)), defaultValue: 'pta_bala' })!;
    expect(applicantView(hidden, JOYNA_USER, null)).toEqual({ id: 'pta_joyna', name: 'Joyna', inList: false });
    expect(visibleApplicants(hidden).map((e) => e.name)).toEqual(['Bala', 'Kherry']);
  });

  it('bar colours come from the list, for the entry and for jobs that stored the linked user', () => {
    expect(applicantBars(list())).toEqual({ pta_bala: '#d50000', [BALA_USER]: '#d50000', pta_joyna: '#f6bf26', [JOYNA_USER]: '#f6bf26', pta_kherry: '#0b8043' });
    const colours = withApplicantList(coloursOf([{ userId: OTHER_USER, settings: { calendar: { bar: '#795548', ptwDefault: true } } }]), list());
    const input = (ptwApplicantId: string | null): StyleInput => ({ cancelled: false, postponed: false, ptwStatus: 'REQUIRED', doCount: 0, cod: false, category: null, salespersonId: null, ptwApplicantId });
    expect(styleOf(input('pta_kherry'), colours).bar).toBe('#0b8043');
    expect(styleOf(input(BALA_USER), colours).bar).toBe('#d50000');
    // A member's own bar colour no longer applies once the org has a list.
    expect(styleOf(input(OTHER_USER), colours).bar).toBe(NEUTRAL_BAR);
    expect(colours.defaultApplicant).toEqual({ id: 'pta_bala', name: 'Bala' });
  });
});

describe('PTW applicants list: saving a job', () => {
  const stored = (id: string | null, name: string | null = null) => ({ ...EMPTY_JOB_STYLE, ptwApplicantId: id, ptwApplicantName: name });

  it('only list entries can be picked; a linked user is stored as its entry; Kherry needs no login', () => {
    const l = list();
    expect(withListedApplicant({ ptwApplicantId: 'pta_kherry', ptwApplicantName: null }, l, null)).toEqual({ ptwApplicantId: 'pta_kherry', ptwApplicantName: 'Kherry' });
    expect(withListedApplicant({ ptwApplicantId: JOYNA_USER, ptwApplicantName: 'x' }, l, null)).toEqual({ ptwApplicantId: 'pta_joyna', ptwApplicantName: 'Joyna' });
    expect(() => withListedApplicant({ ptwApplicantId: OTHER_USER, ptwApplicantName: 'Richie' }, l, null)).toThrow(BadRequestException);
    // Clearing is always allowed; a job keeps an applicant it already has.
    expect(withListedApplicant({ ptwApplicantId: null, ptwApplicantName: null }, l, stored(OTHER_USER))).toEqual({ ptwApplicantId: null, ptwApplicantName: null });
    expect(withListedApplicant({ ptwApplicantId: OTHER_USER, ptwApplicantName: null }, l, stored(OTHER_USER, 'Richie'))).toEqual({ ptwApplicantId: OTHER_USER, ptwApplicantName: 'Richie' });
    // No list: unchanged (every other org).
    expect(withListedApplicant({ ptwApplicantId: OTHER_USER, ptwApplicantName: 'Richie' }, null, null)).toEqual({ ptwApplicantId: OTHER_USER, ptwApplicantName: 'Richie' });
  });

  it("a new PTW job gets the list's default (Bala); without a list the member default as before", async () => {
    const withList = { customField: { findFirst: jest.fn(async () => ({ options: SEED.entries, defaultValue: 'pta_bala' })) }, userOrganization: { findMany: jest.fn() } };
    expect(await defaultPtwApplicant(withList, 'org')).toBe('pta_bala');
    expect(withList.userOrganization.findMany).not.toHaveBeenCalled();
    const noList = { customField: { findFirst: jest.fn(async () => null) }, userOrganization: { findMany: jest.fn(async () => [{ userId: OTHER_USER, settings: { calendar: { ptwDefault: true } } }]) } };
    expect(await defaultPtwApplicant(noList, 'org')).toBe(OTHER_USER);
    expect(withStampedApplicant({}, 'REQUIRED', null, 'pta_bala')).toEqual({ ptwApplicantId: 'pta_bala', ptwApplicantName: null });
  });
});

/** Members + the org's custom fields (the list row when given). */
function fakePrisma(opts: { list?: any; features?: any; style?: any } = {}) {
  const members = [
    { userId: BALA_USER, salesmanCode: null, settings: null },
    { userId: JOYNA_USER, salesmanCode: 'S004', settings: { calendar: { fill: '#3f51b5' } } },
    { userId: OTHER_USER, salesmanCode: null, settings: { calendar: { bar: '#795548', ptwDefault: true } } },
  ];
  return {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: opts.features ?? { enableCalendarStyle: true } })) },
    userOrganization: { findMany: jest.fn(async ({ where }: any) => (where.salesmanCode ? members.filter((m) => m.salesmanCode) : members)) },
    userRole: { findMany: jest.fn(async () => [{ userId: JOYNA_USER, role: { name: 'Sales' } }]) },
    customField: {
      findFirst: jest.fn(async ({ where }: any) => (where.fieldName === PTW_APPLICANTS_FIELD ? opts.list ?? null : where.fieldName === 'job_calendar_style' ? { id: 'style-field' } : null)),
      create: jest.fn(async () => ({ id: 'new' })),
      update: jest.fn(async () => ({})),
    },
    customFieldValue: { findMany: jest.fn(async ({ where }: any) => (opts.style ? where.entityId.in.map((id: string) => ({ entityId: id, value: opts.style })) : [])) },
    delivery: { findFirst: jest.fn(async () => ({ id: 'job-1', ptwStatus: 'REQUIRED' })) },
  } as any;
}
const NAMES: Record<string, string> = { [BALA_USER]: 'Bala WCT', [JOYNA_USER]: 'Joyna Tan', [OTHER_USER]: 'Richie' };
const clerk = { toClerkUsers: jest.fn(async (ids: Iterable<string>) => new Map([...ids].filter((i) => NAMES[i]).map((i) => [i, { firstName: NAMES[i], lastName: '', emailAddresses: [] }]))) } as any;

describe('PTW applicants list: pickers, settings, job page', () => {
  it('the dropdown offers only the list (in order), default Bala; Kherry selectable without a login', async () => {
    const s = new CalendarStyleService(fakePrisma({ list: { options: SEED.entries, defaultValue: 'pta_bala' } }), clerk);
    const p: any = await s.formPeople('org', JOYNA_USER);
    expect(p.applicants).toEqual([
      { id: 'pta_bala', name: 'Bala', colour: '#d50000' },
      { id: 'pta_joyna', name: 'Joyna', colour: '#f6bf26' },
      { id: 'pta_kherry', name: 'Kherry', colour: '#0b8043' },
    ]);
    expect(p.applicantsFromList).toBe(true);
    expect(p.defaultApplicant).toEqual({ id: 'pta_bala', name: 'Bala' });
    expect(p.salespeople.map((x: any) => x.id)).toEqual([JOYNA_USER]);
  });

  it('an org with no list: every member as before (other orgs unchanged)', async () => {
    const s = new CalendarStyleService(fakePrisma(), clerk);
    const p: any = await s.formPeople('org', null);
    expect(p.applicantsFromList).toBeUndefined();
    expect(p.applicants.map((x: any) => x.name)).toEqual(['Bala WCT', 'Joyna Tan', 'Richie']);
    expect(p.defaultApplicant).toEqual({ id: OTHER_USER, name: 'Richie' });
    const settings: any = await s.settings('org');
    expect(settings.ptwList).toBe(false);
  });

  it('settings save: refuses a colour close to a salesperson colour and a login outside the org; stores the list', async () => {
    const prisma = fakePrisma();
    const s = new CalendarStyleService(prisma, clerk);
    await expect(s.saveApplicants('org', { entries: [{ name: 'Bala', colour: '#3f51b5' }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.saveApplicants('org', { entries: [{ name: 'Bala', colour: '#d50000', userId: 'stranger' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customField.create).not.toHaveBeenCalled();
    await s.saveApplicants('org', { ...SEED, entries: SEED.entries.map(({ id, ...e }) => e) });
    expect(prisma.customField.create.mock.calls[0][0].data).toMatchObject({ fieldName: PTW_APPLICANTS_FIELD, isActive: false, defaultValue: 'pta_bala', options: SEED.entries });
    // The gate: no calendar style, no list endpoints.
    await expect(new CalendarStyleService(fakePrisma({ features: {} }), clerk).applicants('org')).rejects.toThrow();
  });

  it('job page: an old job that stored Bala\'s login reads as Bala; one outside the list keeps its name, marked', async () => {
    const make = (style: any) => new DeliveriesService(fakePrisma({ list: { options: SEED.entries, defaultValue: 'pta_bala' }, style }), {} as any, {} as any, {} as any, {} as any, undefined, undefined, clerk);
    expect(await make({ ptwApplicantId: BALA_USER, ptwApplicantName: null }).getJobStyle('job-1', 'org')).toMatchObject({ ptwApplicantId: 'pta_bala', ptwApplicantName: 'Bala', ptwApplicantInList: true });
    expect(await make({ ptwApplicantId: OTHER_USER, ptwApplicantName: null }).getJobStyle('job-1', 'org')).toMatchObject({ ptwApplicantId: OTHER_USER, ptwApplicantName: 'Richie', ptwApplicantInList: false });
  });
});
