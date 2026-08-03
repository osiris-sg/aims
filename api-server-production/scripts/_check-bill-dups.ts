import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const NAMES = ["JP2604290113", "JP2604290118", "JP2604290119", "JP2604290120", "JP2604290121", "JP2604300024", "JP2604300025"];
(async () => {
  for (const n of NAMES) {
    const rows = await prod.document.findMany({
      where: { organizationId: ORG, type: "BILL", name: n },
      select: { id: true, createdAt: true, config: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`${n}: ${rows.length} row(s)`);
    for (const r of rows) {
      const c: any = r.config || {};
      console.log(`   ${r.id.slice(0, 8)} created=${r.createdAt.toISOString().slice(0, 16)} supplier=${(c.supplier?.name || c.supplierName || "?").slice(0, 24)} $${c.totalAmount} paid=${c.amountPaid ?? 0} xero=${c.xeroBillId ? "yes" : "no"} ref=${(c.reference || "").slice(0, 34)}`);
    }
  }
  await prod.$disconnect();
})();
