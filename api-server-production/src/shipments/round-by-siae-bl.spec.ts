import { SIAE_BL_RAW } from './__fixtures__/bl-siae-nlbso';
import { compareParty, shipmentDraftFromBl } from './trade-extract.rules';
import { carrierOf } from './trade-carrier';

describe('round BY — SIAE (PT Sri Indah) B/L on #24', () => {
  const draft = shipmentDraftFromBl(SIAE_BL_RAW as any);

  it('reads every shipment field from the SIAE / NCS layout', () => {
    expect(draft).toMatchObject({
      blNumber: 'NLBSO2611001-00',
      shippingLine: 'NCS LOGISTIC LINK',
      vessel: 'SITC BRAVE',
      voyageNo: 'V.2627N',
      etd: '2026-11-11',
      portOfLoading: 'BATAM, INDONESIA',
      portOfDischarge: 'NAGOYA, JAPAN',
      netWeightMt: 50.0395, // round BZ: the B/L's 50,039.5 KGS at its own precision (was 50.04)
      grossWeightMt: 50.062,
      totalBundles: 45,
      totalPieces: 8375,
      containerCount: 2,
      hsCode: '7601.20',
      contractNo: null,
    });
    expect(draft.containers.map((c) => c.containerNo)).toEqual(['TIIU 289833-6', 'SEKU 157862-0']);
  });

  it('never guesses what the B/L does not print (origin, grade, contract no.)', () => {
    expect(draft.countryOfOrigin).toBeNull();
    expect(draft.contractNo).toBeNull();
    expect(draft.grade).toBeNull();
  });

  it('flags the B/L typo "MARINA BAYA" in the notify party address', () => {
    const c = compareParty('Notify party', 'notifyParty', 'ASIA DEAL HUB PTE.LTD.\n12 MARINA BOULEVARD 17-01, TOWER 3 MARINA BAY FINANCIAL CENTRE, SINGAPORE 018982', draft.notifyPartyText);
    expect(c.items?.find((i) => i.item === 'Address')?.status).not.toBe('ok');
  });

  it('NCS (an NVOCC house B/L) has no known Track page — no SITC link is guessed from the vessel name', () => {
    expect(carrierOf(draft.blNumber, draft.shippingLine)).toBeNull();
  });
});
