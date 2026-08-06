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
    SELECT di.id, i.sku, d.name AS doc, d.type, di."deliveryStatus"
    FROM "DocumentItem" di
    JOIN "Inventory" i ON i.id = di."inventoryId"
    JOIN "Document" d ON d.id = di."documentId"
    WHERE d."organizationId"=${ORG} AND i.sku IN ('ZZTEST-AST-004','ZZTEST-AST-005')`;
  console.log("items linked to units 004/005:");
  rows.forEach(r => console.log(`  ${r.doc} (${r.type}) · ${r.sku} · ${r.deliveryStatus}`));
  const ids = rows.map(r => r.id);
  const upd = await prod.documentItem.updateMany({
    where: { id: { in: ids } },
    data: { deliveryStatus: "not_delivered", deductedAt: null, deliveringAt: null, deliveredAt: null, completedAt: null, installSkipped: false },
  });
  console.log(`reset ${upd.count} item(s) → not_delivered (timestamps cleared)`);
  await prod.$disconnect();
})();
