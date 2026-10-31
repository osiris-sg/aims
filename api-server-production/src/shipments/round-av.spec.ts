import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { OrdersController } from './orders.controller';
import { ShipmentsController } from './shipments.controller';
import { EmailInboxController } from '../ingestion-email/email-inbox.controller';
import { ShipmentsService } from './shipments.service';

// The ADH Sales role (prod role b3045e64…, read 2026-10-31): its permissions as the guard checks them.
const ADH_SALES = 'customers:create,customers:create-by-name,customers:delete,customers:read,customers:read-one,customers:update,documentTemplates:read,documentTemplates:read-one,documents:create-basic,documents:create-revision,documents:create-with-timeline,documents:delete,documents:generate-pdf,documents:payment-summary,documents:read,documents:read-by-asset,documents:read-by-inventory,documents:read-one,documents:send-email,documents:tag-template-to-asset,documents:untag-template-from-asset,documents:update,payments:create,payments:delete,payments:read,payments:update,shipments:create,shipments:delete,shipments:read,shipments:update,suppliers:create,suppliers:delete,suppliers:read,suppliers:read-one,suppliers:update,uploads:upload-image,users:read,users:read-roles'.split(',');
/** ClerkAuthGuard's rule: a role passes when it has every required resource:action (or a wildcard). */
const allows = (perms: string[], required: string[]) =>
  required.every((r) => {
    const [res, act] = r.split(':');
    return perms.some((p) => {
      const [pr, pa] = p.split(':');
      return (pr === res || pr === '*') && (pa === act || pa === '*');
    });
  });
const need = (ctrl: any, method: string): string[] => Reflect.getMetadata(PERMISSIONS_KEY, ctrl.prototype[method]) ?? [];

describe('round AV — new / edit a shipment from the email, as ADH Sales', () => {
  it.each([
    ['the picker lists orders', OrdersController, 'list', 'shipments:read'],
    ['+ New shipment (POST /trade-orders/:id/shipments)', OrdersController, 'addShipment', 'shipments:create'],
    ['the edit form loads the shipment', ShipmentsController, 'getById', 'shipments:read'],
    ['Save on an edit (PATCH /shipments/:id)', ShipmentsController, 'update', 'shipments:update'],
    ['the email prefill (POST /email-inbox/shipment-facts)', EmailInboxController, 'shipmentFacts', 'shipments:read'],
    ['Confirm in the Answer flow', EmailInboxController, 'answer', 'shipments:update'],
    ['the files step', EmailInboxController, 'placements', 'shipments:read'],
  ])('%s — needs its permission and ADH Sales has it', (_label, ctrl, method, perm) => {
    const required = need(ctrl, method as string);
    expect(required).toEqual([perm]);
    expect(allows(ADH_SALES, required)).toBe(true);
  });

  it('a role without shipments:create is refused "+ New shipment" (and without update the edit)', () => {
    const noCreate = ADH_SALES.filter((p) => p !== 'shipments:create' && p !== 'shipments:update');
    expect(allows(noCreate, need(OrdersController, 'addShipment'))).toBe(false);
    expect(allows(noCreate, need(ShipmentsController, 'update'))).toBe(false);
    expect(allows(noCreate, need(EmailInboxController, 'shipmentFacts'))).toBe(true);
  });

  describe('Activity Log: "from email <subject 60>"', () => {
    const svc = (subject: string | null) => {
      const prisma: any = { emailIngestLog: { findFirst: jest.fn().mockResolvedValue(subject === undefined ? null : { subject }) } };
      return { s: new ShipmentsService(prisma, {} as any, {} as any), prisma };
    };
    it('names the email by its subject, cut at 60, and the new shipment', async () => {
      const subject = 'Fw: (WEB)ARRIVAL NOTICE 198GX06524 N046365 INVIZ INVIZ JPYOK JPYOK — and a much longer tail';
      const { s, prisma } = svc(subject);
      const note = await s.emailSourceNote('org1', 'e1', '#27-1');
      expect(subject.slice(0, 60)).toHaveLength(60);
      expect(note).toEqual({ source: `from email "${subject.slice(0, 60)}"`, emailId: 'e1', ref: '#27-1' });
      expect(prisma.emailIngestLog.findFirst).toHaveBeenCalledWith({ where: { id: 'e1', organizationId: 'org1' }, select: { subject: true } });
    });
    it("another org's email id is not read (not found)", async () => {
      const prisma: any = { emailIngestLog: { findFirst: jest.fn().mockResolvedValue(null) } };
      const note = await new ShipmentsService(prisma, {} as any, {} as any).emailSourceNote('org1', 'other-org-email', null);
      expect(note.source).toBe('from email (not found)');
    });
    it('the controllers put it on the request for the interceptor row (create and edit)', async () => {
      const req: any = { userOrganization: { id: 'org1' }, user: { id: 'u1' } };
      const orders: any = { addShipment: jest.fn().mockResolvedValue({ id: 's1', ref: '#27-1' }), emailSourceNote: jest.fn().mockResolvedValue({ source: 'from email "x"', emailId: 'e1', ref: '#27-1' }) };
      await new OrdersController(orders, {} as any).addShipment('11111111-1111-4111-8111-111111111111', { fromEmailId: 'e1', blNumber: 'X1' } as any, req);
      expect(req.actionLogResult).toEqual({ source: 'from email "x"', emailId: 'e1', ref: '#27-1' });
      const req2: any = { userOrganization: { id: 'org1' }, user: { id: 'u1' } };
      const shipments: any = { update: jest.fn().mockResolvedValue({ id: 's1', ref: '#27-1' }), emailSourceNote: jest.fn().mockResolvedValue({ source: 'from email "y"', emailId: 'e2', ref: '#27-1' }) };
      await new ShipmentsController(shipments).update('11111111-1111-4111-8111-111111111111', { fromEmailId: 'e2', vessel: 'V' } as any, req2);
      expect(req2.actionLogResult.source).toBe('from email "y"');
      const req3: any = { userOrganization: { id: 'org1' }, user: { id: 'u1' } };
      await new ShipmentsController(shipments).update('11111111-1111-4111-8111-111111111111', { vessel: 'V' } as any, req3);
      expect(req3.actionLogResult).toBeUndefined();
    });
  });
});
