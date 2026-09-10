import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const TOKENS = ["2sQ9v2h7FQwj6lE_wa1ujlLO97q0nG8A2XHN29D7qqc", "vSigIdJJddicRXqqngkk4SJXKdb_Qs0HQ9rKdOIKyuQ"];
(async () => {
  for (const tok of TOKENS) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, config: { path: [], string_contains: tok } as any } }).catch(() => null)
      || await prisma.document.findFirst({ where: { organizationId: ORG, type: { contains: "DELIVERY" } , config: { not: undefined } , AND: [] } , take: 0 } as any).catch(() => null);
    if (!d) {
      // fallback: raw scan
      const all = await prisma.document.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, type: true, status: true, config: true } });
      const hit = all.find(x => JSON.stringify(x.config).includes(tok));
      if (!hit) { console.log(`token ${tok.slice(0, 8)}… : NOT FOUND`); continue; }
      const c: any = hit.config;
      console.log(`\n═══ ${hit.name} [${hit.type} · ${hit.status}] date=${c.date} cust=${c.customerName || c.customer?.name}`);
      console.log(`deliveryTo: ${c.deliveryTo || c.deliveryAddress || "?"} · ref: ${c.referenceNo || c.reference || "-"} · PO: ${c.poNo || c.documentInfo?.poNo || "-"} · qtn: ${c.quotationRef || "-"}`);
      for (const it of c.items || []) console.log(`  qty=${it.quantity} :: ${String(it.description || "").replace(/\n/g, " ¶ ").slice(0, 110)}`);
      continue;
    }
  }
  process.exit(0);
})();
