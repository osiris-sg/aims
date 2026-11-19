/**
 * DEV ONLY: pay an imported ABSS opening bill with a real payment voucher (the app's own
 * PaymentVouchersService, booted against the dev DB) and check the journal is Dr AP / Cr bank and
 * the bill is settled; then remove the voucher and check the bill is owed again.
 *   npx ts-node --transpile-only scripts/_pv-imported-bill-devtest.ts <bills log.json>
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/elroylee/Desktop/aims/api-server-production/.env' });
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { PaymentVouchersService } from '../src/payment-vouchers/payment-vouchers.service';
import { PrismaService } from '../src/common/prisma.service';

(async () => {
  if (/neon\.tech/.test(process.env.DATABASE_URL || '') && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('refusing: DATABASE_URL is prod');
  const log = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (log.env !== 'dev') throw new Error('dev log only');
  const ORG = log.organizationId;
  const bill = [...log.bills].sort((a: any, b: any) => a.amount - b.amount)[0];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const pvs = app.get(PaymentVouchersService);
  const prisma: any = app.get(PrismaService);
  const actor = { id: 'devtest', name: 'Dev test' };
  const ok = (cond: boolean, what: string) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`);
    if (!cond) process.exitCode = 1;
  };
  await runAsOrg(ORG, async () => {
    const settings = await prisma.accountingSetting.findUnique({ where: { organizationId: ORG } });
    const ctl = (settings?.controlAccounts as any) || {};
    const creditor = ctl.creditorControl || 'CL001';
    const banks = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG, isActive: true }, select: { code: true, name: true, accountType: true } });
    const bank = banks.find((a: any) => a.code === ctl.cashAccount) || banks.find((a: any) => /bank/i.test(a.name) && /ASSET/.test(String(a.accountType)));
    console.log(`bill ${bill.name} ${bill.supplier} ${bill.amount}; creditor ${creditor}; bank ${bank?.code} ${bank?.name}`);
    const open = await pvs.openBills(ORG, bill.supplierId);
    const row = open.find((r: any) => r.documentId === bill.id);
    ok(!!row && Math.abs(row.outstanding - bill.amount) < 0.005, `the opening bill is offered on a payment voucher, owed ${row?.outstanding}`);
    const pv: any = await pvs.create(ORG, actor);
    await pvs.save(
      ORG,
      pv.id,
      {
        date: '2026-11-20',
        bankAccountCode: bank.code,
        currency: 'SGD',
        paymentMethod: 'transfer',
        lines: [{ amount: bill.amount, offset: { supplierId: bill.supplierId, rate: 1, allocations: [{ documentId: bill.id, amount: bill.amount }] } } as any],
      },
      actor,
    );
    const saved = await prisma.document.findFirst({ where: { id: pv.id }, select: { name: true, config: true } });
    ok(!(saved.config as any).incompleteReason, `voucher ${saved.name} saved complete ${(saved.config as any).incompleteReason ? `(incomplete: ${(saved.config as any).incompleteReason})` : ''}`);
    const jes = await prisma.journalEntry.findMany({ where: { organizationId: ORG, sourceDocumentId: pv.id, status: { not: 'VOID' } }, include: { lines: true } });
    const accById = new Map((await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true } })).map((a: any) => [a.id, a.code]));
    const lines = jes.flatMap((j: any) => j.lines.map((l: any) => ({ code: accById.get(l.accountId), dr: l.debit, cr: l.credit })));
    console.log(`journal ${jes.map((j: any) => `${j.journalNumber} ${j.type} ${j.status}`).join(', ')}: ${JSON.stringify(lines)}`);
    ok(jes.length === 1 && jes[0].type === 'PAYMENT' && jes[0].status === 'POSTED', 'one posted PAYMENT journal');
    ok(lines.some((l: any) => l.code === creditor && Math.abs(l.dr - bill.amount) < 0.005), `Dr ${creditor} (AP) ${bill.amount}`);
    ok(lines.some((l: any) => l.code === bank.code && Math.abs(l.cr - bill.amount) < 0.005), `Cr ${bank.code} (bank) ${bill.amount}`);
    const after = await prisma.document.findFirst({ where: { id: bill.id }, select: { config: true } });
    const c: any = after.config;
    ok(c.billStatus === 'PAID' && Number(c.amountPaid) === bill.amount && Number(c.outstandingBalance) === 0, `bill settled: ${c.billStatus}, paid ${c.amountPaid}, owed ${c.outstandingBalance}`);
    const billJes = await prisma.journalEntry.count({ where: { organizationId: ORG, sourceDocumentId: bill.id } });
    ok(billJes === 0, 'the imported bill itself still has no journal');
    await pvs.remove(ORG, pv.id, actor);
    const back = await prisma.document.findFirst({ where: { id: bill.id }, select: { config: true } });
    const b: any = back.config;
    ok(b.billStatus === 'POSTED' && Number(b.outstandingBalance) === bill.amount, `voucher removed: bill owed again (${b.billStatus}, owed ${b.outstandingBalance})`);
    const left = await prisma.journalEntry.count({ where: { organizationId: ORG, sourceDocumentId: pv.id, status: { not: 'VOID' } } });
    ok(left === 0, 'the voucher journal is void after removal');
  });
  await app.close();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('ERR', e?.message || e);
  process.exit(1);
});
