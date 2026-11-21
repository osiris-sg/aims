import { DateTime } from 'luxon';
import { runParity } from './parity';

const at = (d: string, hm: string) => DateTime.fromFormat(`${d} ${hm}`, 'yyyy-MM-dd HH:mm', { zone: 'Asia/Singapore' }).toJSDate();
const base = () => ({
  fieldSite: [{ id: 's', organizationId: 'o', name: 'S', lat: 1, lng: 1, radiusM: 150, timezone: 'Asia/Singapore', autoCloseAfterH: 14, kind: 'PERMANENT', active: true }],
  fieldSettings: [{ id: 'st', organizationId: 'o', crewMarginBeforeMin: 15, crewMarginAfterMin: 30, missedClockOut: 'FULL_SHIFT', jobClocking: 'ARRIVE_LEAVE', jobClockingTeamIds: [] }],
  fieldOvertimeRule: [{ id: 'ot', organizationId: 'o', siteId: null, dailyThresholdMin: 528, otMultiplier: 1.5, weeklyCapOtMin: null, countEarlyAsWork: false, earlyMode: null }],
  fieldBreakRule: [{ id: 'br', organizationId: 'o', siteId: null, deductMinutes: 60, minShiftMinutes: 360, nlbCreditMinutes: 0 }],
  fieldShiftTemplate: [] as any[],
  fieldShiftAssignment: [] as any[],
});
const entry = (id: string, stored: Record<string, unknown>) => ({
  id, siteclockId: `sc-${id}`, organizationId: 'o', workerId: 'w', siteId: 's', workDate: '2026-11-02', clockInAt: at('2026-11-02', '08:00'), clockOutAt: at('2026-11-02', '18:00'),
  status: 'APPROVED', nlb: false, editedById: null, needsReview: false, paidFromAt: null, paidToAt: null, workedFor: null, otMultiplier: 1.5, lateMinutes: 0, earlyMinutes: 0, leftEarlyMinutes: 0, ...stored,
});

describe('golden parity runner', () => {
  it('no mismatch when SiteClock stored what the engine computes; every differing field is listed', async () => {
    const good = entry('e1', { grossMinutes: 600, breakMinutes: 60, regularMinutes: 528, otMinutes: 12 });
    const bad = entry('e2', { grossMinutes: 600, breakMinutes: 30, regularMinutes: 528, otMinutes: 42 });
    const out = await runParity({ ...base(), fieldTimeEntry: [good, bad] }, { from: '2026-11-01', to: '2026-11-30' });
    expect(out.checked).toBe(2);
    expect(out.entriesWithMismatch).toBe(1);
    expect(out.mismatches.map((m) => [m.entryId, m.field, m.siteclock, m.aims])).toEqual([
      ['e2', 'breakMinutes', 30, 60],
      ['e2', 'otMinutes', 42, 12],
    ]);
  });
  it('open days and days outside the window are not checked', async () => {
    const out = await runParity({ ...base(), fieldTimeEntry: [entry('e3', { status: 'OPEN', clockOutAt: null }), entry('e4', { workDate: '2026-08-01' })] }, { from: '2026-11-01', to: '2026-11-30' });
    expect(out.checked).toBe(0);
  });
});
