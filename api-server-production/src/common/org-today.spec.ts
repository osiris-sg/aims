import { orgToday, orgTodayFor } from './org-today';

const tzReader = (timeZone: string | null) => ({ accountingSetting: { findUnique: async () => (timeZone === undefined ? null : { timeZone }) } });

describe('orgToday', () => {
  it('uses the org time zone, not UTC', () => {
    const sgt0330 = new Date('2026-11-02T03:30:00+08:00');
    expect(sgt0330.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(orgToday('Asia/Singapore', sgt0330)).toBe('2026-11-02');
    expect(orgToday(null, sgt0330)).toBe('2026-11-02');
    expect(orgToday('Not/AZone', sgt0330)).toBe('2026-11-02');
    expect(orgToday('Asia/Tokyo', new Date('2026-11-01T23:30:00+08:00'))).toBe('2026-11-02');
  });

  it('flips exactly at midnight SGT', () => {
    expect(orgToday('Asia/Singapore', new Date('2026-11-01T23:59:59+08:00'))).toBe('2026-11-01');
    expect(orgToday('Asia/Singapore', new Date('2026-11-02T00:00:00+08:00'))).toBe('2026-11-02');
    expect(orgToday('Asia/Singapore', new Date('2026-11-02T07:59:59+08:00'))).toBe('2026-11-02');
    expect(orgToday('Asia/Singapore', new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01'); // month edge
  });
});

describe('orgTodayFor (server-created documents)', () => {
  // INV202611-0009 was made at 01:52 SGT on 2 Nov and stamped 2026-11-01T17:52Z ("1 Nov").
  const at0152 = new Date('2026-11-01T17:52:24.895Z');

  it('dates a document made at 01:52 SGT as that SGT day, date-only', async () => {
    await expect(orgTodayFor(tzReader('Asia/Singapore') as any, 'org', at0152)).resolves.toBe('2026-11-02');
  });

  it('falls back to Singapore without a setting or on a read error', async () => {
    await expect(orgTodayFor(tzReader(null) as any, 'org', at0152)).resolves.toBe('2026-11-02');
    const broken = { accountingSetting: { findUnique: async () => Promise.reject(new Error('down')) } };
    await expect(orgTodayFor(broken as any, 'org', at0152)).resolves.toBe('2026-11-02');
  });

  it('a date-only value posts its journal on that day (midnight UTC, like payments)', () => {
    expect(new Date('2026-11-02').toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});
