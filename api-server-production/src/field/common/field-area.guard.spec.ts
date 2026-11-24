import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fakePrisma } from '../testing/fake-prisma';
import { FieldAreaGuard, FIELD_AREA_KEY } from './field-area.guard';
import { FieldContextService } from './field-context.service';
import { ALL_FIELD_FLAGS, fieldAreaOn, fieldEngineLive } from './field-flags';

async function run(features: Record<string, unknown>, roles: string[], meta: any) {
  const db: any = fakePrisma();
  await db.organizationUIConfig.create({ data: { organizationId: 'o', features } });
  for (const name of roles) {
    const role = await db.role.create({ data: { name, organizationId: 'o' } });
    await db.userRole.create({ data: { userId: 'u', roleId: role.id, organizationId: 'o', isActive: true, role: { name } } });
  }
  const reflector = { getAllAndOverride: () => meta } as unknown as Reflector;
  const guard = new FieldAreaGuard(reflector, new FieldContextService(db));
  const req: any = { userOrganization: { id: 'o' }, user: { id: 'u', firstName: 'Ann' } };
  const ctx: any = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) };
  await guard.canActivate(ctx);
  return req.field;
}

describe('FieldAreaGuard (FIELD_PLAN.md §2)', () => {
  const on = { enableFieldModule: true, enableFieldPeople: true };
  it('flag off: the route does not exist (404), also with only one of the two flags', async () => {
    await expect(run({}, ['Admin'], { area: 'people', level: 'view' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run({ enableFieldPeople: true }, ['Admin'], { area: 'people', level: 'view' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run({ enableFieldModule: true }, ['Admin'], { area: 'people', level: 'view' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run(on, ['Admin'], { area: 'payroll', level: 'view' })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('on: Admin passes; Sales has no Field access (403); a route without @FieldRoute is refused', async () => {
    const f = await run(on, ['Admin'], { area: 'people', level: 'edit' });
    expect(f.access.admin).toBe(true);
    expect(f.userName).toBe('Ann');
    await expect(run(on, ['Sales'], { area: 'people', level: 'view' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(on, ['Operations'], { area: 'people', level: 'edit' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(on, ['Admin'], undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('the engine switch needs the module too; every flag key is listed', () => {
    expect(fieldEngineLive({ fieldEngineLive: true })).toBe(false);
    expect(fieldEngineLive({ enableFieldModule: true, fieldEngineLive: true })).toBe(true);
    expect(fieldAreaOn({ enableFieldModule: true, enableFieldPeople: true }, 'people')).toBe(true);
    expect(ALL_FIELD_FLAGS).toHaveLength(9);
    expect(FIELD_AREA_KEY).toBe('fieldArea');
  });
});

// Custom access orgs (2026-11-24): the HR tabs of the tab map decide, not the role names.
describe('field access from a tab map', () => {
  const { computeFieldAccess, grantFromTabMap } = require('./field-access');
  const { PRESET_TAB_ACCESS, noAccess, readTabAccess, fullAccess } = require('../../access/tab-access');

  it('a person cut down from Admin by their own Custom access gets only what the map gives', () => {
    const map = { ...noAccess(), hrTimesheets: 'view' };
    const a = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false, grant: grantFromTabMap(map), customAccessOrg: true });
    expect(a.admin).toBe(false);
    expect(a.levels.timesheets).toBe('view');
    expect(a.levels.payroll).toBe('none');
    expect(a.levels.punches).toBe('none');
  });

  it('no roles is Admin only outside custom access orgs', () => {
    expect(computeFieldAccess({ isOsirisAdmin: false, roleNames: [], supervises: false }).admin).toBe(true);
    const a = computeFieldAccess({ isOsirisAdmin: false, roleNames: [], supervises: false, customAccessOrg: true });
    expect(a.admin).toBe(false);
    expect(a.levels.people).toBe('none');
  });

  it('a supervisor keeps their own-sites grant on top of the map, scoped', () => {
    const a = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Site HR'], supervises: true, grant: grantFromTabMap({ ...noAccess(), hrPayroll: 'edit' }), customAccessOrg: true });
    expect(a.levels.payroll).toBe('edit');
    expect(a.levels.punches).toBe('approve');
    expect(a.scoped.punches).toBe(true);
    expect(a.scoped.payroll).toBe(false);
  });

  it('the preset tables give the same HR levels the role names do', () => {
    for (const name of ['Operations', 'Accounting', 'Viewer', 'Sales']) {
      const byName = computeFieldAccess({ isOsirisAdmin: false, roleNames: [name], supervises: false }).levels;
      const byMap = computeFieldAccess({ isOsirisAdmin: false, roleNames: [name], supervises: false, grant: grantFromTabMap(PRESET_TAB_ACCESS[name]), customAccessOrg: true }).levels;
      expect(byMap).toEqual(byName);
    }
    expect(Object.values(grantFromTabMap(fullAccess())).every((l) => l !== 'none')).toBe(true);
  });

  it('a map saved before the HR tabs existed reads as no HR access', () => {
    const old = readTabAccess({ sales: 'edit', orders: 'view' });
    expect(old.sales).toBe('edit');
    expect(Object.values(grantFromTabMap(old)).every((l) => l === 'none')).toBe(true);
  });

  it('the platform admin is never narrowed', () => {
    expect(computeFieldAccess({ isOsirisAdmin: true, roleNames: [], supervises: false, grant: grantFromTabMap(noAccess()), customAccessOrg: true }).levels.payroll).toBe('approve');
  });
});
