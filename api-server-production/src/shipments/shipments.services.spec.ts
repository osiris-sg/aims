import { TradeConfigService } from './trade-config.service';
import { TradeDocumentsService } from './trade-documents.service';
import { TradeFilesService } from './trade-files.service';
import { TradeStepsService } from './trade-steps.service';

/**
 * Service-level checks of the step / unlink rules with a stubbed Prisma: the
 * interactive transaction just runs the callback against the same stub.
 */
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const actor = { id: 'user_1', name: 'Test User' };

function makePrisma(models: Record<string, Record<string, jest.Mock>>) {
  const prisma: any = { ...models };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

const docTypes = { findMany: jest.fn().mockResolvedValue([{ code: 'BL_DRAFT', label: 'B/L draft' }]), findFirst: jest.fn() };

describe('TradeStepsService.complete', () => {
  const baseStep = {
    id: 'step-1',
    title: 'B/L draft approval',
    status: 'IN_PROGRESS',
    requiredDocTypes: ['BL_DRAFT'],
    contractId: null,
    shipmentId: 'ship-1',
    contract: null,
    shipment: { blNumber: 'TEST-198GX04630', status: 'OPEN' },
  };

  /** docLinks: in-app documents linked to the shipment; docs: the Document rows that still exist. */
  function setup(step: any, linkedTypes: string[], docLinks: Array<{ docType: string; documentId: string }> = [], docs: Array<{ id: string; config: any }> = []) {
    const prisma = makePrisma({
      tradeStep: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(step)
          .mockResolvedValue({ ...step, status: 'DONE' }),
        update: jest.fn().mockResolvedValue({}),
      },
      tradeFileLink: { findMany: jest.fn().mockResolvedValue(linkedTypes.map((t) => ({ file: { docType: t } }))) },
      tradeDocumentLink: { findMany: jest.fn().mockResolvedValue(docLinks) },
      document: { findMany: jest.fn().mockResolvedValue(docs) },
      tradeDocType: docTypes,
      // syncSteps after the change reads the record; null = nothing more to do here.
      shipment: { findFirst: jest.fn().mockResolvedValue(null) },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = new TradeStepsService(prisma, new TradeConfigService(prisma));
    return { prisma, service };
  }

  it('refuses when a required doc type is not linked to the same shipment, naming its label', async () => {
    const { prisma, service } = setup(baseStep, []);
    await expect(service.complete(ORG, 'step-1', actor)).rejects.toThrow(/missing required document\(s\) on this shipment: B\/L draft/);
    expect(prisma.tradeStep.update).not.toHaveBeenCalled();
    expect(prisma.tradeFileLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, shipmentId: 'ship-1' } }));
  });

  it('marks DONE with completedAt and the actor once the file is linked', async () => {
    const { prisma, service } = setup(baseStep, ['BL_DRAFT']);
    await service.complete(ORG, 'step-1', actor);
    const data = prisma.tradeStep.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'DONE', skipReason: null, updatedById: 'user_1', updatedByName: 'Test User' });
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('refuses any change while the shipment is completed', async () => {
    const { prisma, service } = setup({ ...baseStep, shipment: { blNumber: 'X', status: 'COMPLETED' } }, ['BL_DRAFT']);
    await expect(service.complete(ORG, 'step-1', actor)).rejects.toThrow(/completed — reopen it before changing steps/);
    expect(prisma.tradeStep.update).not.toHaveBeenCalled();
  });

  it('counts a linked CONFIRMED in-app invoice as the required type', async () => {
    const invStep = { ...baseStep, title: 'Issue Invoice #2', requiredDocTypes: ['INVOICE_2'] };
    const { prisma, service } = setup(invStep, [], [{ docType: 'INVOICE_2', documentId: 'doc-1' }], [{ id: 'doc-1', status: 'confirmed', config: {} } as any]);
    await service.complete(ORG, 'step-1', actor);
    expect(prisma.tradeStep.update.mock.calls[0][0].data).toMatchObject({ status: 'DONE' });
  });

  it('does not count a draft / unconfirmed invoice', async () => {
    const invStep = { ...baseStep, title: 'Issue Invoice #2', requiredDocTypes: ['INVOICE_2'] };
    for (const status of ['draft', 'unconfirmed']) {
      const { prisma, service } = setup(invStep, [], [{ docType: 'INVOICE_2', documentId: 'doc-1' }], [{ id: 'doc-1', status, config: {} } as any]);
      await expect(service.complete(ORG, 'step-1', actor)).rejects.toThrow(/missing required document/);
      expect(prisma.tradeStep.update).not.toHaveBeenCalled();
    }
  });

  it('ignores a linked invoice that was voided or deleted', async () => {
    const invStep = { ...baseStep, title: 'Issue Invoice #2', requiredDocTypes: ['INVOICE_2'] };
    const voided = setup(invStep, [], [{ docType: 'INVOICE_2', documentId: 'doc-1' }], [{ id: 'doc-1', status: 'confirmed', config: { voided: true } } as any]);
    await expect(voided.service.complete(ORG, 'step-1', actor)).rejects.toThrow(/missing required document/);
    const deleted = setup(invStep, [], [{ docType: 'INVOICE_2', documentId: 'doc-gone' }], []);
    await expect(deleted.service.complete(ORG, 'step-1', actor)).rejects.toThrow(/missing required document/);
  });

  it('has no skip path any more', () => {
    const { service } = setup(baseStep, []);
    expect((service as any).skip).toBeUndefined();
  });

  it('reopen clears completedAt (and any legacy skip reason)', async () => {
    const { prisma, service } = setup({ ...baseStep, status: 'DONE' }, []);
    await service.reopen(ORG, 'step-1', actor);
    expect(prisma.tradeStep.update.mock.calls[0][0].data).toMatchObject({ status: 'IN_PROGRESS', completedAt: null, skipReason: null });
  });
});

describe('TradeFilesService.removeLink', () => {
  const link = {
    id: 'link-1',
    contractId: null,
    shipmentId: 'ship-1',
    contract: null,
    shipment: { blNumber: 'TEST-198GX04630', status: 'OPEN' },
  };

  function setup(doneSteps: any[], otherLinkTypes: string[], linkRow: any = link) {
    const prisma = makePrisma({
      tradeFileLink: {
        findFirst: jest.fn().mockResolvedValue(linkRow),
        // Without the NOT (round N: "present before" the removal) the file being removed (a BL_DRAFT) counts too.
        findMany: jest.fn(async ({ where }: any) => [...otherLinkTypes, ...(where?.NOT ? [] : ['BL_DRAFT'])].map((t) => ({ file: { docType: t } }))),
        delete: jest.fn().mockResolvedValue({}),
      },
      tradeStep: { findMany: jest.fn().mockResolvedValue(doneSteps) },
      tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      tradeFile: { findFirst: jest.fn().mockResolvedValue({ id: 'file-1', docType: 'BL_DRAFT', links: [] }) },
      tradeDocType: docTypes,
    });
    const s3: any = { deleteFile: jest.fn() };
    const service = new TradeFilesService(prisma, s3, new TradeConfigService(prisma), { make: jest.fn(async () => null) } as any);
    return { prisma, service };
  }

  const doneStep = { id: 'step-1', title: 'B/L draft approval', status: 'DONE', isOngoing: false, requiredDocTypes: ['BL_DRAFT'] };

  it('refuses when a DONE step on that shipment would lose its required type, naming the step', async () => {
    const { prisma, service } = setup([doneStep], []);
    await expect(service.removeLink(ORG, 'file-1', 'link-1')).rejects.toThrow(/"B\/L draft approval" on shipment TEST-198GX04630 \(needs B\/L draft\)/);
    expect(prisma.tradeFileLink.delete).not.toHaveBeenCalled();
    // Remaining files are counted on the same shipment, excluding this file.
    expect(prisma.tradeFileLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, shipmentId: 'ship-1', NOT: { fileId: 'file-1' } } }));
  });

  it('allows it when another file of that type is still linked', async () => {
    const { prisma, service } = setup([doneStep], ['BL_DRAFT']);
    await service.removeLink(ORG, 'file-1', 'link-1');
    expect(prisma.tradeFileLink.delete).toHaveBeenCalledWith({ where: { id: 'link-1', organizationId: ORG } });
  });

  it('round N: a done step that was ALREADY missing a type (imported "done before AIMS") is not blocked by removing another type', async () => {
    // #15-1: steps 3a–7 done by the task-list import with no files; removing a DELIVERY_NOTE breaks none of them.
    const imported = [
      { id: 's3a', title: 'Approve B/L draft', status: 'DONE', isOngoing: false, requiredDocTypes: ['BL_DRAFT'] },
      { id: 's3b', title: 'Receive shipping documents', status: 'DONE', isOngoing: false, requiredDocTypes: ['BL', 'CI', 'PL'] },
      { id: 's7', title: 'Customs documents & tax estimate', status: 'DONE', isOngoing: false, requiredDocTypes: ['SGJP_IV_PL', 'TAX_ESTIMATE'] },
    ];
    const prisma = makePrisma({
      tradeFileLink: {
        findFirst: jest.fn().mockResolvedValue(link),
        findMany: jest.fn(async ({ where }: any) => (where?.NOT ? [] : [{ file: { docType: 'DELIVERY_NOTE' } }])),
        delete: jest.fn().mockResolvedValue({}),
      },
      tradeStep: { findMany: jest.fn().mockResolvedValue(imported) },
      tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      tradeFile: { findFirst: jest.fn().mockResolvedValue({ id: 'file-1', docType: 'DELIVERY_NOTE', links: [] }) },
      tradeDocType: docTypes,
    });
    const service = new TradeFilesService(prisma, { deleteFile: jest.fn() } as any, new TradeConfigService(prisma), { make: jest.fn(async () => null) } as any);
    await service.removeLink(ORG, 'file-1', 'link-1');
    expect(prisma.tradeFileLink.delete).toHaveBeenCalledWith({ where: { id: 'link-1', organizationId: ORG } });
  });

  it('refuses on a completed shipment', async () => {
    const { prisma, service } = setup([], [], { ...link, shipment: { blNumber: 'X', status: 'COMPLETED' } });
    await expect(service.removeLink(ORG, 'file-1', 'link-1')).rejects.toThrow(/is completed — reopen it first/);
    expect(prisma.tradeFileLink.delete).not.toHaveBeenCalled();
  });
});

describe('TradeDocumentsService.unlink', () => {
  const docLink = {
    id: 'dl-1',
    contractId: 'con-1',
    shipmentId: null,
    contract: { contractNo: 'TEST-454003422', status: 'OPEN' },
    shipment: null,
  };
  const doneInv1 = { id: 'step-9', title: 'Issue Invoice #1', status: 'DONE', isOngoing: false, requiredDocTypes: ['INVOICE_1'] };

  function setup(doneSteps: any[], otherDocLinks: Array<{ docType: string; documentId: string }>, files: string[] = []) {
    const prisma = makePrisma({
      tradeDocumentLink: {
        findFirst: jest.fn().mockResolvedValue(docLink),
        // Without the NOT (round N: "present before" the removal) the invoice link being removed counts too.
        findMany: jest.fn(async ({ where }: any) => [...otherDocLinks, ...(where?.NOT ? [] : [{ docType: 'INVOICE_1', documentId: 'doc-removed' }])]),
        delete: jest.fn().mockResolvedValue({}),
      },
      tradeFileLink: { findMany: jest.fn().mockResolvedValue(files.map((t) => ({ file: { docType: t } }))) },
      document: { findMany: jest.fn(async ({ where }: any) => (where?.id?.in ?? []).map((id: string) => ({ id, status: 'confirmed', config: {} }))) },
      tradeStep: { findMany: jest.fn().mockResolvedValue(doneSteps) },
      tradeDocType: { findMany: jest.fn().mockResolvedValue([{ code: 'INVOICE_1', label: 'Invoice #1' }]) },
    });
    const config = new TradeConfigService(prisma);
    const service = new TradeDocumentsService(prisma, config, new TradeFilesService(prisma, {} as any, config, { make: jest.fn(async () => null) } as any));
    return { prisma, service };
  }

  it('refuses while a DONE step still needs that invoice, naming the step', async () => {
    const { prisma, service } = setup([doneInv1], []);
    await expect(service.unlink(ORG, 'dl-1')).rejects.toThrow(/"Issue Invoice #1" on contract TEST-454003422 \(needs Invoice #1\)/);
    expect(prisma.tradeDocumentLink.delete).not.toHaveBeenCalled();
    // The link being removed is excluded when counting what remains.
    expect(prisma.tradeDocumentLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, contractId: 'con-1', NOT: { id: 'dl-1' } } }));
  });

  it('allows it when a file of that type still covers the step', async () => {
    const { prisma, service } = setup([doneInv1], [], ['INVOICE_1']);
    await service.unlink(ORG, 'dl-1');
    expect(prisma.tradeDocumentLink.delete).toHaveBeenCalledWith({ where: { id: 'dl-1', organizationId: ORG } });
  });
});
