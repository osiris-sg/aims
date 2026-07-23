import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const doc = await prod.document.findFirst({
    where: { organizationId: ORG, type: "CREDIT_NOTE", name: "CN202606-001" },
    select: { id: true, name: true, status: true },
  });
  if (!doc) { console.log("not found"); return; }
  await prod.documentItem.deleteMany({ where: { documentId: doc.id } });
  await prod.documentEmbedding.deleteMany({ where: { documentId: doc.id } }).catch(() => null);
  await prod.timelineItem.deleteMany({ where: { documentId: doc.id } }).catch(() => null);
  await prod.document.updateMany({ where: { baseDocumentId: doc.id }, data: { baseDocumentId: null } });
  await prod.document.delete({ where: { id: doc.id } });
  console.log(`deleted CREDIT_NOTE ${doc.name} (${doc.status})`);
  await prod.$disconnect();
})();
