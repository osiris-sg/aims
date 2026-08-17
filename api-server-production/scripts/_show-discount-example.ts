import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" }, select: { name: true, config: true } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const withDisc = ours.filter(d => ((d.config as any).items || []).some((it: any) => Number(it.amount) < 0));
  console.log(`drafts with negative (discount) lines: ${withDisc.map(d => d.name).join(", ")}\n`);
  for (const d of withDisc.slice(0, 2)) {
    const c: any = d.config;
    console.log(`════ ${d.name}  (${c.customerId && ""}${""}sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal})`);
    for (const it of c.items || [])
      console.log(`  [${(it.itemCode || "—").padEnd(11)}] qty=${it.quantity} up=${String(it.unitPrice).padStart(8)} amt=${String(it.amount).padStart(8)} tax=${it.tax}% acct=${it.accountCode || "—"}\n     ${(it.description || "").replace(/\n/g, "\n     ").slice(0, 400)}\n`);
  }
  // product-code coverage across all 71
  const codeCount: Record<string, number> = {};
  let uncoded = 0;
  for (const d of ours) for (const it of (d.config as any).items || []) {
    if (Number(it.amount) !== 0) { if (it.itemCode) codeCount[it.itemCode] = (codeCount[it.itemCode] || 0) + 1; else uncoded++; }
  }
  console.log("amount-line product codes across all 71:", JSON.stringify(codeCount), "| uncoded:", uncoded);
  process.exit(0);
})();
