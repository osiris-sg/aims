/**
 * Round AM — DEV end-to-end (refuses the prod DB): Clients lists + SUS profile, Document formats preview of the SUS
 * COA_集計ファイル / PACKING LIST on dev #11-1 (198GX04630 = ADH's 305.804 t sample), compared cell by cell with ADH's
 * files (--sample-pl=, --sample-coa=); then (--apply-dev) switches dev SUS to the SUS formats, adds the two samples
 * and creates + finalizes nothing (preview only). Prints the Monthly view rows for Oct–Nov.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClientsService } from '../src/shipments/clients.service';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { parseCoaPdfText, pdfText } from '../src/shipments/trade-coa';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg('out') ?? '.';
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const clients = app.get(ClientsService);
  const monthly = app.get(MonthlyListService);
  const prisma: any = app.get(PrismaService);
  await runAsOrg(ORG, async () => {
    const cs = await clients.customers(ORG);
    console.log('CUSTOMERS', cs.map((c) => `${c.short}: open ${c.openOrders} · this month ${c.tonsThisMonth} t · last3 ${c.tonsLast3Months} t · last ${c.lastDelivery?.date ?? c.lastDelivery?.month ?? '—'} ${c.lastDelivery?.ref ?? ''} · ${c.billingMode}`).join('\n  '));
    const ss = await clients.suppliers(ORG);
    console.log('SUPPLIERS', ss.map((s) => `${s.short}: ${s.contracts.map((k) => k.contractNo).join(',')} · open ${s.openOrders} · PI ${JSON.stringify(s.pi)}`).join('\n  '));
    const sus = cs.find((c) => c.short === 'SUS')!;
    const detail = await clients.customer(ORG, sus.id);
    console.log('SUS contracts', detail.contracts.map((k) => `${k.contractNo}(${k.files.length} files)`).join(', '), '| contacts', detail.contacts.length, '| sites', detail.deliverySites.map((d: any) => d.siteName).join(', '));
    const ship = await prisma.shipment.findFirst({ where: { organizationId: ORG, blNumber: '198GX04630' }, select: { id: true } });
    const coa = await clients.preview(ORG, sus.id, 'CUSTOMER_COA', { shipmentId: ship.id, generator: 'CUSTOMER_COA_SUS_SUMMARY' });
    fs.writeFileSync(`${OUT}/preview-sus-coa.pdf`, Buffer.from(coa.pdf.base64, 'base64'));
    console.log('COA preview from', coa.source, '|', coa.notes.join(' | '));
    // Compare the preview PDF's table with ADH's own COA_集計ファイル.
    if (arg('sample-coa')) {
      const ours = parseCoaPdfText(await pdfText(Buffer.from(coa.pdf.base64, 'base64')));
      const theirs = parseCoaPdfText(await pdfText(fs.readFileSync(arg('sample-coa')!)));
      const same = JSON.stringify(ours.rows) === JSON.stringify(theirs.rows) && JSON.stringify(ours.headers) === JSON.stringify(theirs.headers);
      console.log(`COA table vs ADH's file: ${same ? 'IDENTICAL' : 'DIFFERENT'} (${ours.rows.length} vs ${theirs.rows.length} rows); date ${ours.date} vs ${theirs.date}; invoice ${ours.invoiceNo} vs ${theirs.invoiceNo}`);
      if (!same) console.log(JSON.stringify(ours.headers), JSON.stringify(theirs.headers), JSON.stringify(ours.rows[0]), JSON.stringify(theirs.rows[0]));
    }
    const pl = await clients.preview(ORG, sus.id, 'CUSTOMER_PL', { shipmentId: ship.id, generator: 'CUSTOMER_PL_SUS_XLS' });
    fs.writeFileSync(`${OUT}/preview-sus-pl.pdf`, Buffer.from(pl.pdf.base64, 'base64'));
    fs.writeFileSync(`${OUT}/PACKING LIST-preview.xlsx`, Buffer.from(pl.xlsx!.base64, 'base64'));
    console.log('PL preview from', pl.source, '|', pl.notes.join(' | '));
    if (arg('sample-pl')) {
      const X = require('xlsx');
      const rows = (b: Buffer) => X.utils.sheet_to_json(X.read(b).Sheets[X.read(b).SheetNames[0]], { header: 1, raw: true }).slice(1).map((r: any[]) => r.map((v) => (typeof v === 'string' ? v.trim() : v ?? '')));
      const a = rows(Buffer.from(pl.xlsx!.base64, 'base64'));
      const b = rows(fs.readFileSync(arg('sample-pl')!));
      let diff = 0;
      a.forEach((r: any[], i: number) => r.forEach((v, j) => { if (String(v) !== String(b[i]?.[j] ?? '')) { diff++; if (diff < 6) console.log(`  r${i + 2} c${j + 1}: ours ${JSON.stringify(v)} theirs ${JSON.stringify(b[i]?.[j])}`); } }));
      console.log(`PL .xlsx vs ADH's file: ${a.length} vs ${b.length} rows, ${diff} differing cells`);
    }
    if (process.argv.includes('--apply-dev')) {
      await clients.updateFormat(ORG, sus.id, 'CUSTOMER_COA', { generator: 'CUSTOMER_COA_SUS_SUMMARY', notes: 'From Vedanta COA.XLS (casts summed; PIECES = bundles × 5)' });
      await clients.updateFormat(ORG, sus.id, 'CUSTOMER_PL', { generator: 'CUSTOMER_PL_SUS_XLS', notes: 'SUS takes the .xlsx' });
      for (const [t, f] of [['CUSTOMER_COA', arg('sample-coa')], ['CUSTOMER_PL', arg('sample-pl')]] as const) {
        if (!f) continue;
        const buf = fs.readFileSync(f);
        const name = f.split('/').pop()!;
        await clients.addSample(ORG, sus.id, t, { originalname: name, mimetype: name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: buf.length, buffer: buf } as any, { id: 'dev-test', name: 'Dev test' });
      }
      const after = await clients.customer(ORG, sus.id);
      console.log('DEV SUS formats now:', after.formats.map((f) => `${f.docType}=${f.generator} (${f.samples.length} samples)`).join(' · '));
    }
    const m = await monthly.list(ORG, { from: '2026-10', to: '2026-11' });
    for (const b of m.blocks) for (const r of b.rows) console.log(`  ${b.client} ${r.managementNo} | ${r.orderStageLabel}${r.unconfirmed ? ' (check)' : ''} | ${r.supplierStageLabel} | step: ${r.shipmentStatus ?? '—'}`);
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
