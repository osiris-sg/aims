import { carrierOf } from './trade-carrier';
import { addDays, trackingBoard, trackingRow, trackingWindow, type TrackingSource } from './trade-tracking-board';

const today = '2026-11-21';
const base = (over: Partial<TrackingSource> = {}): TrackingSource => ({
  id: 's1',
  orderId: 'o1',
  seqNo: 1,
  status: 'OPEN',
  blNumber: '198GX05001',
  shippingLine: null,
  vessel: 'WAN HAI 316',
  voyageNo: 'N123',
  eta: new Date('2026-11-28T00:00:00Z'),
  etaHistory: [],
  actualArrivalDate: null,
  dischargeDate: null,
  tsPort: null,
  tsEta: null,
  tsEtd: null,
  arrivingVessel: null,
  arrivingVoyageNo: null,
  order: { orderNo: 25, customer: { name: 'SUS Co., Ltd.' } },
  steps: [],
  ...over,
});

describe('round BX — Tracking list', () => {
  it('window: 14 days back to 21 days ahead', () => {
    expect(trackingWindow(today)).toEqual({ from: '2026-11-07', to: '2026-12-12' });
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('one row: ref, customer, carrier link, days to ETA; no history = not delayed', () => {
    const r = trackingRow(base(), today)!;
    expect(r).toMatchObject({ ref: '#25-1', customerName: 'SUS Co., Ltd.', eta: '2026-11-28', daysToEta: 7, delayed: false, delayDays: 0, etaTrail: '' });
    expect(r.carrier).toMatchObject({ code: 'WANHAI', prefilled: false });
  });

  it('delayed when the ETA moved later than first known; the trail lists every ETA', () => {
    const r = trackingRow(
      base({
        eta: new Date('2026-12-02T00:00:00Z'),
        etaHistory: [
          { eta: '2026-11-28', previous: '2026-11-25', at: '2026-11-10T01:00:00Z', by: 'Sayaka', source: 'MANUAL' },
          { eta: '2026-12-02', previous: '2026-11-28', at: '2026-11-18T01:00:00Z', by: 'Sayaka', source: 'PASTE' },
        ],
      }),
      today,
    )!;
    expect(r).toMatchObject({ firstEta: '2026-11-25', delayDays: 7, delayed: true, etaTrail: '11/25 → 11/28 → 12/2' });
    expect(r.etaHistory).toHaveLength(2);
  });

  it('an earlier ETA is not a delay', () => {
    const r = trackingRow(base({ eta: new Date('2026-11-24T00:00:00Z'), etaHistory: [{ eta: '2026-11-24', previous: '2026-11-28', at: '2026-11-15T00:00:00Z', by: null, source: 'MANUAL' }] }), today)!;
    expect(r).toMatchObject({ delayed: false, delayDays: 0 });
  });

  it('leaves out closed, arrived, discharged, cleared, no-ETA and out-of-window shipments', () => {
    expect(trackingRow(base({ status: 'COMPLETED' }), today)).toBeNull();
    expect(trackingRow(base({ actualArrivalDate: new Date('2026-11-20') }), today)).toBeNull();
    expect(trackingRow(base({ dischargeDate: new Date('2026-11-20') }), today)).toBeNull();
    expect(trackingRow(base({ eta: null }), today)).toBeNull();
    expect(trackingRow(base({ eta: new Date('2026-12-20T00:00:00Z') }), today)).toBeNull();
    expect(trackingRow(base({ eta: new Date('2026-11-01T00:00:00Z') }), today)).toBeNull();
    const cleared = [
      { displayNo: '9', status: 'DONE', isOngoing: false },
      { displayNo: '10', status: 'DONE', isOngoing: false },
      { displayNo: '12', status: 'OPEN', isOngoing: false },
    ];
    expect(trackingRow(base({ steps: cleared }), today)).toBeNull();
    // A past ETA with no arrival yet stays (late), with a negative day count.
    expect(trackingRow(base({ eta: new Date('2026-11-19T00:00:00Z') }), today)).toMatchObject({ daysToEta: -2 });
  });

  it('sorted by ETA, then ref', () => {
    const rows = trackingBoard(
      [
        base({ id: 'a', seqNo: 2, eta: new Date('2026-12-01T00:00:00Z') }),
        base({ id: 'b', seqNo: 10, eta: new Date('2026-11-25T00:00:00Z') }),
        base({ id: 'c', seqNo: 9, eta: new Date('2026-11-25T00:00:00Z') }),
      ],
      today,
    );
    expect(rows.map((r) => r.ref)).toEqual(['#25-9', '#25-10', '#25-2']);
  });

  it('SITC opens its cargo tracking page and copies the B/L (the page ignores a B/L in the URL)', () => {
    expect(carrierOf('SITGSHJK123456')).toEqual({ code: 'SITC', name: 'SITC', url: 'https://api.sitcline.com/app/cargoTrackSearch', prefilled: false });
    expect(carrierOf(null, 'SITC CONTAINER LINES')!.url).toBe('https://api.sitcline.com/app/cargoTrackSearch');
  });
});
