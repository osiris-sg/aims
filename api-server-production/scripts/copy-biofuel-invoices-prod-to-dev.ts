import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

const devUrl = dotenv.parse(fs.readFileSync('.env')).DATABASE_URL;
const prodUrl = dotenv.parse(fs.readFileSync('.env.production')).DATABASE_URL;
const dev = new PrismaClient({ datasources: { db: { url: devUrl } } });
const prod = new PrismaClient({ datasources: { db: { url: prodUrl } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

async function main() {
  // 1) Pull full prod invoice rows.
  const invoices = await prod.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' } });
  console.log(`prod invoices: ${invoices.length}`);

  // 2) Ensure every referenced template exists on dev (copy missing ones).
  const tmplIds = Array.from(new Set(invoices.map((i) => i.documentTemplateId).filter(Boolean))) as string[];
  for (const tid of tmplIds) {
    const exists = await dev.documentTemplate.findUnique({ where: { id: tid } });
    if (!exists) {
      const t = await prod.documentTemplate.findUnique({ where: { id: tid } });
      if (t) { await dev.documentTemplate.create({ data: t as any }); console.log(`  copied missing template ${tid}`); }
      else console.log(`  ⚠ template ${tid} not found on prod either`);
    }
  }

  // 3) Upsert invoices by (org, type, name): refresh existing, create missing.
  const devInv = await dev.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { id: true, name: true } });
  const devByName = new Map(devInv.map((d) => [d.name, d.id]));

  let created = 0, updated = 0, failed = 0;
  for (const inv of invoices) {
    try {
      const existingId = devByName.get(inv.name);
      if (existingId) {
        await dev.document.update({ where: { id: existingId }, data: { status: inv.status, config: inv.config as any, documentTemplateId: inv.documentTemplateId } });
        updated++;
      } else {
        await dev.document.create({ data: inv as any });
        created++;
      }
    } catch (e: any) {
      failed++;
      if (failed <= 8) console.log(`  fail "${inv.name}": ${e.message?.slice(0, 140)}`);
    }
  }
  console.log(`\ndone. created=${created} updated=${updated} failed=${failed}`);
  console.log(`dev invoices now: ${await dev.document.count({ where: { organizationId: ORG, type: 'INVOICE' } })}`);
}
main().catch((e) => console.log('ERR', e.message?.slice(0, 200))).finally(async () => { await dev.$disconnect(); await prod.$disconnect(); });
