/**
 * guru 2026-09-15: DT Matrix OSIRIS OFFICE monthly membership, 250/month.
 * INV-057 (Aspire) covered May 2026. These carry Jun-Sep 2026.
 * Dated TODAY as a catch-up run rather than back-dated, so they don't arrive
 * already overdue; all four fall in FY2026 either way.
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
const CUST={id:'fb0711ec-fb7f-4bd9-9ebf-64cb29593b81',code:'CD002',name:'DT Matrix PTE. LTD.',
  email:'arthur@dtmatrix.com',address:'71 Ayer Rajah Crescent, #04-01, Singapore 139951'};
const DATE='2026-09-15', DUE='2026-10-15', RATE=250;
const MONTHS=[['TI2202609-003','June 2026'],['TI2202609-004','July 2026'],
              ['TI2202609-005','August 2026'],['TI2202609-006','September 2026']];
(async()=>{
  console.log(`==== .env.production ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  const clash=await prisma.document.findMany({where:{organizationId:ORG,name:{in:MONTHS.map(x=>x[0])}},select:{name:true}});
  if(clash.length){ console.log('ABORT — already exist:',clash.map((c:any)=>c.name).join(', ')); return; }
  for(const [no,label] of MONTHS){
    const desc=`Monthly Membership for OSIRIS OFFICE application for ${label}`;
    const cfg={date:DATE,dueDate:DUE,doNo:'',note:'',poNo:'',rate:1,billTo:'',qinRef:'',contact:'',issueBy:'',remarks:'',
      company:{name:'Osiris Technology Pte. Ltd.',address:'71 Ayer Rajah Crescent, #04-01, Singapore 139951',phoneNumber:'91151041'},
      currency:'SGD',gstRegNo:'202410096C',subTotal:RATE,absorbTax:'N',attention:{name:'',email:'',phoneNumber:''},
      gstAmount:0,nettTotal:RATE,grossTotal:RATE,gstPercent:0,taxApplicable:'N',discountAmount:0,discountPercent:0,
      customerId:CUST.id,customerCode:CUST.code,customerName:CUST.name,customerEmail:CUST.email,customerAddress:CUST.address,
      deliveryTo:'',collectFrom:'',salesMobile:'',salesPerson:'',agreementText:'',footerMessage:'',termsAndConditions:'',
      paymentTerms:'30 DAYS',documentNumber:no,referenceNo:`OSIRIS OFFICE membership — ${label}`,
      sourceDocumentId:'',sourceDocumentType:'',sourceDocumentNumber:'',
      items:[{id:Date.now()+Math.floor(Math.random()*1000),itemCode:'SV012',inventoryItemId:'',description:desc,
        quantity:1,unitPrice:RATE,amount:RATE,isService:true,revenueTag:'service',accountCode:'SS002',tax:0}]};
    console.log(`  ${no}  ${label.padEnd(16)} ${RATE.toFixed(2).padStart(8)}  → SS002`);
    if(!APPLY) continue;
    await prisma.document.create({data:{organizationId:ORG,documentTemplateId:TEMPLATE,type:'INVOICE',
      name:no,status:'unconfirmed',config:cfg as any}});
  }
  console.log(APPLY?`\ncreated ${MONTHS.length} invoices, 1,000.00 total`:'\n(dry run)');
})().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
