/**
 * Round AN — dev-only side-by-side: renders Hoei's INVOICE & PACKING LIST and 請求書 with the new generators from a
 * JSON fixture (facts read off ADH's Drive files) to PDF. No DB. Usage: npx ts-node --transpile-only scripts/_an-hoei-render.ts <fixtures.json> <outDir>
 */
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { hoeiInvoiceDraft, hoeiIvPlDraft, renderHoeiInvoiceHtml, renderHoeiIvPlHtml } from '../src/shipments/trade-hoei-formats';

(async () => {
  const [fx, out] = process.argv.slice(2);
  const f = JSON.parse(fs.readFileSync(fx, 'utf8'));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  for (const [name, s] of Object.entries<any>(f.shipments)) {
    const iv = hoeiIvPlDraft({
      today: s.today, shipMonth: s.shipMonth, supplierBlock: f.shipper, parties: { consignee: f.hoei, buyer: f.hoei, notify: f.notify }, sellerBlock: f.seller, signBlock: f.sign,
      bank: { id: 'cfsb', block: f.bank }, portOfLoading: s.pol, portOfDischarge: 'Laem Chabang', countryOfOrigin: 'India', vessel: s.vessel, voyageNo: s.voyage,
      product: 'Aluminium Ingot', grade: 'P1020', hsCode: null, incoterm: 'CIF', lme: s.lme, qmjp: s.qmjp, premium: null, netMt: s.net, grossMt: s.gross, bundles: s.bundles, pieces: s.pieces,
    });
    const inv = hoeiInvoiceDraft({
      today: s.invToday, toName: 'HOEI METAL (THAILAND)Co.,Ltd.', fromName: 'Asia Deal Hub Pte. Ltd.', fromAddress: '12 MARINA BOULEVARD 17-01,\nTOWER 3 MARINA BAY FINANCIAL CENTRE,\nSINGAPORE, 018982',
      bank: { id: 'cfsb', block: f.bank }, shipMonth: s.shipMonth, validity: s.validity, dueDate: s.validity,
      lines: [{ quantity: s.net, lme: s.lme, qmjp: s.qmjp, premium: null, product: 'Aluminium Ingot', grade: 'P1020' }],
    });
    if (s.reissue) inv.header.reissueDate = s.reissue;
    if (s.paid) inv.header.paidNote = s.paid;
    fs.writeFileSync(path.join(out, `ours-${name}.json`), JSON.stringify({ iv, inv }, null, 1));
    for (const [kind, html, margin] of [
      ['ivpl', renderHoeiIvPlHtml(iv.header, iv.items), { top: '12mm', right: '11mm', bottom: '14mm', left: '11mm' }],
      ['inv', renderHoeiInvoiceHtml(inv.header, inv.rows), { top: '14mm', right: '13mm', bottom: '14mm', left: '13mm' }],
    ] as const) {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      fs.writeFileSync(path.join(out, `ours-${kind}-${name}.pdf`), await page.pdf({ format: 'A4', printBackground: true, margin }));
      await page.close();
    }
  }
  await browser.close();
  console.log('ok');
})();
