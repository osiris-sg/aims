/**
 * Round BP item 6 — re-read every PI in AIMS (ADH, prod) for the deposit ("Amount Payable") and its due date
 * ("Instrument to be received by"), and fill the orders' EMPTY fields only: PI no. / date / amount (the order's own
 * line on a shared PI), deposit payable, deposit due date. DRY RUN by default (lists per order); --apply after the go.
 * Vedanta PIs with a text layer are read exactly; scans and other suppliers' PIs by the AI reader (same prompt as the app).
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bp-pi-go.ts [--apply]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DocumentExtractionService } from '../src/document-extraction/document-extraction.service';
import { contractDraftFromPi, parseWith, PI_SCHEMA, PI_SYSTEM_PROMPT, PI_USER_PROMPT, piLineForOrder } from '../src/shipments/trade-extract.rules';
import { parseVedantaPiText } from '../src/shipments/trade-pi-text';
import { piFillFor } from '../src/shipments/trade-extract.service';
import { pdfText } from '../src/shipments/trade-coa';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const money = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '—');

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
  const ai = new DocumentExtractionService();
  const files: any[] = await p.tradeFile.findMany({
    where: { organizationId: ADH, docType: 'PI', links: { some: { orderId: { not: null }, hiddenAt: null } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileName: true, s3Key: true, mimeType: true, links: { where: { orderId: { not: null }, hiddenAt: null }, select: { order: { select: { id: true, orderNo: true, isTest: true, status: true, grade: true, qtyMt: true, piNo: true, piDate: true, piAmount: true, depositPct: true, depositAmount: true, depositDueDate: true } } } } },
  });
  let writes = 0;
  const rows: string[] = [];
  for (const f of files) {
    const orders = f.links.map((l: any) => l.order).filter((o: any) => o && !o.isTest);
    if (!orders.length) continue;
    const buf = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: process.env.RESOURCE_BUCKET || 'aims-osiris', Key: f.s3Key }))).Body!.transformToByteArray());
    const text = f.mimeType === 'application/pdf' ? await pdfText(buf).catch(() => '') : '';
    const t = text ? parseVedantaPiText(text) : null;
    let raw;
    let via: string;
    if (t?.complete) {
      raw = t.data;
      via = 'text';
    } else {
      const out = await ai.extractStructured({ buffer: buf, mimetype: f.mimeType }, PI_SYSTEM_PROMPT, PI_USER_PROMPT, { maxTokens: 4000 });
      raw = parseWith(PI_SCHEMA, out.data, 'PI');
      via = 'AI';
    }
    const d = contractDraftFromPi(raw, { suppliers: [], customers: [] });
    for (const o of orders) {
      const line = d.lines.length ? piLineForOrder(d.lines, o) : null;
      const fill = piFillFor(o, d);
      const keys = Object.keys(fill);
      writes += keys.length ? 1 : 0;
      rows.push(
        `#${o.orderNo} ${o.grade ?? ''} ${o.status}${o.status !== 'OPEN' ? ' (not open)' : ''} | PI ${d.piNumber ?? '?'} (${via}) | line ${line ? `${line.grade} ${line.quantityMt} t` : d.lines.length > 1 ? 'NOT MATCHED' : '—'} | amount ${money(line?.amount ?? (d.lines.length > 1 ? null : d.piAmount))} · payable ${money(line?.amountPayable ?? (d.lines.length > 1 ? null : d.depositAmount))} · due ${d.depositDueDate ?? '—'} | in AIMS: amount ${money(o.piAmount)} · deposit ${money(o.depositAmount)} · due ${day(o.depositDueDate)} | ${keys.length ? `${APPLY ? 'FILL' : 'would fill'} ${keys.map((k) => `${k}=${k === 'depositDueDate' || k === 'piDate' ? day(fill[k]) : k === 'piNo' ? fill[k] : money(fill[k])}`).join(', ')}` : 'nothing empty to fill'}`,
      );
      if (APPLY && keys.length) {
        await p.$transaction([
          p.tradeOrder.update({ where: { id: o.id }, data: fill }),
          p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-bp-pi-go', actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'UPDATE', resource: 'TradeOrder', resourceId: o.id, details: { script: 'scripts/_bp-pi-go.ts', go: 'owner, round BP item 6', order: `#${o.orderNo}`, pi: d.piNumber, via, filled: Object.fromEntries(keys.map((k) => [k, { from: null, to: k === 'depositDueDate' || k === 'piDate' ? day(fill[k]) : fill[k] }])) } as any } }),
        ]);
      }
    }
  }
  rows.sort((a, b) => Number(/^#(\d+)/.exec(a)?.[1]) - Number(/^#(\d+)/.exec(b)?.[1]));
  console.log(rows.join('\n'));
  console.log(`\n${APPLY ? 'Applied' : 'DRY RUN —'} ${writes} order(s) ${APPLY ? 'filled' : 'would be filled (empty fields only); nothing written'}`);
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
