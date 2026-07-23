import { createScriptPrisma } from "./xero-migration/_common";
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const prisma = createScriptPrisma();
  const targets = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }] },
    select: { id: true, reference: true, description: true, entryDate: true, postedBy: true },
  });
  for (const t of targets)
    console.log(`- ${t.entryDate.toISOString().slice(0,10)} ${t.reference ?? "(no ref)"} · ${t.description ?? ""} · postedBy=${t.postedBy}`);
  const ids = targets.map((t) => t.id);
  const l = await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
  const j = await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
  console.log(`deleted ${j.count} journals, ${l.count} lines`);
  await prisma.$disconnect();
})();
