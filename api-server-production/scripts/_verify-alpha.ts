import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  const custs = await prisma.customer.findMany({ where: { id: { in: [...new Set(tpls.map(t => t.customerId))] } }, select: { id: true, name: true } });
  const cn = new Map(custs.map(c => [c.id, c.name || ""]));
  let prev = ""; let ok = true;
  for (const t of tpls) {
    const nm = (cn.get(t.customerId) || "").toLowerCase();
    if (nm < prev) { ok = false; console.log(`OUT OF ORDER at ${t.code}: ${nm}`); }
    prev = nm;
  }
  // show where the 5 new chains landed
  for (const t of tpls) {
    const nm = cn.get(t.customerId) || "";
    if (/Jiayi|Prime|QJI-GCC|Integrate|TANGLIN/i.test(nm)) console.log(`${t.code} · ${nm.slice(0, 40)} · active=${t.isActive}`);
  }
  console.log(ok ? "\n✓ strictly alphabetical, codes REC-001…REC-" + String(tpls.length).padStart(3, "0") : "\n✗ order problem");
  process.exit(0);
})();
