import { applyOrderToDoConfig, deriveOrderStatus, formatOrderNumber, refreshOrderStatus } from './wct-orders';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';

const ORG = 'org-1';
const job = (status: string, isDraft = false) => ({ status, isDraft });

describe('WCT orders: status from the jobs', () => {
  it('no job scheduled yet → Open (none, only a draft, only cancelled)', () => {
    expect(deriveOrderStatus([])).toBe('OPEN');
    expect(deriveOrderStatus([job('scheduled', true)])).toBe('OPEN');
    expect(deriveOrderStatus([job('cancelled'), job('scheduled', true)])).toBe('OPEN');
  });

  it('jobs scheduled, none started → Scheduled', () => {
    expect(deriveOrderStatus([job('scheduled'), job('scheduled')])).toBe('SCHEDULED');
    expect(deriveOrderStatus([job('scheduled'), job('scheduled', true)])).toBe('SCHEDULED');
  });

  it('a job started or done while others are still to do → In progress', () => {
    expect(deriveOrderStatus([job('in_progress')])).toBe('IN_PROGRESS');
    expect(deriveOrderStatus([job('delivered'), job('scheduled')])).toBe('IN_PROGRESS');
    expect(deriveOrderStatus([job('completed'), job('scheduled')])).toBe('IN_PROGRESS');
    // a draft job still waiting keeps a done order open
    expect(deriveOrderStatus([job('completed'), job('scheduled', true)])).toBe('IN_PROGRESS');
  });

  it('all done but a stamped-DO / paper finish not checked yet → Awaiting verification', () => {
    expect(deriveOrderStatus([{ status: 'completed', isDraft: false, verificationState: 'verified' }, { status: 'completed', isDraft: false, verificationState: 'pending' }])).toBe('AWAITING_VERIFICATION');
    expect(deriveOrderStatus([{ status: 'completed', isDraft: false, verificationState: 'rejected' }])).toBe('AWAITING_VERIFICATION');
    expect(deriveOrderStatus([{ status: 'completed', isDraft: false, verificationState: 'verified' }, { status: 'completed', isDraft: false, verificationState: null }])).toBe('COMPLETED');
    // still other jobs to do: in progress, whatever the check says
    expect(deriveOrderStatus([{ status: 'completed', isDraft: false, verificationState: 'pending' }, job('scheduled')])).toBe('IN_PROGRESS');
  });

  it('billing: Completed (to invoice) → Invoiced → Paid → Closed (with the service report)', () => {
    const done = (orderInvoiceId: string | null) => ({ status: 'completed', isDraft: false, verificationState: 'verified', orderInvoiceId });
    expect(deriveOrderStatus([done(null)], { invoiceStatuses: [] })).toBe('COMPLETED');
    expect(deriveOrderStatus([done('inv1'), done(null)], { invoiceStatuses: ['unconfirmed'] })).toBe('COMPLETED');
    expect(deriveOrderStatus([done('claim:x')], { invoiceStatuses: [] })).toBe('COMPLETED');
    expect(deriveOrderStatus([done('inv1'), done('inv2')], { invoiceStatuses: ['paid', 'pending_payment'] })).toBe('INVOICED');
    expect(deriveOrderStatus([done('inv1')], { invoiceStatuses: ['paid'] })).toBe('PAID');
    expect(deriveOrderStatus([done('inv1')], { invoiceStatuses: ['paid'], hasServiceReport: true })).toBe('CLOSED');
    // a new job added after invoicing: back to work
    expect(deriveOrderStatus([done('inv1'), job('scheduled')], { invoiceStatuses: ['paid'] })).toBe('IN_PROGRESS');
  });

  it('every scheduled job done → Completed; cancelled jobs do not count', () => {
    expect(deriveOrderStatus([job('completed')])).toBe('COMPLETED');
    expect(deriveOrderStatus([job('completed'), job('cancelled'), job('completed')])).toBe('COMPLETED');
  });
});

describe('WCT orders: helpers', () => {
  it('the default number format reads ORD{YYYY}{MM}-{###}', () => {
    expect(formatOrderNumber(1, new Date(2026, 10, 1))).toBe('ORD202611-001');
    expect(formatOrderNumber(42, new Date(2026, 11, 31))).toBe('ORD202612-042');
  });

  it('stamps the order onto a DO config; an unknown order leaves it alone', async () => {
    const prisma = { order: { findFirst: async ({ where }: any) => (where.id === 'o1' ? { id: 'o1', orderNumber: 'ORD202611-001' } : null) } };
    expect(await applyOrderToDoConfig(prisma, ORG, 'o1', { remarks: 'x' })).toEqual({ remarks: 'x', orderId: 'o1', orderNo: 'ORD202611-001' });
    expect(await applyOrderToDoConfig(prisma, ORG, 'nope', { remarks: 'x' })).toEqual({ remarks: 'x' });
  });

  it('refreshOrderStatus stores the derived status only when it changed, and never throws', async () => {
    const updates: any[] = [];
    const prisma = (status: string, jobs: any[]) => ({
      order: { findFirst: async () => ({ id: 'o1', status }), update: async (a: any) => updates.push(a) },
      delivery: { findMany: async () => jobs },
    });
    expect(await refreshOrderStatus(prisma('OPEN', [job('scheduled')]), ORG, 'o1')).toBe('SCHEDULED');
    expect(updates).toEqual([{ where: { id: 'o1' }, data: { status: 'SCHEDULED' } }]);
    expect(await refreshOrderStatus(prisma('SCHEDULED', [job('scheduled')]), ORG, 'o1')).toBe('SCHEDULED');
    expect(updates).toHaveLength(1);
    expect(await refreshOrderStatus(prisma('OPEN', []), ORG, null)).toBeNull();
    const broken = { order: { findFirst: async () => { throw new Error('db down'); } } };
    expect(await refreshOrderStatus(broken, ORG, 'o1')).toBeNull();
  });
});

describe('ORDER number issuing', () => {
  // A transaction stand-in: the format row, plus the org's existing order numbers.
  const txWith = (format: any, orderNumbers: string[]) => {
    const writes: any[] = [];
    return {
      writes,
      tx: {
        documentNumberFormat: {
          update: async (a: any) => {
            writes.push(a);
            if (a.data.nextSerial && typeof a.data.nextSerial === 'number') format.nextSerial = a.data.nextSerial;
            return { ...format };
          },
        },
        document: { findMany: async () => [{ name: 'ORD202611-900' }] }, // never read for ORDER
        order: { findMany: async ({ where }: any) => orderNumbers.filter((n) => n.startsWith(where.orderNumber.startsWith)).map((orderNumber) => ({ orderNumber })) },
      },
    };
  };
  const svc = (format: any) =>
    new DocumentNumberingService({ documentNumberFormat: { findFirst: async () => format } } as any);

  it('claims inside the caller transaction, with the ORD code, skipping numbers already on orders', async () => {
    const format = { id: 'f1', documentType: 'ORDER', pattern: '{DOC}{YYYY}{MM}-{###}', nextSerial: 1, resetPolicy: 'never', lastResetKey: null };
    const { tx, writes } = txWith(format, ['ORD202611-001', 'ORD202611-002', 'ORD202610-007']);
    const n = await svc(format).issueNumberLocked(ORG, 'ORDER', 'f1', new Date(2026, 10, 5), tx);
    expect(n).toBe('ORD202611-003');
    expect(writes[writes.length - 1]).toEqual({ where: { id: 'f1' }, data: { nextSerial: 4 } });
  });

  it('a fresh month with no orders yet continues the counter (reset never)', async () => {
    const format = { id: 'f1', documentType: 'ORDER', pattern: '{DOC}{YYYY}{MM}-{###}', nextSerial: 4, resetPolicy: 'never', lastResetKey: null };
    const { tx } = txWith(format, ['ORD202611-003']);
    expect(await svc(format).issueNumberLocked(ORG, 'ORDER', 'f1', new Date(2026, 11, 1), tx)).toBe('ORD202612-004');
  });
});
