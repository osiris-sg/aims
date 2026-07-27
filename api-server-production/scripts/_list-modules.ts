// One-off: list every module code in the dev DB with org enablement counts.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.organizationModule.findMany({
    select: { moduleCode: true, enabled: true, displayName: true, organization: { select: { name: true } } },
  });
  const byCode = new Map<string, { on: string[]; off: string[]; names: Set<string> }>();
  for (const r of rows) {
    if (!byCode.has(r.moduleCode)) byCode.set(r.moduleCode, { on: [], off: [], names: new Set() });
    const e = byCode.get(r.moduleCode)!;
    (r.enabled ? e.on : e.off).push(r.organization.name);
    if (r.displayName) e.names.add(r.displayName);
  }
  for (const [code, e] of [...byCode.entries()].sort()) {
    console.log(`${code}  [${[...e.names].join('/') || '-'}]  ON: ${e.on.length} (${e.on.slice(0, 6).join(', ')})  OFF: ${e.off.length}`);
  }
}
main().finally(() => prisma.$disconnect());
