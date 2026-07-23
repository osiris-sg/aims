import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows: any[] = await prod.$queryRaw`
    SELECT type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE config->>'xeroInvoiceId' IS NOT NULL OR config->>'xeroBillId' IS NOT NULL OR config->>'xeroCreditNoteId' IS NOT NULL)::int AS synced_chip,
      COUNT(*) FILTER (WHERE config->>'xeroInvoiceId' IS NULL AND config->>'xeroBillId' IS NULL AND config->>'xeroCreditNoteId' IS NULL)::int AS not_synced
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')
    GROUP BY type ORDER BY type`;
  console.table(rows);
  const st: any[] = await prod.$queryRaw`
    SELECT COALESCE(config->>'xeroStatus','(none)') AS xero_status, COUNT(*)::int AS n
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')
      AND (config->>'xeroInvoiceId' IS NOT NULL OR config->>'xeroBillId' IS NOT NULL OR config->>'xeroCreditNoteId' IS NOT NULL)
    GROUP BY 1 ORDER BY n DESC`;
  console.table(st);
  const unsynced: any[] = await prod.$queryRaw`
    SELECT type, COUNT(*)::int AS n FROM "Document"
    WHERE "organizationId"=${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')
      AND config->>'xeroInvoiceId' IS NULL AND config->>'xeroBillId' IS NULL AND config->>'xeroCreditNoteId' IS NULL
    GROUP BY 1`;
  console.table(unsynced);
  await prod.$disconnect();
})();
