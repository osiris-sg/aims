import { buildServiceReportHtml } from './service-report-pdf';

/**
 * Time In / Time Out are stored as instants. They must print in the ORG's time
 * zone, not the render host's — the PDF is drawn on a UTC host, so without this
 * the paper disagreed with the portal's own report page by the host's offset
 * (guru 2026-11-26).
 */
describe('service report — Time In / Time Out', () => {
  const html = (timeZone?: string | null) =>
    buildServiceReportHtml({
      reportNumber: 240,
      technicianName: 'biofuel fieldtech',
      // 10:00Z / 11:00Z = 18:00 / 19:00 in Singapore.
      serviceData: { timeIn: '2026-11-25T10:00:00.000Z', timeOut: '2026-11-25T11:00:00.000Z' } as any,
      asset: null,
      inventory: null,
      orgName: 'Biofuel Industries Pte Ltd',
      timeZone,
    });

  const times = (s: string) => [...s.matchAll(/Time (?:In|Out):<\/span>(\d\d:\d\d)/g)].map((m) => m[1]);

  it('prints them in the org time zone', () => {
    expect(times(html('Asia/Singapore'))).toEqual(['18:00', '19:00']);
  });

  it('prints them in a different org time zone', () => {
    expect(times(html('UTC'))).toEqual(['10:00', '11:00']);
  });

  it('falls back to the default zone rather than the host clock', () => {
    expect(times(html(null))).toEqual(['18:00', '19:00']);
  });
});
