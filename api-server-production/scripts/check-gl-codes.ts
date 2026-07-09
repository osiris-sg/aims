import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
const p = new PrismaClient();
async function main() {
  const wb = xlsx.readFile('/Users/guru/Downloads/Biofuel_Industries_Pte_Ltd_-_General_Ledger_Detail.xlsx');
  const rows: any[] = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const dataRows = rows.filter(r => r[0] && /^\d{1,2}\s\w{3}\s\d{4}$/.test(r[0]));
  const glCodes = new Set<string>(dataRows.map(r => String(r[1])));

  const ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const coa = await p.chartOfAccount.findMany({ where: { organizationId: ORG_ID }, select: { code: true, name: true } });
  const coaCodes = new Set(coa.map(c => c.code));

  const missing = [...glCodes].filter(c => !coaCodes.has(c)).sort();
  const unused = [...coaCodes].filter(c => !glCodes.has(c)).sort();
  console.log('GL codes:', glCodes.size, '| CoA codes:', coaCodes.size);
  console.log('GL codes NOT in CoA (must add):', missing.length);
  missing.forEach(c => {
    const sample = dataRows.find(r => String(r[1])===c);
    console.log(`  ${c.padEnd(6)} (${sample?.[2]}) seen in source: ${sample?.[3]}`);
  });
  console.log('\nCoA codes NOT used in GL (fine, just inactive accounts):', unused.length);
}
main().finally(() => p.$disconnect());
