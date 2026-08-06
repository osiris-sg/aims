import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const n of ["GB2600026082", "GB2600024766", "GB2600022014"]) {
    const rows = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: n } }, select: { name: true, status: true, createdAt: true, config: true } });
    if (!rows.length) { console.log(`${n}: NOT IN AIMS`); continue; }
    for (const r of rows) {
      const c: any = r.config || {};
      console.log(`"${r.name}" status=${r.status} created=${r.createdAt.toISOString().slice(0, 10)} billStatus=${c.billStatus} xeroStatus=${c.xeroStatus} total=${c.totalAmount ?? c.xeroGross} balance=${c.xeroBalance} paid=${c.amountPaid}`);
    }
  }
  const [cnt]: any[] = await prod.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "Document" WHERE "organizationId"=${ORG} AND type='BILL' AND name LIKE 'GB26000%'`;
  console.log(`total GB-series bills in AIMS: ${cnt.n}`);
  await prod.$disconnect();
})();
