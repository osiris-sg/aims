// Backfill referenceNo (+ documentInfo.referenceNo) so the Xero Reference
// shows INSIDE the invoice editor, not just the list view. Fill-blank only.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "BILL", "CREDIT_NOTE"] } }, select: { id: true, name: true, config: true } });
  let changed = 0;
  for (const d of docs) {
    const c: any = d.config;
    if (!c) continue;
    const ref = (c.xeroReference || c.reference || "").trim();
    if (!ref) continue;
    const di = c.documentInfo || {};
    const needTop = !c.referenceNo;
    const needDi = !di.referenceNo;
    if (!needTop && !needDi) continue;
    const cfg = { ...c };
    if (needTop) cfg.referenceNo = ref;
    cfg.documentInfo = { ...di, ...(needDi ? { referenceNo: ref } : {}) };
    changed++;
    if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: cfg } });
  }
  console.log(`${DRY ? "[DRY] would update" : "updated"} ${changed}/${docs.length} docs with in-editor referenceNo`);
  process.exit(0);
})();
