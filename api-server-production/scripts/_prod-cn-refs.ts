import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const client = (f: string) => new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(f, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const prod = client(".env.production"), dev = client(".env");
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const cns = await prod.document.findMany({
    where: { organizationId: ORG, type: "CREDIT_NOTE" },
    select: { name: true, status: true, config: true },
  });
  for (const cn of cns) {
    const c: any = cn.config || {};
    if (c.xeroCreditNoteId) continue;
    const ref = c.documentInfo?.reference || "(none)";
    const total = c.totals?.total ?? c.nettTotal;
    let invLine = "no reference";
    if (ref !== "(none)") {
      const inv = await prod.document.findFirst({
        where: { organizationId: ORG, type: "INVOICE", name: ref },
        select: { name: true, status: true, config: true },
      });
      if (inv) {
        const ic: any = inv.config || {};
        const inXeroProd = !!ic.xeroInvoiceId;
        const inDev = !!(await dev.document.findFirst({ where: { organizationId: ORG, name: ref }, select: { id: true } }));
        invLine = `invoice ${inv.name} (${inv.status}) — in Xero: ${inXeroProd || inDev ? "YES" : "NO"}`;
      } else invLine = `⚠ referenced invoice "${ref}" NOT FOUND in prod`;
    }
    console.log(`CN ${cn.name} (${cn.status}) $${total} → ref ${ref}\n   ${invLine}`);
  }
  await prod.$disconnect(); await dev.$disconnect();
})();
