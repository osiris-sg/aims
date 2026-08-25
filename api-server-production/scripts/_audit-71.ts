// Full structural audit of the 71 drafts (guru 2026-08-18).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const ANNOT = /^\s*(\(?(our|your)\s+(do|qtn|po|ref|works|contract|sub-?contract|fi)\b|location\b|project\s*:|attn\b|remarks\b|mobile\b|\(quotation)/i;
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const problems: string[] = [];
  let clean = 0;
  for (const d of ours) {
    const c: any = d.config;
    const items: any[] = c.items || [];
    const p: string[] = [];
    for (const it of items) {
      const amt = Number(it.amount) || 0;
      const desc = (it.description || "").trim();
      // numbered sections = real item sections, NOT serial enumerations ("3). S/No. AF100 0036")
      const sections = (desc.match(/\n\s*\d\)\.?\s(?!S\/No)/g) || []).length;
      if (sections >= 2) p.push(`blob line (${sections + 1} numbered sections in one item)`);
      if (amt !== 0 && !it.itemCode) p.push(`priced line missing product code: "${desc.slice(0, 40)}"`);
      if (amt !== 0 && !it.accountCode) p.push(`priced line missing account code: "${desc.slice(0, 40)}"`);
      if (amt < 0 && (!it.accountCode || !it.itemCode)) p.push(`discount line missing codes`);
      // July convention: zero-amount lines are EITHER fully blank (annotations)
      // OR bundled equipment with qty>0 / unit 0 / amount 0.
      const equipStyle = Number(it.quantity) > 0 && !Number(it.unitPrice) && !Number(it.amount) && it.amount != null;
      const blankStyle = it.quantity == null && it.unitPrice == null && it.amount == null;
      if (amt === 0 && !equipStyle && !blankStyle) p.push(`zero-amount line neither blank nor equip-style (qty=${it.quantity} up=${it.unitPrice} amt=${it.amount})`);
      if (amt === 0 && ANNOT.test(desc) && it.revenueTag) p.push(`annotation line tagged "${it.revenueTag}"`);
      if (/<div|<br|<span|&nbsp/i.test(desc)) p.push(`HTML in description`);
    }
    const net = +items.reduce((s, it) => s + (Number(it.amount) || 0), 0).toFixed(2);
    if (Math.abs(net - c.subTotal) > 0.02) p.push(`line sum ${net} ≠ subTotal ${c.subTotal}`);
    if (Math.abs(c.subTotal + c.gstAmount - c.nettTotal) > 0.02) p.push(`sub+gst ≠ nett`);
    if (!(c.reference || c.referenceNo)) p.push(`no reference`);
    if (p.length) problems.push(`${d.name}: ${[...new Set(p)].join(" | ")}`);
    else clean++;
  }
  console.log(`AUDIT: ${clean}/${ours.length} clean`);
  for (const pr of problems) console.log("  ⚠", pr);
  process.exit(0);
})();
