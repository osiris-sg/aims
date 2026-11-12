import { orgTimeZoneFor, resolveTimeZone } from './org-today';
import { DeliveryGroupPostsService } from '../delivery-group-posts/delivery-group-posts.service';

/**
 * Signed DO / RDO PDFs print in the ORG's time zone (2026-11-12): the server
 * runs in UTC, so Biofuel's RDO202611-005 timeline read "5:51 am" for 1:51 pm
 * and an all-day 19 Oct as "18 Oct". Asia/Singapore when the org has none.
 */
describe('PDF time zone', () => {
  it('resolves a valid zone, and falls back to Asia/Singapore', () => {
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveTimeZone(null)).toBe('Asia/Singapore');
    expect(resolveTimeZone('')).toBe('Asia/Singapore');
    expect(resolveTimeZone('Mars/Olympus')).toBe('Asia/Singapore');
  });

  it("reads the org's Financial Settings zone", async () => {
    const reader = (timeZone: string | null | undefined) => ({ accountingSetting: { findUnique: async () => (timeZone === undefined ? null : { timeZone }) } });
    expect(await orgTimeZoneFor(reader('Asia/Tokyo'), 'org')).toBe('Asia/Tokyo');
    expect(await orgTimeZoneFor(reader(undefined), 'org')).toBe('Asia/Singapore');
    expect(await orgTimeZoneFor(reader('nonsense'), 'org')).toBe('Asia/Singapore');
  });

  it('the signed DO is rendered in that zone', async () => {
    const svc: any = Object.create(DeliveryGroupPostsService.prototype);
    const calls: any[] = [];
    svc.prisma = {
      document: { findFirst: async () => ({ name: 'RDO202611-005' }) },
      accountingSetting: { findUnique: async () => ({ timeZone: 'Asia/Tokyo' }) },
    };
    svc.publicDocs = {
      getOrCreateViewOnlyLink: async () => ({ token: 'vo_x', url: 'https://app.ai-ms.io/guest/do/vo_x' }),
      getPublicView: async () => ({ serverHtml: null }),
    };
    svc.pdf = { generatePdfFromUrl: async (url: string, opts: any) => (calls.push({ url, opts }), Buffer.from('pdf')) };
    const out = await svc.renderSignedDo('org-1', 'doc-1');
    expect(out.fileName).toBe('RDO202611-005-signed.pdf');
    expect(calls[0].opts.timeZone).toBe('Asia/Tokyo');
  });
});
