import { createScriptPrisma } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const rows = await prisma.actionLog.findMany({
    where: { method: "PATCH", path: { contains: "/organizations/" } },
    orderBy: { createdAt: "desc" }, take: 25,
    select: { createdAt: true, path: true, actorType: true, actorName: true, statusCode: true, organizationId: true },
  });
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const nm = new Map(orgs.map(o => [o.id, o.name]));
  for (const r of rows) {
    const target = r.path.split("/organizations/")[1]?.split("/")[0] || "?";
    console.log(`${r.createdAt.toISOString().slice(0, 16)} ${String(r.statusCode)} ${(r.actorName || r.actorType).slice(0, 22).padEnd(24)} → ${nm.get(target) || target}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
