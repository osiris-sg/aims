import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const url = fs.readFileSync(".env", "utf8").match(/^JPSG_DATABASE=\s*"?([^"\n]+)"?/m)?.[1]?.trim();
const pool = new Pool({ connectionString: url });
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // customers of the two invoices
  for (const name of ["BIPL-JPSG-INV-20260721-0036", "BIPL-JPSG-INV-20260721-0038"]) {
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name }, select: { config: true } });
    const c: any = inv?.config || {};
    console.log(`${name}: customer = ${c.customerName || c.customer?.name} · $${c.totals?.total ?? c.nettTotal}`);
  }
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='company_permit_passes' ORDER BY ordinal_position`);
  console.log("\ncompany_permit_passes columns:", cols.rows.map(r => r.column_name).join(", "));
  await pool.end(); await prod.$disconnect();
})();
