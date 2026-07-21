import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const docs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, type, status::text AS status, "documentTemplateId",
            config->>'nettTotal' AS nett, config->'customer'->>'name' AS customer
     FROM "Document"
     WHERE "organizationId" = $1 AND type = 'INVOICE'
       AND (config->>'xeroImported') IS DISTINCT FROM 'true'
       AND (config->>'xeroInvoiceId') IS NULL
     ORDER BY "createdAt" DESC LIMIT 8`, BIOFUEL_ORG_ID);
  console.table(docs.map(d => ({ name: d.name, status: d.status, nett: d.nett, customer: (d.customer || '').slice(0, 26), id: d.id.slice(0, 8), tmpl: d.documentTemplateId?.slice(0, 8) })));
  if (docs[0]) console.log('URL id:', docs[0].id, 'tmpl:', docs[0].documentTemplateId);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
