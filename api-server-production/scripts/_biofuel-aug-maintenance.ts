/**
 * guru 2026-09-17: Biofuel ESS/SIDS maintenance for August 2026.
 * Active units (not registered): ESS 138 of 186, SIDS 17 of 95.
 * Rates and wording follow TI2202608-001/002 (June/July): ESS 20.00, SIDS 9.00.
 * ECM deliberately not charged — guru's standing instruction from 2026-08-04.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY=process.argv.includes('--apply');
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const TEMPLATE='bfa46b89-7619-454d-bc9a-303b909241c3';
const NO='TI2202609-007', DATE='2026-09-17';
const ESS_Q=138, ESS_R=20, SIDS_Q=17, SIDS_R=9;
(async()=>{
  console.log(`==== .env.production ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  if((await prisma.document.findFirst({where:{organizationId:ORG,name:NO}}))){ console.log(`ABORT — ${NO} exists`); return; }
  const mk=(code:string,desc:string,q:number,r:number)=>({id:Date.now()+Math.floor(Math.random()*10000),
    itemCode:code,inventoryItemId:'',description:desc,quantity:q,unitPrice:r,amount:+(q*r).toFixed(2),
    isService:true,revenueTag:'service',accountCode:'SS002',tax:0});
  const items=[mk('SV001',`ESS Maintenance for August 2026`,ESS_Q,ESS_R),
               mk('SV002',`SIDS Maintenance for August 2026`,SIDS_Q,SIDS_R)];
  const total=+items.reduce((s,i)=>s+i.amount,0).toFixed(2);
  const cfg={date:DATE,dueDate:DATE,doNo:'',note:'',poNo:'',rate:1,billTo:'',qinRef:'',contact:'',issueBy:'',remarks:'',
    company:{name:'Osiris Technology Pte. Ltd.',address:'71 Ayer Rajah Crescent, #04-01, Singapore 139951',phoneNumber:'91151041'},
    currency:'SGD',gstRegNo:'202410096C',subTotal:total,absorbTax:'N',attention:{name:'',email:'',phoneNumber:''},
    gstAmount:0,nettTotal:total,grossTotal:total,gstPercent:0,taxApplicable:'N',discountAmount:0,discountPercent:0,
    customerId:'520d7e74-16fb-4977-9603-6b2bfcf13f29',customerCode:'CB001',customerName:'Biofuel Industries Pte. Ltd.',
    customerEmail:'eugene@biofuelindustries.sg',customerAddress:'22 Tuas Avenue 2, Singapore, 639453',
    deliveryTo:'',collectFrom:'',salesMobile:'',salesPerson:'',agreementText:'',footerMessage:'',termsAndConditions:'',
    paymentTerms:'0 DAYS',documentNumber:NO,referenceNo:'ESS + SIDS maintenance — August 2026',
    sourceDocumentId:'',sourceDocumentType:'',sourceDocumentNumber:'',items};
  items.forEach(i=>console.log(`  ${i.description.padEnd(34)} ${String(i.quantity).padStart(4)} x ${i.unitPrice.toFixed(2).padStart(6)} = ${i.amount.toFixed(2).padStart(9)}`));
  console.log(`  ${'TOTAL'.padEnd(34)} ${''.padStart(17)} ${total.toFixed(2).padStart(9)}`);
  console.log(`\n  (ECM not charged — standing instruction)`);
  if(!APPLY){ console.log('\n(dry run)'); return; }
  const d=await prisma.document.create({data:{organizationId:ORG,documentTemplateId:TEMPLATE,type:'INVOICE',name:NO,status:'unconfirmed',config:cfg as any}});
  console.log(`\ncreated ${NO}  id=${d.id}`);
})().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
