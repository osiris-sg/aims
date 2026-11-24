import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { FilesService, normalizeStoredKey } from './files.service';
import { candidateKeys, FileOwnershipInterceptor } from './file-ownership.interceptor';

/** Phase 1 (2026-11-24): files open only through org-checked signed links; records only reference their own org's keys. */

// memberships: active UserOrganization rows; roles: active UserRole rows (default: a role in every membership org).
function make(registry: Record<string, { org: string; quarantined?: boolean; shared?: string[] }>, memberships: Record<string, string[]>, roles: Record<string, string[]> = memberships) {
  const inOrgs = (rows: Record<string, string[]>) => async ({ where }: any) =>
    (rows[where.userId] ?? []).filter((o) => !where.organizationId?.in || where.organizationId.in.includes(o)).map((organizationId) => ({ organizationId }));
  const prisma: any = {
    storedFile: {
      findMany: async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => registry[k]).map((k) => ({ key: k, organizationId: registry[k].org, quarantined: !!registry[k].quarantined, sharedOrgIds: registry[k].shared ?? [] })),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    userOrganization: { findMany: jest.fn(inOrgs(memberships)) },
    userRole: { findMany: jest.fn(inOrgs(roles)) },
  };
  const s3: any = { getSignedUrl: jest.fn(async (key: string, ttl: number) => `https://signed.example/${key}?ttl=${ttl}`) };
  return { svc: new FilesService(prisma, s3), prisma, s3 };
}

describe('FilesService.sign', () => {
  const registry = {
    'logos/a.png': { org: 'orgA' },
    'logos/b.png': { org: 'orgB' },
    'logos/shared.png': { org: 'orgA', quarantined: true, shared: ['orgA', 'orgD'] },
  };
  const memberships = { uA: ['orgA'], uAC: ['orgA', 'orgC'] };

  it('signs own-org keys for 10 minutes and refuses other orgs', async () => {
    const { svc } = make(registry, memberships);
    const out = await svc.sign(['logos/a.png', 'logos/b.png', 'org/orgA/logos/x.png', 'org/orgB/logos/y.png', 'vehicles/orgB/log/z.pdf'], { userId: 'uA', activeOrgId: 'orgA' });
    expect(out['logos/a.png']).toBe('https://signed.example/logos/a.png?ttl=600');
    expect(out['org/orgA/logos/x.png']).toContain('signed.example');
    expect(out['logos/b.png']).toBeNull();
    expect(out['org/orgB/logos/y.png']).toBeNull();
    expect(out['vehicles/orgB/log/z.pdf']).toBeNull();
  });

  it('a member of several orgs may open each of their orgs; platform admins any', async () => {
    const { svc } = make(registry, memberships);
    expect((await svc.sign(['org/orgC/x.png'], { userId: 'uAC', activeOrgId: 'orgA' }))['org/orgC/x.png']).toContain('signed');
    expect((await svc.sign(['logos/b.png'], { userId: 'admin', activeOrgId: 'orgA', platform: true }))['logos/b.png']).toContain('signed');
  });

  it('quarantined keys only for the orgs that reference them', async () => {
    const { svc } = make(registry, { ...memberships, uD: ['orgD'], uE: ['orgE'] });
    expect((await svc.sign(['logos/shared.png'], { userId: 'uD', activeOrgId: 'orgD' }))['logos/shared.png']).toContain('signed');
    expect((await svc.sign(['logos/shared.png'], { userId: 'uE', activeOrgId: 'orgE' }))['logos/shared.png']).toBeNull();
  });

  it('normalises stored public URLs of the bucket; refuses traversal and foreign hosts', async () => {
    const { svc } = make(registry, memberships);
    const u = 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/logos/a.png';
    const out = await svc.sign([u, 'https://evil.example/logos/a.png', 'org/orgA/../orgB/x.png'], { userId: 'uA', activeOrgId: 'orgA' });
    expect(out[u]).toContain('signed.example/logos/a.png');
    expect(out['https://evil.example/logos/a.png']).toBeNull();
    expect(out['org/orgA/../orgB/x.png']).toBeNull();
  });

  it('unknown legacy keys: any signed-in user until FILES_STRICT=1', async () => {
    const { svc } = make(registry, memberships);
    expect((await svc.sign(['do-start/old.jpg'], { userId: 'uA', activeOrgId: 'orgA' }))['do-start/old.jpg']).toContain('signed');
    process.env.FILES_STRICT = '1';
    try {
      expect((await svc.sign(['do-start/old.jpg'], { userId: 'uA', activeOrgId: 'orgA' }))['do-start/old.jpg']).toBeNull();
    } finally {
      delete process.env.FILES_STRICT;
    }
  });
});

/**
 * Owner's rule (2026-11-25, all orgs): a user opens a file when they have access to the FILE's org (membership + an
 * active role there), whichever org they are viewing. Group membership alone gives nothing. WCT-style fixture: WCT (S)
 * is the parent, BC Air its child; uBoth belongs to both, uWct to WCT (S) only.
 */
describe('file access follows the file org, not the viewed org', () => {
  const WCT = 'wct-s';
  const BC = 'bc-air';
  const registry = {
    'logos/wct.png': { org: WCT },
    'logos/bc.png': { org: BC },
    'logos/q.png': { org: 'orgX', quarantined: true, shared: ['orgX', BC] },
  };
  const memberships = { uBoth: [WCT, BC], uWct: [WCT], uNoRole: [WCT, BC] };
  const roles = { uBoth: [WCT, BC], uWct: [WCT], uNoRole: [WCT] };
  const bcKeys = ['logos/bc.png', `org/${BC}/documents/inv.pdf`, `maintenance-reports/${BC}/photos/p.jpg`];

  it('a member of both orgs opens BC Air files from the WCT (S) view and WCT (S) files from the BC Air view', async () => {
    const { svc } = make(registry, memberships, roles);
    const fromWct = await svc.sign(bcKeys, { userId: 'uBoth', activeOrgId: WCT });
    for (const k of bcKeys) expect(fromWct[k]).toContain('signed.example');
    const fromBc = await svc.sign(['logos/wct.png', `org/${WCT}/x.pdf`], { userId: 'uBoth', activeOrgId: BC });
    expect(fromBc['logos/wct.png']).toContain('signed.example');
    expect(fromBc[`org/${WCT}/x.pdf`]).toContain('signed.example');
  });

  it('a WCT (S)-only user is refused every BC Air file (the group gives no access by itself)', async () => {
    const { svc } = make(registry, memberships, roles);
    const out = await svc.sign([...bcKeys, 'logos/wct.png'], { userId: 'uWct', activeOrgId: WCT });
    for (const k of bcKeys) expect(out[k]).toBeNull();
    expect(out['logos/wct.png']).toContain('signed.example');
  });

  it('a membership without an active role in the file org does not open it (same rule as opening a group document)', async () => {
    const { svc } = make(registry, memberships, roles);
    expect((await svc.sign(['logos/bc.png'], { userId: 'uNoRole', activeOrgId: WCT }))['logos/bc.png']).toBeNull();
  });

  it('the viewed org always counts (the auth guard only serves a non-admin an org they belong to)', async () => {
    const { svc, prisma } = make(registry, memberships, roles);
    expect((await svc.sign(['logos/bc.png'], { userId: 'uNoRole', activeOrgId: BC }))['logos/bc.png']).toContain('signed.example');
    expect(prisma.userOrganization.findMany).not.toHaveBeenCalled();
  });

  it('quarantined shared keys open only for their orgs, from any view', async () => {
    const { svc } = make(registry, memberships, roles);
    expect((await svc.sign(['logos/q.png'], { userId: 'uBoth', activeOrgId: WCT }))['logos/q.png']).toContain('signed.example');
    expect((await svc.sign(['logos/q.png'], { userId: 'uWct', activeOrgId: WCT }))['logos/q.png']).toBeNull();
  });

  it('platform admins (viewing as any org, X-Active-Org-Id) open any file', async () => {
    const { svc } = make(registry, {}, {});
    const out = await svc.sign([...bcKeys, 'logos/wct.png', 'logos/q.png'], { userId: 'admin', activeOrgId: 'orgZ', platform: true });
    for (const k of Object.keys(out)) expect(out[k]).toContain('signed.example');
  });

  it('writes: a member of both may reference the other org file; a single-org user gets 403; public flows own org only', async () => {
    const { svc } = make(registry, memberships, roles);
    await expect(svc.assertOwnKeys(WCT, ['logos/bc.png'], { userId: 'uBoth', activeOrgId: WCT })).resolves.toBeUndefined();
    await expect(svc.assertOwnKeys(WCT, ['logos/bc.png'], { userId: 'uWct', activeOrgId: WCT })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertOwnKeys(WCT, ['logos/bc.png'], { userId: 'uNoRole', activeOrgId: WCT })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertOwnKeys(WCT, ['logos/bc.png'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the write interceptor passes the signed-in user: member of both allowed, single-org user 403', async () => {
    const { svc } = make(registry, memberships, roles);
    const icpt = new FileOwnershipInterceptor(svc);
    const ctx = (req: any): any => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) });
    const handler = { handle: jest.fn(() => of('ran')) };
    const req = (user: string) => ({ method: 'PATCH', originalUrl: '/documents/1', user: { id: user }, userOrganization: { id: WCT }, body: { config: { logo: 'logos/bc.png' } } });
    await expect(lastValueFrom(icpt.intercept(ctx(req('uBoth')), handler))).resolves.toBe('ran');
    await expect(lastValueFrom(icpt.intercept(ctx(req('uWct')), handler))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('records may only reference keys of their own org', () => {
  const registry = { 'logos/b.png': { org: 'orgB' }, 'logos/a.png': { org: 'orgA' } };

  it('assertOwnKeys refuses another org key (registry or key shape), allows own', async () => {
    const { svc } = make(registry, {});
    await expect(svc.assertOwnKeys('orgA', ['logos/a.png', 'org/orgA/x/y.png'])).resolves.toBeUndefined();
    await expect(svc.assertOwnKeys('orgA', ['logos/b.png'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertOwnKeys('orgA', ['org/orgB/do-start/1.jpg'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertOwnKeys('orgA', ['https://aims-osiris.s3.ap-southeast-1.amazonaws.com/maintenance-reports/orgB/p.jpg'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the interceptor scans write bodies and blocks before the handler', async () => {
    const { svc } = make(registry, {});
    const icpt = new FileOwnershipInterceptor(svc);
    const ctx = (req: any): any => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) });
    const handler = { handle: jest.fn(() => of('ran')) };
    const bad = { method: 'PATCH', originalUrl: '/documents/1', userOrganization: { id: 'orgA' }, body: { config: { logo: 'logos/b.png', items: [{ photos: ['org/orgA/do-start/1.jpg'] }] } } };
    await expect(lastValueFrom(icpt.intercept(ctx(bad), handler))).rejects.toBeInstanceOf(ForbiddenException);
    expect(handler.handle).not.toHaveBeenCalled();
    const good = { ...bad, body: { config: { logo: 'logos/a.png' } } };
    await expect(lastValueFrom(icpt.intercept(ctx(good), handler))).resolves.toBe('ran');
    const admin = { ...bad, isOsirisAdmin: true };
    await expect(lastValueFrom(icpt.intercept(ctx(admin), handler))).resolves.toBe('ran');
    const get = { ...bad, method: 'GET' };
    await expect(lastValueFrom(icpt.intercept(ctx(get), handler))).resolves.toBe('ran');
  });

  it('candidateKeys finds keys and bucket URLs only', () => {
    expect(candidateKeys({ a: 'hello world', b: ['logos/x.png', { c: 'https://aims-osiris.s3.amazonaws.com/a/b.pdf' }], d: 'Some/text' }).sort()).toEqual(
      ['https://aims-osiris.s3.amazonaws.com/a/b.pdf', 'logos/x.png'].sort(),
    );
  });

  it('normalizeStoredKey', () => {
    expect(normalizeStoredKey('https://aims-osiris.s3.ap-southeast-1.amazonaws.com/logos/a%20b.png?X-Amz=1')).toBe('logos/a b.png');
    expect(normalizeStoredKey('data:image/png;base64,xx')).toBeNull();
    expect(normalizeStoredKey('/logos/a.png')).toBe('logos/a.png');
  });
});
