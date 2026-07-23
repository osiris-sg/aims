import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // prod-born CNs (no Xero id)
  const cns = await prod.document.findMany({
    where: { organizationId: ORG, type: "CREDIT_NOTE" },
    select: { id: true, name: true, status: true, baseDocumentId: true, config: true, createdAt: true },
  });
  for (const cn of cns) {
    const c: any = cn.config || {};
    if (c.xeroCreditNoteId) continue; // Xero-imported, skip
    const refKeys = ["relatedInvoiceId", "appliedToDocumentId", "creditedInvoiceId", "invoiceId", "sourceDocumentId", "originalInvoiceNumber", "reference"];
    const refs: string[] = [];
    for (const k of refKeys) if (c[k]) refs.push(`${k}=${c[k]}`);
    let base = null as any;
    if (cn.baseDocumentId)
      base = await prod.document.findUnique({ where: { id: cn.baseDocumentId }, select: { name: true, type: true, status: true, config: true } });
    // fallback: invoice with same name
    const twin = await prod.document.findFirst({
      where: { organizationId: ORG, type: "INVOICE", name: cn.name },
      select: { name: true, status: true, config: true },
    });
    const totals = c.totals?.total ?? c.nettTotal ?? "?";
    console.log(`\nCN ${cn.name} (${cn.status}) total=${totals}`);
    if (refs.length) console.log(`  config refs: ${refs.join(", ")}`);
    if (base) console.log(`  baseDocument → ${base.type} ${base.name} (${base.status}) xero=${(base.config as any)?.xeroInvoiceId ? "YES" : "NO"}`);
    if (twin) console.log(`  same-name invoice → ${twin.name} (${twin.status}) xero=${(twin.config as any)?.xeroInvoiceId ? "YES" : "NO"}`);
    if (!refs.length && !base && !twin) console.log(`  ⚠ no linkage found at all`);
  }
  await prod.$disconnect();
})();
