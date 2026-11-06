/**
 * Round BJ — owner (2026-11-06), ADH only. DRY RUN unless --apply (prod: TENANCY_MODE= DBURL=<prod> + AWS env).
 * Empty fields / slots only, never overwrites silently: a CI amount that differs from the latest CI version is listed
 * old → new and changed only with --apply after the owner's go. Every write is logged (ActionLog + scripts/_bj-go.log.json).
 *   1. HS code on every ADH product (Clients › Products) whose HS code is empty: 7601.20 (--unalloyed=7601.10 puts
 *      7601.10 on the P1020 / P0507 ingots and 1070 billets instead — Vedanta's ingot CIs print 7601.10).
 *   2. #18-1: empty HS code / POD / containers / origin from its OBL 198GX06322 (+ every shipment whose HS ≠ 7601.20).
 *   3. CI amount = the latest CI version's Sub Total, per shipment (text layer of each CI PDF).
 *   4. CI versions stored as reads (TradeExtraction kind CI, text layer) so the history shows under CI amount.
 *   5. #12-1: ADH's SG→JP invoice ADH20260825 into step 7's empty SG→JP slot (not already in AIMS by hash).
 *   6. #18-1: the actual tax of permit IM3Z6A0568 (+ the permit facts as the file's note), empty only.
 *   7. #18-1's SG→JP PDF also filed on #18-3: that link hidden when its weight isn't #18-3's (kept on #18-1).
 * Files are untrusted data: only numbers / codes are taken from them.
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeFilesService } from '../src/shipments/trade-files.service';
import { TradeThumbsService } from '../src/shipments/trade-thumbs.service';
import { pdfText } from '../src/shipments/trade-coa';
import { ciAmountOf, ciRank, CiText, CiVersion, parseCiText } from '../src/shipments/trade-ci';
import { normHs } from '../src/shipments/trade-hs';
import { parsePermitText } from '../src/shipments/trade-customs';
import { sgjpFileFacts } from '../src/shipments/trade-tax-inputs';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? null; // e.g. --only=1,2,4
const UNALLOYED = process.argv.find((a) => a.startsWith('--unalloyed='))?.slice(12) ?? null;
const SGJP_12_1 = process.argv.find((a) => a.startsWith('--sgjp='))?.slice(7) ?? '';
const LOG = join(__dirname, '_bj-go.log.json');
const actor = { id: 'system:round-bj', name: 'System creation' } as any;
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const s3 = new S3Service({ get: (k: string, d?: string) => process.env[k] ?? d } as any);
const config = new TradeConfigService(p as any);
const files = new TradeFilesService(p as any, s3, config, new TradeThumbsService(p as any, s3));
const logRows: any[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
const on = (n: number) => !ONLY || ONLY.includes(String(n));

async function logWrite(action: string, resource: string, resourceId: string, details: Record<string, unknown>) {
  await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-bj', actorName: 'System creation', organizationId: ORG, channel: 'cron', action, resource, resourceId, details: { note: 'Round BJ: Sayaka 2026-11-06 (#18-1 B/L, HS code, CI versions)', ...details } as any } });
  logRows.push({ at: new Date().toISOString(), action, resource, resourceId, ...details });
}
const plan: string[] = [];
const writes: Array<() => Promise<void>> = [];
const add = (line: string, fn?: () => Promise<void>) => {
  plan.push(`${fn ? 'WRITE' : '     '} ${line}`);
  if (fn) writes.push(fn);
};
const refOf = (s: { seqNo: number | null; order: { orderNo: number; isTest?: boolean } | null }) => `#${s.order?.orderNo ?? '?'}-${s.seqNo ?? '?'}${s.order?.isTest ? ' (test)' : ''}`;
const usd = (n: number | null) => (n === null ? '(empty)' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const UNALLOYED_GRADE = /^(P\d{4}|1070)/i;

async function main() {
  if (!process.env.DBURL) throw new Error('DBURL is required');

  // ── 1. HS code per product
  if (on(1)) {
    plan.push('── 1. HS code on ADH products (empty only)');
    const st = await p.tradeSetting.findFirst({ where: { organizationId: ORG }, select: { id: true, customerProfiles: true, supplierProfiles: true } });
    const names = new Map([...(await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } })), ...(await p.supplier.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } }))].map((x) => [x.id, x.name]));
    for (const col of ['customerProfiles', 'supplierProfiles'] as const) {
      const profiles = (st?.[col] ?? {}) as Record<string, any>;
      for (const [id, prof] of Object.entries(profiles))
        for (const pr of prof.products ?? []) {
          const unalloyed = UNALLOYED && UNALLOYED_GRADE.test(pr.grade ?? '');
          const code = unalloyed ? UNALLOYED : '7601.20';
          const source = !unalloyed
            ? 'aluminium, unwrought, alloyed — as Vedanta\'s billet CIs print (e.g. XP2652102340, #18-1); owner 2026-11-06'
            : /^1070/.test(pr.grade ?? '')
              ? 'unalloyed — Vedanta CI XP2532100057 (#1006-1, 2025) prints 7601.10.20 for 1070 (the 2024 CI XP2332100419 printed 7601.20); owner 2026-11-06'
              : 'unalloyed — as Vedanta\'s ingot CIs print (XP2652102281 #14-1, XP2652101288 #10-1); owner 2026-11-06';
          const flag = UNALLOYED_GRADE.test(pr.grade ?? '') ? '  ⚠ unalloyed (Vedanta prints 7601.10 on P1020 ingot CIs)' : '';
          const label = `${col === 'customerProfiles' ? 'customer' : 'supplier'} ${names.get(id) ?? id} · ${[pr.grade, pr.form?.toLowerCase(), pr.diameterMm && pr.lengthMm ? `${pr.diameterMm}×${pr.lengthMm}` : ''].filter(Boolean).join(' ')}${pr.hidden ? ' (hidden)' : ''}`;
          if (normHs(pr.hsCode)) {
            add(`${label}: HS ${pr.hsCode} already set — kept`);
            continue;
          }
          add(`${label}: HS (empty) → ${code}${unalloyed ? '' : flag}  [${source}]`, async () => {
            const cur = await p.tradeSetting.findFirst({ where: { organizationId: ORG }, select: { id: true, [col]: true } as any });
            const all = ((cur as any)?.[col] ?? {}) as Record<string, any>;
            const row = (all[id]?.products ?? []).find((x: any) => x.id === pr.id);
            if (!row || normHs(row.hsCode)) return; // filled meanwhile: never overwrite
            row.hsCode = code;
            row.hsCodeSource = source;
            row.updatedAt = new Date().toISOString();
            await p.tradeSetting.update({ where: { id: (cur as any).id }, data: { [col]: all } as any });
            await logWrite('UPDATE', 'trade-product', pr.id, { party: col, partyId: id, product: label, field: 'hsCode', from: null, to: code, source });
          });
        }
    }
  }

  const ships = await p.shipment.findMany({
    where: { organizationId: ORG, status: { not: 'CANCELLED' } },
    select: { id: true, seqNo: true, hsCode: true, portOfDischarge: true, containerCount: true, countryOfOrigin: true, ciNumber: true, ciAmount: true, blNumber: true, order: { select: { orderNo: true, isTest: true } } },
  });

  // ── 2. #18-1 empty fields from its OBL; every shipment whose HS code isn't 7601.20
  if (on(2)) {
    plan.push('── 2. #18-1 from OBL 198GX06322 (p.1 box, p.2 "B/L Attached List"), empty fields only');
    const s = ships.find((x) => x.order?.orderNo === 18 && x.seqNo === 1 && !x.order?.isTest)!;
    if (s.blNumber !== '198GX06322') throw new Error(`#18-1 B/L is ${s.blNumber}, expected 198GX06322`);
    const fromObl: Array<[keyof typeof s, string | number, string]> = [
      ['hsCode', '7601.20', 'p.2 "HS CODE : 7601.20"'],
      ['portOfDischarge', 'YOKOHAMA, JAPAN', 'p.1 Port of discharge'],
      ['containerCount', 9, 'p.1 "9 CTRS" / "SAY : NINE CONTAINERS ONLY"'],
      ['countryOfOrigin', 'INDIA', 'p.2 "COUNTRY OF ORIGIN : INDIA"'],
    ];
    for (const [k, v, where] of fromObl) {
      const cur = s[k] as unknown;
      if (cur !== null && cur !== undefined && cur !== '') {
        add(`#18-1 ${String(k)}: ${String(cur)} — kept${String(cur) !== String(v) ? ` (OBL says ${v})` : ''}`);
        continue;
      }
      add(`#18-1 ${String(k)}: (empty) → ${v}   [${where}]`, async () => {
        const r = await p.shipment.updateMany({ where: { id: s.id, organizationId: ORG, [k]: null }, data: { [k]: v } });
        if (r.count) await logWrite('UPDATE', 'shipment', s.id, { ref: '#18-1', field: k, from: null, to: v, source: `OBL 198GX06322 ${where}` });
      });
    }
    plan.push('   HS code ≠ 7601.20 on any shipment:');
    const odd = ships.filter((x) => normHs(x.hsCode) && normHs(x.hsCode) !== '7601.20');
    plan.push(odd.length ? odd.map((x) => `     ${refOf(x)} ${x.hsCode}`).join('\n') : '     none (stored HS codes: ' + ships.filter((x) => x.hsCode).map((x) => `${refOf(x)} ${x.hsCode}`).join(', ') + '; all others empty)');
  }

  // ── 3 + 4. CI versions
  if (on(3) || on(4)) {
    plan.push('── 3. CI amount = latest CI version (Sub Total before the advance) · 4. CI versions stored as reads');
    const cis = await p.tradeFile.findMany({
      where: { organizationId: ORG, docType: 'CI', mimeType: 'application/pdf' },
      select: { id: true, fileName: true, s3Key: true, createdAt: true, links: { where: { hiddenAt: null, shipmentId: { not: null } }, select: { shipmentId: true } }, extractions: { where: { kind: 'CI', status: 'DONE' }, select: { id: true } } },
    });
    const read = new Map<string, { v: CiVersion; c: CiText; file: (typeof cis)[number] }>();
    for (const f of cis) {
      const c = parseCiText(await pdfText(await s3.downloadFile(f.s3Key)).catch(() => ''));
      read.set(f.id, { c, file: f, v: { fileId: f.id, fileName: f.fileName, uploadedAt: f.createdAt.toISOString(), ciNumber: c.ciNumber, ciDate: c.ciDate, status: c.status, amount: ciAmountOf(c) } });
    }
    const rows3: string[] = [];
    for (const s of ships) {
      const mine = [...read.values()].filter((r) => r.file.links.some((l) => l.shipmentId === s.id) && r.v.amount !== null).sort((a, b) => ciRank(a.v, b.v));
      if (!mine.length) continue;
      const latest = mine.at(-1)!;
      const stored = s.ciAmount === null ? null : Number(s.ciAmount);
      const hist = mine.map((r) => `${r.v.status ?? '?'} ${r.v.ciDate ?? ''} ${usd(r.v.amount)}`).join(' → ');
      const same = stored !== null && Math.abs(stored - latest.v.amount!) < 0.005;
      const noMatch = s.ciNumber && latest.v.ciNumber && s.ciNumber !== latest.v.ciNumber ? `  ⚠ CI no. on the shipment ${s.ciNumber} ≠ ${latest.v.ciNumber}` : '';
      if (same) {
        rows3.push(`       ${refOf(s).padEnd(14)} ${usd(stored)} = latest (${hist})`);
        continue;
      }
      if (!on(3)) continue;
      if (s.order?.isTest) {
        rows3.push(`       ${refOf(s).padEnd(14)} ${usd(stored)} vs latest ${usd(latest.v.amount)} (${hist}) — test order, not changed`);
        continue;
      }
      const line = `${refOf(s).padEnd(14)} CI amount ${usd(stored)} → ${usd(latest.v.amount)}   [${latest.v.status} ${latest.v.ciNumber} ${latest.v.ciDate} · ${latest.file.fileName}]  versions: ${hist}${noMatch}`;
      plan.push(`WRITE ${line}`);
      writes.push(async () => {
        const r = await p.shipment.updateMany({ where: { id: s.id, organizationId: ORG, ciAmount: s.ciAmount }, data: { ciAmount: latest.v.amount! } });
        if (r.count) await logWrite('UPDATE', 'shipment', s.id, { ref: refOf(s), field: 'ciAmount', from: stored, to: latest.v.amount, source: `CI ${latest.v.ciNumber} ${latest.v.status} ${latest.v.ciDate} · ${latest.file.fileName} (latest version, Sub Total)` });
      });
    }
    plan.push('   unchanged:\n' + rows3.join('\n'));
    if (on(4)) {
      const missing = [...read.values()].filter((r) => !r.file.extractions.length && r.c.ciNumber && r.v.amount !== null && r.file.links.length);
      add(`CI reads to store (history under CI amount): ${missing.length} CI file(s) without a read — ${missing.map((r) => `${r.c.ciNumber} ${r.c.status ?? ''}`).join(', ')}`);
      for (const r of missing)
        writes.push(async () => {
          const x = await p.tradeExtraction.create({
            data: {
              organizationId: ORG, fileId: r.file.id, kind: 'CI', status: 'DONE', model: 'text-layer', inputTokens: 0, outputTokens: 0, durationMs: 0, createdById: actor.id,
              shipmentId: r.file.links[0]?.shipmentId ?? null,
              result: { raw: { ciNumber: r.c.ciNumber, ciDate: r.c.ciDate, blNumber: null, currency: 'USD', totalAmount: r.c.total, subTotal: r.c.subTotal, advance: r.c.advance, status: r.c.status, netWeightMt: r.c.netMt, unitPrice: r.c.rate, lme: r.c.lme, premium: r.c.premium, countryOfOrigin: r.c.countryOfOrigin, hsCode: r.c.hsCode } } as any,
            },
            select: { id: true },
          });
          await logWrite('CREATE', 'trade-extraction', x.id, { file: r.file.fileName, fileId: r.file.id, kind: 'CI', ciNumber: r.c.ciNumber, status: r.c.status, subTotal: r.c.subTotal });
        });
    }
  }

  // ── 5. #12-1 SG→JP invoice
  if (on(5)) {
    plan.push('── 5. #12-1 SG→JP INVOICE & PACKING LIST (step 7)');
    if (!SGJP_12_1 || !existsSync(SGJP_12_1)) plan.push('      --sgjp=<path to INVOICE & PACKING LIST_6005_202609納品(7月出荷)_120t_SG-JP.pdf> not given — skipped');
    else {
      const buf = readFileSync(SGJP_12_1);
      const sha = createHash('sha256').update(buf).digest('hex');
      const text = await pdfText(buf);
      const no = /ADH\d{8}/.exec(text)?.[0];
      const total = /US\$\s*459,412\.52/.test(text);
      const s = await p.shipment.findFirst({ where: { organizationId: ORG, order: { orderNo: 12, isTest: false }, seqNo: 1 }, select: { id: true, netWeightMt: true, steps: { where: { code: 'CUSTOMS_TAX_ESTIMATE' }, select: { id: true, displayNo: true } }, fileLinks: { where: { hiddenAt: null, file: { docType: 'SGJP_IV_PL' } }, select: { file: { select: { fileName: true } } } } } });
      const st7 = s?.steps[0];
      const same = await p.tradeFile.findMany({ where: { organizationId: ORG, sizeBytes: buf.length }, select: { id: true, s3Key: true, fileName: true } });
      let dup: string | null = null;
      for (const f of same) if (createHash('sha256').update(await s3.downloadFile(f.s3Key)).digest('hex') === sha) dup = f.fileName;
      const check = `no. ${no} · US$459,412.52 ${total ? 'printed' : 'NOT found'} · #12-1 net ${s?.netWeightMt}`;
      if (!s || !st7) plan.push('      #12-1 or its step 7 not found — skipped');
      else if (dup) plan.push(`      already in AIMS (same bytes: ${dup}) — nothing`);
      else if (s.fileLinks.length) plan.push(`      step 7 SG→JP slot already holds ${s.fileLinks.map((l) => l.file.fileName).join(', ')} — nothing`);
      else if (no !== 'ADH20260825' || !total || String(s.netWeightMt) !== '122.478') plan.push(`      file does not match #12-1 (${check}) — skipped`);
      else
        add(`#12-1 step ${st7.displayNo} SGJP_IV_PL: (empty) → upload "${SGJP_12_1.split('/').pop()}"  [${check}]`, async () => {
          const up = await files.upload(ORG, { originalname: SGJP_12_1.split('/').pop()!.normalize('NFC'), mimetype: 'application/pdf', size: buf.length, buffer: buf } as any, { docType: 'SGJP_IV_PL', shipmentIds: [s.id], stepId: st7.id, notes: 'ADH SG→JP invoice ADH20260825 (2026/8/25), US$459,412.52 — the import tax basis (Sayaka 2026-11-06)' } as any, actor, { source: 'UPLOAD', sha256: sha });
          await logWrite('CREATE', 'trade-file', (up as any).id, { ref: '#12-1', step: st7.displayNo, docType: 'SGJP_IV_PL', file: SGJP_12_1.split('/').pop(), sha256: sha });
        });
    }
  }

  // ── 6. #18-1 import permit IM3Z6A0568 → the actual tax (empty fields only)
  if (on(6)) {
    plan.push('── 6. #18-1 permit IM3Z6A0568 → actual import tax (empty only)');
    const s = await p.shipment.findFirst({ where: { organizationId: ORG, order: { orderNo: 18, isTest: false }, seqNo: 1 }, select: { id: true, costs: true } });
    const link = await p.tradeFileLink.findFirst({ where: { organizationId: ORG, shipmentId: s!.id, hiddenAt: null, file: { docType: 'IMPORT_PERMIT', fileName: { startsWith: 'IM3Z6A0568' } } }, select: { file: { select: { id: true, fileName: true, s3Key: true, notes: true } } } });
    if (!link) plan.push('      permit file not on #18-1 — skipped');
    else {
      const d: any = (parsePermitText(await pdfText(await s3.downloadFile(link.file.s3Key))) as any).data;
      const ok = d.invoiceNo === 'ADH20261012' && d.total === 11257300 && d.national + d.local === d.total;
      const facts = `Permit IM3Z6A0568 (申告番号 ${d.declarationNo}, ${d.declarationDate}): 消費税 ¥${d.national?.toLocaleString('en-US')} + 地方消費税 ¥${d.local?.toLocaleString('en-US')} = ¥${d.total?.toLocaleString('en-US')} · invoice ${d.invoiceNo} US$${d.invoiceAmount} × ${d.fxRate} + 加算運賃 ¥${d.addOnJpy?.toLocaleString('en-US')}`;
      if (!ok) plan.push(`      permit text does not read as expected (${facts}) — skipped`);
      else {
        const costs = (s!.costs ?? {}) as Record<string, unknown>;
        if (costs.importTaxActual != null) add(`#18-1 importTaxActual: ${costs.importTaxActual} — kept`);
        else
          add(`#18-1 importTaxActual: (empty) → ${d.total}   [${facts}]`, async () => {
            const cur = await p.shipment.findFirst({ where: { id: s!.id }, select: { costs: true } });
            const c = (cur?.costs ?? {}) as Record<string, unknown>;
            if (c.importTaxActual != null) return;
            await p.shipment.update({ where: { id: s!.id }, data: { costs: { ...c, importTaxActual: d.total } as any } });
            await logWrite('UPDATE', 'shipment', s!.id, { ref: '#18-1', field: 'costs.importTaxActual', from: null, to: d.total, source: facts });
          });
        if (link.file.notes?.trim()) add(`#18-1 permit file notes: "${link.file.notes}" — kept`);
        else
          add(`#18-1 permit file notes: (empty) → "${facts}"`, async () => {
            const r = await p.tradeFile.updateMany({ where: { id: link.file.id, organizationId: ORG, OR: [{ notes: null }, { notes: '' }] }, data: { notes: facts } });
            if (r.count) await logWrite('UPDATE', 'trade-file', link.file.id, { ref: '#18-1', field: 'notes', from: null, to: facts });
          });
      }
    }
  }

  // ── 7. #18-1's SG→JP PDF also filed on #18-3: hide that link when the weight isn't #18-3's (the file stays on #18-1)
  if (on(7)) {
    plan.push('── 7. SG→JP PDF (183.693 t) filed on #18-3');
    const s3_ = await p.shipment.findFirst({ where: { organizationId: ORG, order: { orderNo: 18, isTest: false }, seqNo: 3 }, select: { id: true, netWeightMt: true } });
    const links = await p.tradeFileLink.findMany({ where: { organizationId: ORG, shipmentId: s3_!.id, hiddenAt: null, file: { docType: 'SGJP_IV_PL', fileName: { contains: '183.693t' } } }, select: { id: true, file: { select: { id: true, fileName: true, s3Key: true } } } });
    for (const l of links) {
      const buf = await s3.downloadFile(l.file.s3Key);
      const facts = sgjpFileFacts(await pdfText(buf), Number(s3_!.netWeightMt));
      const h = createHash('sha256').update(buf).digest('hex');
      const on181 = await p.tradeFile.findMany({ where: { organizationId: ORG, docType: 'SGJP_IV_PL', links: { some: { hiddenAt: null, shipment: { seqNo: 1, order: { orderNo: 18 } } } } }, select: { s3Key: true, fileName: true } });
      let copy: string | null = null;
      for (const f of on181) if (createHash('sha256').update(await s3.downloadFile(f.s3Key)).digest('hex') === h) copy = f.fileName;
      const why = `${facts.invoiceNo} US$${facts.total} is 183.693 t (#18-1); #18-3 net ${s3_!.netWeightMt} t`;
      if (facts.netMatches) plan.push(`      ${l.file.fileName}: matches #18-3's weight — kept`);
      else if (!copy) plan.push(`      ${l.file.fileName}: no identical copy on #18-1 — not hidden (would leave #18-1 without it)`);
      else
        add(`#18-3 link to "${l.file.fileName}": visible → hidden   [${why}; the same file stays on #18-1]`, async () => {
          const r = await p.tradeFileLink.updateMany({ where: { id: l.id, organizationId: ORG, hiddenAt: null }, data: { hiddenAt: new Date(), hiddenReason: `Round BJ: ${why} — owner's go 2026-11-06` } });
          if (r.count) await logWrite('HIDE', 'trade-file-link', l.id, { ref: '#18-3', file: l.file.fileName, fileId: l.file.id, reason: why });
        });
    }
    if (!links.length) plan.push('      no visible link — nothing');
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · Round BJ\n` + plan.join('\n'));
  console.log(`\nwrites planned: ${writes.length}`);
  if (!APPLY) return console.log("\n(dry run — nothing written; add --apply after the owner's go)");
  for (const w of writes) await w();
  writeFileSync(LOG, JSON.stringify(logRows, null, 2));
  console.log(`applied ${writes.length} writes; log ${LOG}`);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
