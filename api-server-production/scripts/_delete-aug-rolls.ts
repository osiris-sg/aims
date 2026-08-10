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
    where: { organizationId: ORG, type: "INVOICE", status: "draft" as any, name: { gte: "BI202608059", lte: "BI202608129" } },
    select: { id: true, name: true, config: true },
  });
  const mine = docs.filter(d => (d.config as any)?.provisionalNumber === true && (d.config as any)?.rolledFrom);
  console.log(`found ${docs.length} drafts in range, ${mine.length} are roll-created (expect 71)`);
  if (mine.length !== 71) { console.log("COUNT MISMATCH — not deleting. Names:", docs.map(d => d.name).join(",")); process.exit(1); }
  const res = await prod.document.deleteMany({ where: { id: { in: mine.map(d => d.id) } } });
  console.log(`deleted ${res.count} draft invoices (BI202608059–BI202608129)`);
  process.exit(0);
})();
