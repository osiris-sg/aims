import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const n of ["BI202609025", "BI202609035", "BI202609069", "BI202609076"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n } });
    const c: any = d!.config;
    console.log(`${n} [${d!.status}] sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal} taxApplicable=${c.taxApplicable} · ${String(c.customerName || "").slice(0, 28)} · ${String(c.reference || "").slice(0, 45)}`);
  }
  process.exit(0);
})();
