import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
(async () => {
  const t = JSON.parse(fs.readFileSync(__dirname + "/_xero2-tokens.json", "utf8"));
  const r: any = await fetch("https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=BI202609045", { headers: { Authorization: `Bearer ${t.accessToken}`, "Xero-Tenant-Id": t.tenantId, Accept: "application/json" } }).then(x => x.json());
  const inv = (r.Invoices || [])[0];
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609045" } });
  const c: any = d!.config;
  await prisma.document.update({ where: { id: d!.id }, data: { status: "pending_payment" as any, config: { ...c, xeroInvoiceId: inv.InvoiceID, xeroInvoiceNumber: inv.InvoiceNumber, xeroStatus: inv.Status, xeroGross: inv.Total, xeroBalance: inv.AmountDue, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "link-existing" } } });
  console.log(`✓ BI202609045 linked to its existing Xero invoice [${inv.Status}] $${inv.Total}`);
  process.exit(0);
})();
