import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
(async () => {
  const snap = JSON.parse(fs.readFileSync("scripts/_snap-70-before5.json", "utf8"));
  for (const s of snap) {
    const d = await prisma.document.findUnique({ where: { id: s.id }, select: { name: true, status: true, updatedAt: true, config: true } });
    if (!d) { console.log(`✗ ${s.name}: row gone`); continue; }
    const c: any = d.config;
    if (c.xeroSyncedBy === "app2-recurring-push") continue;
    console.log(`⚠ ${s.name} → now ${d.name} [${d.status}] updated=${d.updatedAt.toISOString().slice(0, 16)} — relinking`);
    await prisma.document.update({ where: { id: s.id }, data: { config: { ...c, xeroInvoiceId: c.xeroInvoiceId || s.xeroInvoiceId, xeroStatus: c.xeroStatus || "DRAFT", xeroGross: c.xeroGross ?? s.nett, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "app2-recurring-push", relinkNote: "editor wipe restored " + new Date().toISOString().slice(0, 10) } } });
  }
  console.log("done");
  process.exit(0);
})();
