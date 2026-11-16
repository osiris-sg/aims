/**
 * Round BU — re-read every Vedanta CI filed on ADH's shipments (PDF text layer, no AI) and list, per CI no. (latest
 * version): shipment · CI no. · Sub Total · Advance · TOTAL (balance payable) · AIMS deposit · match?
 *
 * Writes (only with --apply): the newest stored CI read of each file gets the fields it is missing (Trade Discount,
 * FOB Value, Freight, Insurance, Advance, TOTAL, Sub Total, FINAL / PROVISIONAL) — empty keys only, a value already
 * stored is never changed; a CI file never read gets its text read stored (as the upload's read); a shipment whose CI
 * no. / CI amount is blank gets the latest version's (blank-only, one CI no. per shipment). One Activity Log row per
 * write. Dry run by default: the DB session is read-only.
 *
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bu-ci-reread.ts [--apply]
 */
require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { pdfText } from '../src/shipments/trade-coa';
import { aimsDepositOf, ciPayableOf, ciRank, CiText, CiVersion, parseCiText } from '../src/shipments/trade-ci';
import { shipmentRef } from '../src/shipments/shipments.rules';
import { ciRawFromText } from '../src/shipments/trade-extract.service';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const ACTOR = 'system:round-bu-ci-reread';
const m = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** Text-read CI → the stored raw keys (as TradeExtractService's ciRawFromText). */
const RAW_KEYS: Array<[string, (c: CiText) => unknown]> = [
  ['ciNumber', (c) => c.ciNumber],
  ['ciDate', (c) => c.ciDate],
  ['status', (c) => c.status],
  ['subTotal', (c) => c.subTotal],
  ['tradeDiscount', (c) => c.tradeDiscount],
  ['advance', (c) => c.advance],
  ['totalAmount', (c) => c.total],
  ['fobValue', (c) => c.fobValue],
  ['freight', (c) => c.freight],
  ['insurance', (c) => c.insurance],
];

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  if (!APPLY) await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const s3 = new S3Service({ get: (k: string) => process.env[k] } as any);
  const files: any[] = await p.tradeFile.findMany({
    where: { organizationId: ADH, docType: 'CI', links: { some: { hiddenAt: null, shipmentId: { not: null } } } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fileName: true,
      s3Key: true,
      mimeType: true,
      createdAt: true,
      links: {
        where: { hiddenAt: null, shipmentId: { not: null } },
        select: {
          shipment: {
            select: {
              id: true,
              seqNo: true,
              status: true,
              ciNumber: true,
              ciAmount: true,
              order: { select: { id: true, orderNo: true, isTest: true, status: true, piAmount: true, depositPct: true, depositAmount: true, supplierOrder: { select: { soNo: true, piNo: true, piAmount: true, depositPct: true, depositAmount: true, _count: { select: { customerOrders: true } } } }, shipments: { where: { status: { not: 'CANCELLED' } }, orderBy: { seqNo: 'asc' }, select: { id: true } } } },
            },
          },
        },
      },
      extractions: { where: { kind: 'CI', status: 'DONE' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, result: true } },
    },
  });
  type Row = { file: any; ci: CiText; v: CiVersion; ext: { id: string; result: any } | null; missing: Record<string, unknown> };
  const rows: Row[] = [];
  const unread: string[] = [];
  for (const f of files) {
    if (f.mimeType !== 'application/pdf') {
      unread.push(`${f.fileName} (not a PDF)`);
      continue;
    }
    const text = await pdfText(await s3.downloadFile(f.s3Key)).catch(() => '');
    const ci = parseCiText(text);
    if (!ci.ciNumber && ci.subTotal === null) {
      unread.push(`${f.fileName} (no Vedanta CI text layer)`);
      continue;
    }
    const ext = f.extractions[0] ?? null;
    const raw = (ext?.result?.raw ?? {}) as Record<string, unknown>;
    const missing: Record<string, unknown> = {};
    for (const [k, get] of RAW_KEYS) {
      const val = get(ci);
      if (val !== null && val !== undefined && (raw[k] === null || raw[k] === undefined || raw[k] === '')) missing[k] = val;
    }
    rows.push({ file: f, ci, ext, missing, v: { fileId: f.id, fileName: f.fileName, uploadedAt: f.createdAt.toISOString(), ciNumber: ci.ciNumber, ciDate: ci.ciDate, status: ci.status, amount: ci.subTotal ?? ci.total } });
  }

  // Latest version per CI no. (FINAL after PROVISIONAL, later date, REVISED file, later upload).
  const byCi = new Map<string, Row[]>();
  for (const r of rows) byCi.set(r.ci.ciNumber ?? `file:${r.file.id}`, [...(byCi.get(r.ci.ciNumber ?? `file:${r.file.id}`) ?? []), r]);
  const latest = [...byCi.values()].map((list) => list.sort((a, b) => ciRank(a.v, b.v)).at(-1)!);

  // The order's deposit vs the advances its CIs deduct (summed over the order's shipments).
  const advByOrder = new Map<string, number>();
  for (const r of latest) {
    const orders = new Set<string>(r.file.links.map((l: any) => l.shipment?.order?.id).filter(Boolean));
    for (const o of orders) advByOrder.set(o, (advByOrder.get(o) ?? 0) + (r.ci.advance ?? 0));
  }
  console.log('shipment      · CI no.        · status · Sub Total      · Advance     · TOTAL          · AIMS deposit · match?');
  const lines: Array<[string, string]> = [];
  for (const r of latest) {
    const ships = r.file.links.map((l: any) => l.shipment).filter(Boolean);
    const refs = ships.map((s: any) => shipmentRef(s.order?.orderNo, s.seqNo) + (s.order?.isTest ? ' (test)' : '') + (s.status === 'CANCELLED' ? ' (cancelled)' : '')).join(', ');
    const o = ships[0]?.order;
    const depInfo = o ? aimsDepositOf(o, o.supplierOrder) : null;
    const dep = depInfo?.amount ?? null;
    const first = ships.some((s: any) => s.order?.shipments?.[0]?.id === s.id);
    const adv = r.ci.advance;
    const payable = ciPayableOf(r.ci);
    const sumOk = r.ci.subTotal !== null && payable !== null && Math.abs(r.ci.subTotal - (r.ci.tradeDiscount ?? 0) - (adv ?? 0) - payable) < 0.01;
    const orderAdv = o ? advByOrder.get(o.id) ?? 0 : 0;
    let match: string;
    if (dep === null || dep === undefined) match = adv ? 'no deposit in AIMS' : 'no deposit / no advance';
    else if (!adv) match = first ? `NO — first shipment, no advance (deposit ${m(dep)})` : 'n/a (no advance on this CI)';
    else if (Math.abs(adv - dep) < 0.01) match = 'yes';
    else if (Math.abs(orderAdv - dep) < 0.01) match = `split — the order's CIs deduct ${m(orderAdv)} = deposit`;
    else match = `NO — advance ${m(adv)} vs deposit ${m(dep)} (diff ${m(adv - dep)})`;
    const stored = ships.map((s: any) => (s.ciAmount === null ? 'blank' : Number(s.ciAmount))).find((x: any) => x !== undefined);
    const note = [!sumOk ? 'Sub Total − discount − advance ≠ TOTAL' : '', typeof stored === 'number' && r.ci.subTotal !== null && Math.abs(stored - r.ci.subTotal) >= 0.005 ? `AIMS CI amount ${m(stored)}` : stored === 'blank' ? 'AIMS CI amount blank' : ''].filter(Boolean).join('; ');
    const key = `${(o?.orderNo ?? 9999).toString().padStart(5, '0')}-${String(ships[0]?.seqNo ?? 0).padStart(3, '0')}`;
    lines.push([key, `${refs.padEnd(13)} · ${(r.ci.ciNumber ?? '?').padEnd(13)} · ${(r.ci.status ?? '?').slice(0, 5).padEnd(6)} · ${m(r.ci.subTotal).padStart(14)} · ${m(adv).padStart(11)} · ${m(payable).padStart(14)} · ${m(dep).padStart(12)} · ${match}${depInfo?.source === 'supplierOrder' ? ' (deposit from the supplier order PI)' : ''}${note ? `  [${note}]` : ''}`]);
  }
  for (const [, l] of lines.sort((a, b) => a[0].localeCompare(b[0]))) console.log(l);
  if (unread.length) console.log(`\nNot read (no text layer): ${unread.join('; ')}`);

  // Planned writes: empty keys of the newest stored read, every version (history keeps them too).
  const writes = rows.filter((r) => r.ext && Object.keys(r.missing).length);
  const noRead = rows.filter((r) => !r.ext);
  console.log(`\n${files.length} CI file(s), ${latest.length} CI no(s). Stored reads to fill (empty keys only): ${writes.length}; CI files never read (read stored): ${noRead.length}`);
  const keyCount: Record<string, number> = {};
  for (const r of writes) for (const k of Object.keys(r.missing)) keyCount[k] = (keyCount[k] ?? 0) + 1;
  console.log(`  keys: ${Object.entries(keyCount).map(([k, n]) => `${k} ×${n}`).join(', ') || '—'}`);
  for (const r of noRead) console.log(`  never read: ${r.file.fileName} → ${r.ci.ciNumber} Sub Total ${m(r.ci.subTotal)}`);
  // Blank shipment CI no. / amount ← the latest version (only shipments with one CI no. among their files).
  const ciNosByShip = new Map<string, Set<string>>();
  for (const r of rows) for (const l of r.file.links) if (l.shipment && r.ci.ciNumber) ciNosByShip.set(l.shipment.id, (ciNosByShip.get(l.shipment.id) ?? new Set()).add(r.ci.ciNumber));
  const shipFills: Array<{ s: any; data: Record<string, unknown>; r: Row }> = [];
  for (const r of latest) {
    for (const l of r.file.links) {
      const s = l.shipment;
      if (!s || s.status === 'CANCELLED' || (ciNosByShip.get(s.id)?.size ?? 0) !== 1) continue;
      const data: Record<string, unknown> = {};
      if (!s.ciNumber && r.ci.ciNumber) data.ciNumber = r.ci.ciNumber;
      if (s.ciAmount === null && r.ci.subTotal !== null && r.ci.subTotal > 0) data.ciAmount = r.ci.subTotal;
      if (Object.keys(data).length) shipFills.push({ s, data, r });
    }
  }
  console.log(`Shipments with a blank CI no. / amount to fill: ${shipFills.length}`);
  for (const f of shipFills) console.log(`  ${shipmentRef(f.s.order?.orderNo, f.s.seqNo)}: ${Object.entries(f.data).map(([k, v]) => `${k} = ${typeof v === 'number' ? m(v) : v}`).join(', ')} (${f.r.file.fileName})`);
  if (!APPLY) {
    console.log('\nDry run — nothing written.');
    return p.$disconnect();
  }
  let done = 0;
  for (const r of writes) {
    // Re-check under the write: only keys still empty.
    const cur = await p.tradeExtraction.findUnique({ where: { id: r.ext!.id }, select: { result: true } });
    const result = ((cur?.result ?? {}) as Record<string, any>) || {};
    const raw = { ...(result.raw ?? {}) } as Record<string, unknown>;
    const added: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.missing)) if (raw[k] === null || raw[k] === undefined || raw[k] === '') (raw[k] = v), (added[k] = v);
    if (!Object.keys(added).length) continue;
    await p.tradeExtraction.update({ where: { id: r.ext!.id }, data: { result: { ...result, raw } as any } });
    await p.actionLog.create({
      data: { actorType: 'SYSTEM', actorId: ACTOR, actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'UPDATE', resource: 'TradeExtraction', resourceId: r.ext!.id, details: { script: 'scripts/_bu-ci-reread.ts', fileId: r.file.id, fileName: r.file.fileName, ciNumber: r.ci.ciNumber, added } as any },
    });
    done++;
  }
  let created = 0;
  for (const r of noRead) {
    if (await p.tradeExtraction.findFirst({ where: { organizationId: ADH, fileId: r.file.id, kind: 'CI', status: 'DONE' }, select: { id: true } })) continue;
    const shipmentId = r.file.links[0]?.shipment?.id ?? null;
    const row = await p.tradeExtraction.create({
      data: { organizationId: ADH, fileId: r.file.id, kind: 'CI', status: 'DONE', shipmentId, result: { raw: ciRawFromText(r.ci) } as any, model: 'text-layer', inputTokens: 0, outputTokens: 0, durationMs: 0, createdById: ACTOR },
      select: { id: true },
    });
    await p.actionLog.create({
      data: { actorType: 'SYSTEM', actorId: ACTOR, actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'CREATE', resource: 'TradeExtraction', resourceId: row.id, details: { script: 'scripts/_bu-ci-reread.ts', fileId: r.file.id, fileName: r.file.fileName, ciNumber: r.ci.ciNumber, subTotal: r.ci.subTotal, advance: r.ci.advance, total: r.ci.total } as any },
    });
    created++;
  }
  let filledShips = 0;
  for (const f of shipFills) {
    const where: any = { id: f.s.id, organizationId: ADH, ...(f.data.ciNumber !== undefined ? { ciNumber: null } : {}), ...(f.data.ciAmount !== undefined ? { ciAmount: null } : {}) };
    const u = await p.shipment.updateMany({ where, data: f.data as any });
    if (!u.count) continue;
    await p.actionLog.create({
      data: { actorType: 'SYSTEM', actorId: ACTOR, actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'UPDATE', resource: 'Shipment', resourceId: f.s.id, details: { script: 'scripts/_bu-ci-reread.ts', ref: shipmentRef(f.s.order?.orderNo, f.s.seqNo), filled: f.data, from: f.r.file.fileName } as any },
    });
    filledShips++;
  }
  console.log(`\nApplied: ${done} read(s) filled, ${created} read(s) stored, ${filledShips} shipment(s) filled.`);
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
