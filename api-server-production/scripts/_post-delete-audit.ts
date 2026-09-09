import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const rows = tpls.map(t => ({ code: t.code, slot: parseInt((/\{MONTH NO\}(\d{3})$/.exec(String((t.config as any)?.documentNumber || "")) || [])[1] || "0", 10), name: t.name }))
    .sort((a, b) => a.slot - b.slot);
  const have = new Set(rows.map(r => r.slot));
  const max = Math.max(...rows.map(r => r.slot));
  const gaps = []; for (let i = 1; i <= max; i++) if (!have.has(i)) gaps.push(i);
  console.log(`${rows.length} templates · max slot ${max} · slot gaps: ${gaps.join(",") || "NONE"}`);
  for (const r of rows.filter(r => r.slot >= 47 && r.slot <= 52)) console.log(`  slot ${String(r.slot).padStart(3, "0")} · ${r.code} · ${r.name.slice(0, 48)}`);
  // Sept drafts around the gap
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { in: ["BI202609048", "BI202609049", "BI202609050", "BI202609051", "BI202609089"] } }, select: { name: true, status: true, config: true } });
  for (const d of docs.sort((a, b) => a.name.localeCompare(b.name))) {
    const c: any = d.config;
    console.log(`  doc ${d.name} [${d.status}] ref=${String(c.reference || "").slice(0, 55)}`);
  }
  process.exit(0);
})();
