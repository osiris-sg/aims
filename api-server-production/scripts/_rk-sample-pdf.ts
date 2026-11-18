/** Local render of a Racking quotation (flag on; --off = today's look) to a PDF + PNG, for eyeballing. No DB, nothing sent. */
import * as fs from 'fs';
import { renderDocumentHtml, pdfOptionsFor } from '../src/common/services/document-html';
import { effectiveDesign } from '../src/common/services/document-html/wct-brand';
import { PdfGeneratorService } from '../src/common/services/pdf-generator.service';
const out = process.argv[2];
const footer = fs.readFileSync(process.argv[3], 'utf8');
const org = { id: 'r', name: 'WCT Racking Pte Ltd', address: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099', registrationNumber: '202100255Z', phoneNumber: '6741 1697', email: 'info@wct.com.sg', website: 'www.wct.com.sg' };
const OFF = process.argv.includes('--off');
const design = effectiveDesign({ layout: 'wct', titleText: 'QUOTATION', headerAlign: 'left', showDueDate: false, logoPosition: 'left', showBankDetails: false, showAmountInWords: false, showGeneratedNote: true }, 'QUOTATION', OFF ? {} : { enableRackingLayout: true });
const items = [
  { description: 'Heavy Duty Racking Works', isGroupHeader: true },
  { description: 'Supply heavy duty end frame\n- H3000xD900mm', quantity: 8, uom: 'pcs', unitPrice: 200, amount: 1600 },
  { description: 'Supply heavy duty boxbeam\n- L2450mm\n- Safe working load 1000kg/tier', quantity: 16, uom: 'pcs', unitPrice: 50, amount: 800 },
  { description: 'Supply 25mm thk plywood shelvings\n- 2430x900mm', quantity: 8, uom: '', unitPrice: 70, amount: 560 },
  { description: 'Pre Renovation works', isGroupHeader: true },
  { description: 'Delivery and installation', quantity: 1, uom: 'lot', unitPrice: 800, amount: 800 },
];
const data: any = {
  documentType: 'QUOTATION', name: 'WR-QO202611-TEST', design, organization: org, company: org, logoUrl: process.env.LOGO || '',
  customer: { name: 'TEST Client', address: '1 Raffles Place, Singapore 048616' }, items,
  documentInfo: { documentNumber: 'WR-QO202611-TEST', date: '2026-11-18', currency: 'SGD', subject: 'Heavy duty racking works', location: 'TEST site', contactName: 'Elroy Test', contactEmail: 'test@example.com',
    salesPerson: 'S004', salesPersonName: 'Nee Meng Tan', salesContact: '9181 9107', taxApplicable: 'N', gstPercent: 9, discountPercent: 5, discountAmount: 188, signedByTitle: 'Manager' },
  // --off: the same quotation as Racking prints it today (its current defaults: footer text in the T&Cs, the computer-generated line).
  termsAndConditions: footer, note: '', footerMessage: OFF ? 'This is computer generated, no signature is required' : '',
};
(async () => {
  const html = renderDocumentHtml('QUOTATION', data, org)!;
  fs.writeFileSync(out + '.html', html);
  const pdf = await new PdfGeneratorService().generatePdfFromHtml(html, pdfOptionsFor('QUOTATION', data));
  fs.writeFileSync(out + '.pdf', pdf);
  console.log('written', out + '.pdf', pdf.length);
})();
