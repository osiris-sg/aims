// READ-ONLY (round BS): the per-shipment SUS COA 集計 of #25-1 / #25-2 / #25-3, built in memory (previewFormat) → HTML files.
require('dotenv').config();
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
async function main() {
  const out = process.argv[2];
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const gen = new TradeGeneratedService(p as any, new S3Service({ get: (k: string) => process.env[k] } as any), null as any, new TradeConfigService(p as any), null as any, null as any, null as any);
  const ships = await p.shipment.findMany({ where: { organizationId: '056ed6da-42d3-438e-895b-84bb4df47a4c', order: { orderNo: 25 } }, orderBy: { seqNo: 'asc' }, select: { id: true, seqNo: true } });
  for (const s of ships) {
    const pv = await gen.previewFormat('056ed6da-42d3-438e-895b-84bb4df47a4c', s.id, 'CUSTOMER_COA', 'CUSTOMER_COA_SUS_SUMMARY');
    fs.writeFileSync(`${out}/CUSTOMER_COA-25-${s.seqNo}.html`, pv.html);
    const text = pv.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    console.log(`#25-${s.seqNo} source ${pv.source}\n  ${text.slice(0, 600)}\n  notes: ${pv.notes.join(' | ').slice(0, 300)}`);
  }
  await p.$disconnect();
}
main().catch((e) => console.error(String(e.message).slice(0, 400)));
