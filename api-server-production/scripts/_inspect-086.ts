import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const snap = JSON.parse(fs.readFileSync("scripts/_snap-70-before5.json", "utf8"));
  const s = snap.find((x: any) => x.name === "BI202608086");
  const d = await prisma.document.findUnique({ where: { id: s.id }, select: { name: true, status: true, updatedAt: true, editingByName: true, lastActivityAt: true, config: true } });
  const c: any = d!.config;
  console.log(`updatedAt=${d!.updatedAt.toISOString()} lastActivity=${d!.lastActivityAt?.toISOString()} editor=${d!.editingByName}`);
  console.log("keys:", Object.keys(c).join(","));
  console.log(`nett=${c.nettTotal} sub=${c.subTotal} customer=${c.customerName || c.customer?.name} xeroInvoiceId=${c.xeroInvoiceId} items=${(c.items || []).length}`);
  console.log("old snapshot: nett=", s.nett, "xeroId=", s.xeroInvoiceId?.slice(0, 8));
  // audit trail
  const logs = await prisma.auditLog.findMany({ where: { organizationId: ORG, resourceName: "BI202608086" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, action: true, userName: true, userEmail: true } });
  for (const l of logs) console.log(`  ${l.createdAt.toISOString().slice(0, 16)} ${l.action} · ${l.userName || l.userEmail || "?"}`);
  process.exit(0);
})();
