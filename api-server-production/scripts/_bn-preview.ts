/**
 * Round BN — READ-ONLY preview of the SUS Invoice #1 (order #25, 6005, 200 MT) with the round's code:
 *   1. draft-1106: the draft AIMS makes on 2026-11-06 now (prefill + 備考 + bank + layout), from prod data and the
 *      PROPOSED docDefaults texts below (applied in memory only — nothing is written);
 *   2. final-0003: Sayaka's finalized ADH-INV-2026-0003 values (stored header + lines) re-rendered with the new
 *      stamp placement (its stored PDF is not touched).
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bn-preview.ts --out=<dir>
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { defaultBank, defaultLmeMonth, DocDefaults, fillAutoRemarks, invoice1Line, invoice1UpchargeTemplate, invoiceHeaderDefaults, invoiceTotals, renderInvoiceHtml, toInvoiceLines } from '../src/shipments/trade-invoice';
import { readInvoiceLayout, resolveInvoiceLayout } from '../src/shipments/trade-invoice-layout';
import { invoiceAddressee, orderLine } from '../src/shipments/trade-generated.service';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const FINAL_0003 = 'fdf5b0a3-e0ab-4f2c-b6f8-26f82458eef6';
/** Proposed docDefaults (go needed): ADH's Oct 2026 備考 per line and the TTM note. */
export const PROPOSED: Partial<DocDefaults> = {
  invoiceRemarksTemplate: 'LME Cash {monthJa}平均　\nUSD {LME:2}\n + Q{q} MJP {QMJP:2}\n + Billet Premium {premium:2}{upcharge}',
  invoice1UpchargeTemplate: '\n + {grade} Upcharge {upcharge:2}',
  invoiceFxNote: '円/USD {ttmDate}  三菱UFJ銀行TTM参照',
};

async function main() {
  const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
  if (!out) throw new Error('--out=<dir>');
  fs.mkdirSync(out, { recursive: true });
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const ts: any = await p.tradeSetting.findUnique({ where: { organizationId: ADH } });
  const stored = (ts?.docDefaults ?? {}) as DocDefaults;
  const defaults: DocDefaults = { ...stored, ...PROPOSED };
  const profiles = (ts?.customerProfiles ?? {}) as Record<string, any>;
  const org = await p.organization.findFirst({ where: { id: ADH }, select: { name: true, address: true, registrationNumber: true } });
  const o: any = await p.tradeOrder.findFirst({ where: { organizationId: ADH, orderNo: 25 }, include: { customer: true, contract: { select: { id: true, contractNo: true } } } });
  const seal = typeof stored.sealImage === 'string' ? stored.sealImage : null;
  const prof = profiles[o.customerId] ?? {};
  const layout = resolveInvoiceLayout(readInvoiceLayout(stored.invoiceLayout), readInvoiceLayout(prof.docFormats?.INVOICE?.layout));

  // 1. The draft as made on 2026-11-06 (createBlank's INVOICE_1-on-an-order path).
  const h = invoiceHeaderDefaults({ today: '2026-11-06', org: org ?? { name: '' }, customerName: invoiceAddressee(o.customer), grades: [o.grade ?? ''], products: [o.product ?? ''], defaults, lmeMonth: defaultLmeMonth('INVOICE_1', o.shipMonth) });
  const bank = prof.defaultBankId ? defaultBank(defaults, prof.defaultBankId) : null; // the customer's account wins (createBlank)
  const header = { ...h, ...(bank && bank.id === prof.defaultBankId ? { bankId: bank.id, bankBlock: bank.block } : {}) };
  let rows: any[] = [{ ...invoice1Line({ id: o.contract?.id ?? '', contractNo: o.contract?.contractNo ?? '' }, orderLine(o), defaults, h.dueDate, h.lmeMonth), orderId: o.id }];
  rows = fillAutoRemarks(rows, h.lmeMonth, defaults.invoiceRemarksTemplate, invoice1UpchargeTemplate(defaults));
  fs.writeFileSync(path.join(out, 'draft-1106.html'), renderInvoiceHtml({ ...header, printLayout: layout }, toInvoiceLines(rows), { draft: true, seal }));
  const t1 = invoiceTotals(toInvoiceLines(rows), header.taxRate, header.fxRate);
  console.log('draft-1106:', JSON.stringify({ issueDate: header.issueDate, lmeMonth: header.lmeMonth, bankId: header.bankId, fxRate: header.fxRate, fxNote: header.fxNote, total: t1.total, remarks: rows[0].remarks, layout }));

  // 2. ADH-INV-2026-0003 (Sayaka's values) with the new placement.
  const g: any = await p.tradeGeneratedDoc.findFirst({ where: { id: FINAL_0003, organizationId: ADH } });
  const lines = toInvoiceLines(g.rows);
  fs.writeFileSync(path.join(out, 'final-0003.html'), renderInvoiceHtml({ ...g.header, printLayout: layout }, lines, { draft: true, seal }));
  const t2 = invoiceTotals(lines, g.header.taxRate, g.header.fxRate);
  console.log('final-0003:', JSON.stringify({ issueDate: g.header.issueDate, bankId: g.header.bankId, fxRate: g.header.fxRate, fxNote: g.header.fxNote, total: t2.total, jpy: t2.jpy }));
  await p.$disconnect();
}

if (require.main === module)
  main().catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 400));
    process.exit(1);
  });
