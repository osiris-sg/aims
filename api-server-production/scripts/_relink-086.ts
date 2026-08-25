import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
(async () => {
  const snap = JSON.parse(fs.readFileSync("scripts/_snap-70-before5.json", "utf8"));
  const s = snap.find((x: any) => x.name === "BI202608086");
  const d = await prisma.document.findUnique({ where: { id: s.id } });
  const c: any = d!.config;
  const items = (c.items || []).map((it: any) => {
    const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
    return amt === 0 && up === 0 ? { ...it, quantity: null } : it;
  });
  await prisma.document.update({ where: { id: s.id }, data: { config: { ...c, items, xeroInvoiceId: s.xeroInvoiceId, xeroInvoiceNumber: "BI202608090", xeroStatus: "DRAFT", xeroGross: s.nett, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "app2-recurring-push", relinkNote: "editor wipe 2026-08-25 restored from snapshot" } } });
  console.log(`✓ BI202608086 re-linked to Xero ${s.xeroInvoiceId.slice(0, 8)}… (Xero-side number BI202608090) + qty blanked`);
  process.exit(0);
})();
