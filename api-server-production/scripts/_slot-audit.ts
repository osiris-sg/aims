import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { code: true, name: true, config: true, isActive: true } });
  const slots = tpls
    .map(t => ({ slot: parseInt((/\{MONTH NO\}(\d{3})$/.exec(String((t.config as any)?.documentNumber || "")) || [])[1] || "0", 10), code: t.code, name: t.name, active: t.isActive }))
    .filter(x => x.slot > 0)
    .sort((a, b) => a.slot - b.slot);
  console.log(`${tpls.length} templates, ${slots.length} slotted, ${slots.filter(s => s.active).length} active`);
  const have = new Set(slots.map(s => s.slot));
  const max = Math.max(...slots.map(s => s.slot));
  const gaps = []; for (let i = 1; i <= max; i++) if (!have.has(i)) gaps.push(i);
  console.log(`max slot ${max} · gaps: ${gaps.join(", ") || "NONE — series is compact"}`);
  const dups = slots.filter((s, i) => i > 0 && slots[i - 1].slot === s.slot);
  if (dups.length) console.log("⚠ duplicate slots:", dups.map(d => d.slot).join(","));
  for (const g of gaps.slice(0, 10)) console.log(`  gap ${String(g).padStart(3, "0")}`);
  // is Lian Beng / LT Sambo still here?
  for (const t of slots) if (/Lian Beng|Sambo/i.test(t.name)) console.log(`  still present: slot ${String(t.slot).padStart(3, "0")} ${t.code} ${t.name.slice(0, 50)} active=${t.active}`);
  process.exit(0);
})();
