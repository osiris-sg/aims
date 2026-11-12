/**
 * READ-ONLY sample (2026-11-12, Part C): how a BC Air quotation prints in the
 * WCT layout with BC Air's OWN letterhead (its Organization row) and a client
 * e-signature in the bottom-right "Confirmation of Order" block. Uses the real
 * renderer (PdfGeneratorService.generateInvoiceHtml -> document-html) and the
 * real PDF options. Reads prod, writes only local files.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/_render-bcair-quote-sample.ts --out=<dir> [--quote=Q-014283]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { Client } from 'pg';
import { PdfGeneratorService } from '../src/common/services/pdf-generator.service';
import { pdfOptionsFor } from '../src/common/services/document-html';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const OUT = arg('out') || '.';
const QUOTE = arg('quote') || 'Q-014283';
const S3 = process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

/** A hand-drawn-looking signature as a PNG data URL (the shape public-sign stores). */
async function sampleSignature(browser: puppeteer.Browser): Promise<string> {
  const page = await browser.newPage();
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 120;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#1a237e';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(20, 80);
    for (let x = 20; x <= 330; x += 6) g.lineTo(x, 70 + Math.sin(x / 14) * 22 - (x > 200 ? (x - 200) / 8 : 0));
    g.stroke();
    g.beginPath();
    g.moveTo(60, 100);
    g.quadraticCurveTo(180, 40, 310, 95);
    g.stroke();
    return c.toDataURL('image/png');
  });
  await page.close();
  return url;
}

(async () => {
  const c = new Client({ connectionString: process.env.DBURL || '' });
  await c.connect();
  await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const org = (await c.query(`select * from "Organization" where id = $1`, [BCAIR])).rows[0];
  const tpl = (await c.query(`select "styleConfig", config from "DocumentTemplate" where "organizationId" = $1 and type = 'QUOTATION' and "styleConfig"->>'layout' = 'wct' order by "updatedAt" desc limit 1`, [WCT])).rows[0];
  const doc = (await c.query(`select name, config from "Document" where "organizationId" = $1 and type = 'QUOTATION' and name = $2`, [WCT, QUOTE])).rows[0];
  if (!org || !tpl || !doc) throw new Error('BC Air org, the WCT quotation template or the sample quote is missing');
  const cfg: any = doc.config || {};
  const bcCust = (await c.query(`select name, address, email from "Customer" where "organizationId" = $1 and lower(name) = lower($2) limit 1`, [BCAIR, cfg.customerName || ''])).rows[0];
  await c.end();

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const signature = await sampleSignature(browser);
    const config = {
      ...cfg,
      // Sample only: the BC Air customer of the same name when there is one; the e-signature as public-sign stores it.
      customerName: bcCust?.name ?? cfg.customerName,
      clientSignature: { name: 'Tan Ah Kow', image: signature, signedAt: new Date().toISOString(), ip: 'sample' },
    };
    const data: any = {
      documentType: 'QUOTATION',
      lang: 'en',
      ...config,
      design: tpl.styleConfig,
      logoUrl: org.logo ? (/^(https?:|data:)/i.test(org.logo) ? org.logo : `${S3}${org.logo}`) : null,
      name: doc.name,
      organization: org,
      company: org,
      customer: config.customer || { name: config.customerName },
      documentInfo: { ...(config.documentInfo || {}), documentNumber: config.documentInfo?.documentNumber || doc.name },
      items: Array.isArray(config.items) ? config.items : [],
      config,
      isQuotation: true,
    };
    const gen = new PdfGeneratorService();
    const html = gen.generateInvoiceHtml(data);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'bcair-quotation-sample.html'), html);
    const pdf = await gen.generatePdfFromHtml(html, pdfOptionsFor('QUOTATION', data) as any);
    fs.writeFileSync(path.join(OUT, 'bcair-quotation-sample.pdf'), pdf);
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(OUT, 'bcair-quotation-sample-page1.png') as `${string}.png`, fullPage: false });
    await page.screenshot({ path: path.join(OUT, 'bcair-quotation-sample-full.png') as `${string}.png`, fullPage: true });
    console.log(`Rendered ${doc.name} as BC Air (${bcCust ? 'BC Air customer matched' : 'customer name as on the quote'}) to ${OUT}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
