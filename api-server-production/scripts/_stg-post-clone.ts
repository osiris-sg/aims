import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const url = fs.readFileSync(".env.staging", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
const stg = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // TOKEN RULE: staging must never hold a live Xero refresh token.
  const t = await stg.xeroConnection.updateMany({
    where: { organizationId: ORG },
    data: { accessToken: "", refreshToken: "" },
  });
  console.log(`blanked tokens on ${t.count} staging XeroConnection row(s)`);
  const [tb]: any[] = await stg.$queryRaw`
    SELECT ROUND(SUM(l."debit" - l."credit")::numeric,2) AS net, COUNT(*)::int AS lines
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId"
    WHERE j."organizationId" = ${ORG}`;
  const [wallet]: any[] = await stg.$queryRaw`
    SELECT ROUND(SUM(l."debit" - l."credit")::numeric,2) AS bal
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id = l."accountId"
    WHERE j."organizationId" = ${ORG} AND c."name" = 'Airwallex'`;
  const [chips]: any[] = await stg.$queryRaw`
    SELECT COUNT(*) FILTER (WHERE config->>'xeroInvoiceId' IS NOT NULL OR config->>'xeroBillId' IS NOT NULL OR config->>'xeroCreditNoteId' IS NOT NULL)::int AS synced,
           COUNT(*)::int AS total
    FROM "Document" WHERE "organizationId" = ${ORG} AND type IN ('INVOICE','BILL','CREDIT_NOTE')`;
  console.log(`staging trial balance net=${tb.net} over ${tb.lines} lines (expect 0.00)`);
  console.log(`staging Airwallex wallet=${wallet.bal} (expect 13308.00)`);
  console.log(`staging GL docs with Xero chip: ${chips.synced}/${chips.total} (expect all)`);
  await stg.$disconnect();
})();
