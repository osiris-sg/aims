// READ-ONLY: hunt the 38 JP numbers anywhere in Biofuel prod docs.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const NUMBERS = `JP2604100055 JP2604150047 JP2604150059 JP2604150065 JP2604150119 JP2604150121 JP2604150122 JP2604150125 JP2604160066 JP2604200077 JP2604240090 JP2604250007 JP2604270072 JP2604270078 JP2604270110 JP2604270111 JP2604270115 JP2604270116 JP2604270117 JP2604270118 JP2604270178 JP2604270179 JP2604270180 JP2604270181 JP2604270182 JP2604270184 JP2604290130 JP2604300017 JP2605020017 JP2605020021 JP2605020025 JP2605020026 JP2605020028 JP2605020030 JP2605160024 JP2605160026 JP2606010011 JP2606230023`.split(/\s+/);
async function main() {
  // any doc whose name contains any of the numbers
  const nameHits = await p.document.findMany({
    where: { organizationId: ORG, OR: NUMBERS.map((n) => ({ name: { contains: n } })) },
    select: { name: true, type: true },
  });
  console.log('name-contains hits:', nameHits.length, nameHits.slice(0, 5).map((d) => `${d.type}:${d.name}`));
  // all JP-prefixed bills — what date ranges exist?
  const jp = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP' } }, select: { name: true } });
  const prefixes = new Map<string, number>();
  for (const d of jp) prefixes.set((d.name || '').slice(0, 6), (prefixes.get((d.name || '').slice(0, 6)) || 0) + 1);
  console.log('JP bill name prefixes (JPyymm):', [...prefixes.entries()].sort());
  // scan configs for the numbers (as text) across all docs
  const docs = await p.document.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, type: true, config: true } });
  const hits = new Map<string, string[]>();
  for (const d of docs) {
    const s = JSON.stringify(d.config);
    for (const n of NUMBERS) if (s.includes(n)) { const a = hits.get(n) || []; a.push(`${d.type}:${d.name}`); hits.set(n, a); }
  }
  console.log('config-text hits:', hits.size, 'numbers found inside docs');
  for (const [n, where] of [...hits.entries()].slice(0, 10)) console.log(`  ${n} -> ${where.slice(0, 3).join(', ')}`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
