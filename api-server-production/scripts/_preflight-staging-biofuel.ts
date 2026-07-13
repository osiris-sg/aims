import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
function urlFrom(f: string) { const m = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m); if (!m) throw new Error('no url in ' + f); return m[1]; }
async function counts(label: string, url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!org) { console.log(`${label}: Biofuel org NOT PRESENT`); return; }
    const [docs, je, jel, cust, sup, coa, tmpl, pay, assets, inv] = await Promise.all([
      p.document.count({ where: { organizationId: ORG } }),
      p.journalEntry.count({ where: { organizationId: ORG } }),
      p.journalEntryLine.count({ where: { journalEntry: { organizationId: ORG } } }),
      p.customer.count({ where: { organizationId: ORG } }),
      p.supplier.count({ where: { organizationId: ORG } }),
      p.chartOfAccount.count({ where: { organizationId: ORG } }),
      p.documentTemplate.count({ where: { organizationId: ORG } }),
      p.payment.count({ where: { organizationId: ORG } }),
      p.asset.count({ where: { organizationId: ORG } }).catch(() => -1),
      p.inventory.count({ where: { organizationId: ORG } }).catch(() => -1),
    ]);
    console.log(`${label}: org="${org.name}" docs=${docs} JE=${je} lines=${jel} cust=${cust} sup=${sup} coa=${coa} templates=${tmpl} payments=${pay} assets=${assets} inventory=${inv}`);
  } finally { await p.$disconnect(); }
}
async function main() {
  await counts('DEV    ', urlFrom('.env'));
  await counts('STAGING', urlFrom('.env.staging'));
}
main().catch(e => { console.error(e.message); process.exit(1); });
