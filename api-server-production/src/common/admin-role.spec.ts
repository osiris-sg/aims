import { hasAdminRole, isAdminRoleName } from './admin-role';

const prismaWith = (names: string[]) => ({ userRole: { findMany: async () => names.map((name) => ({ role: { name } })) } });

describe('Admin only (enableOfficeDoEdits / enableDeliveryUnitSwap)', () => {
  it('Admin, superadmin and osirisadmin pass', async () => {
    for (const n of ['Admin', 'superadmin', 'osirisadmin']) expect(await hasAdminRole(prismaWith([n]), 'o', 'u')).toBe(true);
    expect(await hasAdminRole(prismaWith(['field-tech', 'Admin']), 'o', 'u')).toBe(true);
  });
  it('Manager, field-tech, normal_user, no role and no user are refused', async () => {
    for (const n of ['Manager', 'field-tech', 'normal_user']) expect(await hasAdminRole(prismaWith([n]), 'o', 'u')).toBe(false);
    expect(await hasAdminRole(prismaWith([]), 'o', 'u')).toBe(false);
    expect(await hasAdminRole(prismaWith(['Admin']), 'o', null)).toBe(false);
    expect(isAdminRoleName(' ADMIN ')).toBe(true);
  });
});
