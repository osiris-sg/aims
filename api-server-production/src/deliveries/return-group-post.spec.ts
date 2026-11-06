jest.mock('../delivery-group-posts/enqueue', () => ({ enqueueDeliveryGroupPost: jest.fn(async () => null) }));
// The run lease is raw SQL on a real database (run-lease.ts; covered by the dev concurrency e2e): run straight through here.
jest.mock('./run-lease', () => ({ withRunLease: (_prisma: unknown, _lease: unknown, fn: () => Promise<unknown>) => fn() }));

import { enqueueDeliveryGroupPost } from '../delivery-group-posts/enqueue';
import { DeliveriesService } from './deliveries.service';

/**
 * finalizeReturn queues the WhatsApp group post (2026-11-02), exactly once, for
 * the units this signature completed, and only AFTER the recompute (the
 * completion hook that numbers the RDO). Built without Nest: only the members
 * finalizeReturn touches are provided.
 */
function service(runStatus: string) {
  const calls: string[] = [];
  const prisma = {
    delivery: {
      findFirst: async () => ({ id: 'run-88', status: runStatus, direction: 'RETURN' }),
      findUnique: async () => ({ id: 'run-88', status: 'completed' }),
    },
    maintenanceServiceReport: { updateMany: async () => ({ count: 2 }) },
    deliveryItem: {
      findMany: async () => [{ id: 'i1' }, { id: 'i2' }],
      updateMany: async () => {
        calls.push('complete-items');
        return { count: 2 };
      },
    },
  };
  const svc: any = Object.create(DeliveriesService.prototype);
  svc.prisma = prisma;
  svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  svc.recomputeRunStatus = jest.fn(async () => void calls.push('recompute'));
  svc.orderFollowsRun = jest.fn(async () => undefined);
  svc.siteclock = null;
  (enqueueDeliveryGroupPost as jest.Mock).mockImplementation(async () => {
    calls.push('enqueue');
    return null;
  });
  return { svc: svc as DeliveriesService, calls };
}

describe('finalizeReturn → WhatsApp group post', () => {
  beforeEach(() => (enqueueDeliveryGroupPost as jest.Mock).mockClear());

  it('queues one post for the collected units, after the RDO is completed', async () => {
    const { svc, calls } = service('delivered');
    await svc.finalizeReturn('run-88', { signature: 'data:image/png;base64,x', recipientName: 'Azad' }, 'org-1');
    expect(enqueueDeliveryGroupPost).toHaveBeenCalledTimes(1);
    expect(enqueueDeliveryGroupPost).toHaveBeenCalledWith(expect.anything(), 'org-1', 'run-88', ['i1', 'i2'], expect.anything());
    expect(calls).toEqual(['complete-items', 'recompute', 'enqueue']);
  });

  it('a refused finalize (units still to collect) queues nothing', async () => {
    const { svc } = service('in_progress');
    await expect(svc.finalizeReturn('run-88', { signature: 'data:x' }, 'org-1')).rejects.toThrow(/Collect every unit/);
    expect(enqueueDeliveryGroupPost).not.toHaveBeenCalled();
  });
});
