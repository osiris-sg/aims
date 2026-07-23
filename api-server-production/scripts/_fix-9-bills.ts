import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const VOID = ["ID202603-028", "ID202603-030", "Biofiuel20260311 (26.3.26_", "SMM-2026-INV-076", "GB2600020743", "VE/INV-26033146"];
const DELETE_DUPS = ["ELL-IV-26020658 (Pending)", "ELL-IV-26030013 (Pending)"];
(async () => {
  for (const name of VOID) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name }, select: { id: true, config: true } });
    if (!d) { console.log(`x ${name} missing`); continue; }
    const c: any = d.config || {};
    await prod.document.update({
      where: { id: d.id },
      data: { config: { ...c, billStatus: "VOID", voided: true, voidReason: "Not present in Xero — voided in prod↔Xero cleanup 2026-07-23" } },
    });
    console.log(`void ${name}`);
  }
  for (const name of DELETE_DUPS) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name }, select: { id: true } });
    if (!d) { console.log(`x ${name} missing`); continue; }
    await prod.documentItem.deleteMany({ where: { documentId: d.id } });
    await prod.documentEmbedding.deleteMany({ where: { documentId: d.id } }).catch(() => null);
    await prod.timelineItem.deleteMany({ where: { documentId: d.id } }).catch(() => null);
    await prod.document.delete({ where: { id: d.id } });
    console.log(`deleted dup ${name}`);
  }
  await prod.$disconnect();
})();
