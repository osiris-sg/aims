import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
async function main(){
  const bank = await prisma.chartOfAccount.findFirst({ where:{ organizationId:ORG, code:'CA101' } });
  // every JE where the bank was CREDITED = money leaving the account
  const jes = await prisma.journalEntry.findMany({
    where:{ organizationId:ORG, status:'POSTED', lines:{ some:{ accountId:bank!.id, credit:{ gt:0 } } } },
    include:{ lines:{ include:{ account:{ select:{ code:true, name:true } } } } },
    orderBy:{ entryDate:'asc' },
  });
  const rows:any[]=[];
  for(const je of jes as any[]){
    const out = je.lines.find((l:any)=>l.accountId===bank!.id && l.credit>0);
    const contra = je.lines.find((l:any)=>l.debit>0);
    if(!out||!contra) continue;
    const d=String(out.description||'');
    rows.push({
      date: je.entryDate.toISOString().slice(0,10),
      counterparty: d.split(' — ')[0].trim(),
      detail: d.split(' — ').slice(1).join(' — ').trim(),
      amount: out.credit,
      account: contra.account.code,
      accountName: contra.account.name,
      held: contra.account.code==='CA900' ? 'YES — pending classification' : '',
      bankRef: je.reference||'',
      jv: je.journalNumber,
    });
  }
  rows.sort((a,b)=> b.amount-a.amount);
  const total=rows.reduce((s,r)=>s+r.amount,0);
  const byAcct=new Map<string,{n:number;t:number;name:string}>();
  for(const r of rows){ const b=byAcct.get(r.account)||{n:0,t:0,name:r.accountName}; b.n++; b.t+=r.amount; byAcct.set(r.account,b); }
  console.log(`${rows.length} money-out transactions totalling ${total.toLocaleString('en-SG',{minimumFractionDigits:2})}\n`);
  console.log(`${'acct'.padEnd(7)} ${'account'.padEnd(40)} ${'n'.padStart(5)} ${'total'.padStart(14)}`);
  console.log('-'.repeat(70));
  for(const [c,b] of [...byAcct].sort((a,b)=>b[1].t-a[1].t))
    console.log(`${c.padEnd(7)} ${b.name.slice(0,40).padEnd(40)} ${String(b.n).padStart(5)} ${b.t.toLocaleString('en-SG',{minimumFractionDigits:2}).padStart(14)}`);
  console.log('-'.repeat(70));
  console.log(`${'TOTAL'.padEnd(48)} ${String(rows.length).padStart(5)} ${total.toLocaleString('en-SG',{minimumFractionDigits:2}).padStart(14)}`);

  const esc=(s:any)=>`"${String(s??'').replace(/"/g,'""')}"`;
  const out = path.join(os.homedir(),'Downloads','osiris-money-out.csv');
  fs.writeFileSync(out, [
    'Date,Counterparty,Detail,Amount,Account,"Account name","Held for review","Bank ref",JV',
    ...rows.map(r=>[r.date,esc(r.counterparty),esc(r.detail),r.amount.toFixed(2),r.account,esc(r.accountName),esc(r.held),esc(r.bankRef),r.jv].join(',')),
  ].join('\n'));
  console.log(`\nwrote ${out}`);
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
