import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prod.document.findFirst({
    where: { organizationId: ORG, name: "DO202608-0005", type: "DELIVERY_ORDER" },
    select: { id: true, name: true, status: true },
  });
  if (!d) { console.log("DO202608-0005 not found"); return; }
  await prod.documentItem.deleteMany({ where: { documentId: d.id } });
  await prod.timelineItem.deleteMany({ where: { documentId: d.id } }).catch(() => null);
  await prod.deliveryShareLink.deleteMany({ where: { documentId: d.id } }).catch(() => null);
  await prod.documentEmbedding.deleteMany({ where: { documentId: d.id } }).catch(() => null);
  await prod.document.updateMany({ where: { baseDocumentId: d.id }, data: { baseDocumentId: null } });
  await prod.document.delete({ where: { id: d.id } });
  console.log(`deleted ${d.name} (${d.status}) + items/links`);
  // verify no DO items reference units 004/005 anymore
  const left: any[] = await prod.$queryRaw`
    SELECT d.name, d.type, i.sku FROM "DocumentItem" di
    JOIN "Inventory" i ON i.id = di."inventoryId"
    JOIN "Document" d ON d.id = di."documentId"
    WHERE d."organizationId"=${ORG} AND i.sku IN ('ZZTEST-AST-004','ZZTEST-AST-005')`;
  console.log(left.length ? left : "✓ units 004/005 have NO document items attached");
  await prod.$disconnect();
})();
