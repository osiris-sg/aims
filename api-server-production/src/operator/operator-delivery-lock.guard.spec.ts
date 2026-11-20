import { ForbiddenException } from '@nestjs/common';
import { OperatorDeliveryLockGuard } from './operator-delivery-lock.guard';
import { deliveryDocLockReason, isDeliveryDocType, uuidsInRequest } from '../documents/delivery-doc-lock';

const BIO = 'org-bio';
const WCT = 'org-wct';
const DO_SIGNED = '3a25ad0d-d41a-4bb4-b50a-a65fcb6da8fe';
const DO_DRAFT = '11111111-1111-4111-8111-111111111111';
const RUN_DONE = 'c9713522-1197-4cb0-aca8-05d05c83863b';
const INVOICE = 'd01c5924-c661-4e93-9090-571186811b65';

function fakePrisma(flags: Record<string, boolean>) {
  const docs = [
    { id: DO_SIGNED, name: 'DO202611107', type: 'DELIVERY_ORDER', status: 'delivered_installed' },
    { id: DO_DRAFT, name: 'DO-PENDING-07', type: 'DELIVERY_ORDER', status: 'unconfirmed' },
    { id: INVOICE, name: 'BI202611266', type: 'INVOICE', status: 'unconfirmed' },
  ];
  return {
    organizationUIConfig: { findUnique: async ({ where }: any) => ({ features: { enableAssistantSignedDocLock: !!flags[where.organizationId] } }) },
    document: {
      findMany: async ({ where }: any) => docs.filter((d) => where.id.in.includes(d.id) && where.type.in.includes(d.type)),
    },
    delivery: {
      findMany: async ({ where }: any) =>
        where.id ? (where.id.in.includes(RUN_DONE) ? [{ id: RUN_DONE, status: 'completed' }] : []) : [],
    },
    maintenanceServiceReport: { count: async () => 0 },
  };
}

function ctx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

const actionLog = { system: jest.fn() } as any;

describe('OperatorDeliveryLockGuard (enableAssistantSignedDocLock)', () => {
  const guard = (flags: Record<string, boolean>) => new OperatorDeliveryLockGuard(fakePrisma(flags) as any, actionLog);
  const write = (org: string, path: string, body: any = {}) => ({
    viaOperator: true,
    method: 'POST',
    path,
    params: {},
    body,
    userOrganization: { id: org },
    user: { id: 'user_x' },
  });

  it("refuses the assistant's whole-document save of a signed DO (the 19 Nov case)", async () => {
    await expect(guard({ [BIO]: true }).canActivate(ctx(write(BIO, '/documents/update', { id: DO_SIGNED, type: 'DELIVERY_ORDER' })))).rejects.toBeInstanceOf(ForbiddenException);
    expect(actionLog.system).toHaveBeenCalledWith('assistant-signed-doc-lock', 'REFUSED', 'documents', expect.objectContaining({ organizationId: BIO, resourceId: DO_SIGNED }));
  });

  it('refuses path-addressed writes (link-project) and writes to a completed run', async () => {
    await expect(guard({ [BIO]: true }).canActivate(ctx(write(BIO, `/documents/${DO_SIGNED}/link-project`)))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard({ [BIO]: true }).canActivate(ctx({ ...write(BIO, `/deliveries/scheduled/${RUN_DONE}`), method: 'PATCH' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the assistant edit an undelivered DO and a draft invoice', async () => {
    await expect(guard({ [BIO]: true }).canActivate(ctx(write(BIO, '/documents/update', { id: DO_DRAFT })))).resolves.toBe(true);
    await expect(guard({ [BIO]: true }).canActivate(ctx(write(BIO, '/documents/update', { id: INVOICE })))).resolves.toBe(true);
  });

  it('changes nothing for WCT and every org without the flag', async () => {
    await expect(guard({ [BIO]: true }).canActivate(ctx(write(WCT, '/documents/update', { id: DO_SIGNED })))).resolves.toBe(true);
    await expect(guard({}).canActivate(ctx(write(BIO, '/documents/update', { id: DO_SIGNED })))).resolves.toBe(true);
  });

  it('never touches portal users or reads', async () => {
    await expect(guard({ [BIO]: true }).canActivate(ctx({ ...write(BIO, '/documents/update', { id: DO_SIGNED }), viaOperator: undefined }))).resolves.toBe(true);
    await expect(guard({ [BIO]: true }).canActivate(ctx({ ...write(BIO, `/documents/${DO_SIGNED}`), method: 'GET' }))).resolves.toBe(true);
  });
});

describe('delivery-doc-lock helpers', () => {
  const p = (runs: any[], acks: number) => ({ delivery: { findMany: async () => runs }, maintenanceServiceReport: { count: async () => acks } });

  it('locks delivered/returned DOs and RDOs, and signed or completed-run ones', async () => {
    expect(await deliveryDocLockReason(p([], 0), 'o', { id: 'd', type: 'DELIVERY_ORDER', status: 'delivered_installed' })).toBe('delivered_installed');
    expect(await deliveryDocLockReason(p([], 0), 'o', { id: 'd', type: 'RETURN_DELIVERY_ORDER', status: 'returned' })).toBe('returned');
    expect(await deliveryDocLockReason(p([], 1), 'o', { id: 'd', type: 'RDO', status: 'unconfirmed' })).toBe('signed');
    expect(await deliveryDocLockReason(p([{ id: 'r', status: 'completed' }], 0), 'o', { id: 'd', type: 'DO', status: 'unconfirmed' })).toBe('signed');
    expect(await deliveryDocLockReason(p([], 0), 'o', { id: 'd', type: 'DELIVERY_ORDER', status: 'unconfirmed' })).toBeNull();
  });

  it('never locks other document types', async () => {
    expect(isDeliveryDocType('INVOICE')).toBe(false);
    expect(await deliveryDocLockReason(p([], 5), 'o', { id: 'd', type: 'INVOICE', status: 'delivered_installed' })).toBeNull();
  });

  it('collects uuids from params, path and body id fields', () => {
    const ids = uuidsInRequest({ params: { id: DO_DRAFT }, path: `/documents/${DO_SIGNED}/x`, body: { documentIds: [INVOICE], id: 'not-a-uuid' } });
    expect(ids.sort()).toEqual([DO_SIGNED, DO_DRAFT, INVOICE].sort());
  });
});
