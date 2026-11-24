// 2026-11-25: a group company that can't take a new job (no Orders yet, e.g. YMM) is left out of the New job
// Organisation pick; the calendar's own company always stays.
jest.mock('../organizations/org-group', () => ({
  ...jest.requireActual('../organizations/org-group'),
  groupJobCompanies: jest.fn(async () => ({
    group: true,
    current: 'wct',
    orgs: [
      { id: 'wct', name: 'WCT (S)' },
      { id: 'bcair', name: 'BC Air' },
      { id: 'ymm', name: 'YMM' },
    ],
  })),
}));
jest.mock('../deliveries/quick-jobs', () => ({
  ...jest.requireActual('../deliveries/quick-jobs'),
  isCalendarAddEnabled: jest.fn(async (_p: any, id: string) => id !== 'ymm'),
}));
import { JobsCalendarService } from './jobs-calendar.service';

describe('New job Organisation pick', () => {
  it('leaves out a company that cannot take a new job', async () => {
    const svc = new JobsCalendarService({} as any);
    const out = await svc.companies('wct', 'u1', false);
    expect(out.orgs.map((o: any) => o.id)).toEqual(['wct', 'bcair']);
  });
  it('always keeps the calendar company itself', async () => {
    const { isCalendarAddEnabled } = require('../deliveries/quick-jobs');
    (isCalendarAddEnabled as jest.Mock).mockImplementation(async () => false);
    const svc = new JobsCalendarService({} as any);
    const out = await svc.companies('wct', 'u1', false);
    expect(out.orgs.map((o: any) => o.id)).toEqual(['wct']);
  });
});
