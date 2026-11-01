import { UsersService } from './users.service';

// Round AZ — each user's portal language per org (the EN / 日本語 switch, SHIPMENTS orgs only).
describe('round AZ — own portal language', () => {
  const make = (shipments: boolean, prev: string | null = null) => {
    const upserts: any[] = [];
    const prisma: any = {
      organizationModule: { findUnique: async () => (shipments ? { enabled: true } : null) },
      organizationMemberProfile: { findUnique: async (a: any) => (a.select?.uiLang ? (prev ? { uiLang: prev } : null) : { whatsappNumber: null, commissionPct: null, yearlySalesTarget: null, signatureImage: null, uiLang: prev }), upsert: async (a: any) => upserts.push(a) },
    };
    return { svc: new UsersService({} as any, prisma, {} as any), upserts };
  };
  it('saves en / ja on the caller’s own row only', async () => {
    const { svc, upserts } = make(true, 'en');
    expect(await svc.setOwnUiLang('u1', 'org', 'ja')).toEqual({ uiLang: 'ja', from: 'en' });
    expect(upserts[0].where).toEqual({ organizationId_userId: { organizationId: 'org', userId: 'u1' } });
    expect([upserts[0].update, upserts[0].create.uiLang]).toEqual([{ uiLang: 'ja' }, 'ja']);
  });
  it('anything else is refused', async () => {
    await expect(make(true).svc.setOwnUiLang('u1', 'org', 'fr')).rejects.toThrow('"en" or "ja"');
  });
  it('orgs without the Shipments module have no switch', async () => {
    const { svc, upserts } = make(false);
    await expect(svc.setOwnUiLang('u1', 'org', 'ja')).rejects.toThrow('not available');
    expect(upserts).toHaveLength(0);
  });
  it('the own profile returns it', async () => {
    expect((await make(true, 'ja').svc.getOwnProfile('u1', 'org')).uiLang).toBe('ja');
  });
});
