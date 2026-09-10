// Re-deal ALL slots strictly customer-alphabetical (guru 2026-09-11): the 5
// script-created chains were appended at the end instead of slotted in.
// Slots+codes+tokenized refs move; September's minted drafts are NOT renamed
// (series is mid-review) — October mints in the new order.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const slotOf = (c: any) => parseInt((/\{MONTH NO\}(\d{3})$/.exec(String(c?.documentNumber || "")) || [])[1] || "0", 10);
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const custs = await prisma.customer.findMany({ where: { id: { in: [...new Set(tpls.map(t => t.customerId))] } }, select: { id: true, name: true } });
  const cn = new Map(custs.map(c => [c.id, c.name || ""]));
  const slotted = tpls.filter(t => slotOf(t.config) > 0);
  slotted.sort((a, b) => {
    const ca = (cn.get(a.customerId) || "").toLowerCase().trim();
    const cb = (cn.get(b.customerId) || "").toLowerCase().trim();
    if (ca !== cb) return ca.localeCompare(cb);
    return slotOf(a.config) - slotOf(b.config);
  });
  let moved = 0;
  for (let i = 0; i < slotted.length; i++) {
    const t = slotted[i], want = i + 1, cur = slotOf(t.config);
    const code = `REC-${String(want).padStart(3, "0")}`;
    if (cur === want && t.code === code) continue;
    const c: any = t.config;
    const num = `BI{YEAR}{MONTH NO}${String(want).padStart(3, "0")}`;
    const bump = (v: any) => (typeof v === "string" ? v.replace(/^BI\{YEAR\}\{MONTH NO\}\d{3}/, num) : v);
    const config: any = { ...c, documentNumber: num, reference: bump(c.reference) };
    if (config.documentInfo?.referenceNo) config.documentInfo = { ...config.documentInfo, referenceNo: bump(config.documentInfo.referenceNo) };
    await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { code, config } });
    if (cur !== want) { moved++; console.log(`${String(cur).padStart(3, "0")} → ${String(want).padStart(3, "0")} · ${(cn.get(t.customerId) || "").slice(0, 34)}`); }
  }
  console.log(`\n${moved} templates re-slotted alphabetically (of ${slotted.length})`);
  process.exit(0);
})();
