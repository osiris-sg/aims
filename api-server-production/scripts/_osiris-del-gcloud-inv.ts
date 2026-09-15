/**
 * guru 2026-09-15: delete TI2202605-003 (791.38, "Google Cloud recharge").
 * AIMS-created 2026-05-17 back-dated to 2025-10-31, no customer, 9% applied
 * twice on a non-GST company, and no matching Google Cloud cost (Oct 2025 was
 * 300.00). Its journal is DELETED rather than reversed so FY2025 stays clean —
 * a reversal dated today would land the correction in FY2026.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY=process.argv.includes('--apply');
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  console.log(`==== .env.production ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  const doc=await prisma.document.findFirst({where:{organizationId:ORG,name:'TI2202605-003'}});
  const jes=await prisma.journalEntry.findMany({where:{organizationId:ORG,reference:{contains:'TI2202605-003'}},include:{lines:true}});
  console.log(`document : ${doc?.name} [${doc?.status}] ${(doc?.config as any)?.nettTotal}`);
  console.log(`journals : ${jes.map((j:any)=>`${j.journalNumber}[${j.status}] ${j.totalDebit}`).join(', ')||'none'}`);
  console.log(`\neffect on FY2025: revenue −791.38 (SS005), Trade Receivables −791.38`);
  if(!APPLY){ console.log('\n(dry run — nothing written)'); return; }
  fs.writeFileSync(path.join(os.homedir(),'Downloads','osiris-deleted-TI2202605-003.json'),JSON.stringify({doc,jes},null,1));
  for(const j of jes as any[]) await prisma.journalEntry.delete({where:{id:j.id}});
  if(doc) await prisma.document.delete({where:{id:doc.id}});
  console.log(`\ndeleted document + ${jes.length} journal entr${jes.length===1?'y':'ies'} (backed up to ~/Downloads)`);
})().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
