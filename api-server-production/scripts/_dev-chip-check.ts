import { createScriptPrisma } from "./xero-migration/_common";
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const prisma = createScriptPrisma();
  const rows: any[] = await prisma.$queryRaw`
    SELECT type,
      COUNT(*) FILTER (WHERE config->>'xeroInvoiceId' IS NOT NULL OR config->>'xeroBillId' IS NOT NULL OR config->>'xeroCreditNoteId' IS NOT NULL)::int AS synced,
      COUNT(*) FILTER (WHERE config->>'xeroInvoiceId' IS NULL AND config->>'xeroBillId' IS NULL AND config->>'xeroCreditNoteId' IS NULL)::int AS not_synced,
      COUNT(*) FILTER (WHERE config->>'xeroStatus' IS NOT NULL)::int AS with_status
    FROM "Document" WHERE "organizationId" = ${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')
    GROUP BY type ORDER BY type`;
  console.table(rows);
  const unsynced: any[] = await prisma.$queryRaw`
    SELECT type, name, status FROM "Document"
    WHERE "organizationId" = ${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')
      AND config->>'xeroInvoiceId' IS NULL AND config->>'xeroBillId' IS NULL AND config->>'xeroCreditNoteId' IS NULL
    ORDER BY type, name LIMIT 20`;
  console.table(unsynced);
  await prisma.$disconnect();
})();
