/** Round BJ — READ-ONLY: every ADH B/L / B/L draft file (PDF + text layer + stored reads + linked shipment fields) → --out=<dir>. Prod: DBURL inline, TENANCY_MODE=. */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { pdfText } from '../src/shipments/trade-coa';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const out = process.argv.find((a) => a.startsWith('--out='))!.slice(6);
const types = (process.argv.find((a) => a.startsWith('--types='))?.slice(8) ?? 'BL,BL_DRAFT').split(',');
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
(async () => {
  const files = await p.tradeFile.findMany({
    where: { organizationId: ORG, docType: { in: types } },
    select: { id: true, docType: true, fileName: true, s3Key: true, mimeType: true, createdAt: true, links: { select: { shipmentId: true, orderId: true, hiddenAt: true } }, extractions: { select: { id: true, kind: true, status: true, result: true, model: true, createdAt: true } } },
  });
  const sids = [...new Set(files.flatMap((f) => f.links.map((l) => l.shipmentId)).filter((x): x is string => !!x))];
  const ships = await p.shipment.findMany({
    where: { id: { in: sids } },
    select: { id: true, seqNo: true, blNumber: true, portOfLoading: true, portOfDischarge: true, containerCount: true, hsCode: true, countryOfOrigin: true, totalBundles: true, netWeightMt: true, order: { select: { orderNo: true, isTest: true } } },
  });
  const meta: any[] = [];
  for (const f of files) {
    let text = '';
    const fp = path.join(out, `${f.id}${path.extname(f.fileName) || '.bin'}`);
    try {
      const b = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: process.env.RESOURCE_BUCKET, Key: f.s3Key }))).Body!.transformToByteArray());
      fs.writeFileSync(fp, b);
      if (/pdf/i.test(f.mimeType)) text = await pdfText(b).catch(() => '');
    } catch (e) {
      text = `!! ${(e as Error).message}`;
    }
    fs.writeFileSync(path.join(out, `${f.id}.txt`), text);
    meta.push({ ...f, s3Key: undefined, textLen: text.length, ships: ships.filter((s) => f.links.some((l) => l.shipmentId === s.id)).map((s) => ({ ...s, ref: `#${s.order?.orderNo}-${s.seqNo}${s.order?.isTest ? ' (test)' : ''}` })) });
  }
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(files.length, 'files');
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
