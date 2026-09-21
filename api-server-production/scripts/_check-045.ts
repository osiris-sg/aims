import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
(async () => {
  for (const n of ["BI202609045", "BI202609094"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { name: true, status: true, config: true } });
    if (!d) { console.log(`${n}: not in AIMS`); continue; }
    const c: any = d.config;
    console.log(`${n} [${d.status}] $${c.nettTotal} · ${String(c.customerName || "").slice(0, 30)} · xeroId=${c.xeroInvoiceId ? "yes" : "NO"} · ${String(c.reference || "").slice(0, 50)}`);
  }
  // is 045 in Xero already?
  const t = JSON.parse(fs.readFileSync(__dirname + "/_xero2-tokens.json", "utf8"));
  const r: any = await fetch("https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=BI202609045,BI202609094", { headers: { Authorization: `Bearer ${t.accessToken}`, "Xero-Tenant-Id": t.tenantId, Accept: "application/json" } }).then(x => x.json());
  for (const i of r.Invoices || []) console.log(`XERO: ${i.InvoiceNumber} [${i.Status}] $${i.Total} contact="${i.Contact?.Name}" date=${i.DateString?.slice(0, 10)}`);
  if (!(r.Invoices || []).length) console.log("XERO: neither number exists");
  process.exit(0);
})();
