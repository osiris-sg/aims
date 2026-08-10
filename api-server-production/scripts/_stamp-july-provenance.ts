// Append verification provenance to the imported templates' NAMES (internal
// only — never printed): which July invoice + which "Nth mth" was followed,
// so guru can eyeball that the continued counter is right.
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '..', process.argv.includes('--prod') ? '.env.production' : '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const ord = (n: number) => `${n}${[11,12,13].includes(n%100) ? 'th' : ['th','st','nd','rd'][n%10] || 'th'}`;
async function main() {
  const rows: any[] = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/412415e1-ee3c-4c60-8a8b-ca1a1aaa9761/scratchpad/july-rentals.json', 'utf8'));
  let updated = 0;
  for (const r of rows) {
    const t = await p.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, name: `Recurring — ${r.inv}`, createdBy: 'july-rentals-import' } });
    if (!t) continue;
    const nth = (r.ref + ' ' + r.desc + ' ' + r.contract).match(/(\d{1,3})(?:st|nd|rd|th)\s+mth/i);
    const julyN = nth ? parseInt(nth[1], 10) : null;
    const tag = julyN != null ? `(Jul ${r.inv} was ${ord(julyN)} mth → next ${ord(t.nextRunNo)})` : `(from Jul ${r.inv})`;
    await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { name: `Recurring — ${r.inv} ${tag}` } });
    updated++;
  }
  console.log('updated names:', updated);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
