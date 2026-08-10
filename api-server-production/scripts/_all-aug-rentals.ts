import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const RENTAL = /rental|rent of|hire|lease/i;
const DISP = /disposal|soil|tonne|wharfage|pass application/i;
(async () => {
  const invs = await prod.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, config: true } });
  const hits: any[] = [];
  for (const inv of invs) {
    const c: any = inv.config || {};
    const dateStr = c.date || c.documentInfo?.date || "";
    const d = new Date(dateStr);
    if (!(d >= new Date("2026-08-01") && d < new Date("2026-09-01"))) continue;
    const items: any[] = c.items || [];
    if (items.some((it: any) => DISP.test(it.description || ""))) continue;
    if (!items.some((it: any) => RENTAL.test(it.description || ""))) continue;
    const all = items.map((it: any) => it.description || "").join(" | ");
    const period = all.match(/period\s*(from)?\s*[\d\/]{8,10}\s*(to|-|–)\s*[\d\/]{8,10}/i)?.[0] || "";
    const ordinal = all.match(/\(?\d+(st|nd|rd|th)\s*(month|mth)\)?/i)?.[0] || "";
    hits.push({
      description: items.map((it: any) => (it.description || "").trim()).filter(Boolean).join("\n\n"),
      reference: c.xeroReference || c.documentInfo?.reference || "",
      invoice: inv.name, date: dateStr.slice(0, 10),
      customer: (c.customerName || c.customer?.name || "").slice(0, 30),
      total: Number(c.totals?.total ?? c.nettTotal ?? c.xeroGross ?? 0),
      status: c.xeroStatus || "-",
      period: period.replace(/period\s*(from)?\s*/i, "").slice(0, 24),
      ordinal,
    });
  }
  hits.sort((a, b) => a.invoice.localeCompare(b.invoice));
  fs.writeFileSync("scripts/_aug-rentals.json", JSON.stringify(hits, null, 1));
  let sum = 0;
  console.log(`ALL rental invoices dated July 2026: ${hits.length}`);
  hits.forEach(h => { sum += h.total; console.log(`  ${h.invoice.padEnd(14)} $${String(h.total.toFixed(2)).padStart(10)} · ${h.status.padEnd(11)} · ${h.customer.padEnd(31)} · period=${(h.period || "?").padEnd(24)} ${h.ordinal ? "· " + h.ordinal : ""}`); });
  console.log(`TOTAL: $${sum.toFixed(2)}`);
  await prod.$disconnect();
})();
