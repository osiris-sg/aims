import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const q of ["JP2604300025", "JP2604300024", "JP2604290113"]) {
    const hits: any[] = await prod.$queryRaw`
      SELECT name, type, status FROM "Document"
      WHERE "organizationId"=${ORG} AND name <> ${q} AND config::text LIKE ${"%" + q + "%"}`;
    console.log(`${q}: ${hits.length ? hits.map(h => `${h.type} ${h.name} (${h.status})`).join(" · ") : "mentioned NOWHERE"}`);
  }
  // hypothesis: the BRK JPINV invoice covers them without listing bill numbers
  const jpinv = await prod.document.findFirst({
    where: { organizationId: ORG, name: "JPINV-20260430-2CD9AA63" },
    select: { config: true },
  });
  const c: any = jpinv?.config || {};
  console.log(`\nJPINV-20260430-2CD9AA63 (BRK $140) items:`);
  (c.items || []).forEach((it: any) => console.log(`  qty=${it.quantity} unit=${it.unitPrice} amt=${it.amount} "${(it.description || "").replace(/\n/g, " | ")}"`));
  // all BRK bills late Apr with amounts
  const brk: any[] = await prod.$queryRaw`
    SELECT name, config->>'totalAmount' AS total, config->>'billDate' AS date, config->>'reference' AS ref
    FROM "Document" WHERE "organizationId"=${ORG} AND type='BILL'
      AND config->>'reference' LIKE '%BRK%' ORDER BY name`;
  console.log(`\nall bills with BRK employer ref (${brk.length}):`);
  brk.forEach(b => console.log(`  ${b.name} $${b.total} ${String(b.date).slice(0, 10)}`));
  await prod.$disconnect();
})();
