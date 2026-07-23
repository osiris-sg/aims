import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["JP2604150059", "JP2607070051"]) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name }, select: { config: true } });
    const c: any = b?.config || {};
    console.log(`\n=== ${name} keys: ${Object.keys(c).join(", ")}`);
    for (const k of ["items", "lines", "inboundMeta", "reference", "sponsor", "employer", "meta", "extractedMeta"]) {
      if (c[k] !== undefined) console.log(`${k}: ${JSON.stringify(c[k]).slice(0, 400)}`);
    }
  }
  await prod.$disconnect();
})();
