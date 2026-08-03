import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const INV = "JPINV-20260430-2CD9AA63";
const BILLS = ["JP2604290113", "JP2604290118", "JP2604290119", "JP2604290120", "JP2604300024", "JP2604300025"];
(async () => {
  // 1. append the bill listing as a zero-amount line on the invoice
  const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: INV }, select: { id: true, config: true } });
  const c: any = inv!.config || {};
  const amounts: string[] = [];
  for (const b of BILLS) {
    const bd = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: b }, select: { config: true } });
    amounts.push(`${b} — ${Number((bd!.config as any).totalAmount).toFixed(2)}`);
  }
  const listing = amounts.map((a, i) => `${i + 1}. ${a}`).join("\n");
  const hasListing = (c.items || []).some((it: any) => /JP26\d+/.test(it.description || ""));
  if (!hasListing) {
    const items = [...(c.items || []), { id: Date.now(), quantity: 0, unitPrice: 0, amount: 0, description: listing }];
    await prod.document.update({ where: { id: inv!.id }, data: { config: { ...c, items } } });
    console.log(`listing added to ${INV}:\n${listing}`);
  } else console.log("listing already present");
  // 2. back-stamp each bill's reference to the invoice
  for (const b of BILLS) {
    const bd = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: b }, select: { id: true, config: true } });
    const bc: any = bd!.config || {};
    await prod.document.update({ where: { id: bd!.id }, data: { config: { ...bc, reference: INV } } });
    console.log(`ref stamped: ${b} → ${INV}`);
  }
  await prod.$disconnect();
})();
