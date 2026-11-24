// WCT group (2026-11-25): "Add DO" when every quoted line is already on a DO makes no empty DO (it is refused with
// "All lines already on a DO"), and the order page reads the same check (GET /deliveries/order/:id/do-coverage).
import { ALL_LINES_ON_DO, DeliveriesService } from './deliveries.service';

const ORG = 'org-wct';
function svcWith(features: Record<string, unknown>, lines: { resolved: number; remaining: number }) {
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    order: { findFirst: jest.fn(async () => ({ id: 'o1', status: 'DO_COMPLETED', customerId: 'c1', sourceQuotationId: 'q1', linkedDocuments: null })) },
  };
  const svc: any = new DeliveriesService(prisma, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(svc, 'orderDoRemainingLines').mockImplementation(async () => ({
    quotation: { id: 'q1', config: {} },
    qcfg: {},
    di: {},
    resolved: Array.from({ length: lines.resolved }, (_, i) => ({ description: `L${i}` })),
    keyed: [],
    remaining: Array.from({ length: lines.remaining }, (_, i) => ({ line: { description: `L${i}` }, quantity: 1 })),
    unmatchedUsed: 0,
    untouched: [],
  }));
  return svc;
}
const WCT = { enableManualOrderFlow: true, enableWctOrders: true };

describe('Add DO when every line is already on a DO', () => {
  it('is refused for the WCT group, nothing is made', async () => {
    const svc = svcWith(WCT, { resolved: 2, remaining: 0 });
    await expect(svc.prepareManualOrderDo('o1', ORG, { force: true, throwOnError: true })).rejects.toThrow(ALL_LINES_ON_DO);
  });
  it('the order page check says so; with lines left it does not', async () => {
    expect(await svcWith(WCT, { resolved: 2, remaining: 0 }).orderDoCoverage('o1', ORG)).toEqual({ allOnDo: true, quotedLines: 2, remainingLines: 0 });
    expect(await svcWith(WCT, { resolved: 2, remaining: 1 }).orderDoCoverage('o1', ORG)).toEqual({ allOnDo: false, quotedLines: 2, remainingLines: 1 });
    // A quotation with no lines never reads "all on a DO".
    expect((await svcWith(WCT, { resolved: 0, remaining: 0 }).orderDoCoverage('o1', ORG)).allOnDo).toBe(false);
  });
});
