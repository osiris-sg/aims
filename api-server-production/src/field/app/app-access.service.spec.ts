/** HR > Workers > Give app access (app-access.service.ts): login found or made, org membership, the link. */
import { fakePrisma, type FakePrisma } from '../testing/fake-prisma';
import { APP_ROLE, FieldAppAccessService, e164 } from './app-access.service';

const ORG = 'org-1';
const ctx: any = { organizationId: ORG, userId: 'u-admin' };

function clerkStub(users: any[]) {
  const calls: string[] = [];
  return {
    calls,
    users: {
      getUserList: async ({ phoneNumber }: any) => ({ data: users.filter((u) => u.phone === phoneNumber[0]) }),
      createUser: async (d: any) => {
        calls.push('create');
        const u = { id: `clerk-${users.length + 1}`, externalId: null, phone: d.phoneNumber[0], firstName: d.firstName };
        users.push(u);
        return u;
      },
      updateUser: async (id: string, d: any) => {
        calls.push('stamp');
        Object.assign(users.find((u) => u.id === id), d);
      },
    },
  };
}

async function setup(users: any[] = []) {
  const db: FakePrisma = fakePrisma();
  const svc = new FieldAppAccessService(db as any, { get: () => 'sk' } as any);
  const clerk = clerkStub(users);
  svc.setClerk(clerk);
  const worker = await db.worker.create({ data: { organizationId: ORG, name: 'Ali Bin Ahmad', phone: '91234567' } });
  return { db, svc, clerk, worker, users };
}

describe('e164', () => {
  it('8 digits is a Singapore number; other forms keep their country code', () => {
    expect(e164('91234567')).toBe('+6591234567');
    expect(e164('+65 9123 4567')).toBe('+6591234567');
    expect(e164('60123456789')).toBe('+60123456789');
    expect(e164('123')).toBeNull();
  });
});

describe('give app access', () => {
  it('no login for the phone: one is made, added to the org as field-tech and linked', async () => {
    const { db, svc, clerk, worker } = await setup();
    const out = await svc.give(ctx, worker.id);
    expect(out).toMatchObject({ phone: '+6591234567', madeLogin: true, addedMember: true, linked: true });
    expect(clerk.calls).toEqual(['create', 'stamp']);
    const w = await db.worker.findFirst({ where: { id: worker.id } });
    expect(w.userId).toBe('clerk-1');
    expect(await db.userOrganization.count({ where: { userId: 'clerk-1', organizationId: ORG } })).toBe(1);
    const role = await db.role.findFirst({ where: { name: APP_ROLE, organizationId: ORG } });
    expect(await db.userRole.count({ where: { userId: 'clerk-1', roleId: role.id } })).toBe(1);
  });

  it('a login that already works in the org keeps its roles; only the link is made, under its AIMS id', async () => {
    const { db, svc, clerk, worker } = await setup([{ id: 'clerk-9', externalId: 'aims-9', phone: '+6591234567' }]);
    await db.userOrganization.create({ data: { userId: 'aims-9', organizationId: ORG } });
    const admin = await db.role.create({ data: { name: 'Admin', organizationId: ORG } });
    await db.userRole.create({ data: { userId: 'aims-9', roleId: admin.id, organizationId: ORG } });
    const out = await svc.give(ctx, worker.id);
    expect(out).toMatchObject({ madeLogin: false, addedMember: false, linked: true });
    expect(clerk.calls).toEqual([]);
    expect(await db.userRole.count({ where: { userId: 'aims-9' } })).toBe(1);
    expect((await db.worker.findFirst({ where: { id: worker.id } })).userId).toBe('aims-9');
    // Doing it again changes nothing.
    expect(await svc.give(ctx, worker.id)).toMatchObject({ madeLogin: false, addedMember: false, linked: false });
  });

  it('refuses a worker with no phone, and a login already linked to another worker', async () => {
    const { db, svc, worker } = await setup([{ id: 'clerk-9', externalId: 'aims-9', phone: '+6591234567' }]);
    const nophone = await db.worker.create({ data: { organizationId: ORG, name: 'No Phone' } });
    await expect(svc.give(ctx, nophone.id)).rejects.toThrow(/phone number first/);
    await db.worker.create({ data: { organizationId: ORG, name: 'Twin', userId: 'aims-9' } });
    await expect(svc.give(ctx, worker.id)).rejects.toThrow(/already linked to Twin/);
  });
});
