import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BIPL-JPSG-INV-20260721-0036", "BIPL-JPSG-INV-20260721-0038"]) {
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name }, select: { config: true } });
    const c: any = inv?.config || {};
    const listed = [...new Set([...JSON.stringify(c.items || []).matchAll(/(JP26\d{8})/g)].map(m => m[1]))];
    const linked = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", config: { path: ["reference"], equals: name } }, select: { name: true } });
    const have = new Set(linked.map(l => l.name));
    const missing = listed.filter(x => !have.has(x));
    console.log(`${name}: listed=${listed.length} linked-in-AIMS=${have.size}`);
    console.log(`  listed bills: ${listed.join(", ") || "(no listing on invoice)"}`);
    console.log(`  MISSING: ${missing.join(", ") || "(cannot derive — no listing)"}`);
  }
  await prod.$disconnect();
})();
