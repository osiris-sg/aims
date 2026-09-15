import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const FROM=new Date('2025-01-01T00:00:00Z'), TO=new Date('2025-12-31T23:59:59Z');
function person(cp:string){
  const s=cp.replace(/\s+/g,' ').trim();
  const map:[RegExp,string][]=[[/KUMARAGURU|^Guru\b|^Kumaraguru/i,'Guru / Kumaraguru'],[/LWIN MAUNG|^lwin\b/i,'Lwin Maung Maung Thaw'],
   [/Chan Yi Xuan|^Shane\b/i,'Chan Yi Xuan'],[/Elroy Lee/i,'Elroy Lee'],[/Tai Kin Leong/i,'Tai Kin Leong'],[/Johnny/i,'Johnny'],
   [/Lim Shu Wu/i,'Lim Shu Wu'],[/BRIAN TONG/i,'Brian Tong'],[/SOBTI GARVIT/i,'Sobti Garvit'],[/LAU WEI BIN/i,'Lau Wei Bin'],
   [/Jeremy Chua/i,'Jeremy Chua'],[/Heimen Hoy/i,'Heimen Hoy'],[/Dardae/i,'Dardae'],[/PRADHEEP/i,'Pradheep'],[/Kai Sheng/i,'Kai Sheng'],
   [/Tint Lwin/i,'Tint Lwin'],[/alphashu/i,'alphashu'],[/deniselum/i,'deniselum'],[/JG Jenny/i,'JG Jenny'],[/GWYNETH/i,'Gwyneth Wang'],[/LEX YOXX/i,'Lex Yoxx']];
  for(const [rx,n] of map) if(rx.test(s)) return n; return s.slice(0,30);
}
// decided 18 Aug but never posted
const DECIDED:Record<string,string>={'2025-11-07|5070':'CS003 Brian pass-through','2025-12-07|5827':'CS003 Brian pass-through',
 '2025-01-04|1500':'EX010 director salary','2025-02-04|1500':'EX010 director salary','2025-03-03|1500':'EX010 director salary','2025-04-22|1500':'EX010 director salary'};
(async()=>{
  const a=await prisma.chartOfAccount.findFirst({where:{organizationId:ORG,code:'CA900'}});
  const lines=await prisma.journalEntryLine.findMany({
    where:{accountId:a!.id, journalEntry:{organizationId:ORG,status:'POSTED',entryDate:{gte:FROM,lte:TO}}},
    include:{journalEntry:{select:{entryDate:true,journalNumber:true}}}, orderBy:{journalEntry:{entryDate:'asc'}},
  });
  const g=new Map<string,any[]>();
  for(const l of lines as any[]){
    const d=String(l.description||''); const who=person(d.split(' — ')[0]);
    const date=l.journalEntry.entryDate.toISOString().slice(0,10);
    const amt=l.debit>0?-l.debit:l.credit;
    (g.get(who)||g.set(who,[]).get(who)!).push({date,amt,detail:d.split(' — ').slice(1).join(' — ').trim(),
      decided:DECIDED[`${date}|${Math.round(Math.abs(amt))}`]||''});
  }
  const groups=[...g.entries()].map(([who,tx])=>({who,tx,net:tx.reduce((s:number,t:any)=>s-t.amt,0)})).sort((x,y)=>y.net-x.net);
  console.log(`FY2025 suspense — ${lines.length} transactions, ${groups.length} people, net 54,705.15\n`);
  let decided=0;
  for(const [i,x] of groups.entries()){
    console.log(`${String(i+1).padStart(2)}. ${x.who.padEnd(24)} ${x.tx.length} txn   net ${x.net.toFixed(2).padStart(10)}`);
    for(const t of x.tx){ if(t.decided) decided+=-t.amt;
      console.log(`      ${t.date} ${t.amt.toFixed(2).padStart(10)}  ${(t.detail||'(no reference)').slice(0,40).padEnd(40)} ${t.decided?'✓ '+t.decided:''}`); }
  }
  console.log(`\nalready decided on 18 Aug (not yet posted): ${decided.toFixed(2)}`);
  console.log(`still needs a decision:                     ${(54705.15-decided).toFixed(2)}`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
