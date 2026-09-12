import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const PHOTOS = ["do-install/1177397f.jpg", "do-install/14814e23.jpg"];
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: "DO202609-0047" } });
  const c: any = d!.config;
  let hit = false;
  const items = (c.items || []).map((it: any) => {
    if (!/60ES|Generator/i.test(String(it.description || ""))) return it;
    hit = true;
    return { ...it, proofPhotos: PHOTOS };
  });
  if (!hit) { console.log("✗ DG line not found"); process.exit(1); }
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items, date: c.date || "2026-09-12" } } });
  // link the orphan install report to this DO so the proof section/timeline sees it
  const rep = await (prisma as any).maintenanceServiceReport.findFirst({ where: { photos: { hasEvery: PHOTOS } } }).catch(() => null);
  if (rep) { await (prisma as any).maintenanceServiceReport.update({ where: { id: rep.id }, data: { documentId: d!.id } }); console.log("✓ orphan report linked to the DO"); }
  else console.log("(report row not found under maintenanceReport — item photos are the visible part anyway)");
  console.log("✓ DG line now carries the 2 photos · DO date set 12/09/2026");
  process.exit(0);
})();
