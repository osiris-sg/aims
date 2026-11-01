import { orgToday } from './org-today';

describe('orgToday', () => {
  it('uses the org time zone, not UTC', () => {
    const sgt0330 = new Date('2026-11-02T03:30:00+08:00');
    expect(sgt0330.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(orgToday('Asia/Singapore', sgt0330)).toBe('2026-11-02');
    expect(orgToday(null, sgt0330)).toBe('2026-11-02');
    expect(orgToday('Not/AZone', sgt0330)).toBe('2026-11-02');
    expect(orgToday('Asia/Tokyo', new Date('2026-11-01T23:30:00+08:00'))).toBe('2026-11-02');
  });
});
