import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" }, createdAt: { gte: new Date("2026-08-28") } }, select: { name: true, status: true, config: true }, orderBy: { name: "asc" } });
  console.log(`${docs.length} September-numbered invoices created since 28 Aug:`);
  let flat = 0;
  const ANNOT = /^\s*(\d?\)?\.?\s*rental of cables as follows:|\(?(our|your)\s+(do|qtn|po|ref)\b|location\b|project\s*[:\/]|attn\b|remarks\b|\d?\)?\.?\s*rental period\b|rental for the\b)/i;
  for (const d of docs) {
    const c: any = d.config;
    const items: any[] = c.items || [];
    const badLines = items.filter(it => (Number(it.amount) || 0) === 0 && (Number(it.unitPrice) || 0) === 0 && ANNOT.test((it.description || "").trim()) && (it.quantity != null || it.amount != null)).length;
    if (badLines) flat++;
    console.log(`  ${d.name} [${d.status}] $${c.nettTotal} · gen=${c.createdBy || (c.xeroSyncedBy ?? "?")} · ${badLines ? badLines + " flat text lines" : "clean"}`);
  }
  console.log(`\n${flat} generated invoices carry flattened lines`);
  process.exit(0);
})();
