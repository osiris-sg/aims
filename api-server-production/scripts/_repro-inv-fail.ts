import { PrismaClient, Prisma } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from './xero-migration/_common';
const prisma = new PrismaClient();
const TMPL = 'cc6d0035-993f-403f-8dd6-582ce8b10b0b';
async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  const res = await xeroGet<any>(tokens, '/Invoices', { where: 'InvoiceNumber=="INV-0033" && Type=="ACCREC"' });
  const inv = (res.Invoices || [])[0];
  if (!inv) { console.log('INV-0033 not found in Xero'); return; }
  console.log(`Xero INV-0033: id=${inv.InvoiceID} status=${inv.Status} date=${inv.DateString} total=${inv.Total}`);
  try {
    const doc = await prisma.document.create({
      data: {
        organizationId: BIOFUEL_ORG_ID,
        documentTemplateId: TMPL,
        name: 'INV-0033',
        type: 'INVOICE',
        status: 'confirmed' as any,
        config: { probe: true, xeroInvoiceId: inv.InvoiceID } as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(`CREATE SUCCEEDED: ${doc.id} → transient failure confirmed. Deleting probe row (real import will recreate with full data).`);
    await prisma.document.delete({ where: { id: doc.id } });
  } catch (e: any) {
    console.log('CREATE FAILED — FULL ERROR:\n', e.message);
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
