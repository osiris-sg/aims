/** Round AL — carrier tracking (screenshot / paste / email): normalize, text check, AIMS → tracking, email rules. */
import * as fs from 'fs';
import * as path from 'path';
import { blMatches, carrierOf, checkAgainstText, diffLines, emailAutoFields, etaHandTyped, normalizeTracking, sameVoyage, TRACKING_SCHEMA, trackingDiff, updateFor } from './carrier-tracking';
import { carrierTrackingHit, knownSender } from '../ingestion-email/email-triage.rules';

const text = fs.readFileSync(path.join(__dirname, '__fixtures__', 'wanhai-198GX06523.txt'), 'utf8');
import { READ_198GX06523, SHIP_19_2 } from './__fixtures__/tracking-fixtures';

describe('carrier tracking', () => {
  const snap = checkAgainstText(normalizeTracking(TRACKING_SCHEMA.parse(READ_198GX06523)), text);

  it('normalizes the 198GX06523 page: ocean leg, T/S Port Klang, arriving WAN HAI 365 / N046, ETA Yokohama 1 Nov', () => {
    expect(snap).toMatchObject({
      oceanVessel: 'WAN HAI 366', oceanVoyage: '51', arrivingVessel: 'WAN HAI 365', arrivingVoyage: 'N046',
      tsPort: 'PORT KLANG NORTH PORT', tsEta: '2026-10-10', tsEtd: '2026-10-20', etd: '2026-10-06', eta: '2026-11-01',
      releaseType: 'Telex Release', totalBundles: 6, grossWeightMt: 15.356, containers: ['WHSU5162204'], dropped: [],
    });
    expect(blMatches(snap, '198GX06523')).toBe('match');
    expect(blMatches(snap, '198GX06522')).toBe('mismatch');
  });

  it('AIMS → tracking for #19-2: ETA 29 Oct → 1 Nov, new T/S + arriving vessel, same ocean vessel (E051 = 51), weights equal', () => {
    const rows = trackingDiff(SHIP_19_2, snap);
    const by = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(by.eta).toMatchObject({ aims: '2026-10-29', tracking: '2026-11-01', status: 'changed', suggested: true });
    expect(by.vessel.status).toBe('same');
    expect(by.voyageNo.status).toBe('same');
    expect(by.arrivingVessel).toMatchObject({ aims: null, tracking: 'WAN HAI 365', status: 'new' });
    expect(by.arrivingVoyageNo.tracking).toBe('N046');
    expect(by.tsPort.status).toBe('new');
    expect(by.etd).toMatchObject({ tracking: '2026-10-06', status: 'new' });
    expect(by.portOfLoading.status).toBe('changed'); // VIZAG vs VISAKHAPATNAM — offered, never auto
    expect(by.totalBundles.status).toBe('same');
    expect(by.grossWeightMt.status).toBe('same');
    expect(updateFor(['eta', 'arrivingVessel', 'arrivingVoyageNo', 'tsPort', 'tsEta', 'tsEtd'], snap)).toEqual({ eta: '2026-11-01', arrivingVessel: 'WAN HAI 365', arrivingVoyageNo: 'N046', tsPort: 'PORT KLANG NORTH PORT', tsEta: '2026-10-10', tsEtd: '2026-10-20' });
    expect(diffLines(rows)).toContain('Latest ETA (port of discharge): 29 Oct → 1 Nov');
  });

  it('a reader answering "true" / "false" as text still parses', () => {
    expect(TRACKING_SCHEMA.parse({ ...READ_198GX06523, isTrackingPage: 'true' }).isTrackingPage).toBe(true);
    expect(TRACKING_SCHEMA.parse({ isTrackingPage: 'false' }).isTrackingPage).toBe(false);
  });

  it('weights / bundles that disagree are notes only, never written', () => {
    const rows = trackingDiff({ ...SHIP_19_2, totalBundles: 8, grossWeightMt: 15.4 }, snap);
    expect(rows.filter((r) => r.status === 'note').map((r) => r.field)).toEqual(['totalBundles', 'grossWeightMt']);
    expect(rows.filter((r) => r.status === 'note').every((r) => !r.suggested)).toBe(true);
    expect(updateFor(['totalBundles' as any, 'grossWeightMt' as any], snap)).toEqual({});
  });

  it('pasted text: a date / vessel the text does not contain is dropped', () => {
    const bad = checkAgainstText(normalizeTracking(TRACKING_SCHEMA.parse({ ...READ_198GX06523, podEta: '2026-11-03', legs: [READ_198GX06523.legs[0], { ...READ_198GX06523.legs[1], vessel: 'WAN HAI 999', eta: '2026-11-03' }] })), text);
    expect(bad.eta).toBeNull();
    expect(bad.arrivingVessel).toBeNull();
    expect(bad.dropped).toEqual(expect.arrayContaining(['leg 2 vessel WAN HAI 999', 'ETA at the port of discharge 2026-11-03']));
  });

  it('email: the ETA moves by itself unless a person typed it; other changed fields are only offered; empty ones fill', () => {
    const rows = trackingDiff(SHIP_19_2, snap);
    expect(emailAutoFields(rows).sort()).toEqual(['arrivingVessel', 'arrivingVoyageNo', 'blReleaseType', 'eta', 'etd', 'tsEta', 'tsEtd', 'tsPort']);
    const typed = trackingDiff({ ...SHIP_19_2, etaHistory: [{ eta: '2026-10-29', previous: '2026-10-25', at: 'x', by: 'Sayaka', source: 'MANUAL' }] }, snap);
    expect(typed.find((r) => r.field === 'eta')!.handTyped).toBe(true);
    expect(emailAutoFields(typed)).not.toContain('eta');
    expect(etaHandTyped([{ source: 'carrier email', by: 'Carrier email' }])).toBe(false);
    expect(etaHandTyped([{ source: 'whatsapp', by: 'Sayaka via WhatsApp' }])).toBe(true);
  });

  it('carriers of the open shipments', () => {
    expect(carrierOf('198GX06523', 'WAN HAI LINES')).toBe('WAN_HAI');
    expect(carrierOf('198GX06445', 'WAN HAI LINES')).toBe('WAN_HAI'); // #21-1 on EVER BRAVE is still a Wan Hai B/L
    expect(carrierOf('276956322', 'MAERSK')).toBe('MAERSK');
    expect(carrierOf('SITGHANG002846', 'SITC')).toBe('SITC');
    expect(carrierOf('GGVCB2600025201', 'RCL')).toBe('RCL');
    expect(sameVoyage('E051', '51')).toBe(true);
    expect(sameVoyage('N046', 'N045')).toBe(false);
  });

  describe('carrier email rule', () => {
    it('a Wan Hai ETA-change / status notice is CARRIER_TRACKING with its B/L', () => {
      expect(carrierTrackingHit('noreply@wanhai.com', 'Cargo Status Notification - B/L 198GX06523', 'Dear customer, ETA change: YOKOHAMA 2026/11/01')).toMatchObject({ rule: 'CARRIER_TRACKING', blNo: '198GX06523', attachmentTypes: {} });
      expect(knownSender({ from: 'WAN HAI e-Service <eservice@wanhai.com>', subject: 'Vessel schedule change notice', body: 'B/L No.: 198GX06522 WAN HAI 365 N046 ETA YOKOHAMA 2026/11/01', attachments: [] })).toMatchObject({ rule: 'CARRIER_TRACKING', blNo: '198GX06522' });
      expect(carrierTrackingHit('eservice@wanhai.com', '入港予定変更のお知らせ', '198GX06523 本船 WAN HAI 365')?.blNo).toBe('198GX06523');
    });
    it('the A/N, debit notes and other senders keep their own rules', () => {
      expect(knownSender({ from: 'x@wanhai.com', subject: '(WEB)ARRIVAL NOTICE 198GX06523 WAN HAI 365', attachments: [{ name: 'AN.pdf' }] })?.rule).toBe('WANHAI_AN');
      expect(knownSender({ from: 'x@wanhai.com', subject: 'RE: JPYOK_DebitNote-198GX05383-20261020', body: 'schedule change', attachments: [{ name: 'dn.pdf' }] })?.rule).toBe('CARRIER_CHARGES');
      expect(carrierTrackingHit('sales@vedanta.co.in', 'ETA change 198GX06523', '')).toBeNull();
      expect(carrierTrackingHit('x@wanhai.com', 'Happy new year', 'greetings')).toBeNull();
    });
  });
});
