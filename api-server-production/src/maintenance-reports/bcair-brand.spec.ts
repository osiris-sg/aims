import { buildWctServiceReportHtml, wctServicePdfOptions } from './service-report-wct';
import { servicePdfOptions } from './service-report-pdf';
import { wctBrand, wctDoNumberLabel, wctScopeSentence } from './msr-templates';
import { wctBrandSetting, wctBrandStamp } from './wct-brand';

/**
 * BC Air's service report (2026-11-16): the WCT paper with BC Air's letterhead
 * and wording (masters "BC Air SR Template" / "- 10stall"), chosen by the org
 * setting serviceReportTemplate = 'BCAIR'. WCT's output is unchanged.
 */
const org = { name: 'BC AIR PTE. LTD.', address: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099', phoneNumber: '6741 1697', email: null, website: null, registrationNumber: '202205130K', logo: 'organizations/bcair/logo.png' };
const wctOrg = { name: 'WCT (S) Systems Pte Ltd', address: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099', phoneNumber: '6741 1697', email: 'info@wct.com.sg', website: 'www.wct.com.sg', registrationNumber: '201724603K', logo: 'org/logo.png' };
const render = (brand: string | undefined, wct: any, extra: any = {}, o: any = org) =>
  buildWctServiceReportHtml({ reportNumber: 12, technicianName: null, serviceData: { customerName: 'TEST Client', doNumber: 'DO202611023', brand, ...extra, wct }, org: o });

describe('BC Air brand of the WCT paper', () => {
  const full = { jobTypes: ['CD_FULL', 'CD_CARBON_BANK', 'AA_MOTOR', 'CD_AIR_CLEANER'], sections: {} };

  it('letterhead from the master (no bizSAFE / BCA, no red rule), "#DO" number, light-blue box', () => {
    const h = render('BCAIR', full);
    expect(h).toContain('<div class="lh bc">');
    expect(h).toContain('BC Air Pte Ltd');
    expect(h).toContain('<b>Tel :</b> 6741 1697 / 8989 2833');
    expect(h).toContain('<b>Email:</b> info@bcair.com.sg');
    expect(h).toContain('<b>UEN:</b> 202205130K');
    expect(h).toContain('organizations/bcair/logo.png');
    expect(h).not.toContain('bizSAFE');
    expect(h).toContain('>#DO202611023<');
    expect(h).toContain('border-color:#9fd3e3');
    expect(wctDoNumberLabel('202611023')).toBe('#DO202611023');
    expect(wctDoNumberLabel(null)).toBe('#DO—');
  });

  it('job types: Carbon Bank added, "Replacement of Exhaust Booster Fan"; Air Cleaner page; the ticks print', () => {
    const h = render('BCAIR', full);
    expect(h).toContain('Carbon Bank');
    expect(h).toContain('Replacement of Exhaust Booster Fan');
    expect(h).not.toContain('Replacement of Exhaust Motor');
    expect(h).toContain('Chemical Degreasing of <u>Air Cleaner</u> -');
    expect(h).not.toContain('Air Cleaners (Tray/Base)');
    expect((h.match(/class="stamp"/g) ?? []).length).toBe(4);
  });

  it('letter as the master: no contacts, signed Ms Yew, BC Air in the thanks (the master said WCT), "labour"', () => {
    const h = render('BCAIR', full);
    expect(h).toContain('Dear Valued Client ,');
    expect(h).toContain('at the above mentioned location.');
    expect(h).toContain('<b><u>on the date mentioned above</u></b>');
    expect(h).toContain('providing skilled labour');
    expect(h).toContain('Thank you for choosing BC Air Pte Ltd.');
    expect(h).not.toMatch(/henry@wct|isadora@wct|For your kind attention|Isadora Eng/);
    expect(h).toContain('Ms Yew');
    expect(h).toContain('Administrative Assistant');
    expect(h).toContain('Email : <a href="mailto:info@bcair.com.sg">');
    expect(h).toContain('Our Mission');
    expect(h).toContain('such as 24 hour cooking');
    expect(h).toContain('regarding our services and products please feel free');
    expect(wctScopeSentence([], 'WCT')).toContain('skilled labor ');
  });

  it('footer: one centred italic line, no page numbers', () => {
    const o = wctServicePdfOptions(org, 'BCAIR');
    expect(o.pageNumbers).toMatchObject({ label: 'Thank You for Your Patronage . We look forward to serving you again!', format: 'none', align: 'center', italic: true });
    expect(servicePdfOptions({ templateId: 'WCT_V1', brand: 'BCAIR' }, [], org)?.pageNumbers?.format).toBe('none');
  });

  it('stalls work the same (Company / Brand, Unit Location #n + Hood per stall)', () => {
    const h = render('BCAIR', { jobTypes: ['CD_HOOD'], units: 2, sections: {} });
    expect(h).toContain('Company / Brand -');
    expect(h).toContain('Unit Location #2');
    expect(wctBrand('BCAIR').jobTypeGroups[0].items.map((i) => i.id)).toContain('CD_CARBON_BANK');
  });
});

describe('WCT unchanged', () => {
  it('no brand and brand "WCT" draw the same WCT paper (letterhead, report number, page footer)', () => {
    const wct = { jobTypes: ['CD_FULL', 'AA_MOTOR', 'CD_AIR_CLEANER'], sections: {} };
    const a = render(undefined, wct, {}, wctOrg);
    expect(render('WCT', wct, {}, wctOrg)).toBe(a);
    expect(a).toContain('bizSAFE · BCA');
    expect(a).toContain('>#000012<');
    expect(a).toContain('Replacement of Exhaust Motor');
    expect(a).not.toContain('Carbon Bank');
    expect(a).toContain('Air Cleaners (Tray/Base)');
    expect(a).toContain('Isadora Eng');
    expect(a).not.toContain('lh bc');
    expect(wctServicePdfOptions(wctOrg).pageNumbers).toEqual({ label: expect.stringContaining('TEL: 6741 1697'), format: 'of', fontPx: 8, paddingX: '14mm' });
  });

  it('other templates keep their PDF options (no WCT footer)', () => {
    expect(servicePdfOptions({ templateId: 'GENERIC_V1' }, [], wctOrg)?.pageNumbers).toBeUndefined();
    expect(servicePdfOptions({ templateId: 'ESS_V1' }, [], wctOrg)?.pageNumbers).toBeUndefined();
  });
});

describe('brand setting and stamp', () => {
  const prisma = (features: any) => ({ organizationUIConfig: { findUnique: jest.fn(async () => (features ? { features } : null)) } });
  it("BC Air's setting stamps { brand: 'BCAIR' }; WCT and every other org get nothing (rows unchanged)", async () => {
    expect(await wctBrandStamp(prisma({ serviceReportTemplate: 'BCAIR' }), 'bc')).toEqual({ brand: 'BCAIR' });
    expect(await wctBrandStamp(prisma({ enableManualOrderFlow: true }), 'wct')).toEqual({});
    expect(await wctBrandStamp(prisma(null), 'ciel')).toEqual({});
    expect(await wctBrandSetting(prisma({ serviceReportTemplate: 'something' }), 'x')).toBeNull();
  });
});
