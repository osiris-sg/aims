import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const a443 = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, code: "443" }, select: { id: true } });
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { id: true, name: true, config: true } });
  let flipped = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || "")) continue;
    const needs = (c.lines || []).some((l: any) => l.accountId !== a443!.id);
    if (!needs) continue;
    const lines = (c.lines || []).map((l: any) => ({ ...l, accountId: a443!.id, accountCode: "443" }));
    await prod.document.update({ where: { id: b.id }, data: { config: { ...c, lines } } });
    flipped++;
  }
  console.log(`AIMS: flipped ${flipped} ref'd bills to 443`);
  // invoice 0708-0089: items → 443
  const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BIPL-JPSG-INV-20260708-0089" }, select: { id: true, config: true } });
  if (inv) {
    const c: any = inv.config || {};
    const items = (c.items || []).map((it: any) => (Number(it.amount) > 0 ? { ...it, accountCode: "443" } : it));
    await prod.document.update({ where: { id: inv.id }, data: { config: { ...c, items } } });
    console.log("AIMS: 0708-0089 items → 443");
  }
  await prod.$disconnect();
})();
