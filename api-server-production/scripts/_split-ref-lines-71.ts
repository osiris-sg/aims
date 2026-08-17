// AIMS-only: ensure every "Our DO / Our Qtn / Your PO / Your Contract"-style
// reference paragraph is its OWN zero-amount line, never sharing a line with
// cable specs or other content. Amounts untouched.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");

const isRefPara = (p: string) => /^\s*\(?(our|your)\s+(do|qtn|po|ref|works|contract|sub-?contract|fi)\b/i.test(p.trim());

// split a description into [kept paragraphs (non-ref)] and [ref paragraphs]
function splitDesc(desc: string): { kept: string; refs: string[] } {
  const paras = (desc || "").split(/\n\s*\n/);
  if (!paras.some(isRefPara)) return { kept: desc, refs: [] };
  const kept: string[] = []; const refs: string[] = [];
  for (const p of paras) (isRefPara(p) ? refs : kept).push(p.trim());
  return { kept: kept.join("\n\n"), refs };
}

(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0, newLines = 0;
  for (const d of ours) {
    const c: any = d.config;
    const items: any[] = c.items || [];
    const out: any[] = [];
    let dirty = false;
    let idBase = 1795000000000 + changed * 1000;
    for (const it of items) {
      const { kept, refs } = splitDesc(it.description || "");
      if (!refs.length) { out.push(it); continue; }
      dirty = true;
      if (kept.trim()) out.push({ ...it, description: kept });
      else if (Number(it.amount)) out.push({ ...it, description: kept || " " }); // never drop an amount line
      for (const r of refs) {
        out.push({ id: idBase++, description: r, quantity: 1, unitPrice: 0, amount: 0, itemCode: "", accountCode: null, tax: 0, discount: 0, isService: false, revenueTag: "rental" });
        newLines++;
      }
    }
    if (dirty) {
      changed++;
      if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items: out } } });
    }
  }
  console.log(`${DRY ? "[DRY] would update" : "updated"} ${changed}/${ours.length} drafts, ${newLines} ref lines separated`);
  process.exit(0);
})();
