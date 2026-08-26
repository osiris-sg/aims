// Fold the 3 AIMS-series DOs into the client book's running numbers by date:
//  QJI-GCC 08/08 → 006 (between 005 and 007, both 08/08)
//  Integrate 20/08 → 013 (next after 012 of 18/08)
//  Tanglin 26/08 → 016 (015 taken)
// All flagged provisional until the paper book confirms.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const MAP: [string, string][] = [["DO202608-0042", "DO202608-006"], ["DO202608-0038", "DO202608-013"], ["DO202608-0041", "DO202608-016"]];
(async () => {
  for (const [oldName, newName] of MAP) {
    const clash = await prisma.document.findFirst({ where: { organizationId: ORG, name: newName } });
    if (clash) { console.log(`✗ ${newName} already exists — skipped ${oldName}`); continue; }
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: oldName } });
    if (!d) { console.log(`✗ ${oldName} not found`); continue; }
    const c: any = d.config;
    await prisma.document.update({ where: { id: d.id }, data: { name: newName, config: { ...c, documentNumber: newName, remarks: (c.remarks || "") + ` | number ${newName} assigned by date-fit into client DO book (was ${oldName}) — confirm against paper book` } } });
    console.log(`✓ ${oldName} → ${newName}`);
  }
  const all = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["DELIVERY_ORDER", "RETURN_DELIVERY_ORDER"] }, name: { contains: "202608" } }, select: { name: true, config: true }, orderBy: { name: "asc" } });
  console.log("\nregister:");
  for (const d of all) console.log(`  ${d.name.padEnd(18)} ${((d.config as any)?.date || "").slice(0, 10)} · ${((d.config as any)?.customerName || "?").slice(0, 36)}`);
  process.exit(0);
})();
