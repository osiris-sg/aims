// Remove the duplicated bottom-block fields (Our Qtn Ref / WO / Location /
// Project-Dept under the items table) — the info lives in the line items
// (guru 2026-08-25). Header fields (doNo etc.) untouched.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const STRIP = ["qinRef", "qinDate", "woNo", "woDate", "location", "projectDept"];
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0;
  for (const d of ours) {
    const c: any = d.config;
    const di = { ...(c.documentInfo || {}) };
    let dirty = false;
    for (const k of STRIP) if (di[k] !== undefined) { delete di[k]; dirty = true; }
    // some configs carry them top-level too (editor shape)
    const top: any = { ...c };
    for (const k of STRIP) if (top[k] !== undefined) { delete top[k]; dirty = true; }
    if (dirty) { changed++; await prisma.document.update({ where: { id: d.id }, data: { config: { ...top, documentInfo: di } } }); }
  }
  console.log(`stripped footer fields on ${changed}/${ours.length} drafts`);
  process.exit(0);
})();
