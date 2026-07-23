import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prod.document.findFirst({
    where: { organizationId: ORG, type: "INVOICE", name: "BIPL-JPSG-INV-20260715-0092" },
    select: { id: true, config: true },
  });
  const c: any = d!.config || {};
  const ref = c.documentInfo?.reference;
  await prod.document.update({
    where: { id: d!.id },
    data: { config: { ...c, documentInfo: { ...(c.documentInfo || {}), referenceNo: ref } } },
  });
  console.log(`ok referenceNo="${ref}"`);
  await prod.$disconnect();
})();
