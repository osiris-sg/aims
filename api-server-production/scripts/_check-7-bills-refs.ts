import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const LIST = ["JP2604300025", "JP2604300024", "JP2604290120", "JP2604290119", "JP2604290118", "JP2604290113", "JP2604290112"];
(async () => {
  // all invoices whose items mention any of these bill numbers
  const invs: any[] = await prod.$queryRaw`
    SELECT name, type, status, config FROM "Document"
    WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE')
      AND (name LIKE 'BIPL-JPSG%' OR name LIKE 'JPINV%')`;
  const refIndex = new Map<string, string[]>();
  for (const inv of invs) {
    const c: any = inv.config || {};
    const text = JSON.stringify(c.items || []) + " " + (c.documentInfo?.reference || "");
    for (const b of LIST) if (text.includes(b)) refIndex.set(b, [...(refIndex.get(b) || []), `${inv.name} (${c.xeroStatus || inv.status})`]);
  }
  for (const n of LIST) {
    const d = await prod.document.findFirst({
      where: { organizationId: ORG, type: "BILL", name: n },
      select: { config: true },
    });
    if (!d) { console.log(`${n}: NOT IN AIMS`); continue; }
    const c: any = d.config || {};
    const ref = c.reference || "(none)";
    const backRefs = refIndex.get(n) || [];
    console.log(`${n} $${c.totalAmount} paid=${c.amountPaid ?? 0}`);
    console.log(`   bill's own ref: ${ref}`);
    console.log(`   referenced BY:  ${backRefs.length ? backRefs.join(" · ") : "no invoice lists this bill"}`);
  }
  await prod.$disconnect();
})();
