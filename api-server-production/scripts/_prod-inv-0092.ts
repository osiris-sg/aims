import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BIPL-JPSG-INV-20260715-0092", "BIPL-JPSG-INV-20260715-0090", "BIPL-JPSG-INV-20260721-0153"]) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name }, select: { config: true } });
    const c: any = d?.config || {};
    console.log(`\n${name}: di.reference=${JSON.stringify(c.documentInfo?.reference)} references=${JSON.stringify(c.references)} items[0].desc=${JSON.stringify((c.items?.[0]?.description || "").slice(0, 120))}`);
  }
  await prod.$disconnect();
})();
