import { buildWctServiceReportHtml } from './service-report-wct';
import { WCT_JOB_TYPES, WCT_PHOTO_SECTIONS, wctSectionsFor, wctSlotKey, wctSlotsFor, wctSlotTitle, wctUnitCount } from './msr-templates';

/**
 * WCT's blank masters (2026-11-16): "SR (SINGLE)" and "SR (10 Stalls)".
 * Paper wording, paper page order, 2 Before + 2 After per page, multi-stall layout.
 */
const org = { name: 'WCT (S) Systems Pte Ltd', phoneNumber: '6741 1697' };
const html = (wct: any) => buildWctServiceReportHtml({ reportNumber: 3, technicianName: null, serviceData: { customerName: 'TEST Client', wct }, org });
const pages = (h: string) => (h.match(/class="pg[ "]/g) ?? []).length;
const keys = (n: number, p = 'k') => Array.from({ length: n }, (_, i) => `maintenance-reports/${p}${i}.jpg`);

describe('WCT service report masters', () => {
  it('paper wording: Exhaust Louvre, Air Cleaners (Tray/Base), Fresh Air Grille', () => {
    expect(WCT_JOB_TYPES.find((j) => j.id === 'CD_LOUVRE')?.label).toBe('Exhaust Louvre');
    const by = (id: string) => WCT_PHOTO_SECTIONS.find((s) => s.id === id)!;
    expect(by('LOUVRE').subject).toBe('Exhaust Louvre');
    expect(by('LOUVRE').lines[2]).toBe('Chemical degreasing for exhaust lourves/discharge');
    expect(by('AIR_CLEANER').subject).toBe('Air Cleaners (Tray/Base)');
    expect(by('AIR_CLEANER').lines).toHaveLength(5);
    expect(by('AIR_CLEANER').draftedLines).toBeFalsy();
    expect(by('FA_GRILLE')).toMatchObject({ heading: 'De-dusting of', lines: ['Setting up protection coverage before cleaning process begins.', 'Cleaning & de-dusting of fresh air grilles.'] });
  });

  it('paper page order: … UV, Fresh Air Grille, Air Cleaners, Exhaust Louvre, Area Cleaning', () => {
    const ids = wctSectionsFor(['CD_FULL', 'CD_UV', 'DD_GRILLE', 'CD_AIR_CLEANER', 'CD_LOUVRE']).map((s) => s.id);
    expect(ids).toEqual(['UNIT_LOCATION', 'HOOD', 'FAN', 'DUCT', 'UV', 'FA_GRILLE', 'AIR_CLEANER', 'LOUVRE', 'AREA_CLEANING']);
  });

  it('single: keys are the plain ids (old reports read as before)', () => {
    const slots = wctSlotsFor({ jobTypes: ['CD_HOOD'] });
    expect(slots.map((s) => s.key)).toEqual(['UNIT_LOCATION', 'HOOD', 'AREA_CLEANING']);
    expect(slots.every((s) => s.unit === undefined)).toBe(true);
    expect(wctUnitCount(undefined)).toBe(1);
    expect(wctUnitCount('1')).toBe(1);
    expect(wctUnitCount('abc')).toBe(1);
    expect(wctUnitCount(999)).toBe(40);
  });

  it('multiple stalls: Company / Brand, then Unit Location #n + Hood per stall, then shared sections', () => {
    const slots = wctSlotsFor({ jobTypes: ['CD_FULL'], units: 3 });
    expect(slots.map((s) => s.key)).toEqual(['BRAND', 'UNIT_LOCATION', 'HOOD', 'UNIT_LOCATION@2', 'HOOD@2', 'UNIT_LOCATION@3', 'HOOD@3', 'FAN', 'DUCT', 'AREA_CLEANING']);
    expect(wctSlotTitle(slots[3])).toBe('Unit Location #2');
    expect(wctSlotTitle(slots[4])).toBe('Chemical Degreasing of Kitchen Exhaust Hood (#2)');
    expect(wctSlotKey('HOOD', 1)).toBe('HOOD');
    // No hood ticked: stalls still get their Unit Location page.
    expect(wctSlotsFor({ jobTypes: ['CD_FAN'], units: 2 }).map((s) => s.key)).toEqual(['BRAND', 'UNIT_LOCATION', 'UNIT_LOCATION@2', 'FAN', 'AREA_CLEANING']);
  });

  it('two Before + two After per page; more photos add pages of the same section', () => {
    const base = pages(html({ jobTypes: ['CD_HOOD'], sections: {} }));
    // cover + letter + UL + HOOD + AREA + advisory + frequency (page 1 has no .pg)
    expect(base).toBe(6);
    const h = html({ jobTypes: ['CD_HOOD'], sections: { HOOD: { before: keys(5, 'b'), after: keys(2, 'a') } } });
    expect(pages(h)).toBe(base + 2); // 5 before → 3 hood pages
    expect((h.match(/Kitchen Exhaust Hood<\/u>/g) ?? []).length).toBe(3);
    expect(h).toContain('b4.jpg');
  });

  it('multi-stall report prints Unit Location #n captions and each stall’s own photos', () => {
    const h = html({ jobTypes: ['CD_HOOD'], units: 2, sections: { 'HOOD@2': { before: ['maintenance-reports/stall2.jpg'] }, BRAND: { photos: ['maintenance-reports/brand.jpg'] } } });
    expect(h).toContain('Company / Brand -');
    expect(h).toContain('Unit Location #1');
    expect(h).toContain('Unit Location #2');
    expect(h).toContain('stall2.jpg');
    expect(h).toContain('brand.jpg');
  });
});
