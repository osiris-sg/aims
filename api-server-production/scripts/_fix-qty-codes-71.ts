// AIMS-only sweep of the 71 drafts: qty=1 on zero-amount lines; itemCode on
// every amount line (derived from description, falling back to template code).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");

function codeFromDesc(desc: string): string | null {
  const d = desc || "";
  const lion = /LION\s?(\d+)/i.exec(d); if (lion) return `LION${lion[1]}`;
  const mbr = /MBR[-\s]?(\d+)/i.exec(d); if (mbr) return `MBR-${mbr[1]}`;
  const af = /\bAF[-\s]?(40|60|100)\b/i.exec(d); if (af) return `AF${af[1]}`;
  if (/DB\s*Box/i.test(d)) return "DBBOX";
  if (/holding\s*tank/i.test(d)) return "HOLDINGTANK";
  if (/SIDS/i.test(d)) return "SIDS";
  if (/\bAIS\b|solar/i.test(d)) return "AIS";
  return null;
}

(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG, lastRunDocumentId: { not: null } }, select: { lastRunDocumentId: true, config: true } });
  const tplCodeByGenId = new Map<string, string>();
  for (const t of tpls) {
    const codes = ((t.config as any)?.items || []).map((it: any) => it.itemCode).filter(Boolean);
    if (codes.length) tplCodeByGenId.set(t.lastRunDocumentId!, codes[0]);
  }
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0; const noCode: string[] = [];
  for (const d of ours) {
    const c: any = d.config;
    const items: any[] = c.items || [];
    let dirty = false;
    // pass 1: qty + direct codes
    for (const it of items) {
      const amt = Number(it.amount) || 0;
      // qty on text lines stays BLANK (guru 2026-08-25) — do not touch here.
      if (amt !== 0 && !it.itemCode) {
        const code = codeFromDesc(it.description) || tplCodeByGenId.get(d.id) || null;
        if (code) { it.itemCode = code; dirty = true; }
      }
    }
    // pass 2: discount lines inherit the code of the positive line on the same account
    for (const it of items) {
      const amt = Number(it.amount) || 0;
      if (amt < 0 && !it.itemCode) {
        const mate = items.find(o => (Number(o.amount) || 0) > 0 && o.accountCode === it.accountCode && o.itemCode);
        if (mate) { it.itemCode = mate.itemCode; dirty = true; }
      }
    }
    for (const it of items) if ((Number(it.amount) || 0) !== 0 && !it.itemCode) noCode.push(`${d.name}: "${(it.description || "").slice(0, 50)}"`);
    if (dirty && !DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } });
    if (dirty) changed++;
  }
  console.log(`${DRY ? "[DRY] would update" : "updated"} ${changed}/${ours.length} drafts`);
  if (noCode.length) { console.log(`amount lines still without code (${noCode.length}):`); for (const s of noCode) console.log("  ⚠", s); }
  else console.log("every amount line now has a product code ✓");
  process.exit(0);
})();
