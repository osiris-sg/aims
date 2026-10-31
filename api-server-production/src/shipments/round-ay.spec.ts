import { cleanSkipSteps, codesAfter, PROCESS_SKIP_REASON, PROCESS_STEPS, processImpact, ImpactRecord } from './trade-process';
import { mergeProfiles, naStepCodes, profileFor } from './trade-profile';
import { currentStepOf, progressOf } from './shipments.rules';
import { orderStage } from './trade-stage';
import { TradeConfigService } from './trade-config.service';

// Round AY part 1 — the order process per customer (Clients → a customer → Process).
const fail = (m: string): never => {
  throw new Error(m);
};
const CUST = '8ebdc67b-224a-4f30-ac5c-929b4f17fd78';
const HOEI_SKIP = ['IMPORT_PERMIT', 'INVOICE_2', 'LOGISTICS_PAYMENT', 'XERO_HANDOFF', 'DELIVERY_CHANGES'];

describe('round AY — process catalogue', () => {
  it('lists every order (0, 1, 2, 11, 13) and shipment (3a, 3b, 4–10, 12, 14) step with EN + JA names', () => {
    expect(PROCESS_STEPS.filter((s) => s.scope === 'ORDER').map((s) => s.no)).toEqual(['0', '1', '2', '11', '13']);
    expect(PROCESS_STEPS.filter((s) => s.scope === 'SHIPMENT').map((s) => s.no)).toEqual(['3a', '3b', '4', '5', '6', '7', '8', '9', '10', '12', '14']);
    expect(PROCESS_STEPS.every((s) => s.en && s.ja)).toBe(true);
  });
  it('"ends at step 9" = 10, 11, 12, 13, 14 left out (Hoei)', () => {
    expect(codesAfter('9')).toEqual(HOEI_SKIP);
    expect(codesAfter('3a')).toContain('SHIPPING_DOCS');
    expect(codesAfter('3a')).not.toContain('BL_DRAFT_APPROVAL');
  });
  it('skip lists: known codes only, step 0 always applies, kept in process order', () => {
    expect(cleanSkipSteps(['XERO_HANDOFF', 'IMPORT_PERMIT'], fail)).toEqual(['IMPORT_PERMIT', 'XERO_HANDOFF']);
    expect(() => cleanSkipSteps(['NOPE'], fail)).toThrow('Unknown step');
    expect(() => cleanSkipSteps(['CHECK_CONTRACT'], fail)).toThrow('Step 0');
    expect(() => cleanSkipSteps('IMPORT_PERMIT', fail)).toThrow('list');
    expect(cleanSkipSteps(null, fail)).toEqual([]);
  });
});

describe('round AY — profile', () => {
  const base = { billingMode: 'SINGLE', truckCapacityT: 10, sendImportPermit: false, docVariants: {} };
  it('naStepCodes adds the left-out steps per scope (order steps on the order, shipment steps on the shipment)', () => {
    const p = { ...profileFor({ [CUST]: base }, CUST), skipSteps: HOEI_SKIP };
    expect(naStepCodes(p, 'ORDER').sort()).toEqual(['INVOICE_1', 'INVOICE_2', 'XERO_HANDOFF']);
    expect(naStepCodes(p, 'SHIPMENT').sort()).toEqual(['DELIVERY_CHANGES', 'IMPORT_PERMIT', 'LOGISTICS_PAYMENT']);
    expect(naStepCodes(p, 'SUPPLIER_ORDER')).toEqual([]);
  });
  it('no skipSteps = today (every step): SUS / Kato / Sankyo unchanged', () => {
    const sus = profileFor({ [CUST]: { ...base, billingMode: 'TWO_STAGE' } }, CUST);
    expect(naStepCodes(sus, 'ORDER')).toEqual([]);
    expect(naStepCodes(sus, 'SHIPMENT')).toEqual([]);
    expect(naStepCodes(profileFor({}, CUST), 'SHIPMENT')).toEqual([]);
  });
  it('a settings save without skipSteps keeps the stored process; with it, it is validated and replaced', () => {
    const stored = mergeProfiles({}, { [CUST]: { ...base, skipSteps: HOEI_SKIP } }, fail);
    expect(stored[CUST].skipSteps).toEqual(HOEI_SKIP);
    const kept = mergeProfiles(stored, { [CUST]: { ...base, port: 'Nagoya' } }, fail);
    expect(kept[CUST].skipSteps).toEqual(HOEI_SKIP);
    const cleared = mergeProfiles(stored, { [CUST]: { ...base, skipSteps: [] } }, fail);
    expect(cleared[CUST].skipSteps).toBeUndefined();
    expect(() => mergeProfiles({}, { [CUST]: { ...base, skipSteps: ['BOGUS'] } }, fail)).toThrow('Unknown step');
  });
});

const st = (code: string, status = 'NOT_STARTED', extra: Record<string, unknown> = {}) => ({ code, status, isOngoing: code === 'DELIVERY_CHANGES', notApplicable: false, skipReason: null as string | null, ...extra });
const shipSteps = (doneUpTo9: boolean) =>
  ['BL_DRAFT_APPROVAL', 'SHIPPING_DOCS', 'CUSTOMER_DOCS', 'SEND_DOCS_SCHEDULE', 'CI_PAYMENT', 'CUSTOMS_TAX_ESTIMATE', 'TAX_FUNDS', 'AN_INSTRUCTIONS']
    .map((c) => st(c, doneUpTo9 ? 'DONE' : 'NOT_STARTED'))
    .concat([st('IMPORT_PERMIT'), st('LOGISTICS_PAYMENT'), st('DELIVERY_CHANGES'), st('INVOICE_2', 'NOT_STARTED', { notApplicable: false, skipReason: 'Moved to the order (round H)' })]);

describe('round AY — impact of a process change', () => {
  const records: ImpactRecord[] = [
    { kind: 'order', id: 'o14', ref: '#14', status: 'OPEN', steps: [st('CHECK_CONTRACT', 'DONE'), st('PI_PAYMENT', 'DONE'), st('INVOICE_1', 'NOT_STARTED', { notApplicable: true }), st('INVOICE_2', 'DONE'), st('XERO_HANDOFF')] },
    { kind: 'shipment', id: 's14-1', ref: '#14-1', orderId: 'o14', status: 'OPEN', steps: shipSteps(true) },
    { kind: 'order', id: 'o30', ref: '#30', status: 'OPEN', steps: [st('CHECK_CONTRACT', 'DONE'), st('PI_PAYMENT'), st('INVOICE_1', 'NOT_STARTED', { notApplicable: true }), st('INVOICE_2'), st('XERO_HANDOFF')] },
    { kind: 'shipment', id: 's30-1', ref: '#30-1', orderId: 'o30', status: 'OPEN', steps: shipSteps(false) },
    { kind: 'order', id: 'o9', ref: '#9', status: 'COMPLETED', steps: [st('XERO_HANDOFF')] },
  ];
  const na = (r: ImpactRecord) => new Set(naStepCodes({ ...profileFor({}, CUST), billingMode: 'SINGLE', skipSteps: HOEI_SKIP }, r.kind === 'order' ? 'ORDER' : 'SHIPMENT'));
  const i = processImpact(records, na);
  it('counts open orders / shipments only (completed orders never change)', () => {
    expect([i.openOrders, i.openShipments]).toEqual([2, 2]);
  });
  it('lists the not-done steps that become hidden, and done ones that stay done', () => {
    expect(i.hidden.map((h) => `${h.ref} ${h.step}`)).toEqual(expect.arrayContaining(['#14 13 Prepare data for Xero reconciliation', '#14-1 10 Store & send import permit', '#14-1 12 Pay transport & storage costs', '#30 11 Issue Invoice #2 / the invoice']));
    expect(i.doneKept).toEqual([{ ref: '#14', step: '11 Issue Invoice #2 / the invoice' }]);
    expect(i.hidden.some((h) => h.step.includes('Invoice') && h.ref === '#14-1')).toBe(false); // moved-to-the-order row untouched
  });
  it('#14-1 completes (steps up to 9 done), and so does #14; #30 does not', () => {
    expect(i.completes).toEqual(['#14-1', '#14']);
  });
  it('no change → nothing hidden, nothing completes', () => {
    const none = processImpact(records, (r) => new Set(naStepCodes({ ...profileFor({}, CUST), billingMode: 'SINGLE' }, r.kind === 'order' ? 'ORDER' : 'SHIPMENT')));
    expect(none.hidden).toEqual([]);
    expect(none.completes).toEqual([]);
  });
});

describe('round AY — applying a profile to a record', () => {
  const svc = Object.create(TradeConfigService.prototype) as TradeConfigService;
  const db = (steps: any[]) => {
    const updates: any[] = [];
    return {
      updates,
      // Only the N/A fields matter here (sub-tasks / titles are refreshed by the same pass).
      tradeStep: { findMany: async () => steps, update: async (a: any) => ('notApplicable' in a.data || 'skipReason' in a.data) && updates.push({ where: a.where, data: { notApplicable: a.data.notApplicable, skipReason: a.data.skipReason } }) },
      tradeStepTemplate: { findMany: async () => [] },
    };
  };
  const p = { ...profileFor({}, CUST), billingMode: 'SINGLE' as const, skipSteps: HOEI_SKIP };
  it('left-out steps become N/A with the process reason; done steps and moved-to-the-order rows are left alone', async () => {
    const d = db([
      { id: 'a', code: 'IMPORT_PERMIT', status: 'NOT_STARTED', notApplicable: false, skipReason: null, title: 'x', requiredDocTypes: [], subtasks: null },
      { id: 'b', code: 'LOGISTICS_PAYMENT', status: 'DONE', notApplicable: false, skipReason: null, title: 'x', requiredDocTypes: [], subtasks: null },
      { id: 'c', code: 'INVOICE_2', status: 'NOT_STARTED', notApplicable: false, skipReason: 'Moved to the order (round H)', title: 'x', requiredDocTypes: [], subtasks: null },
      { id: 'd', code: 'AN_INSTRUCTIONS', status: 'NOT_STARTED', notApplicable: false, skipReason: null, title: 'x', requiredDocTypes: [], subtasks: null },
    ]);
    const changed = await svc.applyProfile(d as any, 'org', { shipmentId: 's' }, 'SHIPMENT', p);
    expect(changed).toBe(true);
    expect(d.updates).toEqual([{ where: { id: 'a' }, data: { notApplicable: true, skipReason: PROCESS_SKIP_REASON } }]);
  });
  it('a step put back into the process comes back (reason cleared)', async () => {
    const d = db([{ id: 'a', code: 'IMPORT_PERMIT', status: 'NOT_STARTED', notApplicable: true, skipReason: PROCESS_SKIP_REASON, title: 'x', requiredDocTypes: [], subtasks: null }]);
    await svc.applyProfile(d as any, 'org', { shipmentId: 's' }, 'SHIPMENT', { ...p, skipSteps: [] });
    expect(d.updates).toEqual([{ where: { id: 'a' }, data: { notApplicable: false, skipReason: null } }]);
  });
  it('nothing to change → no write, returns false', async () => {
    const d = db([{ id: 'd', code: 'AN_INSTRUCTIONS', status: 'NOT_STARTED', notApplicable: false, skipReason: null, title: 'x', requiredDocTypes: [], subtasks: null }]);
    expect(await svc.applyProfile(d as any, 'org', { shipmentId: 's' }, 'SHIPMENT', p)).toBe(false);
    expect(d.updates).toEqual([]);
  });
});

describe('round AY — everything that reads steps skips the left-out ones', () => {
  const steps = [
    { code: 'AN_INSTRUCTIONS', title: 'A/N', status: 'DONE', isOngoing: false, sortOrder: 9, displayNo: '9', notApplicable: false },
    { code: 'IMPORT_PERMIT', title: 'Permit', status: 'NOT_STARTED', isOngoing: false, sortOrder: 10, displayNo: '10', notApplicable: true },
    { code: 'LOGISTICS_PAYMENT', title: 'Pay', status: 'NOT_STARTED', isOngoing: false, sortOrder: 12, displayNo: '12', notApplicable: true },
  ];
  it('progress counts only the steps in the process; no current step once they are done', () => {
    expect(progressOf(steps)).toEqual({ done: 1, total: 1 });
    expect(currentStepOf(steps)).toBeNull();
  });
  it('Monthly status: a completed Hoei shipment with 11 / 13 left out → the order reads COMPLETED, not "final invoice"', () => {
    const ship = { status: 'COMPLETED', blNumber: 'B', etd: '2026-09-01', eta: '2026-10-01', steps };
    const order = { status: 'OPEN', supplierDone: true, steps: [{ code: 'INVOICE_2', status: 'NOT_STARTED', notApplicable: true }, { code: 'XERO_HANDOFF', status: 'NOT_STARTED', notApplicable: true }], shipments: [ship] };
    expect(orderStage(order as any, ship as any, '2026-10-31')).toBe('COMPLETED');
  });
});
