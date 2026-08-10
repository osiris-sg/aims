// Return-DO corrections (dev Biofuel) — guru 2026-08-11.
// 1. CN against BI202607035 (CCDC): kit fully returned 15/07 (RTN-DO202607-003)
//    → credit 16/31 days of $6,000/mth net.
// 2. Obayashi July-period invoice (arrears): 3 tanks full month + LBGU 321822-5
//    pro-rated 01–15/07 (RTN-DO202607-002).
// 3. Annotate the 3 recurring templates (name + reference) with CN/DELETE
//    status — templates are NOT deleted (guru will decide).
// BI202607037's CN is NOT created: the $6,000 bundle can't be split without
// the cable-only rate (quotation BI/EL/2025-0407 not in AIMS).
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel
const CCDC = '05b9ff38-ebc3-4e99-a699-afae1804ef0a';
const OBAYASHI = '7f4b54e1-b820-45fd-b73f-475c9b06a521';
const INVOICE_TPL = 'cc6d0035-993f-403f-8dd6-582ce8b10b0b'; // org's active INVOICE template
const CN_TPL = '039b4d60-322f-469b-ae9f-8e0a87c23bea'; // template used by AIMS-born CNs
const RENTAL_SALES_FMT = '6709eafb-2b10-43b5-b2a1-d8a558a7aa5b'; // BI{YYYY}{MM}{####}

const R = (n: number) => Math.round(n * 100) / 100;

// ---- replica of DocumentNumberingService.generateNumber (format + claim) ----
const DOC_CODE: Record<string, string> = { INVOICE: 'INV', CREDIT_NOTE: 'CN' };

function fmtPattern(pattern: string, serial: number, date: Date, docCode = ''): string {
  const YYYY = String(date.getFullYear());
  const YY = YYYY.slice(2);
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok: string) => {
    if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
    if (tok === 'DOC') return docCode;
    return tok.replace(/YYYY/g, YYYY).replace(/YY/g, YY).replace(/MM/g, MM).replace(/DD/g, DD);
  });
}

async function mintNumber(formatId: string, when: Date): Promise<string> {
  const format = await prisma.documentNumberFormat.findUniqueOrThrow({ where: { id: formatId } });
  const docCode = DOC_CODE[format.documentType] || '';
  // max existing serial in this pattern's namespace (Xero imports bypass the counter)
  const serialToken = /\{(#+)\}/.exec(format.pattern);
  if (!serialToken) throw new Error('pattern has no serial token');
  const prefix = fmtPattern(format.pattern.slice(0, serialToken.index), 0, when, docCode);
  const suffix = fmtPattern(format.pattern.slice(serialToken.index + serialToken[0].length), 0, when, docCode);
  const existing = await prisma.document.findMany({
    where: { organizationId: ORG, name: { startsWith: prefix } },
    select: { name: true },
  });
  let maxExisting = 0;
  for (const d of existing) {
    const name = d.name || '';
    if (suffix && !name.endsWith(suffix)) continue;
    const mid = name.slice(prefix.length, suffix ? name.length - suffix.length : undefined);
    if (/^\d+$/.test(mid)) maxExisting = Math.max(maxExisting, parseInt(mid, 10));
  }
  const claimed = await prisma.$transaction(async (tx) => {
    const f = await tx.documentNumberFormat.findUniqueOrThrow({ where: { id: format.id } });
    const serial = Math.max(f.nextSerial, maxExisting + 1); // resetPolicy=never on both formats
    await tx.documentNumberFormat.update({ where: { id: f.id }, data: { nextSerial: serial + 1 } });
    return serial;
  });
  return fmtPattern(format.pattern, claimed, when, docCode);
}

type Item = {
  description: string; quantity: number; unitPrice: number; amount: number;
  taxAmount: number; accountCode: string | null; lineNumber: number;
  taxType: null; discount: number; itemCode: null;
};
const line = (n: number, description: string, unitPrice = 0, accountCode: string | null = null, quantity = 1): Item => ({
  description, quantity, unitPrice, amount: R(unitPrice * quantity),
  taxAmount: R(unitPrice * quantity * 0.09), accountCode, lineNumber: n,
  taxType: null, discount: 0, itemCode: null,
});

function docConfig(number: string, when: Date, customerId: string, customerName: string, reference: string, items: Item[]) {
  const subTotal = R(items.reduce((s, i) => s + i.amount, 0));
  const gstAmount = R(items.reduce((s, i) => s + i.taxAmount, 0));
  const nettTotal = R(subTotal + gstAmount);
  return {
    date: when.toISOString(),
    items,
    billTo: '',
    dueDate: null,
    customer: { id: customerId, name: customerName },
    subTotal,
    attention: { name: '', email: '', phone: '' },
    gstAmount,
    nettTotal,
    reference,
    customerId,
    documentInfo: { date: when.toISOString(), currency: 'SGD', gstPercent: 9, documentNumber: number },
    xeroImported: false,
    documentNumber: number,
  };
}

async function main() {
  const when = new Date();

  // ---------- 1. CN against BI202607035 (CCDC, returned 15/07) ----------
  const cnNet = R(6000 * (16 / 31)); // 3096.77
  const cnNo = await mintNumber('d569f279-3845-4df6-9e27-9da56e9108e7', when);
  const cnItems = [
    line(1,
      'Credit for rental period from 16/07/2026 to 31/07/2026 — equipment off-hired on 15/07/2026\n' +
      '(Return DO No. RTN-DO202607-003 dated 15/07/2026)\n\n' +
      '1). One unit Micro-Grid System LION375, S/No. MG20250103\n' +
      '2). One unit 60KVA Denyo Soundproof Diesel Generator, Code: G060183\n' +
      '3). Cables & accessories per DO202601-006\n\n' +
      'Against our Invoice No. BI202607035 dated 01/07/2026\n' +
      '(Rental for the period from 01/07/2026 to 31/07/2026 - 7th mth)\n' +
      'Pro-rated 16/31 days of SGD6,000.00 per month',
      cnNet, '214'),
  ];
  const cn = await prisma.document.create({
    data: {
      organizationId: ORG,
      type: 'CREDIT_NOTE',
      name: cnNo,
      status: 'unconfirmed',
      documentTemplateId: CN_TPL,
      config: docConfig(cnNo, when, CCDC, 'China Construction (South Pacific) Development Co Pte Ltd',
        `C/N against BI202607035 — RTN-DO202607-003 off-hired 15/07/2026`, cnItems),
    },
  });
  console.log(`Created CN ${cnNo} (${cn.id}) — net ${cnNet}, GST ${R(cnNet * 0.09)}, gross ${R(cnNet * 1.09)}`);

  // ---------- 2. Obayashi July-period invoice (arrears) ----------
  const stub = R(2600 * (15 / 31)); // 1258.06
  const invNo = await mintNumber(RENTAL_SALES_FMT, when);
  const invItems = [
    line(1, 'Monthly Rental of Waste Water Holding Tank (24m3) for the period of:-\n(Quotation Ref. No.: 2023-0724 (REV) dated 01/08/2023)'),
    line(2,
      '1. Period from 01/07/2026 to 31/07/2026 at SGD7,800 per month (3 units)\n\n' +
      'Tank No.:\nLBGU 240089-4\nLBGU 240239-3\nLBGU 260397-3\n\n' +
      'Our DO No. BI202308-006 dated 26/08/2023',
      7800, '212'),
    line(3,
      '2. Period from 01/07/2026 to 15/07/2026 (1 unit) — returned 15/07/2026\n' +
      '(Return DO No. RTN-DO202607-002 dated 15/07/2026)\n\n' +
      'Tank No.:\nLBGU 321822-5\n\n' +
      'Pro-rated 15/31 days of SGD2,600.00 per month',
      stub, '212'),
    line(4, 'Your PO No. PUPO004355 dated 16/08/2023'),
    line(5, 'Project Location: HDB Tengah C3C7'),
  ];
  const inv = await prisma.document.create({
    data: {
      organizationId: ORG,
      type: 'INVOICE',
      name: invNo,
      status: 'unconfirmed',
      documentTemplateId: INVOICE_TPL,
      config: docConfig(invNo, when, OBAYASHI, 'Obayashi Singapore Pte Ltd',
        '(Monthly Rental — July 2026: 3 units full month + LBGU 321822-5 pro-rated to 15/07)', invItems),
    },
  });
  const invNet = R(7800 + stub);
  console.log(`Created INV ${invNo} (${inv.id}) — net ${invNet}, GST ${R(702 + stub * 0.09)}, gross ${R(invNet + 702 + R(stub * 0.09))}`);

  // ---------- 3. Annotate recurring templates (NO deletion) ----------
  // 3a. BI202607035 — fully returned, CN issued, slated for delete
  const t35 = await prisma.recurringInvoiceTemplate.findUniqueOrThrow({ where: { id: '2be6b66d-5305-411f-8665-b45834d38eec' } });
  const c35: any = t35.config || {};
  await prisma.recurringInvoiceTemplate.update({
    where: { id: t35.id },
    data: {
      name: `Recurring — BI202607035 [TO DELETE — fully returned 15/07/2026, ${cnNo} issued] (was 7th mth → next 8th)`,
      config: { ...c35, reference: `[TO DELETE — kit returned 15/07/2026 per RTN-DO202607-003; ${cnNo} credits 16/07–31/07] ` + (c35.reference || '') },
    },
  });
  console.log(`Annotated template BI202607035 → TO DELETE (${cnNo} issued)`);

  // 3b. BI202607037 — kit returned 17/07, cables continue; CN pending rate
  const t37 = await prisma.recurringInvoiceTemplate.findUniqueOrThrow({ where: { id: 'ecdc8c71-780d-42de-8f69-cdb9d9e94652' } });
  const c37: any = t37.config || {};
  await prisma.recurringInvoiceTemplate.update({
    where: { id: t37.id },
    data: {
      name: 'Recurring — BI202607037 [CN PENDING — kit returned 17/07/2026, cables continue; need cable-only rate] (was 3rd mth → next 4th)',
      config: { ...c37, reference: '[CN PENDING cable-only rate — MG20250058 + genset returned 17/07/2026 per RTN-DO202607-004; cables continue to rent; trim items to cables-only before activating] ' + (c37.reference || '') },
    },
  });
  console.log('Annotated template BI202607037 → CN PENDING (cable-only rate needed)');

  // 3c. BI202607012 — trim 4 tanks → 3 (LBGU 321822-5 returned 15/07);
  //     July period now billed manually, so next run = Sep (covers Aug).
  const t12 = await prisma.recurringInvoiceTemplate.findUniqueOrThrow({ where: { id: '83a0e6c0-bee4-4599-af26-e2fd98863c53' } });
  const c12: any = t12.config || {};
  const items12 = (c12.items || []).map((it: any) => {
    let d: string = it.description || '';
    if (!d.includes('SGD10,400')) return it;
    d = d
      .replace('Monthly Rental of 4 units', 'Monthly Rental of 3 units')
      .replace('at SGD10,400 per month (4 units)', 'at SGD7,800 per month (3 units)')
      .replace('\nLBGU 321822-5', '');
    return { ...it, description: d, unitPrice: 7800, amount: 7800 };
  });
  await prisma.recurringInvoiceTemplate.update({
    where: { id: t12.id },
    data: {
      name: `Recurring — BI202607012 [UPDATED 4→3 tanks — LBGU 321822-5 returned 15/07/2026; Jul period billed on ${invNo}] (from Jul BI202607012)`,
      nextRunDate: new Date('2026-09-01T01:00:00.000Z'),
      config: {
        ...c12,
        items: items12,
        reference: '(Monthly Rental of 3 units Waste Water Holding Tank — was 4; LBGU 321822-5 returned 15/07/2026 per RTN-DO202607-002)',
      },
    },
  });
  console.log(`Annotated template BI202607012 → 3 tanks @ SGD7,800; next run 01/09/2026 (Jul billed on ${invNo})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
