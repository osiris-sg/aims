/**
 * Seed Osiris's Revenue Master File (services only — Osiris sells no products).
 * Derived from 78 line items across 44 real invoices. Each maps to a GL revenue
 * account so invoice lines self-code. guru 2026-08-18.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile,'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';

const ITEMS: Array<{code:string;name:string;unitPrice:number|null;accountCode:string}> = [
  // recurring maintenance → SS002
  { code:'SV001', name:'ESS Maintenance (per unit / month)',      unitPrice:20,   accountCode:'SS002' },
  { code:'SV002', name:'SIDS Maintenance (per unit / month)',     unitPrice:9,    accountCode:'SS002' },
  { code:'SV003', name:'ECM Maintenance (per unit / month)',      unitPrice:15,   accountCode:'SS002' },
  { code:'SV004', name:'Water-SG Maintenance (monthly)',          unitPrice:10,   accountCode:'SS002' },
  { code:'SV005', name:'Project Maintenance — monthly retainer',  unitPrice:null, accountCode:'SS002' },
  // retainers / projects
  { code:'SV006', name:'Monthly Retainer Fee',                    unitPrice:8000, accountCode:'SS005' },
  { code:'SV007', name:'Software Development — project',          unitPrice:null, accountCode:'SS003' },
  { code:'SV008', name:'Website Development & Maintenance',       unitPrice:null, accountCode:'SS003' },
  { code:'SV009', name:'Mobile Application Development',          unitPrice:null, accountCode:'SS003' },
  { code:'SV010', name:'Sourcing-as-a-Service',                   unitPrice:null, accountCode:'SS005' },
  { code:'SV011', name:'Consulting / Advisory',                   unitPrice:null, accountCode:'SS005' },
  { code:'SV012', name:'Membership Fee (monthly)',                unitPrice:250,  accountCode:'SS005' },
  // recharges → SS004
  { code:'SV013', name:'Hardware supplied (recharge at cost)',    unitPrice:null, accountCode:'SS004' },
  { code:'SV014', name:'Third-party fees recharged',              unitPrice:null, accountCode:'SS004' },
];

async function main(){
  console.log(`==== ${envFile} ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  const accts = await prisma.chartOfAccount.findMany({ where:{ organizationId:ORG }, select:{ id:true, code:true, name:true } });
  const byCode = new Map(accts.map((a:any)=>[a.code,a]));
  const have = await prisma.revenueItem.findMany({ where:{ organizationId:ORG }, select:{ code:true } });
  const haveCodes = new Set(have.map((h:any)=>h.code));
  console.log(`existing revenue items: ${haveCodes.size}\n`);
  const todo = ITEMS.filter(i=>!haveCodes.has(i.code));
  for(const i of todo){
    const a:any = byCode.get(i.accountCode);
    if(!a){ console.log(`  !! ${i.code} — GL ${i.accountCode} missing, skipped`); continue; }
    console.log(`  + ${i.code}  ${i.name.padEnd(42)} ${i.unitPrice!=null?String(i.unitPrice).padStart(7):'      —'}  → ${a.code} ${a.name}`);
    if(!APPLY) continue;
    await prisma.revenueItem.create({ data:{ organizationId:ORG, code:i.code, name:i.name, type:'SERVICE',
      unitPrice:i.unitPrice ?? undefined, taxRate:0, accountCode:a.code, accountId:a.id, isActive:true }});
  }
  console.log(APPLY?`\ncreated ${todo.length} revenue items`:'\n(dry run — re-run with --apply)');
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
