import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UnitSwapService } from './unit-swap.service';

const ORG = 'org-bio';
const RUN = { id: 'run-76', deliveryNumber: 76, status: 'completed', direction: 'OUTBOUND', projectId: 'proj-1', documentId: 'do-1' };
const LINE = { id: 'di-1', inventoryId: 'u-old', assetId: 'a-firefly', deliveryStatus: 'completed', documentId: 'do-1' };
const OLD = { id: 'u-old', sku: 'AIS2026013', assetId: 'a-firefly', status: 'rental', organizationId: ORG, asset: { name: 'FIREFLY 4200' } };
const NEW = { id: 'u-new', sku: 'AIS2026021', assetId: 'a-firefly', status: 'instock', organizationId: ORG };
const DO = { id: 'do-1', name: 'DO202610082', projectId: 'proj-1', config: { items: [{ inventoryItemId: 'u-old', serialNumbers: ['AIS2026013'], description: 'FIREFLY 4200' }] } };
const ASG = { id: 'asg-old', projectId: 'proj-1', projectDeploymentId: 'dep-1', documentId: null, startDate: new Date('2026-10-08T00:00:00Z') };

function fake(opts: { flag?: boolean; roles?: string[]; openRunsOld?: number[]; newUnit?: any; drafts?: any[] } = {}) {
  const writes: Record<string, any[]> = {};
  const w = (k: string) => (args: any) => {
    (writes[k] ||= []).push(args);
    return Promise.resolve(k.endsWith('updateMany') ? { count: 1 } : { id: `${k}-id` });
  };
  const tx: any = {
    inventory: { updateMany: w('inventory.updateMany') },
    assignment: { update: w('assignment.update'), upsert: w('assignment.upsert') },
    deliveryItem: { updateMany: w('deliveryItem.updateMany') },
    maintenanceServiceReport: { updateMany: w('maintenanceServiceReport.updateMany') },
    document: { findUnique: async () => ({ config: DO.config }), update: w('document.update') },
    documentItem: { findMany: async () => [{ id: 'dit-1', sku: 'AIS2026013' }], update: w('documentItem.update') },
    timelineItem: { create: w('timelineItem.create') },
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: async () => ({ features: { enableDeliveryUnitSwap: opts.flag ?? true } }) },
    userRole: { findMany: async () => (opts.roles ?? ['Admin']).map((name) => ({ role: { name } })) },
    delivery: { findFirst: async () => RUN },
    deliveryItem: {
      findFirst: async () => LINE,
      findMany: async (args: any) => (args.where.inventoryId === 'u-old' ? (opts.openRunsOld ?? []).map((n) => ({ delivery: { deliveryNumber: n } })) : []),
    },
    inventory: { findFirst: async (args: any) => (args.where.id === 'u-old' ? OLD : opts.newUnit === undefined ? NEW : opts.newUnit) },
    document: { findFirst: async () => DO, findMany: async () => opts.drafts ?? [] },
    assignment: { findFirst: async () => ASG },
    $transaction: async (fn: any) => fn(tx),
  };
  const actionLog = { log: jest.fn(async () => undefined) };
  const docs = { logUnitSwapHistory: jest.fn(async () => undefined) };
  const svc = new UnitSwapService(prisma, docs as any, actionLog as any);
  return { svc, writes, actionLog, docs };
}

const body = { newInventoryId: 'u-new', reason: 'Wrong serial recorded on site' };
const admin = { id: 'user-admin', name: 'Office Admin' };

describe('UnitSwapService.swapUnit (enableDeliveryUnitSwap)', () => {
  it('flag off: 403', async () => {
    await expect(fake({ flag: false }).svc.swapUnit(ORG, RUN.id, LINE.id, body, admin)).rejects.toThrow(new ForbiddenException('Swap unit is not turned on for this organisation'));
  });
  it('a Manager is refused: 403 "Only an Admin can swap a unit"', async () => {
    await expect(fake({ roles: ['Manager'] }).svc.swapUnit(ORG, RUN.id, LINE.id, body, admin)).rejects.toThrow(new ForbiddenException('Only an Admin can swap a unit'));
  });
  it('osirisadmin passes the Admin check', async () => {
    await expect(fake({ roles: [] }).svc.swapUnit(ORG, RUN.id, LINE.id, body, { ...admin, isOsirisAdmin: true })).resolves.toMatchObject({ ok: true });
  });
  it('old unit on a scheduled return run: 400 naming the run', async () => {
    await expect(fake({ openRunsOld: [111] }).svc.swapUnit(ORG, RUN.id, LINE.id, body, admin)).rejects.toThrow(
      new BadRequestException('AIS2026013 is also on open delivery #111. Remove it from that run first'),
    );
  });
  it('different product / not in stock / blank reason: 400', async () => {
    await expect(fake({ newUnit: { ...NEW, assetId: 'a-lion' } }).svc.swapUnit(ORG, RUN.id, LINE.id, body, admin)).rejects.toThrow(/different product/);
    await expect(fake({ newUnit: { ...NEW, status: 'rental' } }).svc.swapUnit(ORG, RUN.id, LINE.id, body, admin)).rejects.toThrow(/not in stock/);
    await expect(fake().svc.swapUnit(ORG, RUN.id, LINE.id, { ...body, reason: ' ' }, admin)).rejects.toThrow('A reason is required');
  });
  it('happy path: every write, the Activity Log row, the DO history and the drafts to check', async () => {
    const drafts = [
      { id: 'inv-1', name: 'BI202611001', config: { items: [{ description: 'Rental of FIREFLY 4200 S/No.: AIS2026013' }] } },
      { id: 'inv-2', name: 'BI202611002', config: { items: [{ description: 'Transport' }] } },
    ];
    const { svc, writes, actionLog, docs } = fake({ drafts });
    const out = await svc.swapUnit(ORG, RUN.id, LINE.id, body, admin);

    expect(writes['inventory.updateMany']).toEqual([
      { where: { id: 'u-new', organizationId: ORG, status: 'instock' }, data: { status: 'rental' } },
      { where: { id: 'u-old', organizationId: ORG, status: { in: ['rental', 'sold'] } }, data: { status: 'instock' } },
    ]);
    expect(writes['assignment.update'][0]).toMatchObject({ where: { id: 'asg-old' }, data: { endDate: expect.any(Date) } });
    expect(writes['assignment.upsert'][0]).toMatchObject({
      where: { projectId_inventoryId: { projectId: 'proj-1', inventoryId: 'u-new' } },
      create: { projectId: 'proj-1', inventoryId: 'u-new', projectDeploymentId: 'dep-1', startDate: ASG.startDate, endDate: null },
    });
    expect(writes['deliveryItem.updateMany'][0]).toEqual({ where: { id: 'di-1', inventoryId: 'u-old' }, data: { inventoryId: 'u-new' } });
    expect(writes['maintenanceServiceReport.updateMany'][0].data).toEqual({ inventoryId: 'u-new' });
    expect(writes['document.update'][0].data.config.items[0]).toEqual({ inventoryItemId: 'u-new', serialNumbers: ['AIS2026021'], description: 'FIREFLY 4200' });
    expect(writes['documentItem.update'][0]).toEqual({ where: { id: 'dit-1' }, data: { itemId: 'u-new', inventoryId: 'u-new', sku: 'AIS2026021' } });
    expect(writes['timelineItem.create'].map((c: any) => c.data.inventoryId)).toEqual(['u-old', 'u-new']);
    expect(writes['timelineItem.create'][0].data.message).toMatch(/Reason: Wrong serial recorded on site/);

    expect(out.draftInvoicesToCheck).toEqual([{ id: 'inv-1', name: 'BI202611001' }]);
    expect(actionLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'USER',
        action: 'SWAP_UNIT',
        resource: 'deliveries',
        resourceId: RUN.id,
        details: { runNumber: 76, doName: 'DO202610082', product: 'FIREFLY 4200', fromSerial: 'AIS2026013', toSerial: 'AIS2026021', reason: 'Wrong serial recorded on site', draftInvoicesToCheck: ['BI202611001'] },
      }),
    );
    expect(docs.logUnitSwapHistory).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'do-1', detail: expect.stringContaining('AIS2026013 -> AIS2026021') }));
  });
});
