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
    where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BIPL-JPSG-INV" } },
    select: { id: true, name: true, config: true },
  });
  let n = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    // leftover Xero mirror fields on docs no longer linked to Xero
    if (!c.xeroInvoiceId && (c.xeroBalance !== undefined || c.xeroAmountPaid !== undefined || c.xeroGross !== undefined)) {
      const { xeroBalance, xeroAmountPaid, xeroGross, xeroLastSyncAt, ...clean } = c;
      await prod.document.update({ where: { id: d.id }, data: { config: clean } });
      n++;
    }
  }
  console.log(`scrubbed leftover Xero balance fields on ${n} unlinked JPSG docs`);
  await prod.$disconnect();
})();
