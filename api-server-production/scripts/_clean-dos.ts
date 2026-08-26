// 1) Delete TEST DOs (ZZTEST assets / TEST Customer) + the duplicate Nishio
//    portal draft. 2) Move RTN-DO202608-001 to the RETURN_DELIVERY_ORDER type
//    so it shows in the Returns tab.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const KILL = ["DO202608-0019", "DO202608-0020", "DO202608-0021", "DO202608-0022", "DO202608-0023", "DO202608-0040"];
  for (const name of KILL) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name }, select: { id: true, config: true } });
    if (!d) { console.log(`= ${name} gone`); continue; }
    const blob = JSON.stringify((d.config as any)?.items || []);
    if (!/ZZTEST|TEST/i.test(blob + JSON.stringify((d.config as any)?.customerName))) { console.log(`✗ ${name}: does NOT look like test — kept`); continue; }
    await prisma.document.delete({ where: { id: d.id } });
    console.log(`✓ deleted ${name} (test)`);
  }
  const rdoTest = await prisma.document.findFirst({ where: { organizationId: ORG, type: "RETURN_DELIVERY_ORDER", name: "RDO202608-001" }, select: { id: true, config: true } });
  if (rdoTest && /TEST/i.test(String((rdoTest.config as any)?.customerName))) { await prisma.document.delete({ where: { id: rdoTest.id } }); console.log("✓ deleted RDO202608-001 (test return)"); }
  const dup = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-0007" }, select: { id: true } });
  if (dup) { await prisma.document.delete({ where: { id: dup.id } }); console.log("✓ deleted DO202608-0007 (portal duplicate of client DO202608-003)"); }
  const rtn = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "RTN-DO202608-001" }, select: { id: true } });
  if (rtn) { await prisma.document.update({ where: { id: rtn.id }, data: { type: "RETURN_DELIVERY_ORDER" } }); console.log("✓ RTN-DO202608-001 → RETURN_DELIVERY_ORDER (Returns tab)"); }
  // final register
  const dos = await prisma.document.findMany({ where: { organizationId: ORG, OR: [{ name: { startsWith: "DO202608" } }, { name: { startsWith: "RTN-DO202608" } }] }, select: { name: true, type: true, status: true, config: true }, orderBy: { name: "asc" } });
  console.log("\nfinal August register:");
  for (const d of dos) console.log(`  ${d.name.padEnd(18)} ${d.type === "RETURN_DELIVERY_ORDER" ? "[RETURN]" : "        "} ${((d.config as any)?.date || "").slice(0, 10)} · ${((d.config as any)?.customerName || "?").slice(0, 36)}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
