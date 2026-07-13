import { getXeroTokens, xeroGet, createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  // Xero open ACCPAY bills
  const xero = new Map<string, any>();
  for (let page = 1; ; page++) {
    const res = await xeroGet<any>(tokens, '/Invoices', { where: 'Type=="ACCPAY"', page, summaryOnly: 'true' });
    const invs: any[] = res.Invoices || [];
    if (!invs.length) break;
    for (const i of invs) xero.set(i.InvoiceID, i);
    if (invs.length < 100) break;
  }
  // AIMS bills by xeroBillId
  const bills = await prisma.document.findMany({ where: { organizationId: BIOFUEL_ORG_ID, type: 'BILL' }, select: { name: true, config: true } });
  const aims = new Map<string, any>();
  for (const b of bills) { const c: any = b.config || {}; if (c.xeroBillId) aims.set(c.xeroBillId, { name: b.name, ...c }); }
  console.log(`xero=${xero.size} aims=${aims.size}`);
  for (const [id, x] of xero) {
    if (['VOIDED', 'DELETED'].includes(x.Status)) continue;
    const due = Number(x.AmountDue) || 0;
    if (due <= 0.005) continue;
    const a = aims.get(id);
    if (!a) { console.log(`MISSING in AIMS: ${x.InvoiceNumber} status=${x.Status} due=${due} date=${x.DateString || '?'}`); continue; }
    const total = Number(a.totalAmount ?? a.xeroGross ?? 0);
    const paid = a.amountPaid !== undefined ? Number(a.amountPaid) : a.xeroBalance !== undefined ? R(total - Number(a.xeroBalance)) : 0;
    const out = R(total - paid);
    if (Math.abs(out - due) > 0.01) console.log(`AMOUNT DIFF: ${x.InvoiceNumber} xeroDue=${due} aimsOut=${out} (gross=${total} xeroBalance=${a.xeroBalance} amountPaid=${a.amountPaid ?? 'undef'} status=${a.xeroStatus} date=${a.billDate || a.date})`);
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
