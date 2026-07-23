import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const REF = "BIPL-JPSG-INV-20260715-0092";
const BILLS = ["JP2607140112", "JP2607140113", "JP2607140114"];
(async () => {
  for (const name of BILLS) {
    const doc = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name }, select: { id: true, config: true } });
    if (!doc) { console.log(`x ${name} not found`); continue; }
    const cfg: any = doc.config || {};
    await prod.document.update({ where: { id: doc.id }, data: { config: { ...cfg, reference: REF } } });
    console.log(`ok ${name}: reference=${REF} (xeroBillId=${cfg.xeroBillId ? "yes" : "no"})`);
  }
  await prod.$disconnect();
})();
