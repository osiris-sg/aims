// One-off: copy dev invoice BI202607107 (Biofuel) to PROD with prod's
// Sin Hua customer id stamped into config (guru 2026-07-27). Dry-run unless
// --apply. Verifies the template exists in prod; no journal is created —
// the invoice lands unconfirmed (posting-queue model).
import * as dotenv from 'dotenv';
import * as path from 'path';
const APPLY = process.argv.includes('--apply');

import { PrismaClient } from '@prisma/client';

const DEV_DOC_ID = 'b6af81e9-283d-4530-9ce2-3e0cc1fc878e';
const PROD_SIN_HUA = '63890785-bc63-4bf1-9965-33ee22f25507';

async function main() {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
  const dev = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const doc = await dev.document.findUnique({ where: { id: DEV_DOC_ID } });
  await dev.$disconnect();
  if (!doc) throw new Error('dev doc not found');

  dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
  const prod = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const dupe = await prod.document.findFirst({ where: { name: doc.name, organizationId: doc.organizationId } });
  if (dupe) throw new Error(`prod already has ${doc.name} (${dupe.id})`);

  const cust = await prod.customer.findUnique({ where: { id: PROD_SIN_HUA }, select: { id: true, name: true } });
  if (!cust) throw new Error('prod Sin Hua customer not found');

  // Template must exist in prod; fall back to prod's active/legacy INVOICE template.
  let templateId = doc.documentTemplateId;
  const tmpl = await prod.documentTemplate.findUnique({ where: { id: templateId }, select: { id: true, name: true } });
  if (!tmpl) {
    const sel = await prod.organizationActiveTemplate.findFirst({
      where: { organizationId: doc.organizationId, type: 'INVOICE' }, select: { templateId: true },
    });
    const legacy = sel
      ? null
      : await prod.documentTemplate.findFirst({ where: { type: 'INVOICE', isActive: true }, select: { id: true } });
    templateId = sel?.templateId || legacy?.id || '';
    if (!templateId) throw new Error('no INVOICE template resolvable in prod');
    console.log(`dev template missing in prod → using ${templateId}`);
  } else {
    console.log(`template ok in prod: ${tmpl.name}`);
  }

  const config: any = { ...(doc.config as any), customerId: cust.id, customerName: cust.name };
  console.log(`Copying ${doc.name} (type=${doc.type}, status=${doc.status}) → prod Biofuel`);
  console.log(`  customer: ${cust.name} (${cust.id})`);
  console.log(`  items: ${(config.items || []).length}, nettTotal: ${config.nettTotal}, gst: ${config.gstAmount}, gross: ${config.grossTotal}`);
  if (!APPLY) { console.log('dry-run — pass --apply to write'); await prod.$disconnect(); return; }

  const created = await prod.document.create({
    data: {
      id: doc.id, // keep the same id (unused in prod — verified no dupe)
      name: doc.name,
      type: doc.type,
      status: doc.status,
      config,
      documentTemplateId: templateId,
      organizationId: doc.organizationId,
      attachments: doc.attachments as any,
      createdAt: doc.createdAt,
    },
    select: { id: true, name: true, status: true },
  });
  console.log('CREATED in prod:', JSON.stringify(created));
  await prod.$disconnect();
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
