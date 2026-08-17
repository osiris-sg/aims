/**
 * Settle the 5 Aug 2026 Biofuel payment of 57,063.28 = 50,000.00 + 7,063.28.
 *   TI2202607-004 (50,000.00)  pending_payment → paid
 *   TI2202607-006 ( 7,063.28)  unconfirmed → paid  (Aspire calls it TI2202607-005)
 * TI2202607-003 (6,863.40) is NOT touched — superseded by -006, needs guru's call.
 * Dry / --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const PAID_ON='2026-08-05';
const BANK_REF='PIGSG02132A09875';
const TARGETS=['TI2202607-004','TI2202607-006'];
async function main(){
  console.log(`==== .env.production ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, name:{ in:TARGETS } }, orderBy:{ name:'asc' } });
  let sum=0;
  for(const d of docs as any[]){
    const c:any=d.config||{};
    sum += c.nettTotal||0;
    console.log(`  ${d.name}  ${String(c.nettTotal).padStart(9)}  ${d.status} → paid   (bank ${PAID_ON}, ref ${BANK_REF})`);
    if(!APPLY) continue;
    await prisma.document.update({ where:{ id:d.id }, data:{
      status:'paid',
      config:{ ...c,
        confirmedAt: c.confirmedAt || new Date(`${PAID_ON}T00:00:00.000Z`).toISOString(),
        paidAt: new Date(`${PAID_ON}T00:00:00.000Z`).toISOString(),
        paymentReference: BANK_REF,
      } as any,
    }});
  }
  console.log(`\n  settles ${sum.toFixed(2)} of the 57,063.28 received  ${Math.abs(sum-57063.28)<0.005?'✓ exact':'✗ MISMATCH'}`);
  console.log(APPLY?'\napplied':'\n(dry run)');
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
