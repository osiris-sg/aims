import { PrismaClient } from '@prisma/client';
import { getXeroTokens, xeroGet } from './xero-migration/_common';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const prisma = new PrismaClient();

async function main() {
  const tokens = await getXeroTokens(prisma, ORG);
  console.log(`Connected: tenant ${tokens.tenantId}\n`);

  // 1) Available reports
  console.log('=== /Reports (available) ===');
  try {
    const list = await xeroGet<any>(tokens, '/Reports');
    for (const r of (list.Reports || [])) console.log(`  ${r.ReportID} | ${r.ReportName} (${r.ReportType})`);
  } catch (e: any) { console.log('  ERR', e.message?.slice(0,150)); }

  // 2) Current Trial Balance from Xero
  console.log('\n=== Xero Trial Balance (today) ===');
  try {
    const tb = await xeroGet<any>(tokens, '/Reports/TrialBalance');
    const rep = tb.Reports?.[0];
    console.log(`  ${(rep?.ReportTitles||[]).join(' | ')}`);
    let dr=0, cr=0, n=0;
    const walk=(rows:any[])=>{ for(const row of rows||[]){ if(row.RowType==='Row'){ const cells=row.Cells||[]; const d=parseFloat(cells[cells.length-2]?.Value||'0')||0; const c=parseFloat(cells[cells.length-1]?.Value||'0')||0; dr+=d; cr+=c; n++; } if(row.Rows) walk(row.Rows); } };
    walk(rep?.Rows||[]);
    console.log(`  accounts=${n}  total Debit=${dr.toFixed(2)}  total Credit=${cr.toFixed(2)}`);
  } catch (e: any) { console.log('  ERR', e.message?.slice(0,150)); }

  // 3) Journals API — GL source. First page shape + convention.
  console.log('\n=== /Journals (offset 0, first page) ===');
  try {
    const j = await xeroGet<any>(tokens, '/Journals', { offset: 0 });
    const js = j.Journals || [];
    console.log(`  returned ${js.length} journals (page size 100)`);
    const first = js[0];
    if (first) {
      console.log(`  sample: JournalNumber=${first.JournalNumber} date=${first.JournalDate} ref="${first.Reference||''}" src=${first.SourceType}`);
      for (const l of (first.JournalLines||[]).slice(0,4)) console.log(`    line: ${l.AccountCode} ${l.AccountName?.slice(0,22)} Net=${l.NetAmount} Gross=${l.GrossAmount} Tax=${l.TaxType||''}`);
    }
    const maxJn = Math.max(...js.map((x:any)=>x.JournalNumber||0));
    console.log(`  highest JournalNumber on page 1: ${maxJn}`);
  } catch (e: any) { console.log('  ERR', e.message?.slice(0,150)); }

  // 4) Dev DB current GL for comparison
  console.log('\n=== Dev DB GL (Biofuel) ===');
  const agg = await prisma.journalEntryLine.aggregate({ where:{ journalEntry:{ organizationId:ORG, postedBy:'xero-import' } }, _sum:{ debit:true, credit:true } });
  const cnt = await prisma.journalEntry.count({ where:{ organizationId:ORG } });
  console.log(`  JE=${cnt}  total Debit=${(agg._sum.debit||0).toFixed(2)}  total Credit=${(agg._sum.credit||0).toFixed(2)}`);
}
main().catch(e=>{console.error('FATAL', e.message);process.exit(1);}).finally(()=>prisma.$disconnect());
