/**
 * Round BQ — backfill: read every filed invoice / bill / customer invoice PDF on ADH's OPEN orders that has no INVOICE
 * read yet (text layer, else the AI) and store it as a TradeExtraction of kind INVOICE — what the Dashboard "Unpaid"
 * list shows. New uploads are read automatically; this covers the files filed before round BQ.
 * Dry run by default (reads in memory, prints, writes nothing); --apply stores the reads (+ one Activity Log row each).
 * Needs round BQ deployed (the INVOICE enum value) before --apply.
 *
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bq-invoice-read.ts [--apply]
 */
require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { DocumentExtractionService } from '../src/document-extraction/document-extraction.service';
import { pdfText } from '../src/shipments/trade-coa';
import { INVOICE_SYSTEM_PROMPT, INVOICE_USER_PROMPT, InvoiceFacts, readInvoiceBuffer } from '../src/shipments/trade-invoice-read';
import { INVOICE_READ_DOC_TYPES } from '../src/shipments/trade-extract.service';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const money = (v: number | null, c: string | null) => (v === null ? '—' : `${c ?? '?'} ${v.toLocaleString('en-US', { minimumFractionDigits: c === 'JPY' ? 0 : 2, maximumFractionDigits: c === 'JPY' ? 0 : 2 })}`);

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  if (!APPLY) await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const s3 = new S3Service({ get: (k: string) => process.env[k] } as any);
  const ai = new DocumentExtractionService();
  const files: any[] = await p.tradeFile.findMany({
    where: { organizationId: ADH, docType: { in: INVOICE_READ_DOC_TYPES }, source: { not: 'GENERATED' }, links: { some: { hiddenAt: null, OR: [{ order: { status: 'OPEN', isTest: false } }, { shipment: { status: { not: 'CANCELLED' }, order: { status: 'OPEN', isTest: false } } }] } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, docType: true, fileName: true, s3Key: true, mimeType: true },
  });
  // Already read (only after deploy — the enum value does not exist on prod before).
  const done = new Set<string>();
  if (APPLY) for (const x of await p.tradeExtraction.findMany({ where: { organizationId: ADH, kind: 'INVOICE' as any, status: 'DONE', fileId: { in: files.map((f) => f.id) } }, select: { fileId: true } })) done.add(x.fileId);
  let stored = 0;
  for (const f of files) {
    if (done.has(f.id)) {
      console.log(`  ${f.fileName.slice(0, 60).padEnd(60)} already read`);
      continue;
    }
    if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(f.mimeType)) continue;
    const started = Date.now();
    let tokens = { model: 'text-layer', inputTokens: 0, outputTokens: 0 };
    const r = await readInvoiceBuffer(await s3.downloadFile(f.s3Key), f.mimeType, {
      pdfText,
      ai: async (buffer, mimetype) => {
        const out = await (ai as any).extractStructured({ buffer, mimetype }, INVOICE_SYSTEM_PROMPT, INVOICE_USER_PROMPT, { maxTokens: 1500 });
        tokens = { model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
        return out.data;
      },
    });
    const one = (x: InvoiceFacts) => `${x.via}/${x.docKind} ${x.issuer ?? '?'} ${x.invoiceNo ?? '?'} ${money(x.total, x.currency)} due ${x.dueDate ?? (x.dueWithNext ? 'with next' : '—')}`;
    console.log(`  ${f.fileName.slice(0, 60).padEnd(60)} → ${r.invoices ? r.invoices.map(one).join(' ; ') : `not read (${r.error})`}`);
    if (!APPLY) continue;
    const row = await p.tradeExtraction.create({
      data: { organizationId: ADH, fileId: f.id, kind: 'INVOICE' as any, status: r.invoices ? 'DONE' : 'FAILED', result: r.invoices ? ({ invoices: r.invoices } as any) : undefined, error: r.error?.slice(0, 2000) ?? null, ...tokens, durationMs: Date.now() - started, createdById: 'system:round-bq-invoice-read' },
      select: { id: true },
    });
    await p.actionLog.create({
      data: { actorType: 'SYSTEM', actorId: 'system:round-bq-invoice-read', actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'CREATE', resource: 'TradeExtraction', resourceId: row.id, details: { script: 'scripts/_bq-invoice-read.ts', fileId: f.id, fileName: f.fileName, docType: f.docType, invoices: (r.invoices ?? []).map((x) => ({ invoiceNo: x.invoiceNo, total: x.total, currency: x.currency, dueDate: x.dueDate, docKind: x.docKind, via: x.via })), error: r.error } as any },
    });
    stored++;
  }
  console.log(`\n${files.length} file(s); ${APPLY ? `stored ${stored} read(s)` : 'dry run — nothing written'}`);
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
