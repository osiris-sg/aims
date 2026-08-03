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
    where: { organizationId: ORG, name: { contains: "170118" } },
    select: { id: true, name: true, type: true, status: true, createdAt: true, config: true },
  });
  for (const r of rows) {
    const c: any = r.config || {};
    console.log(`${r.type} "${r.name}" status=${r.status} created=${r.createdAt.toISOString().slice(0, 16)}`);
    console.log(`  total=${c.totalAmount ?? c.totals?.total} ref=${c.reference || "(none)"} acct=${c.lines?.[0]?.accountCode || "?"} tax=${c.taxAmount} amountsAre=${c.amountsAre} paid=${c.amountPaid ?? 0} xero=${c.xeroBillId ? c.xeroStatus : "not linked"} channel=${c.inboundChannel || "-"} supplier=${(c.supplier?.name || c.supplierName || "?").slice(0, 25)}`);
  }
  await prod.$disconnect();
})();
