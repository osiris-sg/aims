// AIMS-only: merge CONSECUTIVE non-item annotation lines (Our DO/Qtn/PO refs,
// Location/Project/Attn blocks, REMARKS) into ONE line. Item lines (priced or
// numbered component descriptions) are never touched or merged.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");

const ANNOT = /^\s*(\(?(our|your)\s+(do|qtn|po|ref|works|contract|sub-?contract|fi)\b|location\b|project\s*:|attn\b|remarks\b|mobile\b|\(quotation)/i;
const isAnnotation = (it: any) => (Number(it.amount) || 0) === 0 && ANNOT.test((it.description || "").trim());

(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0, merged = 0;
  for (const d of ours) {
    const c: any = d.config;
    const items: any[] = c.items || [];
    const out: any[] = [];
    let dirty = false;
    for (const it of items) {
      const prev = out[out.length - 1];
      if (prev && isAnnotation(prev) && isAnnotation(it)) {
        prev.description = `${(prev.description || "").trimEnd()}\n\n${(it.description || "").trim()}`;
        dirty = true; merged++;
        continue;
      }
      out.push({ ...it });
    }
    if (dirty) {
      changed++;
      if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items: out } } });
    }
  }
  console.log(`${DRY ? "[DRY] would update" : "updated"} ${changed}/${ours.length} drafts, ${merged} annotation lines folded together`);
  process.exit(0);
})();
