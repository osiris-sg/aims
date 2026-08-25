import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const ds = await prisma.document.findMany({ where: { organizationId: ORG, name: "BI202608079", type: "INVOICE" }, select: { id: true, createdAt: true, documentTemplateId: true, config: true } });
  console.log(`${ds.length} doc(s) named BI202608079:`);
  for (const d of ds) {
    const c: any = d.config;
    console.log(`  id=${d.id.slice(0, 8)} created=${d.createdAt.toISOString().slice(0, 16)} tpl=${d.documentTemplateId.slice(0, 8)} syncedBy=${c.xeroSyncedBy} xeroId=${(c.xeroInvoiceId || "").slice(0, 8)} gen-line-qty=${JSON.stringify((c.items || []).find((it: any) => /60KVA|Denyo/i.test(it.description || ""))?.quantity)}`);
  }
  process.exit(0);
})();
