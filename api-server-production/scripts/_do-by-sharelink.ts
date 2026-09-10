import { createScriptPrisma } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const TOKENS = ["2sQ9v2h7FQwj6lE_wa1ujlLO97q0nG8A2XHN29D7qqc", "vSigIdJJddicRXqqngkk4SJXKdb_Qs0HQ9rKdOIKyuQ"];
(async () => {
  for (const token of TOKENS) {
    const link = await prisma.documentShareLink.findFirst({ where: { token } });
    if (!link) { console.log(`token ${token.slice(0, 8)}… not found`); continue; }
    const d = await prisma.document.findUnique({ where: { id: link.documentId } });
    const c: any = d!.config;
    console.log(`\n═══ ${d!.name} [${d!.type} · ${d!.status}] date=${c.date} cust=${c.customerName || c.customer?.name || "?"}`);
    console.log(`deliveryTo: ${JSON.stringify(c.deliveryTo || c.deliveryAddress || "?")}`);
    console.log(`ourRef/qtn: ${c.ourRef || c.quotationRef || c.referenceNo || c.reference || "-"} · PO: ${c.poNo || c.documentInfo?.poNo || c.yourPoNo || "-"}`);
    for (const k of ["attention", "attentionName", "project", "remarks"]) if (c[k]) console.log(`${k}: ${String(c[k]).slice(0, 120)}`);
    for (const it of c.items || []) console.log(`  qty=${it.quantity ?? "-"} :: ${String(it.description || "").replace(/\n/g, " ¶ ").slice(0, 130)}`);
  }
  process.exit(0);
})();
