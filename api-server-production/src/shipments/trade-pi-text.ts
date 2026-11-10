/**
 * Round BP — Vedanta's Proforma Invoice read from its text layer (the electronically signed PDFs carry one; scanned
 * PIs and other suppliers' PIs go to the AI reader). Exact figures, including the two amount columns:
 *
 *   Payment 10% Adv with 5 business days
 *   Instrument to be received by 06/11/2026
 *   … Quantity(MT) LME PREMIUM Rate(US$/MT) Amount(US$) Amount Payable(US$)
 *   ALUMINIUM BILLET ALLOY 6005V26 -C 8" 100.000 3095.00 495.00 3590.00 359000.00 35900.00
 *   ALUMINIUM BILLET ALLOY 6063V35 -C 8" 200.000 3095.00 460.00 3555.00 711000.00 71100.00
 *   Total 300.000 1070000.00 107000.00
 *
 * "Amount Payable" = the advance due now (the deposit); "Instrument to be received by" = its due date (DD/MM/YYYY).
 * Returns the PI_SCHEMA shape (dates as YYYY-MM-DD) and whether the read is complete enough to skip the AI.
 */
import type { PiRaw } from './trade-extract.rules';

const num = (s: string | undefined) => (s === undefined ? null : Number(s.replace(/,/g, '')));
const dmyIso = (s: string | null | undefined) => {
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec((s ?? '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

export function parseVedantaPiText(text: string): { data: PiRaw; complete: boolean } {
  const t = (text ?? '').replace(/\r/g, '');
  const one = (re: RegExp) => re.exec(t)?.[1]?.trim() ?? null;
  const lines: PiRaw['lines'] = [];
  // A goods row: description … then qty, LME, premium, rate, amount and (newer PIs) amount payable.
  const ROW = /^(.*?\bALLOY\s+(\d{4})\S*.*?)\s+(\d[\d,]*\.\d{3})\s+(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})(?:\s+(\d[\d,]*\.\d{2}))?\s*$/gm;
  for (const m of t.matchAll(ROW)) {
    const desc = m[1].trim();
    const size = /(\d+)\s*(?:"|INCH)/i.exec(desc);
    lines.push({
      description: desc,
      grade: m[2],
      sizeRaw: size ? `${size[1]} INCH` : null,
      lengthRaw: /(\d{4})\s*MM/i.exec(desc)?.[1] ? `${/(\d{4})\s*MM/i.exec(desc)![1]} MM` : null,
      quantityMt: num(m[3]),
      lme: num(m[4]),
      premium: num(m[5]),
      rate: num(m[6]),
      amount: num(m[7]),
      amountPayable: num(m[8]),
    });
  }
  const total = /^Total\s+(\d[\d,]*\.\d{3})\s+(\d[\d,]*\.\d{2})(?:\s+(\d[\d,]*\.\d{2}))?\s*$/m.exec(t);
  const month = /Shipment Month\s+([A-Za-z]+)\s+(\d{4})/.exec(t);
  const data: PiRaw = {
    contractNo: one(/Contract No\s*(\d+)/),
    piNumber: one(/Invoice No\s*(\d+)/),
    piDate: dmyIso(one(/\bDate\s+(\d{1,2}\/\d{1,2}\/\d{4})/)),
    supplierName: /VEDANTA [A-Z ]+LIMITED/.exec(t)?.[0] ?? null,
    supplierBank: null,
    buyerName: one(/Buyer:\s*\n\s*(.+)/),
    customerHint: null,
    product: 'Aluminium Billet',
    portOfLoading: one(/Port of Loading\s+(.+)/),
    portOfDischarge: one(/Port of Discharge\s+(.+)/),
    termsOfDelivery: one(/Terms of Delivery\s*\n\s*(.+)/),
    paymentTerms: one(/^Payment\s+(.+)$/m),
    instrumentDueDate: dmyIso(one(/Instrument to be received by\s*(\S+)/)),
    shipmentPeriod: month ? `${month[1]} ${month[2]}` : null,
    shipmentMonth: month && MONTHS[month[1].toLowerCase()] ? `${month[2]}-${MONTHS[month[1].toLowerCase()]}` : null,
    tolerance: one(/Tolerance Limit\s*:\s*([^ ]+)/),
    currency: /US\$/.test(t) ? 'USD' : null,
    totalAmount: total ? num(total[2]) : null,
    amountPayable: total?.[3] ? num(total[3]) : null,
    lines,
  };
  // Complete: the PI no., the total and every line read (their amounts add up to the total).
  const sum = Math.round(lines.reduce((a, l) => a + (l.amount ?? 0), 0) * 100);
  const complete = !!data.piNumber && data.totalAmount !== null && lines.length > 0 && sum === Math.round((data.totalAmount ?? 0) * 100);
  return { data, complete };
}
