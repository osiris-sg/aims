import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const items: any[] = await prod.$queryRaw`
    SELECT di.id, di."deliveryStatus", di.description, d.name AS doc, d.type, d.status AS docstatus
    FROM "DocumentItem" di JOIN "Document" d ON d.id = di."documentId"
    WHERE d."organizationId"=${ORG} AND (di.description ILIKE '%zztest%' OR di."inventoryId" IN (SELECT id FROM "Inventory" WHERE sku IN ('ZZTEST-AST-004','ZZTEST-AST-005')))`;
  items.forEach(i => console.log(`${i.doc} (${i.type}/${i.docstatus}) · "${(i.description || "").slice(0, 40)}" · delivery=${i.deliveryStatus}`));
  await prod.$disconnect();
})();
