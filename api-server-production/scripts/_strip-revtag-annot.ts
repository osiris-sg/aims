// Non-item lines (location/project/attn, refs, remarks) must NOT be tagged
// "rental" — they're details, not items (guru 2026-08-18).
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
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0, lines = 0;
  for (const d of ours) {
    const c: any = d.config;
    let dirty = false;
    const items = (c.items || []).map((it: any) => {
      if ((Number(it.amount) || 0) === 0 && ANNOT.test((it.description || "").trim()) && it.revenueTag) {
        dirty = true; lines++;
        const { revenueTag, ...rest } = it;
        return rest;
      }
      return it;
    });
    if (dirty) { changed++; await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } }); }
  }
  console.log(`revenueTag stripped from ${lines} annotation lines across ${changed} docs`);
  process.exit(0);
})();
