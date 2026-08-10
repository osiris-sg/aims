import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prod.document.findMany({ where: { organizationId: ORG, name: { in: ["BI202608051","BI202608052","BI202608053","BI202608054","BI202608055","BI202608056","BI202608057","BI202608058"] } }, select: { name: true, type: true, config: true } });
  for (const d of docs.sort((a,b) => a.name.localeCompare(b.name))) {
    const c: any = d.config;
    const desc = (c.items || []).map((it: any) => it.description || "").join(" | ");
    console.log(`${d.name} [${d.type}] ${(c.date || "").slice(0,10)} · ${c.customer?.name || "?"} · $${c.total} · ${c.xeroStatus}`);
    console.log("   ", desc.replace(/\n/g, " ¶ ").slice(0, 180));
  }
  process.exit(0);
})();
