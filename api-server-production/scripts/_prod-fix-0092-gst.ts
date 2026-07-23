import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // find ALL JPSG recharge invoices/CNs that still carry GST
  const rows: any[] = await prod.$queryRaw`
    SELECT id, name, type, config FROM "Document"
    WHERE "organizationId"=${ORG} AND name LIKE 'BIPL-JPSG-INV%'
      AND type IN ('INVOICE','CREDIT_NOTE')`;
  let fixed = 0;
  for (const r of rows) {
    const c: any = r.config || {};
    const di: any = c.documentInfo || {};
    const hasGst = Number(c.gstAmount || 0) > 0 || di.taxApplicable === "Y" || Number(di.gstPercent || 0) > 0;
    const needsAcct = (c.items || []).some((it: any) => it.accountCode !== "443");
    if (!hasGst && !needsAcct) continue;
    const items = (c.items || []).map((it: any) => ({ ...it, accountCode: "443" }));
    await prod.document.update({
      where: { id: r.id },
      data: {
        config: {
          ...c,
          items,
          gstAmount: 0,
          subTotal: Number(c.nettTotal ?? c.totals?.total ?? c.subTotal ?? 0),
          documentInfo: { ...di, taxCode: null, taxApplicable: "N", gstPercent: 0 },
        },
      },
    });
    console.log(`fixed ${r.type} ${r.name} (gst was ${c.gstAmount ?? di.gstPercent + "%"} · taxApplicable=${di.taxApplicable})`);
    fixed++;
  }
  console.log(`total fixed: ${fixed} of ${rows.length} JPSG docs`);
  await prod.$disconnect();
})();
