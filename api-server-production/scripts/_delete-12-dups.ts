import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prod.document.findMany({
    where: { organizationId: ORG, type: { in: ["INVOICE", "CREDIT_NOTE"] } },
    select: { id: true, name: true, config: true },
  });
  const targets = docs.filter(d => {
    const c: any = d.config || {};
    return c.xeroSyncedBy === "jpsg-push" && c.xeroStatus === "DELETED";
  });
  for (const d of targets) {
    await prod.documentItem.deleteMany({ where: { documentId: d.id } });
    await prod.documentEmbedding.deleteMany({ where: { documentId: d.id } }).catch(() => null);
    await prod.timelineItem.deleteMany({ where: { documentId: d.id } }).catch(() => null);
    await prod.document.updateMany({ where: { baseDocumentId: d.id }, data: { baseDocumentId: null } });
    await prod.document.delete({ where: { id: d.id } });
    console.log(`deleted ${d.name}`);
  }
  console.log(`total: ${targets.length}`);
  await prod.$disconnect();
})();
