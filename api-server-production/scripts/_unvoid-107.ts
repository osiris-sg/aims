import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const doc = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202607107" } });
  if (!doc) { console.log("BI202607107 not found"); process.exit(1); }
  const c: any = doc.config || {};
  console.log("before: voided =", c.voided, "| xeroBalance =", c.xeroBalance, "| xeroStatus =", c.xeroStatus);
  if (!c.voided) { console.log("already clean — nothing to do"); process.exit(0); }
  const { voided, ...clean } = c;
  await prod.document.update({ where: { id: doc.id }, data: { config: clean } });
  console.log("✓ voided flag removed from BI202607107");
  process.exit(0);
})();
