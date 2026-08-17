import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
// collapse "Guru 91151041" / "Kumaraguru 0169786092 Trust Bank..." → one person
function person(cp:string){
  const s=cp.replace(/\s+/g,' ').trim();
  const map:[RegExp,string][]=[
    [/KUMARAGURU|^Guru\b|^Kumaraguru/i,'Guru / Kumaraguru'],
    [/LWIN MAUNG MAUNG THAW|^lwin\b/i,'Lwin Maung Maung Thaw'],
    [/Chan Yi Xuan|^Shane\b/i,'Chan Yi Xuan (incl. "Shane")'],
    [/Elroy Lee/i,'Elroy Lee'],[/Tai Kin Leong/i,'Tai Kin Leong'],[/Johnny/i,'Johnny'],
    [/Lim Shu Wu/i,'Lim Shu Wu'],[/BRIAN TONG/i,'Brian Tong'],[/SOBTI GARVIT/i,'Sobti Garvit'],
    [/LAU WEI BIN/i,'Lau Wei Bin'],[/Jeremy Chua/i,'Jeremy Chua'],[/Heimen Hoy/i,'Heimen Hoy'],
    [/Dardae/i,'Dardae'],[/PRADHEEP/i,'Pradheep'],[/Kai Sheng/i,'Kai Sheng'],[/Tint Lwin/i,'Tint Lwin'],
    [/alphashu/i,'alphashu'],[/deniselum/i,'deniselum'],[/JG Jenny/i,'JG Jenny'],
    [/GWYNETH/i,"Gwyneth Wang"],[/LEX YOXX/i,'Lex Yoxx'],
  ];
  for(const [rx,n] of map) if(rx.test(s)) return n;
  return s.slice(0,34);
}
async function main(){
  const acct = await prisma.chartOfAccount.findFirst({ where:{ organizationId:ORG, code:'CA900' } });
  const lines = await prisma.journalEntryLine.findMany({
    where:{ accountId:acct!.id, journalEntry:{ organizationId:ORG, status:'POSTED' } },
    include:{ journalEntry:{ select:{ entryDate:true, journalNumber:true } } },
  });
  const g=new Map<string,any[]>();
  for(const l of lines as any[]){
    const d=String(l.description||''); const who=person(d.split(' — ')[0]);
    (g.get(who)||g.set(who,[]).get(who)!).push({
      date:l.journalEntry.entryDate.toISOString().slice(0,10),
      amt: l.debit>0? -l.debit : l.credit,
      raw:d.split(' — ')[0].replace(/\s+/g,' ').trim(),
      detail:d.split(' — ').slice(1).join(' — ').trim(),
    });
  }
  const groups=[...g.entries()].map(([who,tx])=>({who,tx:tx.sort((a,b)=>a.date.localeCompare(b.date)),
    out:tx.filter(t=>t.amt<0).reduce((s,t)=>s-t.amt,0), inn:tx.filter(t=>t.amt>0).reduce((s,t)=>s+t.amt,0)}))
    .sort((a,b)=>(b.out-b.inn)-(a.out-a.inn));
  console.log(`${groups.length} people · ${lines.length} transactions · net 177,015.99\n`);
  groups.forEach((x,i)=>console.log(`${String(i+1).padStart(2)}. ${x.who.padEnd(30)} ${String(x.tx.length).padStart(3)} txns   out ${x.out.toFixed(2).padStart(10)}   in ${x.inn.toFixed(2).padStart(9)}   net ${(x.out-x.inn).toFixed(2).padStart(10)}`));
  fs.writeFileSync('/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/d7f521e6-33f7-4c8a-a142-5ca2a1753301/scratchpad/suspense_groups.json', JSON.stringify(groups,null,1));
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
