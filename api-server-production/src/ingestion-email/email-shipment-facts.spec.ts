import { exactDate, factsIn, mergeFacts, shipmentFacts, validContainerNo } from './email-shipment-facts';

const AN = [
  'ARRIVAL NOTICE',
  'VSL/VOY: WAN HAI 366/E051',
  'B/L No: 198GX06524',
  'ETA : 2026-10-29',
  'TOTAL GROSS WT (MT) : 17.931',
  'TOTAL NET WT (MT) : 17.861',
  'TOTAL BUNDLES : 7',
  'CSQU3054383 20GP WHLV449201',
].join('\n');

describe('round AV — exact shipment facts from an email', () => {
  it('reads a carrier arrival notice: B/L, vessel / voyage, ETA, net / gross, bundles, container', () => {
    const f = shipmentFacts({ subject: 'Fw: (WEB)ARRIVAL NOTICE 198GX06524', own: '', attachments: [{ name: 'AN.pdf', text: AN }] });
    expect(f.fields.blNumber?.value).toBe('198GX06524');
    expect(f.fields.vessel?.value).toBe('WAN HAI 366');
    expect(f.fields.voyageNo?.value).toBe('E051');
    expect(f.fields.eta?.value).toBe('2026-10-29');
    expect(f.fields.netWeightMt?.value).toBe('17.861');
    expect(f.fields.grossWeightMt?.value).toBe('17.931');
    expect(f.fields.totalBundles?.value).toBe('7');
    expect(f.containers).toEqual(['CSQU3054383']);
    expect(f.fields.containerCount?.value).toBe('1');
    expect(f.fields.netWeightMt?.candidates[0].sources).toEqual(['AN.pdf']);
  });

  it('B/L draft layout: "TOTAL NET WT (M T): 81.670", "32 BUNDLE(S)"', () => {
    const f = shipmentFacts({ subject: null, own: '', attachments: [{ name: 'BL.pdf', text: '32 BUNDLE(S)\nTOTAL GROSS WT (M T): 81.990\nTOTAL NET WT (M T): 81.670\nTOTAL BUNDLES: 32' }] });
    expect(f.fields.netWeightMt?.value).toBe('81.67');
    expect(f.fields.grossWeightMt?.value).toBe('81.99');
    expect(f.fields.totalBundles?.value).toBe('32');
  });

  it('"VESSEL : WAN HAI 365 B/L NO : 198GX05383" on one line + "VOYAGE : N045365"', () => {
    const f = shipmentFacts({ subject: null, own: '', attachments: [{ name: 'det.pdf', text: 'VESSEL : WAN HAI 365 B/L NO : 198GX05383\nVOYAGE : N045365 ARRIVED: 2026-09-28' }] });
    expect(f.fields.vessel?.value).toBe('WAN HAI 365');
    expect(f.fields.blNumber?.value).toBe('198GX05383');
    expect(f.fields.voyageNo?.value).toBe('N045365');
  });

  it('CI no. by the org CI pattern, anywhere ("INVOICE NO : XP2652102551")', () => {
    const f = shipmentFacts({ subject: null, own: '', attachments: [{ name: 'COO.pdf', text: 'INVOICE NO : XP2652102551' }] });
    expect(f.fields.ciNumber?.value).toBe('XP2652102551');
  });

  it('two different values → no value, both candidates (a transhipment has two ETAs)', () => {
    const f = shipmentFacts({ subject: null, own: '', attachments: [{ name: 'track.txt', text: 'WAN HAI 366 / 51  VIZAG  ETD 2026/10/06\nPORT KLANG  ETA 2026/10/10\nWAN HAI 365 / N046  ETD 2026/10/20\nYOKOHAMA ETA 2026/11/01' }] });
    expect(f.fields.eta?.value).toBeNull();
    expect(f.fields.eta?.candidates.map((c) => c.value).sort()).toEqual(['2026-10-10', '2026-11-01']);
    expect(f.fields.etd?.value).toBeNull();
  });

  it('subject, text and attachment agree → one value with all three sources', () => {
    const f = shipmentFacts({ subject: 'B/L No: 198GX06524', own: 'Please find B/L No. 198GX06524 attached', attachments: [{ name: 'AN.pdf', text: AN }] });
    expect(f.fields.blNumber?.value).toBe('198GX06524');
    expect(f.fields.blNumber?.candidates[0].sources).toEqual(['subject', 'email text', 'AN.pdf']);
  });

  it('never guesses: no year, ambiguous order, no unit, unlabelled numbers', () => {
    const f = shipmentFacts({ subject: 'ETA10/28予定', own: 'ETA 10/28 · net 20.4 · 8 bundles · 454003422 // SITGHAYK003232 // 81.670 MT', attachments: [] });
    expect(f.fields.eta).toBeUndefined();
    expect(f.fields.netWeightMt).toBeUndefined();
    expect(f.fields.totalBundles).toBeUndefined();
    expect(f.fields.blNumber).toBeUndefined();
    const g = shipmentFacts({ subject: null, own: '', attachments: [{ name: 'BL.pdf', text: 'VOYAGE NO. : PLACE OF RECEIPT\nNET 1 T/C' }] });
    expect(g.fields.voyageNo).toBeUndefined();
    expect(g.fields.netWeightMt).toBeUndefined();
  });

  it('KG converts to t; dates in other exact forms', () => {
    expect(factsIn('NET WEIGHT: 20,416 KGS', { attachment: true, ciPatterns: [] }).hits).toEqual([{ key: 'netWeightMt', value: '20.416' }]);
    expect(exactDate('28 Oct 2026')).toBe('2026-10-28');
    expect(exactDate('28-OCT-26')).toBe('2026-10-28');
    expect(exactDate('Oct 28, 2026')).toBe('2026-10-28');
    expect(exactDate('2026/02/30')).toBeNull();
    expect(exactDate('10/28/2026')).toBeNull();
  });

  it('container nos. only with a valid ISO 6346 check digit', () => {
    expect(validContainerNo('CSQU3054383')).toBe(true); // the ISO 6346 example
    expect(validContainerNo('CSQU3054384')).toBe(false);
    expect(validContainerNo('WHSU5162204')).toBe(false); // the tracking fixture's number fails its check digit
    expect(factsIn('CNTR: CSQU 305438-3', { attachment: true, ciPatterns: [] }).containers).toEqual(['CSQU3054383']);
  });

  it('a thread: values that differ between emails are candidates only', () => {
    const a = shipmentFacts({ subject: null, own: 'B/L No: 198GX06524', attachments: [] });
    const b = shipmentFacts({ subject: null, own: 'B/L No: 198GX06516', attachments: [] });
    const m = mergeFacts([a, b]);
    expect(m.fields.blNumber?.value).toBeNull();
    expect(m.fields.blNumber?.candidates).toHaveLength(2);
    expect(mergeFacts([a, a]).fields.blNumber?.value).toBe('198GX06524');
  });
});
