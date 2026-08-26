// Flip the 14 on-rent-but-instock units to status rental (Xero invoicing is
// the truth; guru approved 2026-08-26).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const SERIALS = ["MG20260130","MG20260140","MG20250054","MG20250114","MG20250091","MG20250089","MG20250068","MG20250104","MG20250105","MG20250095","MG20250097","MG20250108","MG20250081","MG20250102"];
(async () => {
  const inv = await prisma.inventory.findMany({ where: { asset: { organizationId: ORG } }, select: { id: true, sku: true, serialNumber: true, status: true, asset: { select: { name: true } } } } as any);
  let flipped = 0;
  for (const serial of SERIALS) {
    const unit = (inv as any[]).find(i => [i.sku, i.serialNumber].some(k => k && String(k).toUpperCase().replace(/\s+/g, "") === serial));
    if (!unit) { console.log(`✗ ${serial}: not found`); continue; }
    if (String(unit.status) === "rental") { console.log(`= ${serial}: already rental`); continue; }
    await prisma.inventory.update({ where: { id: unit.id }, data: { status: "rental" as any } });
    console.log(`✓ ${serial} (${unit.asset?.name}) ${unit.status} → rental`);
    flipped++;
  }
  console.log(`\nflipped ${flipped}/14`);
  process.exit(0);
})();
