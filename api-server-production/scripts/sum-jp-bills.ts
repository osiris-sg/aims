// READ-ONLY: find the given JP bills in prod and sum their totals.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const NUMBERS = `JP2604100055 JP2604150047 JP2604150059 JP2604150065 JP2604150119 JP2604150121 JP2604150122 JP2604150125 JP2604160066 JP2604200077 JP2604240090 JP2604250007 JP2604270072 JP2604270078 JP2604270110 JP2604270111 JP2604270115 JP2604270116 JP2604270117 JP2604270118 JP2604270178 JP2604270179 JP2604270180 JP2604270181 JP2604270182 JP2604270184 JP2604290130 JP2604300017 JP2605020017 JP2605020021 JP2605020025 JP2605020026 JP2605020028 JP2605020030 JP2605160024 JP2605160026 JP2606010011 JP2606230023`.split(/\s+/);
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { in: NUMBERS } },
    select: { name: true, status: true, config: true, createdAt: true },
  });
  const byName = new Map(docs.map((d) => [d.name, d]));
  let total = 0, found = 0;
  for (const n of NUMBERS) {
    const d = byName.get(n);
    if (!d) { console.log(`  ${n}  NOT FOUND`); continue; }
    const c: any = d.config;
    const amt = Number(c?.totalAmount ?? c?.xeroGross) || 0;
    total += amt; found++;
    console.log(`  ${n}  ${String(c?.billDate ?? '').slice(0, 10)}  ${amt.toFixed(2)}  ${(c?.billStatus || d.status)}`);
  }
  console.log(`\nfound ${found}/${NUMBERS.length}  TOTAL = ${total.toFixed(2)}`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
