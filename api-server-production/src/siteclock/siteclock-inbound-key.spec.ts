import { ConflictException } from '@nestjs/common';
import { SiteClockLinkService } from './siteclock-link.service';
import { hashInboundKey } from '../job-photos/job-photos';
import * as jp from '../job-photos/job-photos';

/** Generate / Rotate the inbound key: one hash, one connection (inboundKeyHash is indexed, not @unique). */
describe('SiteClockLinkService.generateInboundKey', () => {
  function world() {
    const conns: any[] = [
      { id: 'c-wct', organizationId: 'org-wct', inboundKeyHash: null, inboundKeyLast4: null },
      { id: 'c-other', organizationId: 'org-other', inboundKeyHash: null, inboundKeyLast4: null },
    ];
    const updates: any[] = [];
    const prisma: any = {
      siteClockConnection: {
        findUnique: async ({ where }: any) => conns.find((c) => c.organizationId === where.organizationId) ?? null,
        findFirst: async ({ where }: any) => conns.find((c) => c.inboundKeyHash === where.inboundKeyHash && c.id !== where.id?.not) ?? null,
        update: async ({ where, data }: any) => {
          updates.push(data);
          return Object.assign(
            conns.find((c) => c.organizationId === where.organizationId),
            data,
          );
        },
      },
    };
    const svc = new SiteClockLinkService(prisma, {} as any);
    return { svc, conns, updates };
  }
  afterEach(() => jest.restoreAllMocks());

  it('saves the new hash and returns the key once', async () => {
    const { svc, conns } = world();
    const r: any = await svc.generateInboundKey('org-wct');
    expect(r.key.startsWith('aims_sck_')).toBe(true);
    expect(conns[0].inboundKeyHash).toBe(hashInboundKey(r.key));
  });

  it('refuses to save a hash another connection already has, and saves nothing', async () => {
    const { svc, conns, updates } = world();
    const taken = 'aims_sck_' + 'x'.repeat(43);
    conns[1].inboundKeyHash = hashInboundKey(taken);
    jest.spyOn(jp, 'newInboundKey').mockReturnValue(taken);
    await expect(svc.generateInboundKey('org-wct')).rejects.toBeInstanceOf(ConflictException);
    expect(updates).toHaveLength(0);
    expect(conns[0].inboundKeyHash).toBeNull();
  });

  it('rotating to the same org is not a clash with itself', async () => {
    const { svc, conns } = world();
    const k = 'aims_sck_' + 'y'.repeat(43);
    conns[0].inboundKeyHash = hashInboundKey(k);
    jest.spyOn(jp, 'newInboundKey').mockReturnValue(k);
    await expect(svc.generateInboundKey('org-wct')).resolves.toMatchObject({ key: k });
  });
});
