import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // where does JP2604290112 point now?
  const b112 = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: "JP2604290112" }, select: { config: true } });
  console.log(`JP2604290112 ref = "${(b112?.config as any)?.reference}"`);
  // 0715-0047 journals crediting 443
  const rows: any[] = await prod.$queryRaw`
    SELECT j.reference, j.description, l."credit", j."entryDate"::date AS d
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND l."credit" > 0
      AND (j.reference LIKE '%0715-0047%' OR j.reference LIKE '%20260524-0001%')`;
  rows.forEach(r => console.log(`${r.d.toISOString().slice(0, 10)} CR ${r.credit} "${r.reference}"`));
  await prod.$disconnect();
})();
