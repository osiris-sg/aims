/**
 * Round BF — READ-ONLY preview of #21-1's 出庫・納入依頼書 from prod data: PDFs (today's stored text with the new
 * line rule; the seeded Kato wording JA + EN; JA only; gross only), the .xlsx of each, and a preview fixture for
 * /preview/shipments/si/<id>. Nothing is written to any database.
 *
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node --transpile-only scripts/_bf-si-preview.ts --out=<dir>
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { renderSiV2Html, SiHeaderV2, SiRowV2 } from '../src/shipments/trade-logistics-docs';
import { productDocLines, siXlsx } from '../src/shipments/trade-si';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const out = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
const SEED = { docNameJa: 'ハイスピード\nビレット', docNameEn: 'High speed\nbillet', docSize: '152×5800' };

async function pdf(html: string, file: string, png?: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require('puppeteer');
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: 'networkidle0' });
    await p.pdf({ path: file, format: 'A4', printBackground: true, margin: { top: '12mm', right: '11mm', bottom: '14mm', left: '11mm' } });
    if (png) {
      await p.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await p.screenshot({ path: png, fullPage: true });
    }
  } finally {
    await b.close();
  }
}

async function main() {
  if (!process.env.DBURL || !out) throw new Error('DBURL and --out= are required');
  mkdirSync(out, { recursive: true });
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  try {
    const order = await p.tradeOrder.findFirst({ where: { organizationId: ADH, year: 2026, orderNo: 21 }, select: { id: true, orderNo: true, customerId: true, shipments: { where: { seqNo: 1 }, select: { id: true, blNumber: true, seqNo: true, status: true, contractId: true } } } });
    const sh = order?.shipments[0];
    if (!order || !sh) throw new Error('#21-1 not found');
    const g = await p.tradeGeneratedDoc.findFirst({ where: { organizationId: ADH, shipmentId: sh.id, docType: 'SHIPPING_INSTRUCTIONS' }, orderBy: { createdAt: 'desc' } });
    if (!g) throw new Error('#21-1 has no 出庫・納入依頼書');
    const ts = await p.tradeSetting.findUnique({ where: { organizationId: ADH }, select: { customerProfiles: true, docDefaults: true } });
    const docTypes = await p.tradeDocType.findMany({ where: { organizationId: ADH }, select: { code: true, label: true } });
    const h = g.header as unknown as SiHeaderV2;
    const rows = g.rows as unknown as SiRowV2[];
    const named = productDocLines(SEED, 'JA_EN')!.join('\n');
    const namedJa = productDocLines(SEED, 'JA')!.join('\n');
    const variants: Array<[string, SiHeaderV2, SiRowV2[], string]> = [
      ['21-1-stored-text', h, rows, `today's stored text "${rows[0]?.billet}", new line rule`],
      ['21-1-docname-ja-en', h, rows.map((r) => ({ ...r, billet: named })), 'Kato product wording, Japanese + English'],
      ['21-1-docname-ja', h, rows.map((r) => ({ ...r, billet: namedJa })), 'Kato product wording, Japanese only'],
      ['21-1-gross-only', { ...h, weightMode: 'GROSS' }, rows.map((r) => ({ ...r, billet: named })), 'gross weight only'],
    ];
    const htmlById: Record<string, string> = {};
    for (const [name, hh, rr, what] of variants) {
      const html = renderSiV2Html(hh, rr, { draft: true });
      if (name === '21-1-docname-ja-en') htmlById[g.id] = html;
      await pdf(html, join(out, `SI-${name}.pdf`), join(out, `SI-${name}.png`));
      const x = await siXlsx({ ...(hh as any), requestDate: hh.requestDate, weightMode: hh.weightMode ?? 'NET_GROSS' }, rr);
      writeFileSync(join(out, `SI-${name}.xlsx`), x);
      console.log(`${name}: ${what}`);
    }
    const kato = ((ts?.customerProfiles ?? {}) as Record<string, any>)[order.customerId] ?? {};
    // The editor as a DRAFT (before finalizing), with the seeded wording on its row.
    const view = {
      ...g,
      status: 'DRAFT',
      finalFileId: null,
      header: { ...h, editedBy: 'Sayaka Matsuki', editedAt: '2026-11-05T05:10:00.000Z' },
      rows: rows.map((r) => ({ ...r, billet: named })),
      shipment: { id: sh.id, blNumber: sh.blNumber, status: sh.status, contractId: sh.contractId, orderId: order.id, seqNo: sh.seqNo, order: { orderNo: order.orderNo } },
      order: { orderNo: order.orderNo },
      contract: null,
      covers: [],
    };
    const fixture = {
      generated: { [g.id]: view },
      settings: { customerProfiles: { [order.customerId]: { label: kato.label ?? 'Kato', deliveryProfile: kato.deliveryProfile ?? null } }, docDefaults: { deliveryProfiles: [] } },
      docTypes,
    };
    writeFileSync(join(out, 'si-fixture.json'), JSON.stringify(fixture));
    writeFileSync(join(out, 'si-preview-html.json'), JSON.stringify(htmlById));
    console.log(`fixture: generated ${g.id} (${g.docRef}, stored ${g.status}) — shown as a draft`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
