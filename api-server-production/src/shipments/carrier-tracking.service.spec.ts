/** Round AL — CarrierTrackingService: read → compare → store; Confirm applies through ShipmentsService.update; email auto-ETA. */
import * as fs from 'fs';
import * as path from 'path';
import { CarrierTrackingService } from './carrier-tracking.service';
import { READ_198GX06523, SHIP_19_2 } from './__fixtures__/tracking-fixtures';

const text = fs.readFileSync(path.join(__dirname, '__fixtures__', 'wanhai-198GX06523.txt'), 'utf8');

function setup(ship: any = {}) {
  const sh = { id: 's192', seqNo: 2, status: 'OPEN', orderId: 'o19', shippingLine: 'WAN HAI LINES', order: { orderNo: 19, isTest: false }, ...SHIP_19_2, ...ship };
  const rows: any[] = [];
  const prisma: any = {
    shipment: { findFirst: async () => sh, findMany: async () => [sh, { ...sh, id: 's191', seqNo: 1, blNumber: '198GX06522' }] },
    shipmentTracking: {
      create: async (a: any) => { const r = { id: `t${rows.length + 1}`, ...a.data }; rows.push(r); return { id: r.id }; },
      findFirst: async (a: any) => rows.find((r) => (a.where.id ? r.id === a.where.id : r.emailLogId === a.where.emailLogId)) ?? null,
      update: async (a: any) => Object.assign(rows.find((r) => r.id === a.where.id), a.data),
    },
  };
  const updates: any[] = [];
  const shipments: any = { update: async (_o: string, id: string, dto: any, actor: any) => { updates.push({ id, dto, actor }); Object.assign(sh, dto, dto.eta ? { eta: new Date(dto.eta) } : {}); } };
  const actionLog: any = { system: jest.fn() };
  const svc = new CarrierTrackingService(prisma, {} as any, shipments, actionLog);
  svc.reader = jest.fn(async () => ({ data: READ_198GX06523, model: 'test', inputTokens: 1, outputTokens: 1 })) as any;
  return { svc, rows, updates, sh, actionLog };
}

describe('CarrierTrackingService', () => {
  it('read: compares, stores the snapshot, writes nothing on the shipment', async () => {
    const { svc, rows, updates } = setup();
    const r = await svc.read('adh', { shipmentId: 's192', text, source: 'PASTE' }, { id: 'u1', name: 'Sayaka' });
    expect(r.ref).toBe('#19-2');
    expect(r.bl).toBe('match');
    expect(r.rows.find((x) => x.field === 'eta')).toMatchObject({ aims: '2026-10-29', tracking: '2026-11-01' });
    expect(rows[0]).toMatchObject({ source: 'PASTE', shipmentId: 's192', blNumber: '198GX06523' });
    expect(updates).toEqual([]);
  });

  it('Confirm applies only the ticked fields that still differ, ETA with its source; a second Confirm is refused', async () => {
    const { svc, updates } = setup();
    const r = await svc.read('adh', { shipmentId: 's192', image: { buffer: Buffer.from('x'), mimetype: 'image/png' }, source: 'SCREENSHOT' }, null);
    const out = await svc.apply('adh', r.id, ['eta', 'arrivingVessel', 'arrivingVoyageNo', 'tsPort', 'vessel', 'grossWeightMt'], { id: 'u1', name: 'Sayaka' });
    expect(out.fields.sort()).toEqual(['arrivingVessel', 'arrivingVoyageNo', 'eta', 'tsPort']); // vessel same, weight never
    expect(updates[0].dto).toMatchObject({ eta: '2026-11-01', arrivingVessel: 'WAN HAI 365', arrivingVoyageNo: 'N046', tsPort: 'PORT KLANG NORTH PORT', etaSource: 'tracking screenshot' });
    await expect(svc.apply('adh', r.id, ['eta'], null)).rejects.toThrow(/already applied/);
  });

  it("refuses another shipment's B/L and non-tracking content", async () => {
    const { svc } = setup({ blNumber: '198GX06522' });
    await expect(svc.read('adh', { shipmentId: 's192', text, source: 'PASTE' }, null)).rejects.toThrow(/for B\/L 198GX06523, not 198GX06522/);
    const t = setup();
    t.svc.reader = jest.fn(async () => ({ data: { isTrackingPage: false, legs: [] }, model: 'x', inputTokens: 0, outputTokens: 0 })) as any;
    await expect(t.svc.read('adh', { shipmentId: 's192', text: 'Invoice 123 for warehouse fees, total JPY 50,000', source: 'PASTE' }, null)).rejects.toThrow(/doesn't look like carrier tracking/);
  });

  it('WhatsApp without a shipment: the B/L read picks the open shipment', async () => {
    const { svc } = setup();
    const r = await svc.read('adh', { text, source: 'PASTE' }, null);
    expect(r.shipmentId).toBe('s192');
  });

  it('carrier email: ETA moves by itself (history source "carrier email"), changed non-empty fields are only offered, read once', async () => {
    const { svc, updates, actionLog } = setup();
    const r = await svc.fromEmail('adh', 'log1', text, '198GX06523');
    expect(r).toMatchObject({ ok: true, ref: '#19-2' });
    expect(updates[0].dto).toMatchObject({ eta: '2026-11-01', etaSource: 'carrier email', arrivingVessel: 'WAN HAI 365' });
    expect(updates[0].dto.portOfLoading).toBeUndefined(); // VIZAG vs VISAKHAPATNAM: offered only
    expect((r as any).offered).toContain('portOfLoading');
    expect(actionLog.system).toHaveBeenCalledWith('carrier-tracking-email', 'UPDATE', 'Shipment', expect.anything());
    expect(await svc.fromEmail('adh', 'log1', text, '198GX06523')).toMatchObject({ ok: false, reason: 'already read' });
  });

  it('carrier email never moves an ETA a person typed', async () => {
    const { svc, updates } = setup({ etaHistory: [{ eta: '2026-10-29', previous: null, at: 'x', by: 'Sayaka', source: 'MANUAL' }] });
    const r: any = await svc.fromEmail('adh', 'log2', text, '198GX06523');
    expect(updates[0].dto.eta).toBeUndefined();
    expect(r.offered).toContain('eta');
  });
});
