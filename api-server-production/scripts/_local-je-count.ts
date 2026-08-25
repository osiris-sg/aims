import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
(async () => {
  const n = await prisma.journalEntry.count({ where: { organizationId: "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1", status: "POSTED", OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }] } });
  console.log(`local POSTED journals now: ${n}`);
  process.exit(0);
})();
