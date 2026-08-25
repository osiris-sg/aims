// One-off: make enableActionLog TRUE for every org that has it stored FALSE
// (orgs seeded between 2026-08-21 and 2026-08-23 got the old default). Orgs
// with NO stored key already inherit the new default (true) — left untouched.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const configs = await p.organizationUIConfig.findMany({ select: { id: true, organizationId: true, features: true } });
  let flipped = 0;
  for (const c of configs) {
    const f: any = c.features || {};
    if (f.enableActionLog === false) {
      await p.organizationUIConfig.update({ where: { id: c.id }, data: { features: { ...f, enableActionLog: true } } });
      console.log(`flipped org ${c.organizationId}`);
      flipped++;
    }
  }
  console.log(`done — ${flipped} flipped of ${configs.length} configs (rest inherit default true)`);
}
main().finally(() => p.$disconnect());
