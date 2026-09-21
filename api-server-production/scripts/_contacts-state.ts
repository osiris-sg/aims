import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const links = await prisma.projectContact.findMany({
    include: { customerContact: { select: { name: true, email: true, phone: true, designation: true, customer: { select: { name: true, organizationId: true } } } }, project: { select: { name: true, organizationId: true } } },
  });
  const mine = links.filter(l => l.project.organizationId === ORG);
  console.log(`ProjectContact rows (Biofuel): ${mine.length}`);
  const byGroup = new Map<string, number>(); const bySource = new Map<string, number>();
  for (const l of mine) { byGroup.set(String(l.group), (byGroup.get(String(l.group)) || 0) + 1); bySource.set(l.source, (bySource.get(l.source) || 0) + 1); }
  console.log("by group:", [...byGroup].map(([k, v]) => `${k}=${v}`).join(" · "));
  console.log("by source:", [...bySource].map(([k, v]) => `${k}=${v}`).join(" · "));
  console.log("\nrows:");
  for (const l of mine.slice(0, 25)) console.log(`  [${String(l.group).padEnd(7)}|${l.source.padEnd(6)}] ${l.project.name.slice(0, 26).padEnd(26)} · ${l.customerContact.name.slice(0, 20).padEnd(20)} ${l.customerContact.email || l.customerContact.phone || "no contact detail"}`);
  const cc = await prisma.customerContact.count({ where: { customer: { organizationId: ORG } } });
  const projs = await prisma.project.count({ where: { organizationId: ORG } });
  console.log(`\nCustomerContacts: ${cc} · Projects: ${projs} · projects WITH a contact link: ${new Set(mine.map(l => l.projectId)).size}`);
  process.exit(0);
})();
