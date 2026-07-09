import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Check counts on ALL key tables
  const tables = [
    'organization', 'document', 'documentTemplate', 'bill', 'billPayment',
    'customer', 'supplier', 'journalEntry', 'journalEntryLine', 'chartOfAccount', 'payment',
  ];
  for (const t of tables) {
    try {
      const c = await (p as any)[t].count();
      console.log(`${t.padEnd(25)} ${c.toLocaleString()}`);
    } catch (e: any) {
      console.log(`${t.padEnd(25)} ERROR: ${e.message.slice(0,80)}`);
    }
  }
}
main().finally(()=>p.$disconnect());
