/**
 * Carrier from the B/L number / shipping line (2026-10, shipment tracking).
 * "Track" opens the carrier's own tracking page — no scraping. Where the
 * carrier's page takes the B/L in its URL (Maersk, MSC) it is filled in;
 * otherwise the portal copies the B/L to the clipboard and opens the page.
 * ETD / ETA stay manual or from A/N / B/L reads (with history).
 */
export interface Carrier {
  code: 'WANHAI' | 'KMTC' | 'MAERSK' | 'MSC' | 'SITC' | 'RCL' | 'EVERGREEN';
  name: string;
  /** The tracking page. */
  url: string;
  /** The page takes the B/L in the URL (otherwise: paste it). */
  prefilled: boolean;
}

const enc = encodeURIComponent;

const CARRIERS: Array<{ code: Carrier['code']; name: string; bl?: RegExp; line: RegExp; url: (bl: string) => string; prefilled: boolean }> = [
  // Wan Hai B/Ls: 3 digits + 2 letters + 5 digits (198GX04630).
  { code: 'WANHAI', name: 'Wan Hai Lines', bl: /^\d{3}[A-Z]{2}\d{5,}$/, line: /WAN\s*HAI/i, url: () => 'https://www.wanhai.com/views/cargoTrack/CargoTrack.xhtml', prefilled: false },
  { code: 'KMTC', name: 'KMTC', bl: /^KMTC/, line: /KMTC|KOREA MARINE/i, url: () => 'https://www.ekmtc.com/', prefilled: false },
  { code: 'MSC', name: 'MSC', bl: /^MEDU/, line: /\bMSC\b|MEDITERRANEAN SHIPPING/i, url: (bl) => `https://www.msc.com/en/track-a-shipment?agencyPath=msc&trackingNumber=${enc(bl)}`, prefilled: true },
  { code: 'SITC', name: 'SITC', bl: /^SITG/, line: /\bSITC\b/i, url: () => 'https://www.sitcline.com/', prefilled: false },
  { code: 'RCL', name: 'RCL (Regional Container Lines)', bl: /^GGVC/, line: /\bRCL\b|REGIONAL CONTAINER/i, url: () => 'https://www.rclgroup.com/', prefilled: false },
  { code: 'EVERGREEN', name: 'Evergreen', bl: /^EGLV/, line: /EVERGREEN/i, url: () => 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do', prefilled: false },
  // Maersk B/Ls are all digits (9 or more).
  { code: 'MAERSK', name: 'Maersk', bl: /^\d{9,}$/, line: /MAERSK/i, url: (bl) => `https://www.maersk.com/tracking/${enc(bl)}`, prefilled: true },
];

/** The carrier of a shipment: the shipping line field wins, else the B/L prefix. */
export function carrierOf(blNumber: string | null | undefined, shippingLine?: string | null): Carrier | null {
  const bl = (blNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byLine = shippingLine ? CARRIERS.find((c) => c.line.test(shippingLine)) : undefined;
  const hit = byLine ?? (bl ? CARRIERS.find((c) => c.bl?.test(bl)) : undefined);
  if (!hit) return null;
  return { code: hit.code, name: hit.name, url: hit.url(bl), prefilled: hit.prefilled && !!bl };
}
