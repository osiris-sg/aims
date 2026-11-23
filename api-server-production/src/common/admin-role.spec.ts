import { hasAdminRole, isAdminRoleName, isFieldTechOnly, isFieldTechOnlyRoleNames } from './admin-role';

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

describe('Field-tech only (enableOfficeDoEdits delivered / signed DO, 2026-11-24)', () => {
  it('a user whose only role is field-tech is field-tech only', async () => {
    expect(await isFieldTechOnly(prismaWith(['field-tech']), 'o', 'u')).toBe(true);
    expect(await isFieldTechOnly(prismaWith(['field-tech', ' FIELD-TECH ']), 'o', 'u')).toBe(true);
  });
  it('Admin, normal_user, Manager, field-tech plus an office role, no role (global osirisadmin) and no user are not', async () => {
    for (const n of [['Admin'], ['normal_user'], ['Manager'], ['field-tech', 'Admin'], ['field-tech', 'normal_user'], []]) {
      expect(await isFieldTechOnly(prismaWith(n), 'o', 'u')).toBe(false);
    }
    expect(await isFieldTechOnly(prismaWith(['field-tech']), 'o', null)).toBe(false);
    expect(isFieldTechOnlyRoleNames([null, ''])).toBe(false);
  });
});
