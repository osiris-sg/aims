/**
 * Round AV (read-only): label lines (B/L, vessel, voyage, ETD/ETA, net/gross, bundles, containers, invoice no.)
 * from the newest ADH emails' own text and attachments — to see the layouts the shipment prefill must read.
 * Prints only matching lines, clipped. Writes nothing.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { S3Service } from '../src/common/services/s3.service';
import { pdfText } from '../src/shipments/trade-coa';
import { sheetText } from '../src/shipments/trade-extract.service';
import { shipmentFacts } from '../src/ingestion-email/email-shipment-facts';
import { splitQuoted } from '../src/ingestion-email/email-quote';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const LABEL = /(b\/l|bill of lading|vessel|voy|e\.?t\.?d|e\.?t\.?a|net\s*w|gross|n\.?w|g\.?w|bundles?|container|invoice\s*no|cntr)/i;
(async () => {
  const prisma = new PrismaClient();
  const s3 = new S3Service(new ConfigService(process.env as any));
  const logs: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, direction: { not: 'OUTBOUND' } }, orderBy: { createdAt: 'desc' }, take: Number(process.env.N || 25), select: { id: true, subject: true, rawMeta: true } });
  for (const l of logs) {
    const meta: any = l.rawMeta ?? {};
    const out: string[] = [];
    const scan = (where: string, text: string) => {
      for (const line of text.split(/\r?\n/)) if (LABEL.test(line) && /\d/.test(line)) out.push(`  [${where}] ${line.trim().slice(0, 140)}`);
    };
    const atts: Array<{ name: string; text: string }> = [];
    if (process.env.FACTS) {
      for (const a of meta.attachments ?? []) {
        let t = '';
        try { const buf = await s3.downloadFile(a.key); t = /\.pdf$/i.test(a.name) ? (await pdfText(buf)).slice(0, 4000) : /\.(xlsx?|csv)$/i.test(a.name) ? sheetText(buf).slice(0, 4000) : ''; } catch {}
        atts.push({ name: a.name, text: t });
      }
      const f = shipmentFacts({ subject: l.subject ?? null, own: splitQuoted(String(meta.bodyText ?? '')).own, attachments: atts });
      const shown = Object.entries(f.fields).map(([k, v]: any) => `${k}=${v.value ?? `?(${v.candidates.map((c: any) => c.value).join('|')})`}`);
      if (shown.length) console.log(`— ${String(l.subject ?? '').slice(0, 70)}\n    ${shown.join('  ')}`);
      continue;
    }
    scan('body', String(meta.bodyText ?? '').split(/\n-{2,}\s*Original|\nOn .* wrote:|\nFrom: /)[0].slice(0, 3000));
    for (const a of (meta.attachments ?? []).slice(0, 6)) {
      if (/\.(png|jpe?g|gif)$/i.test(a.name)) continue;
      let t = '';
      try {
        const buf = await s3.downloadFile(a.key);
        t = /\.pdf$/i.test(a.name) ? (await pdfText(buf)).slice(0, 4000) : /\.(xlsx?|csv)$/i.test(a.name) ? sheetText(buf).slice(0, 4000) : '';
      } catch {}
      scan(a.name.slice(0, 40), t);
    }
    if (out.length) console.log(`— ${String(l.subject ?? '').slice(0, 80)}\n${out.slice(0, 18).join('\n')}`);
  }
  await prisma.$disconnect();
})();
