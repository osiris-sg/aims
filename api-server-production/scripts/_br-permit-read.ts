/**
 * Round BR — read the import permits filed on #18-2, #19-1, #19-2 (step 10) and put the import tax total into the
 * shipment's EMPTY costs.importTaxActual only (never over a typed value). Dry run by default: text layer + file name,
 * nothing written. --apply runs the normal step-10 reader (TradeExtractService.extract IMPORT_PERMIT → a stored read,
 * AI when the text layer is not enough), then fills the empty field; every write is logged (old → new).
 *
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_br-permit-read.ts [--apply]
 */
require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { DocumentExtractionService } from '../src/document-extraction/document-extraction.service';
import { TradeExtractService } from '../src/shipments/trade-extract.service';
import { pdfText } from '../src/shipments/trade-coa';
import { parsePermitText, permitTotalFromFileName } from '../src/shipments/trade-customs';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const TARGETS: Array<[number, number]> = [
  [18, 2],
  [19, 1],
  [19, 2],
];
const yen = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `¥${n.toLocaleString('en-US')}`);

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  if (!APPLY) await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const s3 = new S3Service({ get: (k: string) => process.env[k] } as any);
  const svc = new TradeExtractService(p as any, s3, {} as any, new DocumentExtractionService());
  for (const [orderNo, seqNo] of TARGETS) {
    const ref = `#${orderNo}-${seqNo}`;
    const sh: any = await p.shipment.findFirst({
      where: { organizationId: ADH, seqNo, order: { orderNo, isTest: false } },
      select: { id: true, costs: true, fileLinks: { where: { hiddenAt: null, file: { docType: 'IMPORT_PERMIT' } }, orderBy: { createdAt: 'desc' }, select: { file: { select: { id: true, fileName: true, s3Key: true, mimeType: true } } } } },
    });
    if (!sh) {
      console.log(`${ref}: shipment not found`);
      continue;
    }
    const costs = (sh.costs ?? {}) as Record<string, unknown>;
    const had = typeof costs.importTaxActual === 'number' ? (costs.importTaxActual as number) : null;
    const files = sh.fileLinks.map((l: any) => l.file);
    if (!files.length) {
      console.log(`${ref}: no import permit filed`);
      continue;
    }
    const f = files[0];
    let total: number | null = null;
    let via = '';
    if (!APPLY) {
      const t = f.mimeType === 'application/pdf' ? await pdfText(await s3.downloadFile(f.s3Key)).catch(() => '') : '';
      const r = parsePermitText(t);
      total = r.data.total ?? permitTotalFromFileName(f.fileName);
      via = r.data.total !== null ? 'text layer' : total !== null ? 'file name' : 'needs the AI read (on --apply)';
    } else {
      const x: any = await svc.extract(ADH, 'IMPORT_PERMIT', { fileId: f.id, shipmentId: sh.id }, { id: 'system:round-br-permit-read', name: 'System creation' } as any);
      total = x?.result?.permit?.total ?? null;
      via = `${x?.status} (${x?.result?.via ?? '?'}${x?.result?.totalFrom ? `, total from ${x.result.totalFrom}` : ''})`;
      await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-br-permit-read', actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'CREATE', resource: 'TradeExtraction', resourceId: x?.id ?? null, details: { script: 'scripts/_br-permit-read.ts', go: 'owner 2026-11-10 (read the permits on #18-2, #19-1, #19-2)', shipment: ref, fileId: f.id, fileName: f.fileName, total, status: x?.status } as any } });
    }
    const fill = had === null && total !== null;
    console.log(`${ref}: permit ${f.fileName} → total ${yen(total)} via ${via} | importTaxActual now ${yen(had)} → ${fill ? `${APPLY ? 'write' : 'would write'} ${yen(total)}` : had !== null ? 'kept (already set)' : 'nothing to fill'}`);
    if (APPLY && fill) {
      await p.shipment.update({ where: { id: sh.id }, data: { costs: { ...costs, importTaxActual: total } as any } });
      await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-br-permit-read', actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'UPDATE', resource: 'Shipment', resourceId: sh.id, details: { script: 'scripts/_br-permit-read.ts', go: 'owner 2026-11-10', shipment: ref, 'costs.importTaxActual': { from: null, to: total }, source: f.fileName } as any } });
    }
  }
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
