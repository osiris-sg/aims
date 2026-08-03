import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows = await prod.document.findMany({
    where: { organizationId: ORG, name: { contains: "2607170118" } },
    select: { name: true, type: true, createdAt: true },
  });
  console.log(rows.length ? rows.map(r => `${r.type} ${r.name} created=${r.createdAt.toISOString().slice(0, 16)}`).join("\n") : "still NOT in AIMS");
  await prod.$disconnect();
})();
