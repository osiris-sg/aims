import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1", name: "BI202608014", type: "INVOICE" }, select: { config: true } });
  const c: any = d!.config;
  console.log(`sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal}`);
  for (const it of c.items || []) console.log(` [${(it.itemCode || "—").padEnd(9)}] tag=${it.revenueTag || "—"} amt=${String(it.amount).padStart(8)} acct=${it.accountCode || "—"} · ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 75)}`);
  process.exit(0);
})();
