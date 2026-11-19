jest.mock('../orders/manual-order-flow', () => ({ ...jest.requireActual('../orders/manual-order-flow'), isManualOrderFlow: jest.fn().mockResolvedValue(true) }));

import { assertDocNotErpImportedDo, assertNotErpImportedDo, IMPORTED_DO_READ_ONLY, isErpImportedDo } from '../common/erp-import';
import { DocumentsService } from './documents.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { PublicDocumentService } from '../public-document/public-document.service';
import { PublicDeliveryService } from '../public-delivery/public-delivery.service';

// Imported old-ERP delivery orders (WCT 2026-11-19, scripts/wct-erp-dos.js) are read-only: every DO
// entry point refuses them before anything is written; native DOs and other imported documents pass.
const erp = { erpImport: { source: 'wct-erp', batch: 'wct-erp-dos-2026-11-19', erpId: '12394', originalNumber: 'DO012360', status: 'Issued' } };
const importedDo = { id: 'do-1', name: 'DO012360', type: 'DELIVERY_ORDER', status: 'delivered_installed', organizationId: 'org', config: { ...erp, orderId: 'ord-1', items: [{ description: 'x', quantity: 1 }] } };
const nativeDo = { ...importedDo, id: 'do-2', name: 'DO202611030', status: 'unconfirmed', config: { orderId: 'ord-1', items: [{ description: 'x', quantity: 1 }] } };
const importedInvoice = { ...importedDo, id: 'inv-1', name: 'I-015300', type: 'INVOICE', status: 'paid', config: { ...erp } };
const readOnly = expect.objectContaining({ message: expect.stringContaining(IMPORTED_DO_READ_ONLY) });

describe('imported DO guard helpers', () => {
  it('only a DELIVERY_ORDER / DO with the erpImport marker is an imported DO', () => {
    expect(isErpImportedDo(importedDo)).toBe(true);
    expect(isErpImportedDo({ ...importedDo, type: 'DO' })).toBe(true);
    expect(isErpImportedDo(nativeDo)).toBe(false);
    expect(isErpImportedDo(importedInvoice)).toBe(false);
    expect(isErpImportedDo({ type: 'QUOTATION', config: erp })).toBe(false);
    expect(isErpImportedDo(null)).toBe(false);
    expect(isErpImportedDo({ type: 'DELIVERY_ORDER', config: { erpImport: { source: '' } } })).toBe(false);
  });

  it('refuses with a 400 and the read-only message; anything else passes', async () => {
    expect(() => assertNotErpImportedDo(importedDo)).toThrow(IMPORTED_DO_READ_ONLY);
    try { assertNotErpImportedDo(importedDo); } catch (e: any) { expect(e.getStatus()).toBe(400); }
    expect(() => assertNotErpImportedDo(nativeDo)).not.toThrow();
    expect(() => assertNotErpImportedDo(importedInvoice)).not.toThrow();
    const prisma: any = { document: { findFirst: jest.fn().mockResolvedValueOnce(importedDo).mockResolvedValueOnce(nativeDo).mockResolvedValueOnce(null) } };
    await expect(assertDocNotErpImportedDo(prisma, 'org', 'do-1')).rejects.toThrow(IMPORTED_DO_READ_ONLY);
    await expect(assertDocNotErpImportedDo(prisma, 'org', 'do-2')).resolves.toBeUndefined();
    await expect(assertDocNotErpImportedDo(prisma, 'org', 'missing')).resolves.toBeUndefined();
    await expect(assertDocNotErpImportedDo(prisma, 'org', null)).resolves.toBeUndefined();
    expect(prisma.document.findFirst).toHaveBeenCalledWith({ where: { id: 'do-1', organizationId: 'org' }, select: { type: true, config: true } });
  });
});

describe('DocumentsService refuses imported DOs', () => {
  const make = (doc: any) => {
    const svc: any = Object.create(DocumentsService.prototype);
    svc.prisma = {
      document: { findUnique: jest.fn().mockResolvedValue(doc), findFirst: jest.fn().mockResolvedValue(doc), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
      documentItem: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      deliveryItem: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { count: jest.fn().mockResolvedValue(0) },
      journalEntry: { count: jest.fn().mockResolvedValue(0) },
    };
    return svc;
  };

  it('editor save / status change', async () => {
    const svc = make(importedDo);
    await expect(svc.updateDocument({ id: 'do-1', config: { ...importedDo.config, items: [] }, status: 'unconfirmed' } as any, 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.document.update).not.toHaveBeenCalled();
  });

  it('a native DO save is not refused by the guard', async () => {
    const svc = make(nativeDo);
    const err = await svc.updateDocument({ id: 'do-2', config: nativeDo.config } as any, 'org').catch((e: any) => e);
    expect(String(err?.message ?? '')).not.toContain(IMPORTED_DO_READ_ONLY);
  });

  it('delete (also the internal force delete)', async () => {
    for (const force of [false, true]) {
      const svc = make(importedDo);
      await expect(svc.deleteDocument('do-1', 'org', undefined, { force })).rejects.toThrow(readOnly);
      expect(svc.prisma.document.delete).not.toHaveBeenCalled();
    }
  });

  it('confirm DO, bulk-complete DO, revision, project link', async () => {
    let svc = make(importedDo);
    await expect(svc.confirmDeliveryOrder('do-1', { fromDONo: '', toDONo: '' }, 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.document.update).not.toHaveBeenCalled();
    svc = make(importedDo);
    await expect(svc.bulkCompleteDeliveryOrder('do-1', 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.documentItem.findMany).not.toHaveBeenCalled();
    svc = make(importedDo);
    await expect(svc.assertRevisable(importedDo, 'org')).rejects.toThrow(readOnly);
    svc = make(importedDo);
    await expect(svc.linkProjectToDocument('do-1', 'p1', 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.document.update).not.toHaveBeenCalled();
  });

  it('the completion gate never completes an imported DO or makes its invoice', async () => {
    const svc = make(importedDo);
    await expect(svc.maybeCompleteDeliveryOrderAndInvoice('do-1', 'org')).resolves.toBeNull();
    expect(svc.prisma.documentItem.findMany).not.toHaveBeenCalled();
    expect(svc.prisma.document.update).not.toHaveBeenCalled();
    // A native DO still goes on to read its items.
    const nat = make(nativeDo);
    await nat.maybeCompleteDeliveryOrderAndInvoice('do-2', 'org').catch(() => null);
    expect(nat.prisma.documentItem.findMany).toHaveBeenCalled();
  });
});

describe('DeliveriesService refuses imported DOs', () => {
  const make = (doc: any) => {
    const svc: any = Object.create(DeliveriesService.prototype);
    svc.prisma = {
      document: { findFirst: jest.fn().mockResolvedValue(doc), update: jest.fn() },
      delivery: { findFirst: jest.fn().mockResolvedValue({ id: 'run-1', status: 'scheduled', items: [{ id: 'it-1', documentId: null, inventoryId: null }] }), create: jest.fn(), update: jest.fn() },
      deliveryItem: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn(), update: jest.fn() },
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'ord-1', status: 'DO_DRAFT' }) },
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      organizationUIConfig: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
    };
    return svc;
  };

  it('Add job, Complete DO (sign here / signed DO / sign link), link a run, open a run', async () => {
    let svc = make(importedDo);
    await expect(svc.createJobForDo('org', 'do-1')).rejects.toThrow(readOnly);
    expect(svc.prisma.delivery.create).not.toHaveBeenCalled();
    for (const mode of ['signature', 'stamped_do', 'sign_link']) {
      svc = make(importedDo);
      await expect(svc.officeCompleteDo('org', 'do-1', { mode, signature: 'data:image/png;base64,AAAA', recipientName: 'X' }, { id: 'u1', name: 'U' })).rejects.toThrow(readOnly);
      expect(svc.prisma.document.update).not.toHaveBeenCalled();
      expect(svc.prisma.delivery.create).not.toHaveBeenCalled();
    }
    svc = make(importedDo);
    await expect(svc.link('run-1', 'do-1', 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.deliveryItem.updateMany).not.toHaveBeenCalled();
    svc = make(importedDo);
    await expect(svc.ensureOpenRunForDo('do-1', 'org', 'rider', null, { assetId: 'a', inventoryId: 'i' })).rejects.toThrow(readOnly);
    expect(svc.prisma.delivery.findFirst).not.toHaveBeenCalled();
  });

  it('a native DO is not refused by the guard', async () => {
    const svc = make(nativeDo);
    const err = await svc.createJobForDo('org', 'do-2').catch((e: any) => e);
    expect(String(err?.message ?? '')).not.toContain(IMPORTED_DO_READ_ONLY);
  });
});

describe('sign links refuse imported DOs', () => {
  it('office share / sign link and the public sign', async () => {
    const svc: any = Object.create(PublicDocumentService.prototype);
    svc.prisma = {
      document: { findFirst: jest.fn().mockResolvedValue(importedDo) },
      documentShareLink: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findUnique: jest.fn().mockResolvedValue({ documentId: 'do-1', revokedAt: null, document: { organizationId: 'org' } }) },
    };
    await expect(svc.generateForDocument('do-1', 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.documentShareLink.create).not.toHaveBeenCalled();
    await expect(svc.publicSign('tok', { name: 'A', signature: 'data:image/png;base64,AAAA' }, { ip: '1', userAgent: 'x' })).rejects.toThrow(readOnly);
  });

  it('guest delivery link', async () => {
    const svc: any = Object.create(PublicDeliveryService.prototype);
    svc.prisma = { document: { findFirst: jest.fn().mockResolvedValue(importedDo) }, deliveryItem: { findFirst: jest.fn() } };
    await expect(svc.generateForDocument('do-1', 'org')).rejects.toThrow(readOnly);
    expect(svc.prisma.deliveryItem.findFirst).not.toHaveBeenCalled();
  });
});
