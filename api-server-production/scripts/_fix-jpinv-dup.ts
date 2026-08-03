import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // 1. delete the duplicate (keep the original, which is PAID in Xero)
  const dupId = "c90b8b00-0115-4a55-bbd9-844927441c57";
  await prod.documentItem.deleteMany({ where: { documentId: dupId } });
  await prod.documentEmbedding.deleteMany({ where: { documentId: dupId } }).catch(() => null);
  await prod.timelineItem.deleteMany({ where: { documentId: dupId } }).catch(() => null);
  await prod.document.delete({ where: { id: dupId } }).then(() => console.log("duplicate invoice deleted"), () => console.log("dup already gone"));
  // 2. complete the original's listing with the 7th bill + stamp its ref
  const orig = await prod.document.findFirst({
    where: { organizationId: ORG, type: "INVOICE", name: "JPINV-20260430-2CD9AA63" },
    select: { id: true, config: true },
  });
  const c: any = orig!.config || {};
  const items = (c.items || []).map((it: any) => {
    if (/JP26\d{8}/.test(it.description || "") && !it.description.includes("JP2604290121")) {
      return { ...it, description: it.description + "\n7. JP2604290121 — 20.00" };
    }
    return it;
  });
  await prod.document.update({ where: { id: orig!.id }, data: { config: { ...c, items } } });
  console.log("listing completed with JP2604290121 (7/7)");
  const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: "JP2604290121" }, select: { id: true, config: true } });
  const bc: any = b!.config || {};
  await prod.document.update({ where: { id: b!.id }, data: { config: { ...bc, reference: "JPINV-20260430-2CD9AA63" } } });
  console.log("JP2604290121 ref → JPINV-20260430-2CD9AA63");
  await prod.$disconnect();
})();
