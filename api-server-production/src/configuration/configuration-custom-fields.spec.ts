import { ConfigurationService } from './configuration.service';

// 2026-11-01: the generic custom-field routes are scoped to the caller's org,
// and saving values uses that org (it used to read values.organizationId).
describe('ConfigurationService custom fields (org scope)', () => {
  const fields = [
    { id: 'mine', organizationId: 'org-a', entityType: 'Asset', fieldName: 'warranty', isActive: true },
    { id: 'theirs', organizationId: 'org-b', entityType: 'Asset', fieldName: 'warranty', isActive: true },
  ];
  const writes: any[] = [];
  const prisma: any = {
    customField: {
      findFirst: async ({ where }: any) => fields.find((f) => f.id === where.id && f.organizationId === where.organizationId) ?? null,
      findMany: async ({ where }: any) => fields.filter((f) => f.organizationId === where.organizationId && (!where.entityType || f.entityType === where.entityType)),
      update: async (a: any) => (writes.push(['update', a]), a),
    },
    customFieldValue: {
      upsert: async (a: any) => (writes.push(['upsert', a]), a),
      findMany: async (a: any) => (writes.push(['read', a]), []),
    },
  };
  const svc = new ConfigurationService(prisma);

  beforeEach(() => writes.splice(0));

  it("another org's field id is not found, never edited or deleted", async () => {
    await expect(svc.updateCustomField('org-a', 'theirs', { displayLabel: 'x' } as any)).rejects.toThrow(/not found/);
    await expect(svc.deleteCustomField('org-a', 'theirs')).rejects.toThrow(/not found/);
    expect(writes).toHaveLength(0);
    await svc.updateCustomField('org-a', 'mine', { displayLabel: 'Warranty' } as any);
    expect(writes).toHaveLength(1);
  });

  it("values are saved against the caller's org fields only", async () => {
    await svc.setCustomFieldValues('org-a', 'asset-1', 'Asset', { warranty: '2027-01-01' });
    expect(writes.filter((w) => w[0] === 'upsert').map((w) => w[1].create.customFieldId)).toEqual(['mine']);
  });

  it("values are read through the caller's org fields", async () => {
    await svc.getCustomFieldValues('org-a', 'asset-1', 'Asset');
    expect(writes[0][1].where.customField).toEqual({ organizationId: 'org-a' });
  });
});
