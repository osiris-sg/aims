/**
 * Round BS part 1 — SUS asked for one Customer COA (COA_集計ファイル) / PACKING LIST per shipment (per B/L). Existing
 * DRAFTS that cover several shipments (round AO's lot) are replaced by one draft per covered shipment, built from that
 * shipment's own Vedanta file; the old draft is kept HIDDEN (hiddenAt + reason), never deleted. FINAL documents never
 * change. Dry run by default: lists the drafts and builds each per-shipment draft in memory (header date line, invoice
 * no., casts, totals) — nothing written. --apply creates the drafts + hides the old one, one Activity Log row per write.
 * --apply needs round BS deployed (the hiddenAt column).
 *
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bs-sus-split.ts [--apply] [--html=<dir>]
 */
require('dotenv').config();
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { shipmentRef } from '../src/shipments/shipments.rules';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const HTML = process.argv.find((a) => a.startsWith('--html='))?.slice(7) ?? null;
const ACTOR = { id: 'system:round-bs-sus-split', name: 'System creation' } as any;

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  if (!APPLY) await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const s3 = new S3Service({ get: (k: string) => process.env[k] } as any);
  const gen = new TradeGeneratedService(p as any, s3, null as any, new TradeConfigService(p as any), null as any, null as any, null as any);
  const drafts: any[] = await p.tradeGeneratedDoc.findMany({
    where: { organizationId: ADH, status: 'DRAFT', docType: { in: ['CUSTOMER_COA', 'CUSTOMER_PL'] }, ...(APPLY ? { hiddenAt: null } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, docType: true, docRef: true, templateKey: true, shipmentId: true, coversShipmentIds: true, header: true, rows: true, createdAt: true, createdByName: true },
  });
  const multi = drafts.filter((d) => (d.coversShipmentIds ?? []).length > 1);
  const finals = await p.tradeGeneratedDoc.count({ where: { organizationId: ADH, status: 'FINAL', docType: { in: ['CUSTOMER_COA', 'CUSTOMER_PL'] }, NOT: { coversShipmentIds: { isEmpty: true } } } });
  console.log(`${drafts.length} SUS-able COA / PL draft(s); ${multi.length} cover several shipments. Finalized multi-shipment documents (never changed): ${finals}.\n`);
  for (const d of multi) {
    const ships: any[] = await p.shipment.findMany({ where: { organizationId: ADH, id: { in: d.coversShipmentIds } }, orderBy: { seqNo: 'asc' }, select: { id: true, seqNo: true, blNumber: true, ciNumber: true, status: true, netWeightMt: true, order: { select: { orderNo: true } } } });
    const h = (d.header ?? {}) as Record<string, any>;
    const kind = d.docType === 'CUSTOMER_COA' ? 'COA 集計' : 'PACKING LIST';
    console.log(`DRAFT ${kind} ${d.docRef ?? d.id} (created ${d.createdAt.toISOString().slice(0, 10)}${d.createdByName ? ` by ${d.createdByName}` : ''})`);
    console.log(`  covers ${ships.map((s) => shipmentRef(s.order?.orderNo, s.seqNo)).join(', ')} · B/Ls ${ships.map((s) => s.blNumber ?? '?').join(', ')} · date line "${h.dateLine ?? h.date ?? '—'}" · invoice no. "${h.invoiceNo ?? '—'}" · ${Array.isArray(d.rows) ? d.rows.length : 0} rows`);
    console.log(`  proposal: hide this draft ("replaced by per-shipment drafts"), and create:`);
    for (const s of ships) {
      const ref = shipmentRef(s.order?.orderNo, s.seqNo);
      const own = await p.tradeGeneratedDoc.findFirst({ where: { organizationId: ADH, docType: d.docType, shipmentId: s.id, id: { not: d.id }, ...(APPLY ? { hiddenAt: null } : {}) }, select: { id: true, status: true } });
      if (own) {
        console.log(`    ${ref}: already has its own ${own.status} ${kind} — nothing created`);
        continue;
      }
      if (s.status !== 'OPEN') {
        console.log(`    ${ref}: shipment ${s.status} — skipped (reopen it to create)`);
        continue;
      }
      const best = (await gen.sources(ADH, s.id, d.docType))[0] as { id: string; fileName: string } | undefined;
      if (!best) {
        console.log(`    ${ref}: no Vedanta ${d.docType === 'CUSTOMER_COA' ? 'COA' : 'PL'} file on step 3b — skipped`);
        continue;
      }
      try {
        const pv = await gen.previewFormat(ADH, s.id, d.docType, d.templateKey);
        const m = pv.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const total = /TOTAL[^0-9]{0,40}([\d,]+\.\d{3})/i.exec(m)?.[1] ?? null;
        const casts = (m.match(/\b[0-9]{2}[A-Z][0-9]{4,}\b/g) ?? []).length;
        console.log(`    ${ref} (B/L ${s.blNumber ?? '?'}, CI ${s.ciNumber ?? '?'}): new ${kind} from ${best.fileName}${d.docType === 'CUSTOMER_COA' ? ` · ${pv.notes.find((n) => /date|日付/i.test(n)) ?? ''}` : ''}${total ? ` · total ${total} t` : ''}${casts ? ` · ${casts} cast refs` : ''}`);
        if (HTML) fs.writeFileSync(`${HTML}/${d.docType}-${ref.replace('#', '')}.html`, pv.html);
        if (APPLY) {
          const g = await gen.createFromSource(ADH, s.id, d.docType, best.id, ACTOR, { coversShipmentIds: [] });
          await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'CREATE', resource: 'TradeGeneratedDoc', resourceId: g.id, details: { script: 'scripts/_bs-sus-split.ts', shipment: ref, docType: d.docType, source: best.fileName, replaces: d.docRef ?? d.id } as any } });
          console.log(`      created ${g.docRef ?? g.id}`);
        }
      } catch (e) {
        console.log(`    ${ref}: could not build — ${(e as Error).message}`);
      }
    }
    if (APPLY) {
      await p.tradeGeneratedDoc.update({ where: { id: d.id }, data: { hiddenAt: new Date(), hiddenReason: 'Replaced by per-shipment drafts (round BS, SUS: one COA / PL per shipment)' } as any });
      await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'UPDATE', resource: 'TradeGeneratedDoc', resourceId: d.id, details: { script: 'scripts/_bs-sus-split.ts', hidden: true, docRef: d.docRef, covered: ships.map((s) => shipmentRef(s.order?.orderNo, s.seqNo)) } as any } });
      console.log(`  hid ${d.docRef ?? d.id}`);
    }
    console.log('');
  }
  if (!APPLY) console.log('Dry run — nothing written.');
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 500));
  process.exit(1);
});
