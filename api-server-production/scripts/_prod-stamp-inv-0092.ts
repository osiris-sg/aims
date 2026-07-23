import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const REF = "JP2607140112, JP2607140113, JP2607140114";
(async () => {
  const d = await prod.document.findFirst({
    where: { organizationId: ORG, type: "INVOICE", name: "BIPL-JPSG-INV-20260715-0092" },
    select: { id: true, config: true },
  });
  const c: any = d!.config || {};
  await prod.document.update({
    where: { id: d!.id },
    data: { config: { ...c, documentInfo: { ...(c.documentInfo || {}), reference: REF } } },
  });
  console.log(`ok BIPL-JPSG-INV-20260715-0092 reference="${REF}"`);
  await prod.$disconnect();
})();
