import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const pays: any[] = await prod.$queryRaw`
    SELECT d.name, (d.config->>'billDate')::date AS bill_date, bp."paymentDate"::date AS pay_date, bp.amount
    FROM "BillPayment" bp JOIN "Document" d ON d.id::text = bp."billId"
    WHERE bp."organizationId"=${ORG} AND bp."createdBy"='jp-pass-payment-script'
    ORDER BY d.name LIMIT 8`;
  console.table(pays);
  const [chk]: any[] = await prod.$queryRaw`
    SELECT COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE (d.config->>'billDate')::date = bp."paymentDate"::date)::int AS matching
    FROM "BillPayment" bp JOIN "Document" d ON d.id::text = bp."billId"
    WHERE bp."organizationId"=${ORG} AND bp."createdBy"='jp-pass-payment-script'`;
  console.log(`payments: ${chk.n} · payment date = bill date: ${chk.matching}`);
  await prod.$disconnect();
})();
