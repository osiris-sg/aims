/** Round AL — shared fixtures for the carrier-tracking specs: the 198GX06523 (#19-2) page read, and #19-2 in AIMS. */
import { TrackedShipment } from '../carrier-tracking';

/** What the reader returns for that page (the model's JSON). */
export const READ_198GX06523 = {
  isTrackingPage: true,
  carrier: 'WAN HAI LINES',
  blNumber: '198GX06523',
  blIssueDate: '2026-10-06',
  releaseType: 'Telex Release',
  legs: [
    { vessel: 'WAN HAI 366', voyage: '51', portOfLoading: 'VIZAG', etd: '2026-10-06', portOfDischarge: 'PORT KLANG NORTH PORT', eta: '2026-10-10' },
    { vessel: 'WAN HAI 365', voyage: 'N046', portOfLoading: 'PORT KLANG NORTH PORT', etd: '2026-10-20', portOfDischarge: 'YOKOHAMA', eta: '2026-11-01' },
  ],
  portOfDischarge: 'YOKOHAMA',
  podEta: '2026-11-01',
  totalBundles: 6,
  grossWeightKg: 15356,
  containers: ['WHSU5162204'],
};
/** #19-2 as AIMS has it (prod, 2026-10-25): WAN HAI 366 E051, ETA 29 Oct, no ETD, no T/S. */
export const SHIP_19_2: TrackedShipment = {
  blNumber: '198GX06523', vessel: 'WAN HAI 366', voyageNo: 'E051', arrivingVessel: null, arrivingVoyageNo: null, tsPort: null, tsEta: null, tsEtd: null,
  etd: null, eta: new Date('2026-10-29T00:00:00Z'), portOfLoading: 'VISAKHAPATNAM, INDIA', portOfDischarge: 'YOKOHAMA, JAPAN', blReleaseType: null, containerCount: 1, totalBundles: 6, grossWeightMt: '15.356', etaHistory: [],
};

