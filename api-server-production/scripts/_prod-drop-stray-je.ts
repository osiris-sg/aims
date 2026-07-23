import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const strays = await prod.journalEntry.findMany({
    where: { organizationId: ORG, OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }] },
    select: { id: true, reference: true, description: true, entryDate: true },
  });
  strays.forEach(s => console.log(`stray: ${s.entryDate.toISOString().slice(0,10)} ${s.reference ?? ""} ${s.description ?? ""}`));
  const ids = strays.map(s => s.id);
  await prod.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
  const r = await prod.journalEntry.deleteMany({ where: { id: { in: ids } } });
  console.log(`deleted ${r.count} stray journal(s)`);
  await prod.$disconnect();
})();
