import { plannedRiderView, resolvePlannedRider, savePlannedRider } from './planned-rider';

const ORG = 'org-wct';
const fake = (o: { flag?: boolean; profiles?: any[]; members?: string[] } = {}) => {
  const updates: any[] = [];
  return {
    updates,
    prisma: {
      organizationUIConfig: { findUnique: async () => ({ features: { enableWctMyJobs: o.flag ?? true } }) },
      organizationMemberProfile: { findMany: async ({ where }: any) => (o.profiles ?? []).filter((p) => p.siteclockUserId === where.siteclockUserId) },
      userOrganization: { findFirst: async ({ where }: any) => ((o.members ?? []).includes(where.userId) ? { userId: where.userId } : null) },
      delivery: { update: async (a: any) => updates.push(a) },
    },
  };
};

describe('WCT My jobs: planned rider', () => {
  it('resolves the active WCT member linked to the SiteClock worker', async () => {
    const { prisma } = fake({ profiles: [{ userId: 'u-old', siteclockUserId: 'w1' }, { userId: 'u1', siteclockUserId: 'w1' }], members: ['u1'] });
    expect(await resolvePlannedRider(prisma, ORG, 'w1')).toEqual({ userId: 'u1' });
    expect(await resolvePlannedRider(prisma, ORG, 'w9')).toBeNull();
    expect(await resolvePlannedRider(prisma, ORG, null)).toBeNull();
  });

  it('stores the planned rider on a worker pick, clears it on a cleared pick, ignores saves without a pick', async () => {
    const f = fake({ profiles: [{ userId: 'u1', siteclockUserId: 'w1' }], members: ['u1'] });
    await savePlannedRider(f.prisma, ORG, 'd1', { siteclockWorkerId: 'w1', siteclockWorkerName: 'Babu' });
    await savePlannedRider(f.prisma, ORG, 'd1', { siteclockWorkerId: null, siteclockWorkerName: null });
    await savePlannedRider(f.prisma, ORG, 'd1', {});
    expect(f.updates.map((u) => u.data)).toEqual([
      { plannedRiderUserId: 'u1', plannedRiderName: 'Babu' },
      { plannedRiderUserId: null, plannedRiderName: null },
    ]);
  });

  it('does nothing when the flag is off', async () => {
    const f = fake({ flag: false, profiles: [{ userId: 'u1', siteclockUserId: 'w1' }], members: ['u1'] });
    await savePlannedRider(f.prisma, ORG, 'd1', { siteclockWorkerId: 'w1', siteclockWorkerName: 'Babu' });
    expect(f.updates).toHaveLength(0);
  });

  it('list view: isMe only for the planned user; null when nobody is planned', () => {
    expect(plannedRiderView({ plannedRiderUserId: 'u1', plannedRiderName: 'Babu' }, 'u1')).toEqual({ userId: 'u1', name: 'Babu', isMe: true });
    expect(plannedRiderView({ plannedRiderUserId: 'u1', plannedRiderName: 'Babu' }, 'u2')?.isMe).toBe(false);
    expect(plannedRiderView({ plannedRiderUserId: 'u1', plannedRiderName: 'Babu' }, undefined)?.isMe).toBe(false);
    expect(plannedRiderView({}, 'u1')).toBeNull();
  });
});
