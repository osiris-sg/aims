import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const n of ["BI202607009", "BI202607010", "BI202607012", "BI202607013", "BI202607014"]) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { config: true } });
    const c: any = d!.config || {};
    console.log(`\n=== ${n}`);
    (c.items || []).forEach((it: any, i: number) => {
      const t = (it.description || "").replace(/\n/g, " ⏎ ");
      const mth = t.match(/\(?\d+(st|nd|rd|th)\s*(month|mth)\)?/i)?.[0];
      console.log(`  [${i + 1}] ${mth ? "🏷 " + mth + " · " : ""}${t.slice(0, 150)}`);
    });
  }
  await prod.$disconnect();
})();
