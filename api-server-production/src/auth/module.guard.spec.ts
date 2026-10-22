/**
 * Round Y — the API refuses a module's endpoints for an org without that module (403), lets everything else through,
 * and reads the org the request is scoped to (the admin "viewing as" override included).
 */
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleGuard } from './module.guard';

const ctx = (meta: string | undefined, req: any) =>
  ({ getHandler: () => 'h', getClass: () => 'c', switchToHttp: () => ({ getRequest: () => req }), _meta: meta }) as any;

function build(rows: Array<{ organizationId: string; moduleCode: string; enabled: boolean }>) {
  const prisma: any = { organizationModule: { findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.organizationId === where.organizationId && r.moduleCode === where.moduleCode && r.enabled) ?? null) } };
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new ModuleGuard(reflector, prisma);
  const run = (meta: string | undefined, req: any) => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(meta);
    return guard.canActivate(ctx(meta, req));
  };
  return { guard, prisma, run };
}

describe('ModuleGuard', () => {
  const ROWS = [{ organizationId: 'org-adh', moduleCode: 'SHIPMENTS', enabled: true }, { organizationId: 'org-biofuel', moduleCode: 'ACCOUNTING', enabled: true }, { organizationId: 'org-biofuel', moduleCode: 'SHIPMENTS', enabled: false }];

  it('ADH (module on) passes; Biofuel (row disabled) and an org with no row get 403', async () => {
    const { run } = build(ROWS);
    expect(await run('SHIPMENTS', { userOrganization: { id: 'org-adh' }, method: 'GET', url: '/shipments' })).toBe(true);
    await expect(run('SHIPMENTS', { userOrganization: { id: 'org-biofuel' }, method: 'GET', url: '/shipments' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run('SHIPMENTS', { userOrganization: { id: 'org-new' }, method: 'GET', url: '/shipments' })).rejects.toThrow(/SHIPMENTS module is not enabled/);
  });

  it('routes without @RequiresModule and requests without an organization (public routes, webhooks) are untouched', async () => {
    const { run, prisma } = build(ROWS);
    expect(await run(undefined, { userOrganization: { id: 'org-biofuel' } })).toBe(true);
    expect(await run('SHIPMENTS', { userOrganization: null })).toBe(true);
    expect(prisma.organizationModule.findFirst).not.toHaveBeenCalled();
  });

  it('an osiris admin viewing as Biofuel is refused too (the request is scoped to Biofuel); the answer is cached and can be forgotten', async () => {
    const { guard, run, prisma } = build(ROWS);
    await expect(run('SHIPMENTS', { userOrganization: { id: 'org-biofuel' }, isOsirisAdmin: true, method: 'GET', url: '/trade-orders' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run('SHIPMENTS', { userOrganization: { id: 'org-biofuel' }, isOsirisAdmin: true, method: 'GET', url: '/trade-orders' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.organizationModule.findFirst).toHaveBeenCalledTimes(1);
    guard.forget('org-biofuel', 'SHIPMENTS');
    await expect(run('SHIPMENTS', { userOrganization: { id: 'org-biofuel' } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.organizationModule.findFirst).toHaveBeenCalledTimes(2);
  });
});
