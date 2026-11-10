/**
 * Round BP item 7 / BQ — READ-ONLY: the Dashboard "Unpaid" lists as of today on prod (the service the card calls),
 * with each row's reason. Invoices / bills that have no stored INVOICE read yet are read IN MEMORY here (text layer,
 * else the AI) — nothing is written. `--no-ai` skips the AI read for scans.
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bp-unpaid-list.ts [--no-ai | --stored]
 */
require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { TradeUnpaidService, UnpaidRow } from '../src/shipments/trade-unpaid.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';
import { S3Service } from '../src/common/services/s3.service';
import { DocumentExtractionService } from '../src/document-extraction/document-extraction.service';
import { pdfText } from '../src/shipments/trade-coa';
import { InvoiceFacts, INVOICE_SYSTEM_PROMPT, INVOICE_USER_PROMPT, readInvoiceBuffer } from '../src/shipments/trade-invoice-read';
import { INVOICE_READ_DOC_TYPES } from '../src/shipments/trade-extract.service';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const money = (v: number | null, c: string) => (v === null ? '—' : `${c} ${v.toLocaleString('en-US', { minimumFractionDigits: c === 'JPY' ? 0 : 2, maximumFractionDigits: c === 'JPY' ? 0 : 2 })}`);

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const s3 = new S3Service({ get: (k: string) => process.env[k] } as any);
  const ai = process.argv.includes('--no-ai') ? undefined : new DocumentExtractionService();
  // Invoice files on open orders without a stored read → read in memory.
  const files: any[] = await p.tradeFile.findMany({
    where: { organizationId: ADH, docType: { in: INVOICE_READ_DOC_TYPES }, source: { not: 'GENERATED' }, links: { some: { hiddenAt: null, OR: [{ order: { status: 'OPEN', isTest: false } }, { shipment: { status: { not: 'CANCELLED' }, order: { status: 'OPEN', isTest: false } } }] } } },
    select: { id: true, fileName: true, s3Key: true, mimeType: true },
  });
  const facts = new Map<string, InvoiceFacts[] | null>();
  const readLog: string[] = [];
  // Every invoice file is read here (before round BQ's deploy prod has no INVOICE reads stored).
  // --stored: use the reads stored on prod (round BQ backfill) — nothing is read here.
  for (const f of process.argv.includes('--stored') ? [] : files) {
    const r = await readInvoiceBuffer(await s3.downloadFile(f.s3Key), f.mimeType, {
      pdfText,
      ai: ai ? async (buffer, mimetype) => (await (ai as any).extractStructured({ buffer, mimetype }, INVOICE_SYSTEM_PROMPT, INVOICE_USER_PROMPT, { maxTokens: 1500 })).data : undefined,
    });
    facts.set(f.id, r.invoices);
    const one = (x: InvoiceFacts) => `${x.via}/${x.docKind} ${x.issuer ?? '?'} ${x.invoiceNo ?? '?'} ${money(x.total, x.currency ?? '?')} issued ${x.issueDate ?? '—'} due ${x.dueDate ?? (x.dueWithNext ? 'with next' : '—')}`;
    readLog.push(`  ${f.fileName.slice(0, 58).padEnd(58)} → ${r.invoices ? r.invoices.map(one).join(' ; ') : `not read (${r.error})`}`);
  }
  const svc = new TradeUnpaidService(p as any, new TradeDueService(p as any), null as any, new TradeConfigService(p as any), new TradeTaxInputsService(p as any, s3));
  const r = await svc.list(ADH, undefined, { invoiceFacts: facts });
  console.log(`as of ${r.today}`);
  console.log(`\nInvoice files read in memory (${readLog.length}):\n${readLog.join('\n')}`);
  const show = (title: string, rows: UnpaidRow[], totals: Record<string, number>) => {
    console.log(`\n${title} (${rows.length})`);
    let noDate = false;
    for (const x of rows) {
      if (!x.dueDate && !noDate) {
        noDate = true;
        console.log('  -- no due date --');
      }
      console.log(`  ${x.ref.padEnd(18)} | ${(x.counterparty ?? '—').slice(0, 24).padEnd(24)} | ${`${x.kind} ${x.documentNo ?? ''}`.slice(0, 34).padEnd(34)} | ${money(x.amount, x.currency).padStart(17)} | due ${x.dueDate ?? '—'.padEnd(10)} | ${x.daysLeft === null ? '—' : x.daysLeft < 0 ? `${-x.daysLeft}d overdue` : `${x.daysLeft}d left`} | ${x.reason}${x.note ? ` | ${x.note}` : ''}`);
    }
    console.log(`  totals: ${Object.entries(totals).map(([c, v]) => money(v, c)).join(' · ') || '—'}`);
  };
  show('TO PAY', r.pay, r.payTotals);
  show('TO RECEIVE', r.receive, r.receiveTotals);
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
