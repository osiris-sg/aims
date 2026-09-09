import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const code of ["REC-025", "REC-026", "REC-027"]) {
    const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code } });
    if (!t) continue;
    const c: any = t.config;
    const blob = JSON.stringify(c.items || []);
    console.log(`${code} · ${t.name.slice(0, 60)} · tokens-in-items: ${(blob.match(/\{[A-Z ]+\}/g) || []).join(",")}`);
    const hit = (c.items || []).find((it: any) => /DEBY|DEB_Y/.test(String(it.description || "")));
    if (hit) console.log("  PO line:", JSON.stringify(String(hit.description).split("\n").filter((l: string) => /PO No/.test(l))));
  }
  process.exit(0);
})();
