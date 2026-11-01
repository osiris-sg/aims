import { cleanShippingLine, typesOf } from './clients-company';
import { carrierOf } from './trade-carrier';
import { carrierOf as trackingCarrierOf } from './carrier-tracking';

// Round AZ — Clients → Logistics: typed logistics companies; the JJCVZ / VKTCB B/L prefixes.
const fail = (m: string): never => {
  throw new Error(m);
};
describe('round AZ — logistics companies', () => {
  it('a company can have several types (kept in process order); none / unknown types are refused', () => {
    const m = cleanShippingLine({ name: 'Mitsui-Soko Co., Ltd.', nameJa: '三井倉庫株式会社', types: ['TRUCKING', 'WAREHOUSE', 'CUSTOMS_BROKER'], emailDomains: 'mitsui-soko.co.jp, @Mitsui-Soko.co.jp' }, undefined, fail);
    expect(m.types).toEqual(['CUSTOMS_BROKER', 'WAREHOUSE', 'TRUCKING']);
    expect(m.emailDomains).toEqual(['mitsui-soko.co.jp']);
    expect(() => cleanShippingLine({ name: 'X', types: [] }, undefined, fail)).toThrow('at least one type');
    expect(() => cleanShippingLine({ name: 'X', types: ['AIRLINE'] }, undefined, fail)).toThrow('Unknown type');
    expect(() => cleanShippingLine({ name: 'X', emailDomains: ['not a domain'] }, undefined, fail)).toThrow('not an e-mail domain');
  });
  it('tracking and free time belong to shipping lines only', () => {
    const w = cleanShippingLine({ name: 'Warehouse Co', types: ['WAREHOUSE'], trackingUrl: 'https://x.example', freeTime: { detDays: 4 } }, undefined, fail);
    expect([w.trackingUrl, w.freeTime]).toEqual([undefined, undefined]);
    const l = cleanShippingLine({ name: 'ONE', types: ['SHIPPING_LINE'], trackingUrl: 'https://one.example', freeTime: { detDays: 4 } }, undefined, fail);
    expect([l.trackingUrl, l.freeTime]).toEqual(['https://one.example', { detDays: 4 }]);
  });
  it('round AY rows (no types) are shipping lines; a known line keeps the type; unsent fields are kept', () => {
    expect(typesOf({})).toEqual(['SHIPPING_LINE']);
    expect(() => cleanShippingLine({ types: ['FORWARDER'] }, { name: 'Wan Hai Lines' }, fail, true)).toThrow('keeps the Shipping line type');
    const cur = { name: 'Isewan', types: ['FORWARDER' as const], phone: '052-661-5187', notes: 'n' };
    expect(cleanShippingLine({ notes: 'new' }, cur, fail)).toEqual({ name: 'Isewan', types: ['FORWARDER'], phone: '052-661-5187', notes: 'new' });
  });
});

describe('round AZ — B/L prefixes from the documents', () => {
  it('VKTCB… is RCL; JJCVZ… is Shanghai Jinjiang Shipping', () => {
    expect(carrierOf('VKTCB25000562')?.code).toBe('RCL');
    expect(carrierOf('JJCVZNGMNC401842')?.code).toBe('JINJIANG');
    expect(trackingCarrierOf('VKTCB25000562')).toBe('RCL');
    expect(carrierOf('198GX06445')?.code).toBe('WANHAI');
  });
});
