/**
 * Round BB — fewer, clearer email questions: the new-shipment guess, never offering long-sailed / turned-down records,
 * supplier-order PIs, the B/L inside a file as a source, the card (one guess, evidence, what Yes does) in EN / JA,
 * batches, the reply hint.
 */
import { blOfFiledDocs, customerKeyOf, docFacts, isRejected, rejectedOf } from './email-card.rules';
import { findKeyHits, insideFileSource, MatchRecord, newShipmentCandidates, offerable } from './email-match.rules';
import { batchesOf, leaksEnglish, plainReason, questionOf, QuestionInput } from './email-question';

const rec = (o: Partial<MatchRecord>): MatchRecord => ({ orderId: 'o', orderNo: 1, orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: 'KATO', customerName: null, grade: '6005', size: null, qtyMt: 40, netMt: null, deliveryMonth: null, port: null, ...o });

describe('round BB — the facts of an email', () => {
  it('docFacts: B/Ls, grade, net and ETD from the B/L draft; the customer from "Asia Deal(Kato)"', () => {
    const f = docFacts({ subject: 'BL DRAFT - Asia Deal(Kato)//454003598 // 198GX07288 //40.855 MT//Nagoya', body: 'Kindly approve attached BL draft .\nVessel ETD from POL : 07-11-2026', attachments: [{ name: '198GX07288.pdf', text: 'B/L No. 198GX07288\nALUMINIUM BILLET ALLOY 6005 203 MM X 5800 MM\nNET WEIGHT 40.855 MT' }], date: new Date('2026-11-02') });
    expect(f.bls).toEqual(['198GX07288']);
    expect(f.grade).toBe('6005');
    expect(f.etd).toBe('2026-11-07');
    expect(f.file).toBe('198GX07288.pdf');
    expect(customerKeyOf('BL DRAFT - Asia Deal(Kato)//454003598', 'VEDANTA')).toBe('KATO');
    expect(customerKeyOf('Copy documents - Asia Deal(Sus)//454003422', 'VEDANTA')).toBe('SUS');
    expect(customerKeyOf('Re: 11月船積み', 'SUS')).toBe('SUS');
    expect(customerKeyOf('Nov declaration', 'VEDANTA')).toBeNull();
  });

  it('rejectedOf: what a person undid / changed — explicit, or an old inbox Undo (not the self-check\'s own)', () => {
    expect(rejectedOf({ rejected: [{ orderId: null, shipmentId: 's261' }] })).toEqual([{ orderId: null, shipmentId: 's261' }]);
    expect(rejectedOf({ undone: [{ kind: 'file', ownerKind: 'shipment', ownerId: 's261' }, { kind: 'file', ownerKind: 'shipment', ownerId: 's261' }] })).toEqual([{ orderId: null, shipmentId: 's261' }]);
    expect(rejectedOf({ undone: [{ kind: 'file', ownerKind: 'shipment', ownerId: 's1' }], question: { kind: 'RECHECK' } })).toEqual([]);
    expect(isRejected([{ orderId: null, shipmentId: 's261' }], { orderId: 'o26', shipmentId: 's261' })).toBe(true);
    expect(isRejected([{ orderId: null, shipmentId: 's261' }], { orderId: 'o26', shipmentId: null })).toBe(false);
  });
});

describe('round BB — matching', () => {
  const records = [
    rec({ orderId: 'o27', orderNo: 27, grade: '6005', contractNo: '454003598', shipMonth: '2026-10' }),
    rec({ orderId: 'o28', orderNo: 28, grade: '6063', contractNo: '454003598', shipMonth: '2026-10', shipmentId: 's281', seqNo: 1 }),
    rec({ orderId: 'o13', orderNo: 13, grade: '6005', contractNo: '454003598', shipMonth: '2026-07', shipmentId: 's131', seqNo: 1, bl: 'SITGHANG002682', netMt: 40.825, shipStatus: 'COMPLETED' }),
    rec({ orderId: 'o25', orderNo: 25, customerKey: 'SUS', qtyMt: 200, contractNo: '454003255', shipMonth: '2026-10', supplierPiNo: '9331004319' }),
    rec({ orderId: 'o24', orderNo: 24, customerKey: 'SANKYO', grade: '6063', qtyMt: 50, piNo: 'SIAE_PI_26100906' }),
  ];
  it('newShipmentCandidates: the open order of that customer + grade (+ contract, ship month) — "New shipment of #27", never a new deal', () => {
    const c = newShipmentCandidates({ customerKey: 'KATO', grade: '6005', contractNo: '454003598', month: '2026-11', netMt: 40.855 }, records);
    expect(c.map((x) => x.orderNo)).toEqual([27]);
    expect(c[0].why).toEqual(['customer KATO', 'grade 6005', 'contract 454003598', 'ship month 2026-10', 'no shipment yet']);
    expect(newShipmentCandidates({ customerKey: 'KATO', grade: '6063', contractNo: null, month: '2026-10', netMt: 40.271 }, records).map((x) => x.orderNo)).toEqual([28]);
    // Shipped in full (net + this one over qty + 5 %): not a candidate.
    expect(newShipmentCandidates({ customerKey: 'SUS', grade: '6005', contractNo: null, month: '2026-10', netMt: 250 }, records)).toEqual([]);
    expect(newShipmentCandidates({ customerKey: null, grade: '6005', contractNo: null, month: null, netMt: null }, records)).toEqual([]);
  });
  it('offerable: never a completed or long-sailed shipment on soft cues', () => {
    const when = new Date('2026-11-03');
    expect(offerable(records[2], when)).toBe(false);
    expect(offerable({ orderStatus: 'OPEN', shipStatus: 'OPEN', shipmentId: 's', etd: '2026-07-21', eta: '2026-08-21' }, when)).toBe(false);
    expect(offerable({ orderStatus: 'OPEN', shipStatus: 'OPEN', shipmentId: 's', etd: '2026-10-06', eta: '2026-10-29' }, when)).toBe(true);
    expect(offerable({ orderStatus: 'COMPLETED', shipStatus: null, shipmentId: null }, when)).toBe(false);
  });
  it('a supplier order\'s PI names its customer order; a prefixed supplier PI matches its digits ("PI-26100906")', () => {
    const ev = (body: string) => ({ subject: '', body, attachments: [], date: null });
    expect(findKeyHits(ev('Proforma Invoice 9331004319 dispatched 81.670'), records).map((h) => [h.kind, h.value, h.orderId])).toEqual([['pi', '9331004319', 'o25']]);
    expect(findKeyHits(ev('Please check the remittance for PI-26100906'), records).map((h) => [h.kind, h.value, h.orderId])).toEqual([['pi', '26100906', 'o24']]);
  });
  it('the B/L printed INSIDE the file is a second source; a file naming another record\'s B/L is not', () => {
    const recs = [rec({ orderId: 'o19', orderNo: 19, shipmentId: 's192', seqNo: 2, bl: '198GX06523' }), rec({ orderId: 'o18', orderNo: 18, shipmentId: 's182', seqNo: 2, bl: '198GX06516' })];
    const d = { kind: 'bl' as const, target: { orderId: 'o19', shipmentId: 's192' }, keyLabel: 'B/L 198GX06523' };
    const ev = { subject: 'Arrival notice', body: '', attachments: [{ name: 'ArrivalNotice.pdf', text: 'B/L NO: 198GX06523 / VESSEL WAN HAI 366' }], date: null };
    expect(insideFileSource(ev, d, recs, [0])).toEqual({ line: 'B/L 198GX06523 inside ArrivalNotice.pdf' });
    expect(insideFileSource({ ...ev, attachments: [{ name: '198GX06523.pdf', text: '' }] }, d, recs, [0])).toBeNull();
    expect(insideFileSource({ ...ev, attachments: [...ev.attachments, { name: 'x.pdf', text: 'B/L 198GX06516' }] }, d, recs, [0, 1])).toBeNull();
  });
});

describe('round BB — the card', () => {
  const summaryOf = (o: string, s: string | null) => (({ 'o27:': '#27 · Kato 6005 · 40 t', 'o28:': '#28 · Kato 6063 · 40 t', 'o19:s192': '#19-2 · SUS 6063 · 15.3 t · WAN HAI 366 · ETA 29 Oct' }) as Record<string, string>)[`${o}:${s ?? ''}`] ?? null;
  const refOf = (o: string, s: string | null) => (s ? '#19-2' : `#${o.slice(1)}`);
  const base = (o: Partial<QuestionInput>): QuestionInput => ({ lang: 'en', reasonCode: 'NO_ORDER', subject: 'BL DRAFT - Asia Deal(Kato)//454003598 // 198GX07288 //40.855 MT//Nagoya', company: 'Vedanta', attachments: ['198GX07288.pdf'], keys: { blNo: '198GX07288' }, threadSize: 2, suggested: null, candidates: [], check: [], summaryOf, refOf, emails: 2, ...o });
  const newShip = { guess: { kind: 'new_shipment' as const, orderId: 'o27' }, alternatives: [{ kind: 'new_shipment' as const, orderId: 'o28' }], evidence: [{ t: 'key' as const, key: 'bl' as const, value: '198GX07288', where: 'attachment' as const, file: '198GX07288.pdf', on: null }, { t: 'doc' as const, file: '198GX07288.pdf', grade: '6005', netMt: 40.855, etd: '2026-11-07' }, { t: 'free' as const, on: { orderId: 'o27', shipmentId: null } }], files: 2, bl: '198GX07288' };

  it('"New deal not in AIMS yet?" becomes "a new shipment of #27": one guess, ≤2 alternatives, the evidence marked, what Yes does', () => {
    const q = questionOf(base({ card: newShip }));
    expect(q.kind).toBe('NEW_SHIPMENT');
    expect(q.title).toBe('Create a new shipment of #27 (Kato 6005 · 40 t) with B/L 198GX07288?');
    expect(q.guess).toEqual({ kind: 'new_shipment', orderId: 'o27', shipmentId: null, ref: '#27', label: 'New shipment of #27 (Kato 6005 · 40 t)', short: 'New shipment of #27' });
    expect(q.alternatives).toEqual([{ kind: 'new_shipment', orderId: 'o28', shipmentId: null, ref: '#28', label: 'New shipment of #28 (Kato 6063 · 40 t)', short: 'New shipment of #28' }]);
    expect(q.evidence).toEqual([
      { text: 'B/L 198GX07288 in 198GX07288.pdf, not on any shipment yet', mark: '198GX07288', file: '198GX07288.pdf', conflict: false },
      { text: '198GX07288.pdf: 6005 · 40.855 t · ETD 2026-11-07', mark: '6005', file: '198GX07288.pdf', conflict: false },
      { text: '#27 has no shipment yet', mark: null, file: null, conflict: false },
    ]);
    expect(q.yesLine).toBe('Opens a new shipment of #27 with B/L 198GX07288 filled in from the email; you check it, then the documents are filed.');
    // Round BC: ONE short evidence line on the card; alternatives as short chips.
    expect(q.evidenceLine).toEqual([{ text: 'B/L 198GX07288', ok: false, conflict: false }, { text: '6005', ok: false, conflict: false }, { text: '40.855 t', ok: false, conflict: false }]);
    expect(q.alternatives![0].short).toBe('New shipment of #28');
    expect(q.extras.createOrder).toBe(true);
    const ja = questionOf(base({ lang: 'ja', card: newShip }));
    expect(ja.title).toBe('#27（Kato 6005 · 40 t）の新しい出荷をB/L 198GX07288 で作成しますか？');
    expect(ja.evidence![0].text).toBe('B/L 198GX07288：198GX07288.pdf（まだどの出荷にもありません）');
    expect(ja.yesLine).toBe('#27 の新しい出荷をメールの内容で開きます（B/L 198GX07288）。確認後に書類を登録します。');
  });

  it('a record guess with a conflict: the documents say 6005, the record 6063 — in red, first', () => {
    const q = questionOf(base({ reasonCode: 'CONFIRM', card: { guess: { kind: 'record', orderId: 'o19', shipmentId: 's192' }, alternatives: [], evidence: [{ t: 'key', key: 'bl', value: '198GX06523', where: 'attachment', file: 'ArrivalNotice.pdf', on: { orderId: 'o19', shipmentId: 's192' } }, { t: 'conflict', field: 'grade', email: '6005', record: '6063', on: { orderId: 'o19', shipmentId: 's192' } }], files: 1 } }));
    expect(q.title).toBe('File 1 document to #19-2 (SUS 6063 · 15.3 t · WAN HAI 366 · ETA 29 Oct)?');
    expect(q.evidence![0]).toEqual({ text: 'B/L 198GX06523 in ArrivalNotice.pdf = #19-2', mark: '198GX06523', file: 'ArrivalNotice.pdf', conflict: false });
    expect(q.evidence![1]).toMatchObject({ text: 'The documents say grade 6005; #19-2 has 6063', conflict: true });
    expect(q.yesLine).toBeNull();
    expect(q.evidenceLine).toEqual([{ text: '6005 ≠ 6063', ok: false, conflict: true }, { text: 'B/L 198GX06523 ✓', ok: true, conflict: false }]);
  });

  it('never "not in AIMS yet" when a record fits; "new deal" only when no open order fits; a handed-over card says so', () => {
    const deal = questionOf(base({ card: { guess: { kind: 'new_deal' }, alternatives: [], evidence: [], files: 0 }, seed: { piNo: null, contractNo: null, grade: '6061', qtyMt: null, customerKey: null, deliveryMonth: null } }));
    expect(deal.title).toBe('No open order fits. Is this a new 6061 deal?');
    expect(deal.title).not.toMatch(/not in AIMS/);
    const asked = questionOf(base({ card: newShip, asked: { by: 'Sayaka Matsuki', at: '2026-11-03T10:00:00Z', note: 'which order?' } }));
    expect(asked.asked).toEqual({ by: 'Sayaka Matsuki', at: '2026-11-03T10:00:00Z', note: 'which order?' });
    // A turned-down / long-sailed record is never the guess on soft cues.
    const off = questionOf(base({ reasonCode: 'CONFIRM', suggested: { orderId: 'o19', shipmentId: 's192', ref: '#19-2', why: ['grade 6063 (subject)'] }, offerable: () => false }));
    expect(off.guess).toBeNull();
  });

  it('Japanese: no English reason left on the card; the reply hint counts every option', () => {
    expect(plainReason('names #26-1 (unverified)', 'ja')).toBe('#26-1 の可能性（未確認）');
    expect(leaksEnglish('the subject describes it')).toBe(true);
    expect(leaksEnglish('件名のみ一致')).toBe(false);
    const q = questionOf(base({ lang: 'ja', reasonCode: 'PICK_SHIPMENT', keys: { blNo: null }, candidates: [{ orderId: 'o19', shipmentId: 's192', ref: '#19-2', why: ['some untranslated English text here'] }] }));
    expect(q.options[0].why).toBe('');
    const en = questionOf(base({ reasonCode: 'PICK_SHIPMENT', candidates: ['a', 'b', 'c', 'd'].map((x) => ({ orderId: `o${x}`, shipmentId: `s${x}`, ref: `#${x}`, why: ['grade 6005 (subject)'] })) }));
    expect(en.replyHint).toBe('Reply 1 to 4 · 0 = ask later · X = not a shipment');
  });

  it('batches: cards about the same order are one screen; the other "new shipment of …" cards another; asked cards stay single', () => {
    const q = (kind: string, orderId: string | null, shipmentId: string | null = null, ref = '#x') => ({ kind, guess: { kind, orderId, shipmentId, ref, label: '' } }) as any;
    const b = batchesOf([{ id: 't1', question: q('new_shipment', 'o27', null, '#27') }, { id: 't2', question: q('new_shipment', 'o30', null, '#30') }, { id: 't3', question: q('record', 'o25', 's251', '#25-1') }, { id: 't4', question: q('record', 'o25', null, '#25') }, { id: 't5', question: q('record', 'o19', 's191', '#19-1') }, { id: 't6', question: { ...q('new_shipment', 'o26', null, '#26'), asked: { by: 'S' } } }], 'en');
    expect(b).toEqual([
      { key: 'order:o25', threadIds: ['t3', 't4'], title: "2 emails about #25: check AIMS's answers" },
      { key: 'new-shipments', threadIds: ['t1', 't2'], title: '2 B/L drafts and documents for orders without that shipment yet' },
    ]);
    expect(batchesOf([{ id: 't3', question: q('record', 'o18', 's182', '#18-2') }, { id: 't4', question: q('record', 'o18', 's182', '#18-2') }], 'ja')[0].title).toBe('#18 に関するメール2件：AIMSの回答を確認');
  });
});

describe('round BD — the B/L no. a filed B/L states', () => {
  const ev = (o: Partial<{ subject: string; body: string; attachments: Array<{ name: string; text: string }> }>) => ({ subject: '', body: '', attachments: [], date: null, ...o });
  it('one B/L in the filed B/L document, found in two places → filled; one place or two B/Ls → not', () => {
    expect(blOfFiledDocs(ev({ subject: 'Copy documents // SITGHAYK003213 // 198.821 MT', attachments: [{ name: 'COA.pdf', text: '' }, { name: 'SITGHAYK003213 SCAN.PDF', text: '' }] }), [1])).toEqual({ bl: 'SITGHAYK003213', sources: ['its file name', 'the subject'] });
    expect(blOfFiledDocs(ev({ attachments: [{ name: 'BLCopyView (1).pdf', text: 'B/L No. 198GX07288 … 198GX07288' }] }), [0])).toBeNull();
    expect(blOfFiledDocs(ev({ attachments: [{ name: 'BLCopyView (1).pdf', text: 'B/L No. 198GX07288' }, { name: 'COO.pdf', text: 'BL 198GX07288' }] }), [0])).toEqual({ bl: '198GX07288', sources: ['the B/L document', 'another attachment'] });
    expect(blOfFiledDocs(ev({ subject: '198GX07288', attachments: [{ name: 'bl.pdf', text: '198GX07288 and 198GX07292' }] }), [0])).toBeNull();
    expect(blOfFiledDocs(ev({ subject: '198GX07288' }), [])).toBeNull();
  });
});
