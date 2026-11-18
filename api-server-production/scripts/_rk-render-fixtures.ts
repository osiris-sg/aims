/**
 * Renders a fixed set of documents for every org shape through the real
 * effectiveDesign + renderer + PDF generator, writing HTML and PDF (with
 * CreationDate/ModDate/ID stripped) to an output folder. Run before and after a
 * change and diff the folders: other orgs must be byte-identical.
 *
 *   npx ts-node --transpile-only <this> <api-src-dir> <out-dir> [--pdf]
 */
import * as fs from 'fs';
import * as path from 'path';

const [srcDir, outDir] = process.argv.slice(2);
const withPdf = process.argv.includes('--pdf');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderDocumentHtml, pdfOptionsFor } = require(path.join(srcDir, 'common/services/document-html/index'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { effectiveDesign } = require(path.join(srcDir, 'common/services/document-html/wct-brand'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PdfGeneratorService } = require(path.join(srcDir, 'common/services/pdf-generator.service'));

const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const items = [
  { description: 'Heavy Duty Racking Works', isGroupHeader: true },
  { description: 'Supply heavy duty end frame\n- H3000xD900mm', quantity: 8, unitPrice: 200, amount: 1600, uom: 'pcs' },
  { description: 'Supply heavy duty boxbeam', quantity: 16, unitPrice: 50, amount: 800, uom: '' },
  { description: 'Pre Renovation works', isGroupHeader: true },
  { description: 'Delivery and installation', quantity: 1, unitPrice: 800, amount: 800, uom: 'lot' },
];
const base = (extra: any = {}) => ({
  name: 'QO-1',
  customer: { name: 'TEST Client', address: '1 Raffles Place' },
  items,
  documentInfo: { documentNumber: 'QO-1', date: '2026-11-18', currency: 'SGD', subject: 'Racking', location: 'Site A', salesPersonName: 'Nee Meng', salesContact: '9000 0000', gstPercent: 9, taxApplicable: 'Y' },
  termsAndConditions: '- Term one\n- Term two',
  note: '<b>PAYMENT TERMS:</b>\nFirst Payment - 50%',
  footerMessage: 'This is computer generated, no signature is required',
  logoUrl: 'https://x/logo.png',
  ...extra,
});
const orgs: Record<string, { org: any; features: any; tpl: any; doc?: any }> = {
  wct: { org: { id: 'w', name: 'WCT (S) Systems Pte Ltd', address: 'Addr', registrationNumber: '201724603K', phoneNumber: '1', email: 'e@x', website: 'w' }, features: { enableWctOrders: true, enableDocRemarks: true }, tpl: { layout: 'wct', logoPosition: 'left', titleText: 'QUOTATION' } },
  bcair: { org: { id: 'b', name: 'BC AIR PTE. LTD.', address: 'Addr', registrationNumber: '202205130K' }, features: { wctDocumentBrand: 'BCAIR', enableDocRemarks: true }, tpl: { layout: 'wct', logoPosition: 'left' } },
  racking: { org: { id: 'r', name: 'WCT Racking Pte Ltd', address: 'Addr', registrationNumber: '202100255Z', phoneNumber: '6741 1697' }, features: { enableWctOrders: true, enableDocRemarks: true }, tpl: { layout: 'wct', logoPosition: 'left', titleText: 'QUOTATION' } },
  stock: { org: { id: 's', name: 'Other Org', address: 'Addr', registrationNumber: 'X1' }, features: {}, tpl: null },
  // Section-title numbering cutoff set, documents created BEFORE it: must print exactly as before.
  wctOld: { org: { id: 'w', name: 'WCT (S) Systems Pte Ltd', address: 'Addr', registrationNumber: '201724603K' }, features: { enableWctOrders: true, snoSkipTitlesSince: '2026-11-18T12:00:00.000Z' }, tpl: { layout: 'wct', logoPosition: 'left', titleText: 'QUOTATION' }, doc: { createdAt: '2026-11-01T00:00:00.000Z' } },
  bcairOld: { org: { id: 'b', name: 'BC AIR PTE. LTD.', address: 'Addr', registrationNumber: '202205130K' }, features: { wctDocumentBrand: 'BCAIR', snoSkipTitlesSince: '2026-11-18T12:00:00.000Z' }, tpl: { layout: 'wct', logoPosition: 'left' }, doc: { createdAt: '2026-11-18T11:59:59.000Z' } },
  rackingOldInvoice: { org: { id: 'r', name: 'WCT Racking Pte Ltd', address: 'Addr', registrationNumber: '202100255Z' }, features: { snoSkipTitlesSince: '2026-11-18T12:00:00.000Z' }, tpl: { layout: 'wct', logoPosition: 'left', titleText: 'TAX INVOICE' }, doc: { createdAt: '2026-11-02T00:00:00.000Z' } },
};
const variants: Record<string, any> = {
  plain: {},
  discount: { documentInfo: { ...base().documentInfo, discountAmount: 300, discountPercent: 8.571429 } },
  noTax: { documentInfo: { ...base().documentInfo, taxApplicable: 'N' } },
  signed: { config: { clientSignature: { image: SIG, name: 'Tan', signedAt: '2026-11-18T09:00:00+08:00' } } },
  remarks: { remarks: 'Remark line' },
};
const types = ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER', 'CREDIT_NOTE'];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const pdf = withPdf ? new PdfGeneratorService() : null;
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  let n = 0;
  for (const [orgKey, o] of Object.entries(orgs)) {
    if (only && !only.includes(orgKey)) continue;
    for (const t of types) {
      for (const [vKey, v] of Object.entries(variants)) {
        const design = effectiveDesign(o.tpl, t, o.features, o.doc);
        const data = { documentType: t, ...base(v), design, organization: o.org, company: o.org };
        const html = renderDocumentHtml(t, data, o.org);
        const file = `${orgKey}-${t}-${vKey}`;
        fs.writeFileSync(path.join(outDir, `${file}.json`), JSON.stringify({ design, pdfOptions: pdfOptionsFor(t, data) ?? null }, null, 1));
        if (html === null) continue;
        fs.writeFileSync(path.join(outDir, `${file}.html`), html);
        n++;
        if (pdf && vKey !== 'remarks') {
          const buf: Buffer = await pdf.generatePdfFromHtml(html, pdfOptionsFor(t, data));
          const clean = buf.toString('latin1').replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, '').replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, '');
          fs.writeFileSync(path.join(outDir, `${file}.pdf.txt`), clean, 'latin1');
        }
      }
    }
  }
  console.log(`${n} documents rendered to ${outDir}`);
})().catch((e) => { console.error(e); process.exit(1); });
