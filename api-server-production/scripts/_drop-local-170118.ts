import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const je = await prod.journalEntry.findFirst({ where: { organizationId: ORG, reference: "SIN JP2607170118", postedBy: null }, select: { id: true } });
  if (!je) { console.log("not found"); return; }
  await prod.journalEntryLine.deleteMany({ where: { journalEntryId: je.id } });
  await prod.journalEntry.delete({ where: { id: je.id } });
  console.log("local duplicate journal deleted");
  const [bal]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443'`;
  console.log(`AIMS 443 lifetime: ${Number(bal.net).toFixed(2)}`);
  await prod.$disconnect();
})();
